/**
 * Post-approval execution – serverlager.
 *
 * Skapar idempotent ett execution-batch av agent_tasks knutet till ett godkänt
 * möte och kör uppgifterna sekventiellt och dependency-aware. Inga nya tabeller:
 * batchen identifieras av source_event och idempotency_key.
 *
 * Fail-closed: kundkontakt körs aldrig av en agent, kodändringar kan inte
 * appliceras utan repo-executor och externa åtgärder blockeras helt.
 */
import { runtimeEnvFromRequest } from "@/lib/growth/runtime-env";
import { EMPTY_SNAPSHOT, evaluateBudgetGate, readBudgetConfig } from "./budget";
import { readBoardroomSpentTodaySek, recordAgentRunUsage, reserveAgentRun } from "./budget.server";
import { extractJsonObject, repairJsonText } from "./boardroom";
import { buildContextPack } from "./context-pack";
import {
  classifyExecutionTask,
  executionBatchStatus,
  executionPlanKey,
  executionSourceEvent,
  executionTaskKey,
  executionTaskPrompt,
  legacyFallbackPlan,
  EXECUTION_PLAN_CONTRACT,
  nextExecutionTask,
  normalizeExecutionPlan,
  REPO_EXECUTOR_AVAILABLE,
  type ExecutionActionType,
  type ExecutionItem,
  type ExecutionTaskPlan,
} from "./execution";
import { runHarnessSession, type HarnessDeps, type HarnessRole } from "./openai-agents.server";
import { AGENT_EXTERNAL_ACTIONS_ENABLED, AGENT_POLICY, AUTHORITY_EXECUTE_ENABLED } from "./tasks";
import { V2_TASK_TYPE } from "./v2.server";

export type ExecutionContext = { supabase: any; userId?: string; harness?: HarnessDeps };

const TASK_COLUMNS =
  "id, assigned_agent, task_type, status, instructions, result, requires_approval, approval_status, source_event, idempotency_key, run_status, runs_used, created_at";

function assertFailClosed() {
  if (AUTHORITY_EXECUTE_ENABLED || AGENT_EXTERNAL_ACTIONS_ENABLED) {
    throw new Error("Genomförandet kräver att alla externa befogenheter är avstängda.");
  }
}

function metaOf(row: Record<string, any>): ExecutionItem | null {
  const meta = (row["result"] ?? {})["execution"] as Record<string, any> | undefined;
  if (!meta) return null;
  return {
    index: Number(meta["index"] ?? 0),
    role: meta["role"],
    actionType: meta["actionType"] as ExecutionActionType,
    goal: String(meta["goal"] ?? ""),
    successCriteria: String(meta["successCriteria"] ?? ""),
    dependencies: Array.isArray(meta["dependencies"]) ? meta["dependencies"].map(Number) : [],
    executionStatus: meta["executionStatus"],
    blockedReason: String(meta["blockedReason"] ?? ""),
  };
}

