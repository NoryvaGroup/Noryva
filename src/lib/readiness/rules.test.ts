import { describe, expect, it } from "vitest";
import {
  evaluateReadiness,
  isTestCustomer,
  ONBOARDING_STEPS,
  stepLevel,
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
    ...overrides,
  };
}

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
});
