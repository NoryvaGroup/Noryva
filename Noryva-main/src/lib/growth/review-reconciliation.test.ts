import { describe, expect, it } from "vitest";
import { evaluateReviewRows } from "./review-reconciliation.server";
import { parseGrowthBody } from "./api-security";

const NOW = new Date("2026-09-10T12:00:00Z");
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

function row(overrides: Record<string, unknown>) {
  return {
    id: "r1",
    lead_id: "l1",
    customer_id: "c1",
    status: "claimed",
    approved_at: null,
    claimed_at: null,
    sent_at: null,
    attempt_id: "a1",
    transport_message_id: null,
    recipient_email: "hemlig@example.se",
    subject: "Hemligt ämne",
    body: "Hemlig brödtext",
    ...overrides,
  };
}

describe("evaluateReviewRows", () => {
  it("flaggar gammal claimed utan transport-id som HIGH", () => {
    const findings = evaluateReviewRows(
      [row({ status: "claimed", claimed_at: iso(60) })],
      NOW,
      15,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "HIGH",
      reason: "stale_claim_without_transport",
      needsManualReview: true,
      autoRetryAllowed: false,
      attemptIdExists: true,
      transportMessageIdExists: false,
      ageMinutes: 60,
    });
  });

  it("flaggar INTE färsk claimed", () => {
    expect(
      evaluateReviewRows([row({ status: "claimed", claimed_at: iso(5) })], NOW, 15),
    ).toHaveLength(0);
  });

  it("flaggar INTE claimed med transport-id", () => {
    expect(
      evaluateReviewRows(
        [row({ status: "claimed", claimed_at: iso(60), transport_message_id: "tm1" })],
        NOW,
        15,
      ),
    ).toHaveLength(0);
  });

  it("flaggar unknown som HIGH", () => {
    const findings = evaluateReviewRows(
      [row({ status: "unknown", claimed_at: iso(10) })],
      NOW,
      15,
    );
    expect(findings[0]).toMatchObject({
      severity: "HIGH",
      reason: "delivery_unknown",
      needsManualReview: true,
      autoRetryAllowed: false,
    });
  });

  it("flaggar failed som MEDIUM och tillåter inte auto-retry", () => {
    const findings = evaluateReviewRows(
      [row({ status: "failed", claimed_at: iso(120) })],
      NOW,
      15,
    );
    expect(findings[0]).toMatchObject({
      severity: "MEDIUM",
      reason: "confirmed_not_sent",
      autoRetryAllowed: false,
    });
  });

  it("flaggar gammal approved utan claim som MEDIUM", () => {
    const findings = evaluateReviewRows(
      [row({ status: "approved", approved_at: iso(60 * 25), claimed_at: null })],
      NOW,
      15,
    );
    expect(findings[0]).toMatchObject({
      severity: "MEDIUM",
      reason: "approved_not_dispatched",
    });
  });

  it("flaggar INTE nyligen approved", () => {
    expect(
      evaluateReviewRows(
        [row({ status: "approved", approved_at: iso(60), claimed_at: null })],
        NOW,
        15,
      ),
    ).toHaveLength(0);
  });

  it("flaggar aldrig sent, cancelled eller blocked", () => {
    const rows = [
      row({ id: "s", status: "sent", sent_at: iso(10), transport_message_id: "tm" }),
      row({ id: "c", status: "cancelled", approved_at: iso(6000) }),
      row({ id: "b", status: "blocked", approved_at: iso(6000) }),
      row({ id: "p", status: "pending_review" }),
    ];
    expect(evaluateReviewRows(rows, NOW, 15)).toHaveLength(0);
  });

  it("lämnar aldrig ut känsliga fält i fynden", () => {
    const findings = evaluateReviewRows(
      [row({ status: "unknown", claimed_at: iso(10) })],
      NOW,
      15,
    );
    const json = JSON.stringify(findings);
    expect(json).not.toContain("hemlig@example.se");
    expect(json).not.toContain("Hemligt ämne");
    expect(json).not.toContain("Hemlig brödtext");
    expect(json).not.toContain('"attemptId"');
    expect(json).not.toContain('"transportMessageId"');
  });

  it("sorterar mest kritiskt/äldst först", () => {
    const findings = evaluateReviewRows(
      [
        row({ id: "m", status: "failed", claimed_at: iso(5000) }),
        row({ id: "h-new", status: "unknown", claimed_at: iso(10) }),
        row({ id: "h-old", status: "claimed", claimed_at: iso(200) }),
      ],
      NOW,
      15,
    );
    expect(findings.map((f) => f.reviewId)).toEqual(["h-old", "h-new", "m"]);
  });
});

describe("review-reconciliation schema", () => {
  it("accepterar tom body och sätter inga defaults", () => {
    const parsed = parseGrowthBody("review-reconciliation", "{}");
    expect(parsed.ok).toBe(true);
  });

  it("accepterar giltiga värden", () => {
    const parsed = parseGrowthBody(
      "review-reconciliation",
      JSON.stringify({ claimedOlderThanMinutes: 30, limit: 10 }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual({ claimedOlderThanMinutes: 30, limit: 10 });
    }
  });

  it("avvisar värden utanför bounds och okända fält", () => {
    expect(parseGrowthBody("review-reconciliation", JSON.stringify({ claimedOlderThanMinutes: 0 })).ok).toBe(false);
    expect(parseGrowthBody("review-reconciliation", JSON.stringify({ limit: 101 })).ok).toBe(false);
    expect(parseGrowthBody("review-reconciliation", JSON.stringify({ execute: true })).ok).toBe(false);
  });
});
