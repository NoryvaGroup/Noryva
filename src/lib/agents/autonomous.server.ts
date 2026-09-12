/**
 * Agent HQ – konservativt autonomt arbetsläge (endast INTERN analys/förslag).
 *
 * En tick gör HÖGST EN provider-körning:
 *   1. Budget- och run-cap kontrolleras först. Vid tak returneras en tydlig
 *      no-op (aldrig en felloop).
 *   2. Finns en delegerad specialistuppgift i kön körs den – i ett SEPARAT
 *      tick, aldrig rekursivt i samma kedja som Managern som skapade den.
 *   3. Annars görs en Manager-kickoff, högst en gång per dygn (idempotensnyckel).
 *
 * Hårda spärrar som gäller oavsett resultat:
 * - Inga externa effekter: inga mail, SMS, bokningar, Make-anrop, publicering,
 *   DB-ändringar i kunddata eller annonsändringar.
 * - Allt resultat stannar i awaiting_review och kräver mänskligt godkännande.
 * - Endast Managern får delegera, och delegering skapar bara en uppgift.
 */
import { readBudgetConfig, evaluateBudgetGate } from "./budget";
import { readBudgetSnapshot } from "./budget.server";
import { runtimeEnvFromRequest } from "@/lib/growth/runtime-env";
import {
  V2_SOURCE_EVENT,
  V2_SPECIALISTS,
  createV2TaskCore,
  runV2TaskCore,
  type V2Context,
} from "./v2.server";

export const AUTONOMOUS_EXECUTION_MODE = "review" as const;

export type AutonomousOutcome = { status: number; body: Record<string, unknown> };

const SPECIALIST_SOURCE_EVENTS = V2_SPECIALISTS.map((role) => V2_SOURCE_EVENT[role]);

/** PII-fritt, billigt standarduppdrag. Endast aggregerad drifttelemetri används. */
export const AUTONOMOUS_MANAGER_GOAL =
  "Gå igenom aggregerad drifttelemetri, sammanfatta läget kort och ange högst tre prioriteringar. " +
  "Delegera högst en uppgift till den specialist som ger störst intern nytta, eller 'none'.";

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function autonomousTickCore(
  ctx: V2Context,
  input: { now?: Date } = {},
): Promise<AutonomousOutcome> {
  const now = input.now ?? new Date();
  const config = readBudgetConfig(ctx.harness?.env ?? runtimeEnvFromRequest(ctx.harness?.request));
  const snapshot = await readBudgetSnapshot(ctx);

  const noop = (gate: { state: string; reason: string }): AutonomousOutcome => ({
    status: 200,
    body: {
      ok: true,
      action: "noop",
      budgetState: gate.state,
      reason: gate.reason,
      snapshot,
      externalEffect: false,
    },
  });

  // Överordnade kostnadstak gäller alltid, oavsett roll.
  const costGate = evaluateBudgetGate({
    kind: "autonomous",
    role: "product_tech",
    snapshot: { ...snapshot, autonomousRunsTodayByRole: {}, autonomousRunsMonth: 0 },
    config,
  });
  if (!costGate.allowed) return noop(costGate);

  const monthGate = evaluateBudgetGate({
    kind: "autonomous",
    role: "noryva_manager",
    snapshot: { ...snapshot, spentMonthSek: 0, autonomousRunsTodayByRole: {} },
    config,
  });
  if (!monthGate.allowed) return noop(monthGate);

  // 1) Delegerad specialistuppgift körs i ett separat tick.
  const { data: pending } = await ctx.supabase
    .from("agent_tasks")
    .select("id, assigned_agent, status, execution_mode")
    .eq("status", "queued")
    .eq("provider_type", "openai_agents")
    .in("source_event", SPECIALIST_SOURCE_EVENTS)
    .in("execution_mode", ["test", "review"])
    .order("created_at", { ascending: true })
    .limit(10);

  // Per roll: en specialist som redan kört 2 gånger idag hoppas över, men
  // blockerar inte övriga agenter.
  const specialist = (Array.isArray(pending) ? pending : []).find(
    (row: any) =>
      row?.id &&
      autonomousRunsTodayForRole(snapshot, String(row.assigned_agent ?? "")) <
        config.maxAutonomousRunsPerDay,
  );
  if (specialist?.id) {
    const run = await runV2TaskCore(ctx, { taskId: String(specialist.id), runKind: "autonomous" });
    return {
      status: 200,
      body: {
        ok: run.status === 200,
        action: "specialist_run",
        role: specialist.assigned_agent,
        taskId: specialist.id,
        // En specialist får aldrig skapa ytterligare agent-run.
        chained: false,
        result: run.body,
        externalEffect: false,
      },
    };
  }

  // 2) Manager-kickoff, högst en gång per dygn.
  const occurrence = `auto:${dayKey(now)}`;
  const created = await createV2TaskCore(
    ctx,
    {
      role: "noryva_manager",
      executionMode: AUTONOMOUS_EXECUTION_MODE,
      goal: AUTONOMOUS_MANAGER_GOAL,
      occurrence,
    },
    now,
  );
  const taskId = String(created.body["taskId"] ?? "");
  if (created.status !== 200 || !taskId) {
    return {
      status: 200,
      body: {
        ok: false,
        action: "noop",
        reason: String(created.body["error"] ?? "Kickoff kunde inte skapas."),
        externalEffect: false,
      },
    };
  }

  if (created.body["duplicate"] === true) {
    const { data: existing } = await ctx.supabase
      .from("agent_tasks")
      .select("status")
      .eq("id", taskId)
      .maybeSingle();
    if (!existing || existing.status !== "queued") {
      return {
        status: 200,
        body: {
          ok: true,
          action: "noop",
          reason: "Dagens Manager-kickoff är redan körd.",
          taskId,
          externalEffect: false,
        },
      };
    }
  }

  const run = await runV2TaskCore(ctx, { taskId, runKind: "autonomous" });
  return {
    status: 200,
    body: {
      ok: run.status === 200,
      action: "manager_kickoff",
      role: "noryva_manager",
      taskId,
      // Delegering SKAPAR endast en specialistuppgift; den körs nästa tick.
      delegatedTaskId: String(run.body["delegatedTaskId"] ?? ""),
      delegatedStarted: false,
      result: run.body,
      externalEffect: false,
    },
  };
}
