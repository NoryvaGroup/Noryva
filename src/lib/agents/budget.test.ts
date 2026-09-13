import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUDGET_CONFIG,
  assertPricingCoverage,
  budgetStatusLabel,
  estimateRunCostSek,
  evaluateBudgetGate,
  modelForRole,
  readBudgetConfig,
  reservationCostSek,
} from "./budget";

type Snap = Parameters<typeof evaluateBudgetGate>[0]["snapshot"];

const snapshot = (over: Partial<Snap> = {}): Snap => ({
  spentMonthSek: 0,
  spentTodaySek: 0,
  autonomousRunsToday: 0,
  autonomousRunsTodayByRole: {},
  autonomousRunsMonth: 0,
  ...over,
});

describe("agent budget", () => {
  it("har prissättning för alla roller", () => {
    expect(() => assertPricingCoverage()).not.toThrow();
    expect(modelForRole("product_tech")).toBe("gpt-5.4");
    expect(modelForRole("noryva_manager")).toBe("gpt-5.4-mini");
  });

  it("överskattar kostnaden med säkerhetsmarginal", () => {
    const cost = estimateRunCostSek({
      role: "noryva_manager",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    // 0.25 USD * 11.5 SEK * 1.25 marginal
    expect(cost).toBeCloseTo(3.59375, 4);
  });

  it("hard cap kan aldrig konfigureras över 500 SEK", () => {
    const cfg = readBudgetConfig({
      NORYVA_AGENT_HARD_CAP_SEK: "5000",
      NORYVA_AGENT_SOFT_CAP_SEK: "4000",
      NORYVA_AGENT_MAX_AUTONOMOUS_RUNS_DAY: "50",
    });
    expect(cfg.hardCapSek).toBe(500);
    expect(cfg.softCapSek).toBe(500);
    expect(cfg.maxAutonomousRunsPerDay).toBe(2);
  });

  it("soft cap stoppar autonomt men tillåter manuellt under hard cap", () => {
    const snap = snapshot({ spentMonthSek: 320 });
    expect(
      evaluateBudgetGate({ kind: "autonomous", role: "noryva_manager", snapshot: snap }),
    ).toMatchObject({ allowed: false, state: "soft_paused" });
    expect(
      evaluateBudgetGate({ kind: "manual", role: "noryva_manager", snapshot: snap }),
    ).toMatchObject({ allowed: true, state: "ok" });
    expect(
      evaluateBudgetGate({ kind: "boardroom", role: "noryva_manager", snapshot: snap }),
    ).toMatchObject({ allowed: true, state: "ok" });
  });

  it("hard cap stoppar även manuella körningar", () => {
    const snap = snapshot({ spentMonthSek: 499.99 });
    expect(
      evaluateBudgetGate({ kind: "manual", role: "product_tech", snapshot: snap }),
    ).toMatchObject({ allowed: false, state: "hard_blocked" });
  });

  it("dygnstaket gäller per roll, inte globalt", () => {
    const capped = snapshot({
      autonomousRunsToday: 2,
      autonomousRunsTodayByRole: { noryva_manager: 2 },
    });
    expect(
      evaluateBudgetGate({ kind: "autonomous", role: "noryva_manager", snapshot: capped }),
    ).toMatchObject({ allowed: false, state: "run_capped" });
    // En annan roll blockeras INTE av Managerns körningar.
    expect(
      evaluateBudgetGate({ kind: "autonomous", role: "growth_sales", snapshot: capped }),
    ).toMatchObject({ allowed: true, state: "ok" });
    // Två olika roller med en körning var blockerar ingen.
    const mixed = snapshot({
      autonomousRunsToday: 2,
      autonomousRunsTodayByRole: { noryva_manager: 1, qa_risk: 1 },
    });
    expect(
      evaluateBudgetGate({ kind: "autonomous", role: "noryva_manager", snapshot: mixed }),
    ).toMatchObject({ allowed: true });
    expect(budgetStatusLabel(mixed, DEFAULT_BUDGET_CONFIG)).toBe("ok");
  });

  it("månadstaket och manuella körningar", () => {
    expect(
      evaluateBudgetGate({
        kind: "autonomous",
        role: "noryva_manager",
        snapshot: snapshot({ autonomousRunsMonth: 360 }),
      }),
    ).toMatchObject({ allowed: false, state: "run_capped" });
    expect(
      evaluateBudgetGate({
        kind: "manual",
        role: "noryva_manager",
        snapshot: snapshot({ autonomousRunsTodayByRole: { noryva_manager: 99 } }),
      }),
    ).toMatchObject({ allowed: true });
    // Manuella boardroom-körningar begränsas av hard cap, inte av run caps.
    expect(
      evaluateBudgetGate({
        kind: "boardroom",
        role: "noryva_manager",
        snapshot: snapshot({ autonomousRunsMonth: 360, autonomousRunsTodayByRole: { noryva_manager: 99 } }),
      }),
    ).toMatchObject({ allowed: true, state: "ok" });
    expect(
      evaluateBudgetGate({
        kind: "boardroom",
        role: "noryva_manager",
        snapshot: snapshot({ spentMonthSek: 499.9 }),
      }),
    ).toMatchObject({ allowed: false, state: "hard_blocked" });
  });

  it("reservationen använder konservativ schablon", () => {
    expect(reservationCostSek("product_tech", DEFAULT_BUDGET_CONFIG)).toBeGreaterThan(
      reservationCostSek("noryva_manager", DEFAULT_BUDGET_CONFIG),
    );
  });

  it("statusetiketten speglar förbrukningen", () => {
    expect(budgetStatusLabel(snapshot(), DEFAULT_BUDGET_CONFIG)).toBe("ok");
    expect(budgetStatusLabel(snapshot({ spentMonthSek: 300 }), DEFAULT_BUDGET_CONFIG)).toBe(
      "soft_paused",
    );
    expect(budgetStatusLabel(snapshot({ spentMonthSek: 500 }), DEFAULT_BUDGET_CONFIG)).toBe(
      "hard_blocked",
    );
  });
});
