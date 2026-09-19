/**
 * Agent HQ v2 – kontroll- och auditlager för de två aktiva rollerna.
 *
 * Lovable är kontrollpanel, Supabase är kontroll-/auditlager och OpenAI Agents
 * API är harnessen. Den här filen skapar uppgifter, håller budget och
 * idempotens, kör harnessen via adaptern och sparar PII-fritt resultat.
 *
 * Hårda regler:
 * - Endast test/review. Ingen extern action, inga mail, inga Make-anrop.
 * - Fail closed: utan konfigurerad harness startas ingen körning, och det
 *   sker ingen automatisk reserv till det gamla Responses-lagret.
 * - Ett Manager-run per uppgift. Specialist-run skapas bara vid faktisk
 *   delegering från Manager.
 * - Endast aggregerad, PII-fri systemtelemetri skickas till harnessen.
 */
import { z } from "zod";
import { collectSystemTelemetry } from "./improvement.server";
import {
  evaluateRunBudget,
  isRunnableHarnessRole,
  readHarnessStatus,
  runHarnessSession,
  type HarnessDeps,
  type HarnessRole,
} from "./openai-agents.server";
import { AGENT_POLICY, verifyTaskResult, type TaskStatus, type TaskType } from "./tasks";
import { readBudgetConfig, type RunKind } from "./budget";
import { recordAgentRunUsage, reserveAgentRun } from "./budget.server";
import { runtimeEnvFromRequest } from "@/lib/growth/runtime-env";

export type V2Context = { supabase: any; harness?: HarnessDeps };

export const V2_TASK_TYPE: Record<HarnessRole, TaskType> = {
  noryva_manager: "manager_directive",
  product_tech: "product_tech_review",
  growth_sales: "growth_sales_review",
  customer_success: "customer_success_review",
  qa_risk: "qa_risk_review",
  operations_finance: "operations_finance_review",
};

export const V2_SOURCE_EVENT: Record<HarnessRole, string> = {
  noryva_manager: "manager_goal",
  product_tech: "product_tech_goal",
  growth_sales: "growth_sales_goal",
  customer_success: "customer_success_goal",
  qa_risk: "qa_risk_goal",
  operations_finance: "operations_finance_goal",
};

/** Specialistroller som Manager får delegera till. */
export const V2_SPECIALISTS = [
  "product_tech",
  "growth_sales",
  "customer_success",
  "qa_risk",
  "operations_finance",
] as const;

/** Hårt tak: ett provider-run per uppgift i v1. */
export const V2_RUN_BUDGET = 1;

/**
 * Server-side policytext. Reusable-agenterna i OpenAI bär sina permanenta
 * instruktioner; den här texten används som safety guard och som reserv när ett
 * agent-id saknas – aldrig som en divergerande ersättning.
 */
export const V2_INSTRUCTIONS: Record<HarnessRole, string> = {
  noryva_manager: AGENT_POLICY.noryva_manager,
  product_tech: AGENT_POLICY.product_tech,
  growth_sales: AGENT_POLICY.growth_sales,
  customer_success: AGENT_POLICY.customer_success,
  qa_risk: AGENT_POLICY.qa_risk,
  operations_finance: AGENT_POLICY.operations_finance,
};

/** Rollspecifikt JSON-kontrakt som läggs i session-input (inte som systemprompt). */
export const V2_OUTPUT_CONTRACT: Record<HarnessRole, string> = {
  noryva_manager:
    'Svara som JSON: {"summary":"...","priorities":["..."],"delegate":{"to":"product_tech|growth_sales|customer_success|qa_risk|operations_finance|none","goal":"..."}}',
  product_tech:
    'Svara som JSON: {"summary":"...","recommendations":["..."],"implementationPrompt":"..."}',
  growth_sales:
    'Svara som JSON: {"summary":"...","recommendations":["..."],"draftOutreach":"..."}',
  customer_success:
    'Svara som JSON: {"summary":"...","recommendations":["..."],"churnRisk":"low|medium|high"}',
  qa_risk:
    'Svara som JSON: {"summary":"...","risks":["..."],"verdict":"pass|concerns|fail"}',
  operations_finance:
    'Svara som JSON: {"summary":"...","recommendations":["..."],"budgetStatus":"ok|watch|over"}',
};


/* --------------------------------------------------------- skapa uppgift */

export type CreateV2Input = {
  role: HarnessRole;
  executionMode: "test" | "review";
  goal?: string;
  occurrence?: string;
};

export type V2Outcome = { status: number; body: Record<string, unknown> };

export function v2IdempotencyKey(input: CreateV2Input, now = new Date()): string {
  const occ = input.occurrence?.trim() || now.toISOString().slice(0, 10);
  return `${V2_SOURCE_EVENT[input.role]}:${occ}`;
}

