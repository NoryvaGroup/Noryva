import { describe, expect, it } from "vitest";
import {
  evaluateReadiness,
  buildHandoff,
  isTestCustomer,
  ONBOARDING_STEPS,
  stepLevel,
  summarizeGoNoGo,
  THRESHOLDS,
  type ReadinessFacts,
} from "./rules";

function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    customer: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Takmästarna AB",
      slug: "takmastarna",
      status: "published",
      industry: "tak",
      recipientEmail: "kund@example.com",
      deliveryWebhookUrl: "https://hook.example.com/x",
    },
    questions: { total: 5, required: 3 },
    profile: { exists: true, notifyRecipients: 1, aiAssistantEnabled: true, executionMode: "review" },
    mailChannel: {
      configured: true,
      verified: true,
      status: "verified",
      senderEmail: "a@b.se",
      replyToEmail: "a@b.se",
      verifiedAt: "2026-01-01T00:00:00Z",
    },
    leads: { total: 3, pending: 0, failed: 0, latest: null },
    nurture: { pending: 0, approved: 0, stuck: 0, failed: 0 },
    reminders: { pending: 0, failed: 0, stuck: 0, latestStatus: "sent" },
    replies: { unprocessed: 0 },
    contacted: { contacted: 1, total: 3 },
    launchApproval: { approved: true, approvedAt: "2026-02-01T00:00:00Z" },
    ...overrides,
  };
}

describe("launch approval-gate", () => {
  it("blockerar GO när launch inte är godkänd", () => {
    const r = evaluateReadiness(facts({ launchApproval: { approved: false } }));
    expect(r.status).toBe("no_go");
    expect(r.coreReady).toBe(false);
    expect(r.fullReady).toBe(false);
    expect(r.blocking.map((c) => c.id)).toContain("launch");
  });

  it("blockerar även när kunden är publicerad men saknar godkännande", () => {
    const r = evaluateReadiness(
      facts({ customer: { ...facts().customer, status: "published" }, launchApproval: { approved: false } }),
    );
    expect(r.coreReady).toBe(false);
  });

  it("fail closed när launch-godkännandet är okänt", () => {
    for (const value of [null, undefined]) {
      const r = evaluateReadiness(facts({ launchApproval: value as never }));
      expect(r.coreReady).toBe(false);
      expect(r.checks.find((c) => c.id === "launch")?.level).toBe("unknown");
    }
  });

  it("blockerar inte när launch är uttryckligen godkänd", () => {
    const r = evaluateReadiness(facts());
    expect(r.checks.find((c) => c.id === "launch")?.level).toBe("ok");
    expect(r.status).toBe("full_ready");
  });
});

