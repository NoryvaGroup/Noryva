/**
 * Read-only underlag för 24h-påminnelser (`due-lead-reminders`).
 *
 * Supabase är facit: en påminnelse är aktuell så länge `leads.customer_status`
 * fortfarande är "Ny". Ingen extern status (kalkylark) används.
 *
 * Säkerhet/garantier:
 * - Ingen skrivning: status ändras inte och ingen påminnelse markeras skickad.
 * - Inget mail, ingen bokning, inga externa anrop.
 * - Mottagare hämtas ENDAST från kundens sparade profil. Saknas profil eller
 *   mottagare returneras tom lista med tydlig flagga – aldrig en gissning.
 * - Prioritet härleds bara från auktoritativt sparat state (growth_lead_state).
 *   Saknas det sätts prioritySource = "unknown" och Make får filtrera.
 */
import { buildContactUrl } from "@/lib/leads/contact-token";
import type { RuntimeEnv } from "./runtime-env";
import type { GrowthContext } from "./service.server";

/** Statusvärdet som betyder "ingen har hört av sig ännu". */
export const PENDING_STATUS = "Ny";
export const DEFAULT_OLDER_THAN_HOURS = 24;
export const DEFAULT_LIMIT = 25;

/** Nivåer som enligt nuvarande pilotlogik bör påminnas. */
const REMINDER_LEVELS = new Set(["HÖG", "AKUT", "FALLBACK"]);

export type DueLeadReminder = {
  leadId: string;
  customerId: string;
  customerName: string;
  createdAt: string;
  customerStatus: string;
  contactedAt: string | null;
  intentLevel: string | null;
  prioritySource: "growth_lead_state" | "unknown";
  reminderRecommended: boolean | null;
  reason: string;
  notifyRecipients: string[];
  recipientsMissing: boolean;
  contactUrl: string | null;
  /** Transportstate i Supabase – aldrig kalkylarksstatus. */
  reminderStatus: ReminderStatus;
  claimable: boolean;
  needsManualReview: boolean;
};

/** Enda påminnelsetypen i piloten. */
export const REMINDER_KIND = "contact_24h";
export const REMINDER_TABLE = "lead_reminder_deliveries";
/** En claim som legat längre än så här kräver manuell avstämning. */
export const STALE_CLAIM_MINUTES = 15;

export type ReminderStatus = "none" | "pending" | "claimed" | "sent" | "failed" | "unknown";

function readReminderStatus(value: unknown): ReminderStatus {
  return value === "pending" ||
    value === "claimed" ||
    value === "sent" ||
    value === "failed" ||
    value === "unknown"
    ? value
    : "none";
}

