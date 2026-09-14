/**
 * Agent HQ – budgetbokföring mot Supabase.
 *
 * Reservationen sker ATOMISKT i SQL (`reserve_agent_run`) med ett advisory lock,
 * så parallella workers aldrig kan passera taken samtidigt. Efter körningen
 * bokförs faktisk usage och en konservativ kostnad.
 *
 * Fail closed: om reservationen inte kan göras startas ingen provider-körning.
 */
import {
  EMPTY_SNAPSHOT,
  estimateRunCostSek,
  modelForRole,
  readBudgetConfig,
  reservationCostSek,
  type BudgetConfig,
  type BudgetSnapshot,
  type BudgetState,
  type RunKind,
} from "./budget";
import type { RuntimeEnv } from "@/lib/growth/runtime-env";

export type BudgetCtx = { supabase: any };

/** Admin-klient laddas först vid behov (server-only, aldrig i klientbundlen). */
async function adminClient(): Promise<any | null> {
  try {
    const mod: any = await import("@/integrations/supabase/client.server");
    return mod?.supabaseAdmin ?? null;
  } catch {
    return null;
  }
}

export type Reservation =
  | { ok: true; runId: string; reservedCostSek: number; state: "ok" }
  | { ok: false; runId: ""; state: BudgetState; reason: string };

/** Reserverar EN provider-körning innan anropet görs. */
export async function reserveAgentRun(
  ctx: BudgetCtx,
  input: { role: string; taskId: string | null; kind: RunKind; config?: BudgetConfig },
): Promise<Reservation> {
  const cfg = input.config ?? readBudgetConfig();
  const reserved = reservationCostSek(input.role, cfg);
  const { data, error } = await ctx.supabase.rpc("reserve_agent_run", {
    p_role: input.role,
    p_task_id: input.taskId,
    p_run_kind: input.kind,
    p_reserved_cost_sek: reserved,
    p_soft_cap_sek: cfg.softCapSek,
    p_hard_cap_sek: cfg.hardCapSek,
    p_max_autonomous_runs_day: cfg.maxAutonomousRunsPerDay,
    p_max_autonomous_runs_month: cfg.maxAutonomousRunsPerMonth,
    p_model: modelForRole(input.role),
  });

  let row = (data ?? {}) as Record<string, unknown>;
  if (error) {
    // Endast service_role får köra reservations-RPC:n. Faller tillbaka på
    // admin-klienten server-side; spärrarna ligger kvar i SQL-funktionen.
    const admin = await adminClient();
    if (!admin) {
      return { ok: false, runId: "", state: "hard_blocked", reason: "Budgetkontrollen kunde inte göras." };
    }
    const retry = await admin.rpc("reserve_agent_run", {
      p_role: input.role,
      p_task_id: input.taskId,
      p_run_kind: input.kind,
      p_reserved_cost_sek: reserved,
      p_soft_cap_sek: cfg.softCapSek,
      p_hard_cap_sek: cfg.hardCapSek,
      p_max_autonomous_runs_day: cfg.maxAutonomousRunsPerDay,
      p_max_autonomous_runs_month: cfg.maxAutonomousRunsPerMonth,
      p_model: modelForRole(input.role),
    });
    if (retry.error) {
      return { ok: false, runId: "", state: "hard_blocked", reason: "Budgetkontrollen kunde inte göras." };
    }
    row = (retry.data ?? {}) as Record<string, unknown>;
  }
  if (row["ok"] !== true) {
    return {
      ok: false,
      runId: "",
      state: (String(row["state"] ?? "hard_blocked") as BudgetState) ?? "hard_blocked",
      reason: String(row["reason"] ?? "Budgetspärren stoppade körningen."),
    };
  }
  return { ok: true, runId: String(row["runId"] ?? ""), reservedCostSek: reserved, state: "ok" };
}