describe("readiness-status", () => {
  it("ger FULL READY när allt är grönt", () => {
    const r = evaluateReadiness(facts());
    expect(r.status).toBe("full_ready");
    expect(r.coreReady).toBe(true);
    expect(r.fullReady).toBe(true);
  });

  it("ger NO-GO vid blockerande kärnfel och pekar ut nästa åtgärd", () => {
    const r = evaluateReadiness(
      facts({
        customer: { ...facts().customer, recipientEmail: "" },
      }),
    );
    expect(r.status).toBe("no_go");
    expect(r.coreReady).toBe(false);
    expect(r.blocking.map((c) => c.id)).toContain("recipient");
    expect(r.checks.find((c) => c.id === "recipient")?.nextAction).toMatch(/mottagaradress/i);
  });

  it("opublicerad kund är NO-GO", () => {
    const r = evaluateReadiness(facts({ customer: { ...facts().customer, status: "draft" } }));
    expect(r.status).toBe("no_go");
  });

  it("CORE READY när bara mailkanalen saknas", () => {
    const r = evaluateReadiness(
      facts({
        mailChannel: {
          configured: true,
          verified: false,
          status: "draft",
          senderEmail: "a@b.se",
          replyToEmail: "a@b.se",
          verifiedAt: null,
        },
      }),
    );
    expect(r.status).toBe("core_ready");
    expect(r.coreReady).toBe(true);
    expect(r.fullReady).toBe(false);
    expect(r.checks.find((c) => c.id === "mail")?.nextAction).toBe("Verifiera kundens mailkanal.");
  });

  it("REVIEW vid mindre varning utan blockerare", () => {
    const r = evaluateReadiness(facts({ leads: { total: 0, pending: 0, failed: 0, latest: null } }));
    expect(r.status).toBe("review");
    expect(r.coreReady).toBe(true);
  });

  it("olasbar data ger unknown och aldrig falskt grönt", () => {
    const r = evaluateReadiness(facts({ questions: null }));
    expect(r.status).toBe("review");
    expect(r.coreReady).toBe(false);
    expect(r.checks.find((c) => c.id === "form")?.level).toBe("unknown");
  });

  it("misslyckad leverans blockerar kärnflödet", () => {
    const r = evaluateReadiness(
      facts({
        leads: {
          total: 2,
          pending: 0,
          failed: 1,
          latest: { deliveryStatus: "failed", deliveryError: "timeout", deliveredAt: null, createdAt: "" },
        },
      }),
    );
    expect(r.status).toBe("no_go");
  });

  it("fastnad nurture blockerar bara full readiness", () => {
    const r = evaluateReadiness(facts({ nurture: { pending: 0, approved: 0, stuck: 1, failed: 0 } }));
    expect(r.status).toBe("core_ready");
    expect(r.coreReady).toBe(true);
  });

  it("obehandlade inkomna svar blockerar full readiness", () => {
    const r = evaluateReadiness(facts({ replies: { unprocessed: 2 } }));
    expect(r.fullReady).toBe(false);
  });

  it("markerar testkunder men lämnar riktiga kunder ifred", () => {
    expect(isTestCustomer(facts().customer)).toBe(false);
    expect(isTestCustomer({ ...facts().customer, status: "draft" })).toBe(true);
    expect(isTestCustomer({ ...facts().customer, slug: "e2e-router" })).toBe(true);
  });

  it("onboarding-stegen speglar kontrollernas nivå", () => {
    const r = evaluateReadiness(facts({ customer: { ...facts().customer, deliveryWebhookUrl: "" } }));
    const delivery = ONBOARDING_STEPS.find((s) => s.key === "delivery")!;
    expect(stepLevel(r.checks, delivery.checks)).toBe("fail");
    const golive = ONBOARDING_STEPS.find((s) => s.key === "golive")!;
    expect(stepLevel(r.checks, golive.checks)).toBe("ok");
  });

  it("växlar från varning till blockerande vid väntande lead-threshold", () => {
    const warning = evaluateReadiness(
      facts({ leads: { total: 1, pending: 1, failed: 0, pendingOverWarn: 1, pendingOverBlock: 0, latest: null } }),
    );
    expect(THRESHOLDS.leadPendingWarnMinutes).toBe(30);
    expect(warning.status).toBe("review");
    expect(warning.checks.find((c) => c.id === "delivery")?.level).toBe("warn");

    const blocked = evaluateReadiness(
      facts({ leads: { total: 1, pending: 1, failed: 0, pendingOverWarn: 1, pendingOverBlock: 1, latest: null } }),
    );
    expect(THRESHOLDS.leadPendingBlockMinutes).toBe(120);
    expect(blocked.status).toBe("no_go");
    expect(blocked.checks.find((c) => c.id === "delivery")?.level).toBe("fail");
  });

  it("separerar core-blockerare, full-blockerare och varningar", () => {
    const result = evaluateReadiness(
      facts({
        customer: { ...facts().customer, recipientEmail: "" },
        mailChannel: {
          configured: true,
          verified: false,
          status: "draft",
          senderEmail: "a@b.se",
          replyToEmail: "a@b.se",
          verifiedAt: null,
        },
        nurture: { pending: 1, approved: 0, stuck: 0, failed: 0 },
      }),
    );
    const summary = summarizeGoNoGo(result);
    expect(summary.go).toBe(false);
    expect(summary.coreBlockers.map((c) => c.id)).toContain("recipient");
    expect(summary.fullBlockers.map((c) => c.id)).toContain("mail");
    expect(summary.warnings.map((c) => c.id)).toContain("nurture");
  });

  it("bygger handoff med tidigaste säkra kärnåtgärd", () => {
    const result = evaluateReadiness(
      facts({ customer: { ...facts().customer, deliveryWebhookUrl: "", recipientEmail: "" } }),
    );
    const handoff = buildHandoff(result);
    expect(handoff.done).toContain("Kundprofil");
    expect(handoff.remaining.some((item) => item.startsWith("Leveransadress"))).toBe(true);
    expect(handoff.nextActionCheckId).toBe("webhook");
  });

  it("klassar testdata konservativt utan att filtrera bort skarpa kunder", () => {
    const customers = [
      facts().customer,
      { ...facts().customer, id: "22222222-2222-4222-8222-222222222222", slug: "demo-kund" },
      { ...facts().customer, id: "33333333-3333-4333-8333-333333333333", status: "draft" },
    ];
    expect(customers.filter((customer) => !isTestCustomer(customer)).map((customer) => customer.id)).toEqual([
      facts().customer.id,
    ]);
  });
});
