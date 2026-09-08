import { describe, expect, it } from "vitest";
import { computeVariantMetrics, dedupeOutcomes, outcomeKey, type OutcomeRecord } from "./outcomes";
import { estimateCost, sumCost, budgetState } from "./cost";
import { assignVariant, stableHash } from "./experiments";

const rows: OutcomeRecord[] = [
  { leadId: "l1", variantId: "a", outcomeType: "lead_created", outcomeValue: null, revenueValue: null },
  { leadId: "l1", variantId: "a", outcomeType: "meeting_booked", outcomeValue: 1, revenueValue: null },
  { leadId: "l1", variantId: "a", outcomeType: "won", outcomeValue: 1, revenueValue: 5000 },
  { leadId: "l2", variantId: "a", outcomeType: "lead_created", outcomeValue: null, revenueValue: null },
];

describe("utfall", () => {
  it("är idempotent: dubblett räknas en gång", () => {
    const duplicated = [...rows, ...rows];
    expect(dedupeOutcomes(duplicated)).toHaveLength(rows.length);
    expect(outcomeKey("l1", "won", "a")).toBe("l1:won:a");
  });

  it("beräknar mötesgrad, win rate, intäkt och kostnad per lead", () => {
    const m = computeVariantMetrics("a", [...rows, ...rows], 0.5);
    expect(m.leads).toBe(2);
    expect(m.meetings).toBe(1);
    expect(m.won).toBe(1);
    expect(m.meetingRate).toBe(0.5);
    expect(m.winRate).toBe(0.5);
    expect(m.revenue).toBe(5000);
    expect(m.revenuePerLead).toBe(2500);
    expect(m.aiCostPerLead).toBe(0.25);
    expect(m.costPerWon).toBe(0.5);
    expect(m.roi).toBeGreaterThan(0);
  });

  it("returnerar null i stället för påhittade siffror utan data", () => {
    const m = computeVariantMetrics("tom", []);
    expect(m.winRate).toBeNull();
    expect(m.revenuePerLead).toBeNull();
    expect(m.roi).toBeNull();
  });
});

describe("kostnad", () => {
  it("summerar och uppskattar kostnad", () => {
    const c = estimateCost({ tier: "ai_light", inputTokens: 1_000_000, outputTokens: 0 });
    expect(c.estimatedCost).toBe(0.25);
    expect(estimateCost({ tier: "deterministic" }).estimatedCost).toBe(0);
    expect(sumCost([{ estimatedCost: 0.25 }, { estimatedCost: 0.1 }, { estimatedCost: null }])).toBe(0.35);
  });

  it("flaggar budgettillstånd", () => {
    const budget = { dailyLimitUsd: 2, monthlyLimitUsd: 40 };
    expect(budgetState({ spentTodayUsd: 0.1, spentMonthUsd: 1 }, budget)).toBe("ok");
    expect(budgetState({ spentTodayUsd: 1.7, spentMonthUsd: 1 }, budget)).toBe("warn");
    expect(budgetState({ spentTodayUsd: 2, spentMonthUsd: 1 }, budget)).toBe("exceeded");
  });
});

describe("experimenttilldelning", () => {
  const variants = [
    { id: "a", name: "A", weight: 1, isControl: true },
    { id: "b", name: "B", weight: 1, isControl: false },
  ];

  it("är stabil för samma lead", () => {
    const first = assignVariant("exp1", "lead-42", variants);
    for (let i = 0; i < 20; i += 1) {
      expect(assignVariant("exp1", "lead-42", variants)?.id).toBe(first?.id);
    }
  });

  it("fördelar över båda varianterna", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(assignVariant("exp1", `lead-${i}`, variants)!.id);
    expect(seen.size).toBe(2);
  });

  it("returnerar null utan användbara varianter", () => {
    expect(assignVariant("exp1", "lead", [])).toBeNull();
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });
});