/** Bokför faktisk usage efter körningen. Kostnaden överskattas medvetet. */
export async function recordAgentRunUsage(
  ctx: BudgetCtx,
  input: {
    runId: string;
    role: string;
    status: "completed" | "failed";
    inputTokens?: number | null;
    outputTokens?: number | null;
    config?: BudgetConfig;
  },
): Promise<number> {
  if (!input.runId) return 0;
  const cfg = input.config ?? readBudgetConfig();
  const hasUsage = Number(input.inputTokens ?? 0) > 0 || Number(input.outputTokens ?? 0) > 0;
  // Utan rapporterad usage behålls schablonen (konservativt), även vid fel.
  const cost = hasUsage
    ? Math.max(
        estimateRunCostSek({
          role: input.role,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          config: cfg,
        }),
        0,
      )
    : reservationCostSek(input.role, cfg);

  const patch = {
    // 'failed' räknas inte mot taket, men behålls i loggen för spårbarhet.
    status: input.status,
    input_tokens: Math.max(Number(input.inputTokens ?? 0) || 0, 0),
    output_tokens: Math.max(Number(input.outputTokens ?? 0) || 0, 0),
    estimated_cost_sek: cost,
  };
  try {
    // Ledgern är skrivskyddad för vanliga roller; admin-klienten används först.
    const admin = await adminClient();
    const client = admin ?? ctx.supabase;
    const res: any = await client.from("agent_run_ledger").update(patch).eq("id", input.runId);
    if (res?.error && admin) await ctx.supabase.from("agent_run_ledger").update(patch).eq("id", input.runId);
  } catch {
    /* bokföringen får aldrig kasta vidare i körvägen */
  }
  return cost;
}

/**
 * Dagens uppskattade boardroom-kostnad (alla möten tillsammans).
 * Fail-safe: kan summan inte läsas returneras nödstoppsnivån så nya
 * mötessteg pausas i stället för att köras okontrollerat.
 */
export async function readBoardroomSpentTodaySek(ctx: BudgetCtx, config?: BudgetConfig): Promise<number> {
  const cfg = config ?? readBudgetConfig();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  try {
    const admin = await adminClient();
    const client = admin ?? ctx.supabase;
    const { data, error } = await client
      .from("agent_run_ledger")
      .select("estimated_cost_sek")
      .eq("run_kind", "boardroom")
      .in("status", ["reserved", "completed"])
      .gte("created_at", since.toISOString());
    if (error || !Array.isArray(data)) return cfg.boardroomEmergencyDayCapSek;
    return data.reduce((sum: number, row: any) => sum + (Number(row?.estimated_cost_sek ?? 0) || 0), 0);
  } catch {
    return cfg.boardroomEmergencyDayCapSek;
  }
}

/** Läser månadens förbrukning. Returnerar nollor om läsningen misslyckas. */
export async function readBudgetSnapshot(ctx: BudgetCtx): Promise<BudgetSnapshot> {
  try {
    const { data, error } = await ctx.supabase.rpc("agent_budget_snapshot");
    const boardroomSpentTodaySek = await readBoardroomSpentTodaySek(ctx);
    if (error || !data) return { ...EMPTY_SNAPSHOT, boardroomSpentTodaySek };
    const row = data as Record<string, unknown>;
    return {
      boardroomSpentTodaySek,
      spentMonthSek: Number(row["spentMonthSek"] ?? 0) || 0,
      spentTodaySek: Number(row["spentTodaySek"] ?? 0) || 0,
      autonomousRunsToday: Number(row["autonomousRunsToday"] ?? 0) || 0,
      autonomousRunsTodayByRole: Object.fromEntries(
        Object.entries((row["autonomousRunsTodayByRole"] ?? {}) as Record<string, unknown>).map(
          ([role, count]) => [role, Number(count ?? 0) || 0],
        ),
      ),
      autonomousRunsMonth: Number(row["autonomousRunsMonth"] ?? 0) || 0,
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export function budgetConfigFromEnv(env: RuntimeEnv = {}): BudgetConfig {
  return readBudgetConfig(env);
}
