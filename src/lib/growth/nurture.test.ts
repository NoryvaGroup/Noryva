import { describe, expect, it } from "vitest";
import {
  applyReplyToNurture,
  buildNurturePlan,
  buildNurtureQuestions,
  canTransitionNurture,
  evaluateNurtureEligibility,
  nextNurtureStepAt,
} from "./nurture";
import { classifyReplyDeterministic } from "@/lib/ai-sales/reply";
import { computeIntent } from "./intent";

const base = {
  intentLevel: "LÅG" as const,
  terminal: false,
  humanTakeover: false,
  missingInformation: ["önskad automattyp", "tidsram"],
};

describe("nurture-policy", () => {
  it("släpper bara in LÅG och NORMAL", () => {
    expect(evaluateNurtureEligibility({ ...base }).eligible).toBe(true);
    expect(evaluateNurtureEligibility({ ...base, intentLevel: "NORMAL" }).eligible).toBe(true);
    expect(evaluateNurtureEligibility({ ...base, intentLevel: "HÖG" }).eligible).toBe(false);
    expect(evaluateNurtureEligibility({ ...base, intentLevel: "AKUT" }).eligible).toBe(false);
  });

  it("stoppar terminala, eskalerade och avböjda leads", () => {
    expect(evaluateNurtureEligibility({ ...base, terminal: true }).eligible).toBe(false);
    expect(evaluateNurtureEligibility({ ...base, humanTakeover: true }).eligible).toBe(false);
    expect(evaluateNurtureEligibility({ ...base, optedOut: true }).eligible).toBe(false);
  });

  it("planerar nästa steg deterministiskt per nivå", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(nextNurtureStepAt("LÅG", from)).toBe("2026-01-04T00:00:00.000Z");
    expect(nextNurtureStepAt("NORMAL", from)).toBe("2026-01-02T00:00:00.000Z");
    expect(nextNurtureStepAt("HÖG", from)).toBeNull();
  });
});

describe("frågegenerering", () => {
  it("hittar aldrig på frågor när inget saknas", () => {
    expect(buildNurtureQuestions({ missingInformation: [] })).toEqual([]);
    const plan = buildNurturePlan({ ...base, missingInformation: [] });
    expect(plan.questions).toEqual([]);
    expect(plan.status).toBe("cancelled");
    expect(plan.nextStepAt).toBeNull();
  });

  it("ger max tre frågor och återanvänder analysens frågor först", () => {
    const q = buildNurtureQuestions({
      missingInformation: ["a", "b", "c", "d"],
      existingQuestions: ["Vilken typ av automat är ni intresserade av?"],
    });
    expect(q.length).toBe(3);
    expect(q[0]).toBe("Vilken typ av automat är ni intresserade av?");
  });

  it("frågar inte om plats när geografin är verifierad", () => {
    const q = buildNurtureQuestions({
      missingInformation: ["ort", "tidsram"],
      geographyVerified: true,
    });
    expect(q.some((x) => /ort/i.test(x))).toBe(false);
    expect(q.length).toBe(1);
  });

  it("planen är idempotent för samma indata", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(buildNurturePlan({ ...base, now })).toEqual(buildNurturePlan({ ...base, now }));
  });
});

describe("svarshantering i nurture", () => {
  it("avböj stoppar all vidare uppföljning", () => {
    const e = applyReplyToNurture(classifyReplyDeterministic("Nej tack, inte intresserad"));
    expect(e.status).toBe("cancelled");
    expect(e.stop).toBe(true);
    expect(e.upgradeSignal).toBe(false);
  });

  it("pris, förhandling, klagomål och juridik ger mänsklig handläggning", () => {
    for (const text of ["Vad kostar det?", "Kan ni ge rabatt?", "Jag är missnöjd", "Min advokat hör av sig"]) {
      const e = applyReplyToNurture(classifyReplyDeterministic(text));
      expect(e.humanTakeover).toBe(true);
      expect(e.stop).toBe(true);
      expect(e.status).toBe("review");
    }
  });

  it("mötesvilja ger uppgraderingssignal och mötesutfall", () => {
    const e = applyReplyToNurture(classifyReplyDeterministic("Kan vi boka ett möte?"));
    expect(e.upgradeSignal).toBe(true);
    expect(e.outcome).toBe("meeting_booked");
    expect(e.humanTakeover).toBe(false);
  });

  it("positivt svar ger uppgraderingssignal utan extern notis", () => {
    const e = applyReplyToNurture(classifyReplyDeterministic("Låter bra, berätta mer"));
    expect(e.upgradeSignal).toBe(true);
    expect(e.outcome).toBe("replied");
  });

  it("neutralt svar håller leadet kvar i billig uppföljning", () => {
    const e = applyReplyToNurture(classifyReplyDeterministic("Hej!"));
    expect(e.stop).toBe(false);
    expect(e.status).toBe("replied");
  });
});

describe("statusmaskin", () => {
  it("tillåter bara definierade övergångar", () => {
    expect(canTransitionNurture("pending", "approved")).toBe(true);
    expect(canTransitionNurture("approved", "sent")).toBe(true);
    expect(canTransitionNurture("cancelled", "pending")).toBe(false);
    expect(canTransitionNurture("sent", "approved")).toBe(false);
    expect(canTransitionNurture("pending", "pending")).toBe(true);
  });
});

describe("intent-uppgradering från svar", () => {
  it("mötesvilja lyfter ett LÅG-lead över NORMAL-tröskeln", () => {
    const effect = applyReplyToNurture(classifyReplyDeterministic("Kan vi boka ett möte?"));
    const before = computeIntent({ baseScore: 20, outcomes: [] });
    const after = computeIntent({
      baseScore: 20,
      outcomes: [{ leadId: "l1", variantId: null, outcomeType: effect.outcome!, outcomeValue: null, revenueValue: null }],
    });
    expect(before.level).toBe("LÅG");
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.level).toBe("NORMAL");
  });

  it("samma utfall två gånger ger samma score (idempotens)", () => {
    const o = { leadId: "l1", variantId: null, outcomeType: "replied" as const, outcomeValue: null, revenueValue: null };
    expect(computeIntent({ baseScore: 30, outcomes: [o, o] }).score).toBe(
      computeIntent({ baseScore: 30, outcomes: [o] }).score,
    );
  });
});