/** Skapar EN uppgift för en aktiv v1-roll. Ingen körning startas här. */
export async function createV2TaskCore(
  ctx: V2Context,
  input: CreateV2Input,
  now = new Date(),
): Promise<V2Outcome> {
  if (!isRunnableHarnessRole(input.role)) {
    return {
      status: 403,
      body: { error: "Rollen är planerad och kan inte köras ännu.", externalEffect: false },
    };
  }
  if (input.executionMode !== "test" && input.executionMode !== "review") {
    return { status: 403, body: { error: "Endast test- eller granskningsläge tillåts." } };
  }

  const taskType = V2_TASK_TYPE[input.role];
  const idempotencyKey = v2IdempotencyKey(input, now);
  const base = {
    assignedAgent: input.role,
    taskType,
    executionMode: input.executionMode,
    requiresApproval: true as const,
    externalEffect: false as const,
  };

  const { data: existing } = await ctx.supabase
    .from("agent_tasks")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing?.id) {
    return { status: 200, body: { ok: true, taskId: existing.id, duplicate: true, ...base } };
  }

  const instructions = input.goal?.trim()
    ? `${V2_INSTRUCTIONS[input.role]} Mål: ${input.goal.trim().slice(0, 400)}`
    : V2_INSTRUCTIONS[input.role];

  const { data: created, error } = await ctx.supabase
    .from("agent_tasks")
    .insert({
      customer_id: null,
      lead_id: null,
      assigned_agent: input.role,
      task_type: taskType,
      priority: "normal",
      status: "queued",
      instructions,
      requires_approval: true,
      approval_status: "pending",
      source_event: V2_SOURCE_EVENT[input.role],
      idempotency_key: idempotencyKey,
      execution_mode: input.executionMode,
      provider_type: "openai_agents",
      run_status: "not_started",
      run_budget: V2_RUN_BUDGET,
      runs_used: 0,
    })
    .select("id")
    .single();

  if (error) {
    if (/duplicate key|23505/i.test(String(error.message ?? ""))) {
      const { data: raced } = await ctx.supabase
        .from("agent_tasks")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (raced?.id) {
        return { status: 200, body: { ok: true, taskId: raced.id, duplicate: true, ...base } };
      }
    }
    throw new Error(String(error.message ?? "Kunde inte skapa uppgiften."));
  }

  await audit(ctx, created.id, "task_created", "system", {
    agent: input.role,
    taskType,
    provider: "openai_agents",
    externalEffect: false,
  });

  return { status: 200, body: { ok: true, taskId: created.id, duplicate: false, ...base } };
}

/* -------------------------------------------------------------- körning */

const summary = z.string().trim().min(10).max(4000);
// Agenterna svarar ofta med utförliga punkter; taket är generöst men ändå hårt.
const bullets = z.array(z.string().trim().min(3).max(2000)).min(1).max(8);

const managerSchema = z.object({
  summary,
  priorities: z.array(z.string().trim().min(3).max(1000)).min(1).max(8),
  delegate: z
    .object({
      to: z.enum([...V2_SPECIALISTS, "none"]),
      goal: z.string().trim().max(400).default(""),
    })
    .optional(),
});

const productTechSchema = z.object({
  summary,
  recommendations: bullets,
  implementationPrompt: z.string().trim().min(30).max(8000),
});

const growthSalesSchema = z.object({
  summary,
  recommendations: bullets,
  draftOutreach: z.string().trim().max(8000).default(""),
});

const customerSuccessSchema = z.object({
  summary,
  recommendations: bullets,
  churnRisk: z.enum(["low", "medium", "high"]).default("low"),
});

const qaRiskSchema = z.object({
  summary,
  risks: bullets,
  verdict: z.enum(["pass", "concerns", "fail"]).default("concerns"),
});

const operationsFinanceSchema = z.object({
  summary,
  recommendations: bullets,
  budgetStatus: z.enum(["ok", "watch", "over"]).default("ok"),
});

const V2_SCHEMA: Record<HarnessRole, z.ZodTypeAny> = {
  noryva_manager: managerSchema,
  product_tech: productTechSchema,
  growth_sales: growthSalesSchema,
  customer_success: customerSuccessSchema,
  qa_risk: qaRiskSchema,
  operations_finance: operationsFinanceSchema,
};

/** Plockar ut JSON ur agentens textoutput. Ingen gissning – felar hellre. */
export function parseHarnessOutput(
  role: HarnessRole,
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "Svaret innehöll ingen JSON." };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: "Svaret kunde inte tolkas som JSON." };
  }
  const parsed = V2_SCHEMA[role].safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Svaret matchade inte förväntat format." };
  return { ok: true, value: parsed.data as Record<string, unknown> };
}


