import { describe, expect, it } from "vitest";
import { computeIntent, levelFromScore } from "./intent";
import { routeLead } from "./router";
import type { OutcomeRecord } from "./outcomes";

const LEAD = "lead-1";

function outcome(type: OutcomeRecord["outcomeType"], revenue: number | null = null): OutcomeRecord {
  return { leadId: LEAD, variantId: null, outcomeType: type, outcomeValue: null, revenueValue: revenue };
}

describe("Intent Engine", () => {
  it("lågt lead behålls och routas deterministiskt – aldrig bortkastat", () => {
    const intent = computeIntent({ baseScore: 10, basePriority: "LÅG" });
    expect(intent.level).toBe("LÅG");
    expect(intent.terminal).toBe(false);

    const d = routeLead({ priority: "LÅG", intentLevel: intent.level, missingInformation: [] });
    expect(d.route).toBe("deterministic");
    expect(d.llmCalls).toBe(0);
  });

  it("replied höjer score", () => {
    const before = computeIntent({ baseScore: 30 }).score;
    const after = computeIntent({ baseScore: 30, outcomes: [outcome("replied")] }).score;
    expect(after).toBeGreaterThan(before);
  });

  it("meeting_booked höjer kraftigt", () => {
    const replied = computeIntent({ baseScore: 30, outcomes: [outcome("replied")] }).score;
    const meeting = computeIntent({
      baseScore: 30,
      outcomes: [outcome("replied"), outcome("meeting_booked")],
    }).score;
    expect(meeting - replied).toBeGreaterThanOrEqual(30);
  });

  it("lost markerar terminalt och sänker till noll", () => {
    const intent = computeIntent({
      baseScore: 90,
      outcomes: [outcome("replied"), outcome("meeting_booked"), outcome("lost")],
    });
    expect(intent.score).toBe(0);
    expect(intent.level).toBe("LÅG");
    expect(intent.terminal).toBe(true);
  });

  it("won är terminalt positivt utan dubbelräkning av intäkt", () => {
    const intent = computeIntent({ baseScore: 50, outcomes: [outcome("won", 50000), outcome("revenue", 50000)] });
    expect(intent.score).toBe(100);
    expect(intent.terminal).toBe(true);
  });

  it("idempotenta dubbletter räknas inte två gånger", () => {
    const single = computeIntent({ baseScore: 20, outcomes: [outcome("replied")] }).score;
    const doubled = computeIntent({
      baseScore: 20,
      outcomes: [outcome("replied"), outcome("replied")],
    }).score;
    expect(doubled).toBe(single);
  });

  it("låg blir hög efter positiva utfall", () => {
    const start = computeIntent({ baseScore: 25 });
    expect(start.level).toBe("LÅG");
    const later = computeIntent({
      baseScore: 25,
      outcomes: [outcome("contacted"), outcome("replied"), outcome("meeting_booked")],
    });
    expect(later.level).toBe("HÖG");
    expect(later.score).toBeGreaterThan(start.score);
  });

  it("hög sänks när negativt utfall registreras", () => {
    const high = computeIntent({ baseScore: 80, outcomes: [outcome("replied")] });
    expect(high.level).toBe("HÖG");
    const dropped = computeIntent({ baseScore: 80, outcomes: [outcome("replied"), outcome("lost")] });
    expect(dropped.score).toBeLessThan(high.score);
    expect(dropped.level).toBe("LÅG");
  });

  it("AKUT från hårda regler behålls oavsett score", () => {
    expect(computeIntent({ baseScore: 5, basePriority: "AKUT" }).level).toBe("AKUT");
  });

  it("trösklarna är transparenta", () => {
    expect(levelFromScore(39)).toBe("LÅG");
    expect(levelFromScore(40)).toBe("NORMAL");
    expect(levelFromScore(70)).toBe("HÖG");
  });
});

describe("router med intent", () => {
  it("människoregeln vinner alltid över hög intent-score", () => {
    const d = routeLead({ priority: "LÅG", intentLevel: "HÖG", text: "Vad kostar det?" });
    expect(d.route).toBe("human");
    expect(d.llmCalls).toBe(0);
  });

  it("uppgraderad intent ger AI-analys även för initialt lågt lead", () => {
    const d = routeLead({ priority: "LÅG", intentLevel: "HÖG", missingInformation: [] });
    expect(d.route).toBe("ai_full");
  });

  it("nedgraderad intent ger billig deterministisk hantering", () => {
    const d = routeLead({ priority: "HÖG", intentLevel: "LÅG", missingInformation: [] });
    expect(d.route).toBe("deterministic");
    expect(d.llmCalls).toBe(0);
  });

  it("budget vinner över intent", () => {
    const d = routeLead({
      priority: "LÅG",
      intentLevel: "HÖG",
      budgetUsage: { spentTodayUsd: 5, spentMonthUsd: 5 },
      budget: { dailyLimitUsd: 2, monthlyLimitUsd: 40 },
    });
    expect(d.route).toBe("deterministic");
  });
});
