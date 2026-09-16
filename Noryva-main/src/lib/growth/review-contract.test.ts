/**
 * Tester för utskickskontraktet och manuell avstämning (rena funktioner).
 * Inga nätverksanrop, ingen databas, inga mail.
 */
import { describe, expect, it } from "vitest";
import { evaluateReconcileRequest, evaluateSendContract } from "./review-contract";
import { EMPTY_MAIL_CHANNEL, rowToMailChannel } from "./mail-channel";

const CUST_A = "22222222-2222-4222-8222-222222222222";
const CUST_B = "44444444-4444-4444-8444-444444444444";

const VERIFIED = rowToMailChannel({
  provider: "smtp",
  sender_email: "no-reply@kund.se",
  reply_to_email: "svar@kund.se",
  connection_alias: "kund-smtp",
  status: "verified",
  verified_at: "2026-09-01T10:00:00Z",
});

const base = {
  reviewCustomerId: CUST_A,
  leadCustomerId: CUST_A,
  launchApproved: true,
  reviewRecipient: "kund@example.com",
  storedLeadRecipient: "Kund@Example.com",
  mailChannel: VERIFIED,
};

describe("utskickskontrakt", () => {
  it("släpper igenom rätt kund, lagrad mottagare och verifierad identitet", () => {
    expect(evaluateSendContract(base)).toEqual({ ok: true, code: "ok", reason: "" });
  });

  it("stoppar utskick över kundgräns", () => {
    expect(evaluateSendContract({ ...base, leadCustomerId: CUST_B }).code).toBe("customer_mismatch");
    expect(evaluateSendContract({ ...base, reviewCustomerId: "" }).code).toBe("customer_mismatch");
  });

  it("stoppar mottagare som inte är den lagrade lead-adressen", () => {
    const other = evaluateSendContract({ ...base, reviewRecipient: "info@noryva.se" });
    expect(other.code).toBe("recipient_mismatch");
    expect(other.ok).toBe(false);
    expect(evaluateSendContract({ ...base, storedLeadRecipient: "" }).code).toBe("recipient_missing");
  });

  it("kräver verifierad mailidentitet med avsändare, svarsadress och anslutning", () => {
    expect(evaluateSendContract({ ...base, mailChannel: EMPTY_MAIL_CHANNEL }).code).toBe(
      "mail_identity_unverified",
    );
    expect(
      evaluateSendContract({
        ...base,
        mailChannel: rowToMailChannel({
          sender_email: "a@b.se",
          reply_to_email: "c@b.se",
          connection_alias: "x",
          status: "draft",
        }),
      }).code,
    ).toBe("mail_identity_unverified");
    expect(
      evaluateSendContract({
        ...base,
        mailChannel: rowToMailChannel({
          sender_email: "a@b.se",
          reply_to_email: "c@b.se",
          connection_alias: "x",
          status: "disabled",
        }),
      }).code,
    ).toBe("mail_identity_unverified");
    expect(
      evaluateSendContract({
        ...base,
        mailChannel: rowToMailChannel({
          sender_email: "a@b.se",
          reply_to_email: "c@b.se",
          connection_alias: "",
          status: "verified",
        }),
      }).code,
    ).toBe("mail_identity_unverified");
  });

  it("lämnar aldrig ut credentials i spärrorsaken", () => {
    const result = evaluateSendContract({ ...base, mailChannel: EMPTY_MAIL_CHANNEL });
    expect(result.reason).not.toMatch(/password|token|key/i);
  });

  it("spärrar utskick utan explicit launch-godkännande (fail closed)", () => {
    for (const launchApproved of [false, undefined, null] as (boolean | null | undefined)[]) {
      const result = evaluateSendContract({ ...base, launchApproved: launchApproved as boolean });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("launch_not_approved");
      expect(result.reason).not.toMatch(/password|token|key/i);
    }
  });

  it("släpper igenom när launch är godkänd och övrigt kontrakt är grönt", () => {
    expect(evaluateSendContract({ ...base, launchApproved: true })).toEqual({
      ok: true,
      code: "ok",
      reason: "",
    });
  });
});

describe("manuell avstämning", () => {
  it("tillåter endast hämtad eller osäker post", () => {
    expect(evaluateReconcileRequest({ reviewStatus: "claimed", outcome: "UNKNOWN" }).ok).toBe(true);
    expect(evaluateReconcileRequest({ reviewStatus: "unknown", outcome: "NOT_SENT" }).ok).toBe(true);
    for (const status of ["pending_review", "approved", "blocked", "cancelled", "failed"]) {
      const gate = evaluateReconcileRequest({ reviewStatus: status, outcome: "NOT_SENT" });
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.code).toBe("invalid_status");
    }
  });

  it("kräver transport-id för bekräftat utskick", () => {
    const gate = evaluateReconcileRequest({ reviewStatus: "unknown", outcome: "SENT" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("missing_message_id");
    expect(
      evaluateReconcileRequest({
        reviewStatus: "unknown",
        outcome: "SENT",
        transportMessageId: "tm-1",
      }).ok,
    ).toBe(true);
  });

  it("avvisar okända lägen, t.ex. försök till omsändning", () => {
    for (const outcome of ["RESEND", "RETRY", "", "sent "]) {
      const gate = evaluateReconcileRequest({ reviewStatus: "claimed", outcome });
      if (outcome === "sent ") {
        // Normaliseras till SENT och kräver då transport-id – aldrig omsändning.
        expect(gate.ok).toBe(false);
        if (!gate.ok) expect(gate.code).toBe("missing_message_id");
      } else {
        expect(gate.ok).toBe(false);
        if (!gate.ok) expect(gate.code).toBe("invalid_outcome");
      }
    }
  });
});
