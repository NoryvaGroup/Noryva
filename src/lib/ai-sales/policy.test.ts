import { describe, expect, it } from "vitest";
import { buildAiSalesContext } from "./context";
import { applyPolicyGuardrails, fallbackOutput, resolvePolicyPath } from "./policy";
import { assistantOutputSchema, reviewStatusV1Schema } from "./types";

function contextFrom(answers: Record<string, string>, industry = "varuautomater") {
  return buildAiSalesContext(
    {
      leadId: "11111111-1111-4111-8111-111111111111",
      customerId: "22222222-2222-4222-8222-222222222222",
      industry,
      createdAt: "2026-09-07T20:00:00.000Z",
      payload: { payload_version: 2, answers, make: null },
    },
    { name: "Testkund", industry, serviceArea: "Borås" },
  );
}

const highPriority = {
  onskad_automat: "Kombinerad dryck och snacks",
  antal_anstallda: "25–49",
  tidsram: "Inom 1–3 månader",
  projektbeskrivning: "Vi vill ha automat i personalrummet.",
};

describe("policyvägar", () => {
  it("hög prioritet ger snabb personlig kontakt", () => {
    const p = resolvePolicyPath(contextFrom(highPriority));
    expect(p.action).toBe("Kontakta nu");
    expect(p.contactSpeed).toBe("Omgående");
    expect(p.humanTakeover).toBe(false);
  });

  it("lågt/ofullständigt lead rekommenderar komplettering", () => {
    const p = resolvePolicyPath(contextFrom({ onskad_automat: "Vet inte ännu" }));
    expect(p.action).toBe("Be om komplettering");
    expect(p.contactSpeed).toBe("Inom 2 arbetsdagar");
  });

  it("pris/offert/förhandling ger mänsklig handläggning", () => {
    for (const text of ["Vill ha en offert", "Vad blir priset?", "Öppen för förhandling"]) {
      const p = resolvePolicyPath(contextFrom({ ...highPriority, projektbeskrivning: text }));
      expect(p.humanTakeover).toBe(true);
      expect(p.action).toBe("Mänsklig handläggning");
    }
  });

  it("guardrails kan lägga till men aldrig ta bort mänsklig handläggning", () => {
    const context = contextFrom({ ...highPriority, projektbeskrivning: "Skicka offert tack" });
    const output = assistantOutputSchema.parse({
      action: "Kontakta nu",
      contactSpeed: "Omgående",
      subject: "Din förfrågan",
      emailDraft: "Hej! Tack för din förfrågan, vi återkommer med nästa steg inom kort.",
      followupQuestions: [],
      humanTakeover: false,
      strategyReason: "Modellen ville kontakta direkt.",
      confidence: 0.8,
      safetyFlags: [],
    });
    const guarded = applyPolicyGuardrails(output, context);
    expect(guarded.humanTakeover).toBe(true);
    expect(guarded.safetyFlags).toContain("policy:human_takeover");
  });
});

describe("outputvalidering", () => {
  it("avvisar ogiltiga värden", () => {
    expect(() =>
      assistantOutputSchema.parse({
        action: "Ring direkt",
        contactSpeed: "Omgående",
        subject: "Hej",
        emailDraft: "för kort",
        humanTakeover: false,
        strategyReason: "x",
        confidence: 2,
      }),
    ).toThrow();
  });

  it("reservutkastet är giltigt och börjar med Hej!", () => {
    const out = fallbackOutput(contextFrom(highPriority));
    expect(() => assistantOutputSchema.parse(out)).not.toThrow();
    expect(out.emailDraft.startsWith("Hej!")).toBe(true);
  });

  it("review-status i v1 tillåter aldrig sent", () => {
    expect(reviewStatusV1Schema.safeParse("approved").success).toBe(true);
    expect(reviewStatusV1Schema.safeParse("rejected").success).toBe(true);
    expect(reviewStatusV1Schema.safeParse("sent").success).toBe(false);
  });
});
