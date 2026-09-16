import { describe, expect, it } from "vitest";
import { recommendWinner } from "./optimizer";
import { computeVariantMetrics, type OutcomeRecord } from "./outcomes";

function metrics(variantId: string, leads: number, won: number, cost = 0) {
  const rows: OutcomeRecord[] = [];
  for (let i = 0; i < leads; i += 1) {
    rows.push({ leadId: `${variantId}-${i}`, variantId, outcomeType: "lead_created", outcomeValue: null, revenueValue: null });
    if (i < won) {
      rows.push({ leadId: `${variantId}-${i}`, variantId, outcomeType: "won", outcomeValue: 1, revenueValue: 1000 });
    }
  }
  return computeVariantMetrics(variantId, rows, cost);
}

describe("optimizer", () => {
  it("utser ingen vinnare vid för få samples", () => {
    const rec = recommendWinner([metrics("a", 5, 3), metrics("b", 5, 0)]);
    expect(rec.winnerVariantId).toBeNull();
    expect(rec.needsMoreData).toBe(true);
  });

  it("utser vinnare vid tydligt bättre resultat", () => {
    const rec = recommendWinner([metrics("a", 40, 12), metrics("b", 40, 4)]);
    expect(rec.winnerVariantId).toBe("a");
    expect(rec.confidence).toBeGreaterThan(0);
  });

  it("behåller exploration floor för förloraren", () => {
    const rec = recommendWinner([metrics("a", 40, 12), metrics("b", 40, 4)]);
    expect(rec.allocations["b"]).toBeGreaterThanOrEqual(0.1);
    const sum = Object.values(rec.allocations).reduce((x, y) => x + y, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });

  it("utser ingen vinnare vid marginell skillnad", () => {
    const rec = recommendWinner([metrics("a", 40, 10), metrics("b", 40, 9)]);
    expect(rec.winnerVariantId).toBeNull();
  });

  it("kräver minst två varianter", () => {
    expect(recommendWinner([metrics("a", 100, 50)]).winnerVariantId).toBeNull();
  });
});
