import { describe, expect, it } from "vitest";
import { recordAgentRunUsage, sumBoardroomLedgerRows } from "./budget.server";
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

  it("mötesbudget, dagsbudget och nödstopp gäller var för sig", () => {
    // Aktuellt möte pausar vid 10 kr.
    expect(
      evaluateBudgetGate({
        kind: "boardroom",
        role: "noryva_manager",
        snapshot: snapshot({ boardroomMeetingSpentSek: 10, boardroomSpentTodaySek: 10 }),
      }),
    ).toMatchObject({ allowed: false, state: "soft_paused" });
    // Ett NYTT möte blockeras inte av tidigare mötens kostnad under dagstaket.
    expect(
      evaluateBudgetGate({
        kind: "boardroom",
        role: "noryva_manager",
        snapshot: snapshot({ boardroomMeetingSpentSek: 0, boardroomSpentTodaySek: 12 }),
      }),
    ).toMatchObject({ allowed: true, state: "ok" });
    // Dagsbudget 40 kr stoppar.
    expect(
      evaluateBudgetGate({
        kind: "boardroom",
        role: "noryva_manager",
        snapshot: snapshot({ boardroomSpentTodaySek: 40 }),
      }),
    ).toMatchObject({ allowed: false, state: "soft_paused" });
    // Nödstopp 60 kr blockerar hårt.
    expect(
      evaluateBudgetGate({
        kind: "boardroom",
        role: "noryva_manager",
        snapshot: snapshot({ boardroomSpentTodaySek: 60 }),
      }),
    ).toMatchObject({ allowed: false, state: "hard_blocked" });
    // Env kan aldrig höja nödstoppet över kodtaket 60 kr.
    const cfg = readBudgetConfig({
      NORYVA_BOARDROOM_DAY_CAP_SEK: "999",
      NORYVA_BOARDROOM_EMERGENCY_DAY_CAP_SEK: "999",
    });
    expect(cfg.boardroomEmergencyDayCapSek).toBe(60);
    expect(cfg.boardroomDayCapSek).toBe(60);
    expect(cfg.boardroomMeetingCapSek).toBe(10);
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

describe("Boardroom-ledgerns kostnadssummering", () => {
  it("räknar completed men ignorerar gamla hängande reservationer", () => {
    const now = Date.parse("2026-09-14T12:00:00Z");
    const sum = sumBoardroomLedgerRows(
      [
        { estimated_cost_sek: 1.5, status: "completed", created_at: "2026-09-14T07:00:00Z" },
        { estimated_cost_sek: 0.5, status: "reserved", created_at: "2026-09-14T11:58:00Z" },
        { estimated_cost_sek: 0.5, status: "reserved", created_at: "2026-09-14T07:05:00Z" },
      ],
      now,
    );
    expect(sum).toBeCloseTo(2, 5);
  });

  it("misslyckad körning utan usage bokförs som 0 kr", async () => {
    let patched: Record<string, unknown> = {};
    const ctx = {
      supabase: {
        from: () => ({ update: (p: Record<string, unknown>) => ({ eq: async () => ((patched = p), { error: null }) }) }),
      },
    } as any;
    const cost = await recordAgentRunUsage(ctx, {
      runId: "run-1",
      role: "product_tech",
      status: "failed",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(cost).toBe(0);
    expect(patched["estimated_cost_sek"]).toBe(0);
  });
});