export async function dueLeadRemindersCore(
  ctx: GrowthContext,
  input: { olderThanHours?: number; limit?: number },
  env: RuntimeEnv,
  now: Date = new Date(),
): Promise<{
  olderThanHours: number;
  cutoff: string;
  count: number;
  reminders: DueLeadReminder[];
  externalEffect: false;
  notificationSent: false;
}> {
  const olderThanHours = input.olderThanHours ?? DEFAULT_OLDER_THAN_HOURS;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(now.getTime() - olderThanHours * 3_600_000).toISOString();

  const { data: leads, error } = await ctx.supabase
    .from("leads")
    .select("id, customer_id, created_at, customer_status, contacted_at")
    .eq("customer_status", PENDING_STATUS)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const actionSecret = env["NORYVA_LEAD_ACTION_SECRET"];
  const customerCache = new Map<string, { name: string; recipients: string[] }>();
  const reminders: DueLeadReminder[] = [];

  for (const lead of (leads ?? []) as Array<Record<string, any>>) {
    const customerId = String(lead["customer_id"] ?? "");
    let customer = customerCache.get(customerId);
    if (!customer) {
      const { data: customerRow } = await ctx.supabase
        .from("customers")
        .select("id, name")
        .eq("id", customerId)
        .maybeSingle();
      const { data: profileRow } = await ctx.supabase
        .from("customer_profiles")
        .select("customer_id, notify_recipients")
        .eq("customer_id", customerId)
        .maybeSingle();
      const recipients = Array.isArray(profileRow?.["notify_recipients"])
        ? (profileRow["notify_recipients"] as string[]).filter(
            (r) => typeof r === "string" && r.trim() !== "",
          )
        : [];
      customer = { name: String(customerRow?.["name"] ?? ""), recipients };
      customerCache.set(customerId, customer);
    }

    const { data: stateRow } = await ctx.supabase
      .from("growth_lead_state")
      .select("lead_id, intent_level")
      .eq("lead_id", lead["id"])
      .maybeSingle();

    // Transportstate: redan skickade, pågående och osäkra påminnelser lämnar
    // listan helt. Supabase är facit – ingen kalkylarksstatus används.
    const { data: deliveryRow } = await ctx.supabase
      .from(REMINDER_TABLE)
      .select("lead_id, kind, status, claimed_at")
      .eq("lead_id", lead["id"])
      .eq("kind", REMINDER_KIND)
      .maybeSingle();
    const reminderStatus = readReminderStatus(deliveryRow?.["status"]);
    if (reminderStatus === "sent" || reminderStatus === "unknown") continue;
    let staleClaim = false;
    if (reminderStatus === "claimed") {
      const claimedAt = Date.parse(String(deliveryRow?.["claimed_at"] ?? ""));
      const fresh =
        !Number.isNaN(claimedAt) &&
        now.getTime() - claimedAt < STALE_CLAIM_MINUTES * 60_000;
      if (fresh) continue;
      staleClaim = true;
    }


    const intentLevel = stateRow?.["intent_level"] ? String(stateRow["intent_level"]) : null;
    const prioritySource = intentLevel ? "growth_lead_state" : "unknown";
    const reminderRecommended = intentLevel ? REMINDER_LEVELS.has(intentLevel) : null;

    const reasons: string[] = [
      `Status är fortfarande ${PENDING_STATUS} och förfrågan är äldre än ${olderThanHours} timmar.`,
    ];
    if (!intentLevel) {
      reasons.push("Ingen auktoritativ prioritet sparad – Make får filtrera.");
    } else if (!reminderRecommended) {
      reasons.push(`Prioritet ${intentLevel} ingår inte i påminnelseurvalet.`);
    }
    if (customer.recipients.length === 0) {
      reasons.push("Kundens profil saknar sparade mottagare.");
    }
    if (staleClaim) {
      reasons.push("Tidigare hämtning har fastnat – kräver manuell avstämning, ingen autoretry.");
    }


    reminders.push({
      leadId: String(lead["id"]),
      customerId,
      customerName: customer.name,
      createdAt: String(lead["created_at"] ?? ""),
      customerStatus: String(lead["customer_status"] ?? ""),
      contactedAt: lead["contacted_at"] ? String(lead["contacted_at"]) : null,
      intentLevel,
      prioritySource,
      reminderRecommended,
      reason: reasons.join(" "),
      notifyRecipients: customer.recipients,
      recipientsMissing: customer.recipients.length === 0,
      // Länken byggs bara när hemligheten finns server-side; annars null.
      contactUrl: actionSecret
        ? buildContactUrl({ secret: actionSecret, leadId: String(lead["id"]), now })
        : null,
      reminderStatus,
      claimable: !staleClaim,
      needsManualReview: staleClaim,
    });
  }

  return {
    olderThanHours,
    cutoff,
    count: reminders.length,
    reminders,
    externalEffect: false,
    notificationSent: false,
  };
}

/**
 * Hämtar EN påminnelse för utskick. Hela behörighetskontrollen (lead är
 * fortfarande "Ny", påminnelsen är förfallen, inte redan skickad/hämtad) sker
 * atomiskt i SQL. Svaret innehåller endast sändunderlag – ingen lead-PII,
 * inga hemligheter.
 */