async function loadMeeting(ctx: ExecutionContext, meetingId: string) {
  const { data, error } = await ctx.supabase
    .from("agent_meetings")
    .select("id, agenda, status, approval_status, recommendation, final_summary, estimated_cost_sek")
    .eq("id", meetingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Mötet hittades inte.");
  return data as Record<string, any>;
}

async function loadBatch(ctx: ExecutionContext, meetingId: string) {
  const { data, error } = await ctx.supabase
    .from("agent_tasks")
    .select(TASK_COLUMNS)
    .eq("source_event", executionSourceEvent(meetingId))
    .order("idempotency_key", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, any>[];
}

/** Plockar executionPlan ur mötets sparade syntes (ingen extra körning). */
async function planFromSynthesis(ctx: ExecutionContext, meetingId: string): Promise<ExecutionTaskPlan[]> {
  const { data } = await ctx.supabase
    .from("agent_meeting_messages")
    .select("content")
    .eq("meeting_id", meetingId)
    .eq("message_type", "synthesis")
    .order("sequence", { ascending: false })
    .limit(1);
  const content = String(data?.[0]?.content ?? "");
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return normalizeExecutionPlan(parsed["executionPlan"]);
  } catch {
    return [];
  }
}

async function insertTasks(ctx: ExecutionContext, meetingId: string, plan: ExecutionTaskPlan[]) {
  const source = executionSourceEvent(meetingId);
  let created = 0;
  for (const item of plan) {
    const policy = classifyExecutionTask(item);
    const row = {
      assigned_agent: item.role,
      task_type: V2_TASK_TYPE[item.role as HarnessRole],
      priority: "normal",
      status: "queued",
      instructions: `${item.goal}`.slice(0, 1000),
      requires_approval: policy.finalStatus === "awaiting_human_approval",
      approval_status: policy.finalStatus === "awaiting_human_approval" ? "pending" : "not_required",
      source_event: source,
      idempotency_key: executionTaskKey(meetingId, item.index),
      execution_mode: "review",
      provider_type: "openai_agents",
      run_status: "not_started",
      run_budget: policy.providerRun ? 1 : 0,
      runs_used: 0,
      result: {
        externalEffect: false,
        execution: {
          meetingId,
          index: item.index,
          role: item.role,
          actionType: item.actionType,
          goal: item.goal,
          successCriteria: item.successCriteria,
          dependencies: item.dependencies,
          executionStatus: "queued",
          blockedReason: policy.blockedReason,
        },
      },
    };
    const { error } = await ctx.supabase.from("agent_tasks").insert(row);
    if (error) {
      if (/duplicate key|23505/i.test(String(error.message ?? ""))) continue;
      throw new Error(error.message);
    }
    created += 1;
  }
  return created;
}

/**
 * Startar execution-batchen för ett godkänt möte. Idempotent: dubbelklick på
 * Godkänn eller retry skapar aldrig dubbla uppgifter.
 */
export async function startMeetingExecutionCore(ctx: ExecutionContext, meetingId: string) {
  assertFailClosed();
  const meeting = await loadMeeting(ctx, meetingId);
  if (meeting["approval_status"] !== "approved") {
    return { ok: false as const, created: 0, needsPlanning: false as const, reason: "Mötet är inte godkänt." };
  }
  const existing = await loadBatch(ctx, meetingId);
  if (existing.length > 0) {
    return { ok: true as const, created: 0, needsPlanning: false as const, tasks: existing.length };
  }
  const plan = await planFromSynthesis(ctx, meetingId);
  if (plan.length === 0) {
    return { ok: true as const, created: 0, needsPlanning: true as const, tasks: 0 };
  }
  const created = await insertTasks(ctx, meetingId, plan);
  return { ok: true as const, created, needsPlanning: false as const, tasks: created };
}

function parseOutput(text: string): Record<string, unknown> | null {
  const candidate = extractJsonObject(text);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(repairJsonText(candidate)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** Kör ett provider-anrop inom befintlig budgetgrind. Returnerar rå output. */
async function runWithBudget(
  ctx: ExecutionContext,
  input: { meetingId: string; taskId: string; role: HarnessRole; instructions: string; prompt: string; requestKey: string; meetingSpent: number },
) {
  const budgetConfig = readBudgetConfig(ctx.harness?.env ?? runtimeEnvFromRequest(ctx.harness?.request));
  const boardroomSpentTodaySek = await readBoardroomSpentTodaySek(ctx, budgetConfig);
  const gate = evaluateBudgetGate({
    kind: "boardroom",
    role: input.role,
    snapshot: { ...EMPTY_SNAPSHOT, boardroomSpentTodaySek, boardroomMeetingSpentSek: input.meetingSpent },
    config: budgetConfig,
  });
  if (!gate.allowed) return { ok: false as const, paused: true as const, reason: gate.reason, costSek: 0, outputText: "" };
  const reservation = await reserveAgentRun(ctx, {
    role: input.role,
    taskId: input.taskId,
    kind: "boardroom",
    config: budgetConfig,
  });
  if (!reservation.ok) {
    return { ok: false as const, paused: true as const, reason: reservation.reason, costSek: 0, outputText: "" };
  }
  const run = await runHarnessSession(
    { role: input.role, instructions: input.instructions, input: input.prompt, requestKey: input.requestKey },
    { ...(ctx.harness ?? {}), timeoutMs: ctx.harness?.timeoutMs ?? 180_000 },
  );
  if (!run.ok) {
    await recordAgentRunUsage(ctx, {
      runId: reservation.runId,
      role: input.role,
      status: "failed",
      inputTokens: run.usage.inputTokens ?? 0,
      outputTokens: run.usage.outputTokens ?? 0,
      config: budgetConfig,
    });
    return { ok: false as const, paused: false as const, reason: run.error, costSek: 0, outputText: "" };
  }
  const costSek = await recordAgentRunUsage(ctx, {
    runId: reservation.runId,
    role: input.role,
    status: "completed",
    inputTokens: run.usage.inputTokens ?? 0,
    outputTokens: run.usage.outputTokens ?? 0,
    config: budgetConfig,
  });
  return { ok: true as const, paused: false as const, reason: "", costSek, outputText: run.outputText };
}

async function addMeetingCost(ctx: ExecutionContext, meetingId: string, current: number, costSek: number) {
  if (!costSek) return;
  await ctx.supabase
    .from("agent_meetings")
    .update({ estimated_cost_sek: current + costSek, updated_at: new Date().toISOString() })
    .eq("id", meetingId);
}

/** En billig Manager-planering för gamla möten utan executionPlan. Max en gång. */
async function planWithManager(ctx: ExecutionContext, meetingId: string, meeting: Record<string, any>) {
  const key = executionPlanKey(meetingId);
  const { data: existing } = await ctx.supabase
    .from("agent_tasks")
    .select("id, status, run_status, runs_used, result")
    .eq("idempotency_key", key)
    .maybeSingle();
  // Planeringen får bara kosta ETT provider-anrop per möte. Är den förbrukad
  // (oavsett utfall) faller vi tillbaka på en lokal, deterministisk plan.
  const plannerConsumed = Boolean(
    existing &&
      (Number(existing["runs_used"] ?? 0) >= 1 ||
        ["completed", "failed"].includes(String(existing["run_status"] ?? "")) ||
        ["done", "failed"].includes(String(existing["status"] ?? ""))),
  );
  let plan: ExecutionTaskPlan[] = [];
  if (existing?.result?.executionPlan) {
    plan = normalizeExecutionPlan(existing.result.executionPlan);
  } else if (plannerConsumed) {
    plan = [];
  } else {
    let taskId = existing?.id as string | undefined;
    if (!taskId) {
      const { data, error } = await ctx.supabase
        .from("agent_tasks")
        .insert({
          assigned_agent: "noryva_manager",
          task_type: "manager_directive",
          priority: "normal",
          status: "queued",
          instructions: "Bryt ned godkänd Boardroom-slutsats i en kort execution plan.",
          requires_approval: false,
          approval_status: "not_required",
          source_event: `${executionSourceEvent(meetingId)}:plan`,
          idempotency_key: key,
          execution_mode: "review",
          provider_type: "openai_agents",
          run_status: "not_started",
          run_budget: 1,
          runs_used: 0,
          result: { externalEffect: false },
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      taskId = data.id as string;
    }
    const run = await runWithBudget(ctx, {
      meetingId,
      taskId: taskId!,
      role: "noryva_manager",
      instructions: AGENT_POLICY.noryva_manager,
      prompt: [
        buildContextPack("noryva_manager"),
        `Godkänd slutsats: ${String(meeting["recommendation"] ?? "").slice(0, 800)}`,
        EXECUTION_PLAN_CONTRACT,
      ].join("\n"),
      requestKey: key,
      meetingSpent: Number(meeting["estimated_cost_sek"] ?? 0) || 0,
    });
    if (!run.ok) {
      await ctx.supabase
        .from("agent_tasks")
        .update({ status: "failed", run_status: "failed", runs_used: 1 })
        .eq("id", taskId!);
      return { plan: [] as ExecutionTaskPlan[], paused: run.paused, reason: run.reason };
    }
    await addMeetingCost(ctx, meetingId, Number(meeting["estimated_cost_sek"] ?? 0) || 0, run.costSek);
    const parsed = parseOutput(run.outputText);
    plan = normalizeExecutionPlan(parsed?.["tasks"]);
    await ctx.supabase
      .from("agent_tasks")
      .update({
        status: plan.length ? "done" : "failed",
        run_status: "completed",
        runs_used: 1,
        result: { externalEffect: false, executionPlan: plan },
      })
      .eq("id", taskId!);
  }
  if (plan.length === 0) {
    // Legacy: godkänt möte utan användbar plan. Bygg lokalt, utan provider-anrop.
    plan = legacyFallbackPlan({
      agenda: String(meeting["agenda"] ?? ""),
      recommendation: String(meeting["recommendation"] ?? ""),
      finalSummary: String(meeting["final_summary"] ?? ""),
    });
  }
  return { plan, paused: false, reason: plan.length ? "" : "Manager kunde inte skapa en genomförandeplan." };
}

export type AdvanceExecutionResult = {
  ok: boolean;
  done: boolean;
  paused?: boolean;
  reason?: string;
  batchStatus: string;
  index?: number;
  executionStatus?: string;
  externalEffect: false;
};

/**
 * Kör nästa uppgift i execution-batchen. Max ett provider-anrop per anrop.
 * Kundkontakt och externa åtgärder körs aldrig – de sätts i väntläge.
 */
export async function advanceExecutionCore(ctx: ExecutionContext, meetingId: string): Promise<AdvanceExecutionResult> {
  assertFailClosed();
  const meeting = await loadMeeting(ctx, meetingId);
  if (meeting["approval_status"] !== "approved") {
    return { ok: false, done: true, reason: "Mötet är inte godkänt.", batchStatus: "not_started", externalEffect: false };
  }
  let rows = await loadBatch(ctx, meetingId);
  if (rows.length === 0) {
    const plan = await planFromSynthesis(ctx, meetingId);
    if (plan.length > 0) {
      await insertTasks(ctx, meetingId, plan);
    } else {
      const planned = await planWithManager(ctx, meetingId, meeting);
      if (planned.plan.length === 0) {
        return {
          ok: false,
          done: true,
          paused: planned.paused,
          reason: planned.reason,
          batchStatus: "not_started",
          externalEffect: false,
        };
      }
      await insertTasks(ctx, meetingId, planned.plan);
    }
    rows = await loadBatch(ctx, meetingId);
  }

  const items = rows.map(metaOf).filter((item): item is ExecutionItem => Boolean(item));
  const next = nextExecutionTask(items);
  if (!next) {
    return { ok: true, done: true, batchStatus: executionBatchStatus(items), externalEffect: false };
  }
  const row = rows.find((candidate) => metaOf(candidate)?.index === next.index)!;
  const policy = classifyExecutionTask(next);

  const finish = async (
    executionStatus: string,
    patch: Record<string, unknown>,
    taskStatus: string,
    runStatus: string,
  ) => {
    const meta = { ...((row["result"] ?? {})["execution"] ?? {}), executionStatus, blockedReason: policy.blockedReason };
    await ctx.supabase
      .from("agent_tasks")
      .update({
        status: taskStatus,
        run_status: runStatus,
        result: { ...(row["result"] ?? {}), externalEffect: false, execution: meta, ...patch },
      })
      .eq("id", row["id"]);
  };

  if (!policy.providerRun) {
    // Kundkontakt: alltid människa. Extern åtgärd: fail closed.
    await finish(policy.finalStatus, {}, "awaiting_review", "not_started");
    const updated = items.map((item) =>
      item.index === next.index ? { ...item, executionStatus: policy.finalStatus } : item,
    );
    return {
      ok: true,
      done: Boolean(!nextExecutionTask(updated)),
      batchStatus: executionBatchStatus(updated),
      index: next.index,
      executionStatus: policy.finalStatus,
      externalEffect: false,
    };
  }

  const { data: claimed } = await ctx.supabase
    .from("agent_tasks")
    .update({ status: "in_progress", run_status: "running", runs_used: 1 })
    .eq("id", row["id"])
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) {
    return { ok: true, done: false, batchStatus: "running", index: next.index, externalEffect: false };
  }

  const run = await runWithBudget(ctx, {
    meetingId,
    taskId: String(row["id"]),
    role: next.role as HarnessRole,
    instructions: AGENT_POLICY[next.role],
    prompt: executionTaskPrompt({
      actionType: next.actionType,
      goal: next.goal,
      successCriteria: next.successCriteria,
      recommendation: String(meeting["recommendation"] ?? ""),
      contextPack: buildContextPack(next.role),
    }),
    requestKey: String(row["idempotency_key"]),
    meetingSpent: Number(meeting["estimated_cost_sek"] ?? 0) || 0,
  });
  if (!run.ok) {
    // Släpp tillbaka till kö så steget kan återupptas utan dubbel debitering.
    await ctx.supabase
      .from("agent_tasks")
      .update({ status: "queued", run_status: "not_started", runs_used: 0 })
      .eq("id", row["id"]);
    return {
      ok: false,
      done: true,
      paused: run.paused,
      reason: run.reason,
      batchStatus: "running",
      index: next.index,
      externalEffect: false,
    };
  }
  await addMeetingCost(ctx, meetingId, Number(meeting["estimated_cost_sek"] ?? 0) || 0, run.costSek);
  const parsed = parseOutput(run.outputText);
  const output = parsed ?? { summary: String(run.outputText ?? "").slice(0, 2000) };
  await finish(
    policy.finalStatus,
    policy.finalStatus === "ready_for_repo_executor"
      ? { output, implementationPatch: output["implementationPatch"] ?? null, repoExecutorAvailable: REPO_EXECUTOR_AVAILABLE }
      : { output },
    policy.finalStatus === "done" ? "done" : "awaiting_review",
    "completed",
  );
  const updated = items.map((item) =>
    item.index === next.index ? { ...item, executionStatus: policy.finalStatus } : item,
  );
  return {
    ok: true,
    done: Boolean(!nextExecutionTask(updated)),
    batchStatus: executionBatchStatus(updated),
    index: next.index,
    executionStatus: policy.finalStatus,
    externalEffect: false,
  };
}

export async function listExecutionCore(ctx: ExecutionContext, meetingId: string) {
  const rows = await loadBatch(ctx, meetingId);
  const tasks = rows
    .map((row) => {
      const meta = metaOf(row);
      if (!meta) return null;
      return {
        id: String(row["id"]),
        approvalStatus: String(row["approval_status"] ?? "not_required"),
        requiresApproval: Boolean(row["requires_approval"]),
        output: (row["result"] ?? {})["output"] ?? null,
        ...meta,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.index ?? 0) - (b!.index ?? 0));
  const items = tasks.map((task) => task as ExecutionItem);
  return {
    meetingId,
    tasks,
    batchStatus: executionBatchStatus(items),
    repoExecutorAvailable: REPO_EXECUTOR_AVAILABLE,
    externalEffect: false as const,
  };
}

/**
 * Mänskligt beslut om en kundkontakt-uppgift. Ändrar ENDAST intern status –
 * ingen sändning finns i den här versionen, varken mail, SMS eller Make.
 */
export async function decideExecutionContactCore(
  ctx: ExecutionContext,
  input: { taskId: string; decision: "approved" | "rejected" },
) {
  assertFailClosed();
  const { data: row, error } = await ctx.supabase
    .from("agent_tasks")
    .select(TASK_COLUMNS)
    .eq("id", input.taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Uppgiften hittades inte.");
  const meta = metaOf(row);
  if (!meta || meta.actionType !== "customer_contact") throw new Error("Uppgiften är inte en kundkontakt.");
  if (row["approval_status"] !== "pending") {
    return { ok: true as const, decision: row["approval_status"], externalEffect: false as const };
  }
  const executionStatus = input.decision === "approved" ? "awaiting_human_approval" : "blocked";
  const blockedReason =
    input.decision === "approved"
      ? "Godkänd av människa. Ingen automatisk utskickskanal finns – kontakten görs manuellt."
      : "Avvisad av människa.";
  const { error: updateError } = await ctx.supabase
    .from("agent_tasks")
    .update({
      approval_status: input.decision,
      status: input.decision === "approved" ? "awaiting_review" : "cancelled",
      result: {
        ...(row["result"] ?? {}),
        externalEffect: false,
        execution: { ...((row["result"] ?? {})["execution"] ?? {}), executionStatus, blockedReason },
      },
    })
    .eq("id", input.taskId)
    .eq("approval_status", "pending");
  if (updateError) throw new Error(updateError.message);
  return { ok: true as const, decision: input.decision, externalEffect: false as const };
}
