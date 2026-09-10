/**
 * `delivery-recovery` – automatisk återleverans av leads samt larmunderlag.
 *
 * SÄKERHET / GARANTIER
 * - STANDARDLÄGE är DRY-RUN: `execute` default false. En dry-run gör INGA
 *   skrivningar och INGA nätverksanrop – endast läsningar.
 * - `execute: true` är hårdspärrat av runtime-flaggan
 *   NORYVA_DELIVERY_RETRY_ENABLED=true. Saknas den returneras 403 blocked.
 * - Återleverans skapar aldrig ett nytt lead: samma sparade payload och samma
 *   idempotency-nyckel återanvänds, och leveransen claimas atomiskt via
 *   befintliga `claim_lead_delivery`.
 * - Endast publicerad kund med `delivery_webhook_url` levereras till.
 * - Inga LLM-anrop, inga mail, inga hemligheter i svaret.
 */
import { buildMakeFields, readStoredPayload } from "@/lib/landing/make-adapter";
import { pickDeliveryFields } from "@/lib/landing/delivery";
import { scoreVaruautomat } from "@/lib/landing/scoring";
import { buildContactUrl } from "@/lib/leads/contact-token";
import type { PublicQuestion } from "@/lib/landing/schema";
import type { RuntimeEnv } from "./runtime-env";
import type { GrowthContext } from "./service.server";

export const DEFAULT_LIMIT = 25;
export const MAX_ATTEMPTS = 5;
/** Ett `sending` som legat längre än så här räknas som fastnat. */
export const STALE_SENDING_SECONDS = 900;
/** Ett odlevererat lead äldre än så här kräver manuell koll. */
export const ALERT_AGE_HOURS = 24;
/** Kontrollerad backoff per genomfört försök (minuter). */
export const BACKOFF_MINUTES = [5, 15, 60, 240, 720];

export const RECOVERABLE_STATUSES = ["pending", "failed", "sending"] as const;

export type DeliveryCandidate = {
  leadId: string;
  customerId: string;
  deliveryStatus: string;
  attempts: number;
  createdAt: string | null;
  lastAttemptAt: string | null;
  ageHours: number | null;
  nextRetryAt: string | null;
  retryable: boolean;
  needsAlert: boolean;
  alertReasons: string[];
  reason: string;
  /** Endast satt när execute genomförts för detta lead. */
  result?: "delivered" | "failed" | "skipped";
  resultDetail?: string;
};

export type DeliveryRecoveryResult = {
  status: number;
  body: Record<string, unknown>;
};

function backoffMinutes(attempts: number): number {
  const idx = Math.min(Math.max(attempts, 0), BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[idx] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]!;
}

function hoursBetween(from: string | null, now: Date): number | null {
  if (!from) return null;
  const t = Date.parse(from);
  if (Number.isNaN(t)) return null;
  return Math.round(((now.getTime() - t) / 3_600_000) * 10) / 10;
}