async function audit(
  ctx: V2Context,
  taskId: string,
  eventType: string,
  actor: "agent" | "system" | "human",
  detail: Record<string, unknown>,
) {
  try {
    await ctx.supabase
      .from("agent_task_events")
      .insert({ task_id: taskId, actor, event_type: eventType, detail });
  } catch {
    /* audit får aldrig blockera */
  }
}

const V2_COLUMNS =
  "id, assigned_agent, task_type, status, instructions, requires_approval, approval_status, execution_mode, provider_type, provider_agent_id, provider_run_id, run_status, usage, run_budget, runs_used";

/**
 * Kör EN uppgift genom harnessen. Idempotent: bara `queued` startas, budgeten
 * kontrolleras före anropet och ingen extern effekt kan uppstå.
 */
export async function runV2TaskCore(
  ctx: V2Context,
  input: { taskId: string; runKind?: RunKind },
): Promise<V2Outcome> {
  const runKind: RunKind = input.runKind === "autonomous" ? "autonomous" : "manual";
  const { data: task, error } = await ctx.supabase
    .from("agent_tasks")
    .select(V2_COLUMNS)
    .eq("id", input.taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!task) return { status: 404, body: { error: "Uppgiften hittades inte." } };

  const role = task["assigned_agent"] as HarnessRole;
  if (!isRunnableHarnessRole(role)) {
    return { status: 403, body: { error: "Endast aktiva interna roller kan köras här." } };
  }
  if (task["execution_mode"] !== "test" && task["execution_mode"] !== "review") {
    return { status: 403, body: { error: "Endast test- eller granskningsläge tillåts." } };
  }
  if ((task["status"] as TaskStatus) !== "queued") {
    return {
      status: 409,
      body: { error: "Uppgiften kan inte köras i nuvarande status.", status: task["status"] },
    };
  }

  const budget = evaluateRunBudget({
    runBudget: Number(task["run_budget"] ?? 0),
    runsUsed: Number(task["runs_used"] ?? 0),
  });
  if (!budget.allowed) {
    await ctx.supabase.from("agent_tasks").update({ run_status: "blocked" }).eq("id", task["id"]);
    await audit(ctx, task["id"], "run_blocked", "system", {
      reason: budget.reason,
      externalEffect: false,
    });
    return { status: 409, body: { error: budget.reason, runStatus: "blocked" } };
  }

  const status = readHarnessStatus(ctx.harness ?? {});
  if (!status.configured) {
    await ctx.supabase.from("agent_tasks").update({ run_status: "blocked" }).eq("id", task["id"]);
    await audit(ctx, task["id"], "run_blocked", "system", {
      reason: status.reason,
      configured: false,
      externalEffect: false,
    });
    return {
      status: 409,
      body: { error: status.reason, configured: false, runStatus: "blocked", externalEffect: false },
    };
  }

  // Atomisk budgetreservation. Parallella workers serialiseras i SQL, så varken
  // soft cap, hard cap eller run cap kan passeras samtidigt.
  const budgetConfig = readBudgetConfig(
    ctx.harness?.env ?? runtimeEnvFromRequest(ctx.harness?.request),
  );
  const reservation = await reserveAgentRun(ctx, {
    role,
    taskId: String(task["id"]),
    kind: runKind,
    config: budgetConfig,
  });
  if (!reservation.ok) {
    await ctx.supabase.from("agent_tasks").update({ run_status: "blocked" }).eq("id", task["id"]);
    await audit(ctx, task["id"], "run_budget_blocked", "system", {
      runKind,
      state: reservation.state,
      reason: reservation.reason,
      externalEffect: false,
    });
    return {
      status: 409,
      body: {
        error: reservation.reason,
        budgetState: reservation.state,
        runStatus: "blocked",
        externalEffect: false,
      },
    };
  }

  // Atomisk start: bara den som vinner queued -> in_progress kör.
  const { data: claimed } = await ctx.supabase
    .from("agent_tasks")
    .update({
      status: "in_progress",
      run_status: "running",
      runs_used: Number(task["runs_used"] ?? 0) + 1,
    })
    .eq("id", task["id"])
    .eq("status", "queued")
    .select("id");
  if (!claimed || claimed.length === 0) {
    // Reservationen släpps som 'failed' så den inte belastar taket i onödan.
    await recordAgentRunUsage(ctx, {
      runId: reservation.runId,
      role,
      status: "failed",
      config: budgetConfig,
    });
    return { status: 409, body: { error: "Uppgiften körs redan." } };
  }
  await audit(ctx, task["id"], "task_started", "agent", {
    agent: role,
    provider: "openai_agents",
    externalEffect: false,
  });

  // Endast aggregerad, PII-fri drifttelemetri går till harnessen.
  const telemetry = await collectSystemTelemetry(ctx);
  const run = await runHarnessSession(
    {
      role,
      instructions: String(task["instructions"] ?? V2_INSTRUCTIONS[role]),
      input: [
        "Aggregerad drifttelemetri (ingen kunddata):",
        JSON.stringify(telemetry),
        V2_OUTPUT_CONTRACT[role],
      ].join("\n"),

    },
    ctx.harness ?? {},
  );

  const parsed = run.ok ? parseHarnessOutput(role, run.outputText) : null;

  if (!run.ok || !parsed || parsed.ok !== true) {
    const reason = run.ok ? (parsed as { error: string }).error : run.error;
    // Ingen provider-session startade: återställ uppgiften till körbar utan
    // att bränna run_budget eller lämna ett falskt provider_run_id.
    const retryable = run.ok === false && run.retryable === true;
    await ctx.supabase
      .from("agent_tasks")
      .update({
        status: retryable ? "queued" : "failed",
        run_status: retryable ? "not_started" : run.runStatus,
        provider_run_id: run.providerRunId,
        provider_agent_id: run.providerAgentId,
        usage: run.usage,
        ...(retryable ? { runs_used: Number(task["runs_used"] ?? 0) } : {}),
      })
      .eq("id", task["id"]);
    await recordAgentRunUsage(ctx, {
      runId: reservation.runId,
      role,
      status: "failed",
      inputTokens: run.usage.inputTokens,
      outputTokens: run.usage.outputTokens,
      config: budgetConfig,
    });
    await audit(ctx, task["id"], "run_failed", "agent", { reason, externalEffect: false });
    return { status: 502, body: { error: reason, runStatus: run.runStatus, externalEffect: false } };
  }

  const result = {
    kind: V2_TASK_TYPE[role],
    ...parsed.value,
    telemetry,
    generatedBy: "openai_agents",
    externalEffect: false,
  } as Record<string, unknown>;

  await ctx.supabase
    .from("agent_tasks")
    .update({
      status: "awaiting_review",
      result,
      run_status: "completed",
      provider_run_id: run.providerRunId,
      provider_agent_id: run.providerAgentId,
      usage: run.usage,
    })
    .eq("id", task["id"]);
  const costSek = await recordAgentRunUsage(ctx, {
    runId: reservation.runId,
    role,
    status: "completed",
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    config: budgetConfig,
  });
  await audit(ctx, task["id"], "result_saved", "agent", {
    resultKind: result["kind"],
    providerRunId: run.providerRunId,
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    runKind,
    estimatedCostSek: costSek,
    externalEffect: false,
  });

  const verdict = verifyTaskResult({
    taskType: V2_TASK_TYPE[role],
    requiresApproval: true,
    result,
  });
  await ctx.supabase
    .from("agent_tasks")
    .update({ verification_status: verdict.status, verification_reasons: verdict.reasons })
    .eq("id", task["id"]);
  await audit(ctx, task["id"], "task_verified", "agent", {
    verification: verdict.status,
    reasons: verdict.reasons,
    externalEffect: false,
  });

  // Specialist-run skapas ENDAST om Manager faktiskt delegerar.
  let delegatedTaskId = "";
  const delegate = (parsed.value as { delegate?: { to?: string; goal?: string } }).delegate;
  const target = delegate?.to ?? "none";
  if (
    role === "noryva_manager" &&
    (V2_SPECIALISTS as readonly string[]).includes(target)
  ) {
    const specialist = target as (typeof V2_SPECIALISTS)[number];
    // Delegering SKAPAR endast uppgiften. Ingen körning startas i samma kedja.
    const delegated = await createV2TaskCore(ctx, {
      role: specialist,
      executionMode: task["execution_mode"] as "test" | "review",
      ...(delegate?.goal ? { goal: delegate.goal } : {}),
      occurrence: `delegated:${task["id"]}`,
    });
    delegatedTaskId = String(delegated.body["taskId"] ?? "");
    await audit(ctx, task["id"], "task_delegated", "agent", {
      to: specialist,
      taskId: delegatedTaskId,
      started: false,
      externalEffect: false,
    });
  }


  return {
    status: 200,
    body: {
      ok: true,
      taskId: task["id"],
      status: "awaiting_review",
      runStatus: "completed",
      providerRunId: run.providerRunId,
      usage: run.usage,
      runKind,
      estimatedCostSek: costSek,
      verification: verdict.status,
      approvalStatus: "pending",
      delegatedTaskId,
      externalEffect: false,
    },
  };
}