export async function claimLeadReminderCore(
  ctx: GrowthContext,
  input: { leadId: string; olderThanHours?: number },
  env: RuntimeEnv,
  now: Date = new Date(),
) {
  const { data, error } = await ctx.supabase.rpc("claim_lead_reminder", {
    p_lead_id: input.leadId,
    p_kind: REMINDER_KIND,
    p_older_than_hours: input.olderThanHours ?? DEFAULT_OLDER_THAN_HOURS,
    p_stale_claim_minutes: STALE_CLAIM_MINUTES,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, any>;
  if (result["ok"] !== true) {
    const code = String(result["code"] ?? "not_claimable");
    return {
      ok: false as const,
      status: code === "not_found" ? 404 : 409,
      code,
      externalEffect: false as const,
      notificationSent: false as const,
    };
  }

  const customerId = String(result["customerId"] ?? "");
  const { data: customerRow } = await ctx.supabase
    .from("customers")
    .select("id, name")
    .eq("id", customerId)
    .maybeSingle();
  const { data: profileRow } = await ctx.supabase
    .from("customer_profiles")
    .select("customer_id, notify_recipients")
    .eq("customer_id", customerId)
    .maybeSingle();
  const notifyRecipients = Array.isArray(profileRow?.["notify_recipients"])
    ? (profileRow["notify_recipients"] as string[]).filter(
        (r) => typeof r === "string" && r.trim() !== "",
      )
    : [];

  const { data: stateRow } = await ctx.supabase
    .from("growth_lead_state")
    .select("lead_id, intent_level")
    .eq("lead_id", input.leadId)
    .maybeSingle();

  const actionSecret = env["NORYVA_LEAD_ACTION_SECRET"];

  return {
    ok: true as const,
    status: 200,
    code: "claimed",
    reminderId: result["reminderId"],
    attemptId: result["attemptId"],
    kind: REMINDER_KIND,
    leadId: input.leadId,
    customerId,
    customerName: String(customerRow?.["name"] ?? ""),
    notifyRecipients,
    recipientsMissing: notifyRecipients.length === 0,
    intentLevel: stateRow?.["intent_level"] ? String(stateRow["intent_level"]) : null,
    contactUrl: actionSecret
      ? buildContactUrl({ secret: actionSecret, leadId: input.leadId, now })
      : null,
    externalEffect: false as const,
    notificationSent: false as const,
  };
}

/** Bokför bekräftat utskick. Idempotent via (reminderId, attemptId). */
export async function completeLeadReminderCore(
  ctx: GrowthContext,
  input: { reminderId: string; attemptId: string; transportMessageId: string },
) {
  const { data, error } = await ctx.supabase.rpc("complete_lead_reminder", {
    p_reminder_id: input.reminderId,
    p_attempt_id: input.attemptId,
    p_transport_message_id: input.transportMessageId,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, any>;
  if (result["ok"] !== true) {
    return {
      ok: false as const,
      status: String(result["code"]) === "not_found" ? 404 : 409,
      code: String(result["code"] ?? "invalid"),
    };
  }
  return {
    ok: true as const,
    status: 200,
    code: String(result["code"]),
    duplicate: result["duplicate"] === true,
    transportMessageId: result["transportMessageId"],
  };
}

/**
 * Misslyckat försök. `unknown` (standard) betyder att vi inte vet om mailet
 * gick iväg – posten släpps ALDRIG automatiskt tillbaka för nytt försök.
 */
export async function failLeadReminderCore(
  ctx: GrowthContext,
  input: { reminderId: string; attemptId: string; outcome?: "not_sent" | "unknown"; reason?: string },
) {
  const { data, error } = await ctx.supabase.rpc("fail_lead_reminder", {
    p_reminder_id: input.reminderId,
    p_attempt_id: input.attemptId,
    p_outcome: input.outcome === "not_sent" ? "not_sent" : "unknown",
    p_reason: (input.reason ?? "").trim(),
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, any>;
  if (result["ok"] !== true) {
    return {
      ok: false as const,
      status: String(result["code"]) === "not_found" ? 404 : 409,
      code: String(result["code"] ?? "invalid"),
    };
  }
  return {
    ok: true as const,
    status: 200,
    code: String(result["code"]),
    status_: undefined,
    reminderStatus: String(result["status"] ?? result["code"]),
    autoRetryAllowed: false as const,
  };
}