/** Ren, testbar bedömning av ett lead. Inga sidoeffekter. */
export function evaluateCandidate(
  lead: {
    id: string;
    customer_id: string;
    delivery_status: string;
    delivery_attempts?: number | null;
    created_at?: string | null;
    last_attempt_at?: string | null;
  },
  now: Date,
): DeliveryCandidate | null {
  const status = String(lead.delivery_status ?? "");
  if (!RECOVERABLE_STATUSES.includes(status as (typeof RECOVERABLE_STATUSES)[number])) return null;

  const attempts = Number(lead.delivery_attempts ?? 0) || 0;
  const createdAt = lead.created_at ?? null;
  const lastAttemptAt = lead.last_attempt_at ?? null;
  const base = lastAttemptAt ?? createdAt;
  const ageHours = hoursBetween(createdAt, now);
  const alertReasons: string[] = [];

  // Ett pågående `sending` är bara en kandidat när det fastnat.
  if (status === "sending") {
    const since = base ? (now.getTime() - Date.parse(base)) / 1000 : Infinity;
    if (!(since >= STALE_SENDING_SECONDS)) return null;
    alertReasons.push("stale_sending");
  }

  const nextRetryAt = base
    ? new Date(Date.parse(base) + backoffMinutes(attempts) * 60_000).toISOString()
    : now.toISOString();
  const backoffElapsed = Date.parse(nextRetryAt) <= now.getTime();

  let retryable = true;
  let reason = "Redo för nytt leveransförsök.";

  if (attempts >= MAX_ATTEMPTS) {
    retryable = false;
    reason = "Max antal leveransförsök uppnått – kräver manuell hantering.";
    alertReasons.push("max_attempts");
  } else if (!backoffElapsed) {
    retryable = false;
    reason = "Väntar på backoff-fönstret.";
  }

  if (ageHours !== null && ageHours >= ALERT_AGE_HOURS) alertReasons.push("undelivered_too_long");

  return {
    leadId: lead.id,
    customerId: lead.customer_id,
    deliveryStatus: status,
    attempts,
    createdAt,
    lastAttemptAt,
    ageHours,
    nextRetryAt,
    retryable,
    needsAlert: alertReasons.length > 0,
    alertReasons,
    reason,
  };
}

export type DeliveryRecoveryDeps = {
  /** Injicerbar för test. Anropas ALDRIG i dry-run. */
  fetchImpl?: typeof fetch;
};

