/**
 * READ-ONLY reconciliation/watchdog för nurture reviews.
 *
 * Hittar fastnade eller osäkra transporter utan att någonsin ändra något:
 * - inga DB-writes eller muterande RPC:er
 * - inga nätverksanrop, mail, retries eller LLM-anrop
 * - lämnar aldrig ut recipient, subject/body, attemptId, transportMessageId
 *   eller några hemligheter
 *
 * Watchdoggen RETYAR aldrig något – den levererar bara underlag för
 * manuell/systemmässig kontroll.
 */
import type { GrowthContext } from "./service.server";

export type ReviewReconciliationOptions = {
  /** Hur gamla `claimed`-poster måste vara för att flaggas. Default 15 min. */
  claimedOlderThanMinutes?: number;
  /** Max antal rader som skannas. Default 50. */
  limit?: number;
};

export type ReconciliationFinding = {
  reviewId: string;
  leadId: string;
  customerId: string;
  status: string;
  approvedAt: string | null;
  claimedAt: string | null;
  sentAt: string | null;
  ageMinutes: number | null;
  severity: "HIGH" | "MEDIUM";
  reason:
    | "stale_claim_without_transport"
    | "delivery_unknown"
    | "confirmed_not_sent"
    | "approved_not_dispatched";
  needsManualReview: boolean;
  autoRetryAllowed: boolean;
};

const MIN_CLAIMED_MINUTES = 1;
const MAX_CLAIMED_MINUTES = 60 * 24 * 30; // 30 dagar
const DEFAULT_CLAIMED_MINUTES = 15;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
/** Approved utan claim flaggas först efter 24h. */
const APPROVED_STALE_HOURS = 24;

function toIso(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ageMinutes(fromIso: string | null, now: Date): number | null {
  if (!fromIso) return null;
  return Math.floor((now.getTime() - new Date(fromIso).getTime()) / 60_000);
}

/**
 * Ren bedömningsfunktion: givet rader från nurture_reviews, returnera
 * flaggade fynd. Ingen I/O – lätt att testa.
 */
export function evaluateReviewRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  now: Date,
  claimedOlderThanMinutes: number,
): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];

  for (const row of rows) {
    const status = String(row["status"] ?? "");
    const reviewId = String(row["id"] ?? "");
    if (!reviewId) continue;

    const approvedAt = toIso(row["approved_at"]);
    const claimedAt = toIso(row["claimed_at"]);
    const sentAt = toIso(row["sent_at"]);
    const attemptIdExists = typeof row["attempt_id"] === "string" && row["attempt_id"] !== "";
    const transportMessageIdExists =
      typeof row["transport_message_id"] === "string" && row["transport_message_id"] !== "";

    const base = {
      reviewId,
      leadId: String(row["lead_id"] ?? ""),
      customerId: String(row["customer_id"] ?? ""),
      status,
      approvedAt,
      claimedAt,
      sentAt,
      attemptIdExists,
      transportMessageIdExists,
      autoRetryAllowed: false,
    };

    if (status === "claimed") {
      const age = ageMinutes(claimedAt, now);
      // Friska/nya claims (under cutoff) eller claims med transport-id flaggas inte.
      if (transportMessageIdExists) continue;
      if (age === null || age < claimedOlderThanMinutes) continue;
      findings.push({
        ...base,
        ageMinutes: age,
        severity: "HIGH",
        reason: "stale_claim_without_transport",
        needsManualReview: true,
      });
      continue;
    }

    if (status === "unknown") {
      findings.push({
        ...base,
        ageMinutes: ageMinutes(claimedAt ?? approvedAt, now),
        severity: "HIGH",
        reason: "delivery_unknown",
        needsManualReview: true,
      });
      continue;
    }

    if (status === "failed") {
      findings.push({
        ...base,
        ageMinutes: ageMinutes(claimedAt ?? approvedAt, now),
        severity: "MEDIUM",
        reason: "confirmed_not_sent",
        needsManualReview: true,
      });
      continue;
    }

    if (status === "approved") {
      const age = ageMinutes(approvedAt, now);
      if (age === null || age < APPROVED_STALE_HOURS * 60) continue;
      findings.push({
        ...base,
        ageMinutes: age,
        severity: "MEDIUM",
        reason: "approved_not_dispatched",
        needsManualReview: true,
      });
      continue;
    }

    // sent / cancelled / blocked / pending_review och övrigt flaggas aldrig.
  }

  // Mest kritiskt först, sedan äldst.
  const severityRank = (s: string) => (s === "HIGH" ? 0 : 1);
  findings.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      (b.ageMinutes ?? 0) - (a.ageMinutes ?? 0),
  );
  return findings;
}

export async function reviewReconciliationCore(
  ctx: GrowthContext,
  options: ReviewReconciliationOptions = {},
  now: Date = new Date(),
) {
  const claimedOlderThanMinutes = Math.min(
    Math.max(Math.floor(options.claimedOlderThanMinutes ?? DEFAULT_CLAIMED_MINUTES), MIN_CLAIMED_MINUTES),
    MAX_CLAIMED_MINUTES,
  );
  const limit = Math.min(
    Math.max(Math.floor(options.limit ?? DEFAULT_LIMIT), MIN_LIMIT),
    MAX_LIMIT,
  );

  const claimedCutoff = new Date(now.getTime() - claimedOlderThanMinutes * 60_000);
  const approvedCutoff = new Date(now.getTime() - APPROVED_STALE_HOURS * 3_600_000);

  // Läser endast kandidatrader: gammal claimed, unknown, failed, gammal approved.
  // Endast säkra metadatafält väljs – aldrig recipient/subject/body/transport-id.
  const { data, error } = await ctx.supabase
    .from("nurture_reviews")
    .select("id,lead_id,customer_id,status,approved_at,claimed_at,sent_at,attempt_id,transport_message_id")
    .in("status", ["claimed", "unknown", "failed", "approved"])
    .limit(limit);

  if (error) throw new Error(`Kunde inte läsa nurture reviews: ${error.message}`);

  const findings = evaluateReviewRows(data ?? [], now, claimedOlderThanMinutes);

  return {
    ok: true,
    now: now.toISOString(),
    claimedOlderThanMinutes,
    claimedCutoff: claimedCutoff.toISOString(),
    approvedOlderThanHours: APPROVED_STALE_HOURS,
    approvedCutoff: approvedCutoff.toISOString(),
    scanned: (data ?? []).length,
    findings,
    counts: {
      total: findings.length,
      high: findings.filter((f) => f.severity === "HIGH").length,
      medium: findings.filter((f) => f.severity === "MEDIUM").length,
    },
    externalEffect: false,
    notificationSent: false,
  };
}