export async function deliveryRecoveryCore(
  ctx: GrowthContext,
  input: { limit?: number; execute?: boolean },
  env: RuntimeEnv,
  now: Date = new Date(),
  deps: DeliveryRecoveryDeps = {},
): Promise<DeliveryRecoveryResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const execute = input.execute === true;
  const retryEnabled = env["NORYVA_DELIVERY_RETRY_ENABLED"] === "true";

  if (execute && !retryEnabled) {
    return {
      status: 403,
      body: {
        blocked: true,
        error: "Återleverans är avstängd. NORYVA_DELIVERY_RETRY_ENABLED måste vara true.",
        executed: false,
        dryRun: true,
        externalEffect: false,
        notificationSent: false,
      },
    };
  }

  const { data: rows, error } = await ctx.supabase
    .from("leads")
    .select(
      "id, customer_id, industry, payload, idempotency_key, delivery_status, delivery_attempts, created_at, last_attempt_at",
    )
    .in("delivery_status", RECOVERABLE_STATUSES as unknown as string[])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const leadRows = (rows ?? []) as Array<Record<string, any>>;
  const candidates: DeliveryCandidate[] = [];
  const byId = new Map<string, Record<string, any>>();
  for (const row of leadRows) {
    const evaluated = evaluateCandidate(row as any, now);
    if (!evaluated) continue;
    byId.set(evaluated.leadId, row);
    candidates.push(evaluated);
  }

  if (!execute) {
    return {
      status: 200,
      body: {
        dryRun: true,
        executed: false,
        limit,
        maxAttempts: MAX_ATTEMPTS,
        count: candidates.length,
        candidates,
        externalEffect: false,
        notificationSent: false,
      },
    };
  }

  const doFetch = deps.fetchImpl ?? fetch;
  let delivered = 0;
  let failed = 0;

  for (const candidate of candidates) {
    if (!candidate.retryable) {
      candidate.result = "skipped";
      candidate.resultDetail = candidate.reason;
      continue;
    }
    const lead = byId.get(candidate.leadId)!;

    const { data: customer } = await ctx.supabase
      .from("customers")
      .select(
        "id, slug, name, industry, schema_version, status, recipient_email, delivery_webhook_url",
      )
      .eq("id", candidate.customerId)
      .maybeSingle();

    if (!customer || customer["status"] !== "published") {
      candidate.result = "skipped";
      candidate.resultDetail = "Kunden är inte publicerad.";
      candidate.needsAlert = true;
      candidate.alertReasons.push("customer_not_published");
      continue;
    }
    if (!customer["delivery_webhook_url"]) {
      candidate.result = "skipped";
      candidate.resultDetail = "Kunden saknar leveranswebhook.";
      candidate.needsAlert = true;
      candidate.alertReasons.push("missing_webhook");
      continue;
    }

    // Atomisk claim – stale `sending` får reclaimas, delivered aldrig.
    const { data: claim, error: claimErr } = await ctx.supabase.rpc("claim_lead_delivery", {
      p_lead_id: candidate.leadId,
      p_stale_seconds: STALE_SENDING_SECONDS,
    });
    if (claimErr || claim !== "claimed") {
      candidate.result = "skipped";
      candidate.resultDetail = claimErr
        ? "Claim misslyckades."
        : `Claim gav status: ${String(claim)}`;
      continue;
    }

    const { data: questionRows } = await ctx.supabase
      .from("form_questions")
      .select("field_key, label, field_type, options, required")
      .eq("customer_id", candidate.customerId)
      .order("sort_order", { ascending: true });
    const questions = (questionRows ?? []) as unknown as PublicQuestion[];

    const stored = readStoredPayload(lead["payload"]);
    const fields = pickDeliveryFields({
      storedPayload: lead["payload"],
      industry: String(customer["industry"]),
      questions,
      fallback: buildMakeFields({
        industry: String(customer["industry"]),
        questions,
        values: stored.answers ?? {},
      }),
    });

    const scoring =
      customer["industry"] === "varuautomater" ? scoreVaruautomat(stored.answers ?? {}) : null;

    const actionSecret = env["NORYVA_LEAD_ACTION_SECRET"];
    const kontaktadUrl = actionSecret
      ? buildContactUrl({ secret: actionSecret, leadId: candidate.leadId })
      : "";

    const idempotencyKey = String(lead["idempotency_key"] ?? "");
    const submissionId = idempotencyKey.includes(":")
      ? idempotencyKey.slice(idempotencyKey.indexOf(":") + 1)
      : "";

    const body = {
      ...fields,
      ...(scoring ?? {}),
      kund_id: customer["id"],
      kund_slug: customer["slug"],
      lead_id: candidate.leadId,
      submission_id: submissionId,
      idempotency_key: idempotencyKey,
      bransch: customer["industry"],
      schema_version: customer["schema_version"],
      mottagare: customer["recipient_email"],
      submitted_at: candidate.createdAt ?? now.toISOString(),
      source: `noryva_offert_${customer["industry"]}`,
      kontaktad_url: kontaktadUrl,
      kund_status: "Ny",
    };

    try {
      const res = await doFetch(String(customer["delivery_webhook_url"]), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        await ctx.supabase
          .from("leads")
          .update({ delivery_status: "failed", delivery_error: `HTTP ${res.status}` })
          .eq("id", candidate.leadId);
        candidate.result = "failed";
        candidate.resultDetail = `HTTP ${res.status}`;
        failed += 1;
        continue;
      }
      await ctx.supabase
        .from("leads")
        .update({
          delivery_status: "delivered",
          delivery_error: "",
          delivered_at: now.toISOString(),
        })
        .eq("id", candidate.leadId);
      candidate.result = "delivered";
      delivered += 1;
    } catch {
      await ctx.supabase
        .from("leads")
        .update({ delivery_status: "failed", delivery_error: "Nätverksfel eller timeout" })
        .eq("id", candidate.leadId);
      candidate.result = "failed";
      candidate.resultDetail = "Nätverksfel eller timeout";
      failed += 1;
    }
  }

  return {
    status: 200,
    body: {
      dryRun: false,
      executed: true,
      limit,
      maxAttempts: MAX_ATTEMPTS,
      count: candidates.length,
      delivered,
      failed,
      candidates,
      // Återleverans till kundens egen webhook är avsedd effekt; ingen
      // extern kund-/mailkommunikation sker från backend.
      externalEffect: true,
      notificationSent: false,
    },
  };
}
