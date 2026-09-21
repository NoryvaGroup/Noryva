/**
 * Agent HQ – serverlager (kontrollplan). Allt är admin-gated och internt:
 * inga mail, inga Make-anrop, inga bokningar och inga externa actions.
 *
 * De aktiva v1-rollerna (Noryva Manager, Product & Tech) körs av OpenAI Agents
 * API-harnessen via `v2.server.ts`. Saknas konfiguration görs ingenting alls.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildTaskResult } from "@/lib/agents/run.server";
import {
  assertTransition,
  evaluateApprovalDecision,
  routeEvent,
  verifyTaskResult,
  type AgentEvent,
  type TaskStatus,
} from "@/lib/agents/tasks";
import { MEETING_TYPES } from "@/lib/agents/boardroom";

type AdminContext = { supabase: any; userId: string };

const TASK_COLUMNS =
  "id, customer_id, lead_id, assigned_agent, task_type, priority, status, instructions, result, verification_status, verification_reasons, requires_approval, approval_status, source_event, idempotency_key, execution_mode, provider_type, provider_agent_id, provider_run_id, run_status, usage, run_budget, runs_used, created_at, updated_at";

async function assertAdmin(context: AdminContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Behörighet saknas.");
}

/** Audit-logg. Endast metadata och beslut – aldrig personuppgifter. */
async function logEvent(
  context: AdminContext,
  taskId: string,
  eventType: string,
  actor: "human" | "agent" | "system",
  detail: Record<string, unknown> = {},
) {
  try {
    await context.supabase.from("agent_task_events").insert({
      task_id: taskId,
      actor,
      actor_user_id: context.userId,
      event_type: eventType,
      detail,
    });
  } catch {
    /* audit får aldrig blockera */
  }
}

async function loadTask(context: AdminContext, id: string) {
  const { data, error } = await context.supabase
    .from("agent_tasks")
    .select(TASK_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Uppgiften hittades inte.");
  return data as Record<string, any>;
}

/* ------------------------------------------------------------------ läs */

export const listAgentTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { data: tasks, error } = await ctx.supabase
      .from("agent_tasks")
      .select(TASK_COLUMNS)
      // Boardroom-turns är internt mötesunderlag: Manager är intern kontrollnivå
      // och endast mötets slutsyntes går till användarens godkännande.
      .or("source_event.is.null,source_event.neq.boardroom_turn")
      // Genomförandeuppgifter har egen vy och egen godkännandeväg.
      .not("source_event", "ilike", "boardroom_execution%")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const { data: events } = await ctx.supabase
      .from("agent_task_events")
      .select("id, task_id, actor, event_type, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(25);

    return { tasks: tasks ?? [], events: events ?? [], mode: "TEST/REVIEW" as const };
  });

/* ------------------------------------------------------ harness (v2) */

/** Status för agent-harnessen. Returnerar aldrig nycklar eller hemligheter. */
export const getAgentHarnessStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { readHarnessStatus } = await import("@/lib/agents/openai-agents.server");
    return readHarnessStatus({ request: getRequest() });
  });

const v2Input = z.object({
  role: z.enum([
    "noryva_manager",
    "product_tech",
    "growth_sales",
    "customer_success",
    "qa_risk",
    "operations_finance",
  ]),

  goal: z.string().trim().max(400).optional(),
});

/** Skapar EN uppgift för en aktiv v1-roll. Ingen körning startas här. */
export const createV2Task = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => v2Input.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { createV2TaskCore } = await import("@/lib/agents/v2.server");
    const result = await createV2TaskCore(ctx, {
      role: data.role,
      executionMode: "test",
      ...(data.goal ? { goal: data.goal } : {}),
    });
    if (result.status !== 200) throw new Error(String(result.body["error"] ?? "Kunde inte skapa."));
    return { ok: true as const, ...result.body, externalEffect: false as const };
  });

/** Kör EN v1-uppgift via harnessen. Fail closed utan konfiguration. */
export const runV2Task = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { runV2TaskCore } = await import("@/lib/agents/v2.server");
    const result = await runV2TaskCore(
      { ...ctx, harness: { request: getRequest() } },
      { taskId: data.taskId },
    );
    if (result.status !== 200) throw new Error(String(result.body["error"] ?? "Körningen stoppades."));
    return { ok: true as const, ...result.body, externalEffect: false as const };
  });

/** Budgetstatus för Agent HQ. Endast aggregerade belopp – inga hemligheter. */
export const getAgentBudgetStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { readBudgetConfig, budgetStatusLabel } = await import("@/lib/agents/budget");
    const { readBudgetSnapshot } = await import("@/lib/agents/budget.server");
    const { runtimeEnvFromRequest } = await import("@/lib/growth/runtime-env");
    const config = readBudgetConfig(runtimeEnvFromRequest(getRequest()));
    const snapshot = await readBudgetSnapshot(ctx);
    return { config, snapshot, state: budgetStatusLabel(snapshot, config) };
  });

/* ---------------------------------------------------- Agent Boardroom */

export const listAgentMeetings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { listMeetingsCore } = await import("@/lib/agents/boardroom.server");
    return listMeetingsCore(ctx);
  });

const meetingInput = z.object({
  agenda: z.string().trim().min(10).max(2000),
  meetingType: z.enum(MEETING_TYPES),
  maxSpecialists: z.number().int().min(2).max(5),
});

export const createAgentMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => meetingInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { createMeetingCore } = await import("@/lib/agents/boardroom.server");
    return createMeetingCore(ctx, data);
  });

export const advanceAgentMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ meetingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { advanceMeetingCore } = await import("@/lib/agents/boardroom.server");
    return advanceMeetingCore({ ...ctx, harness: { request: getRequest() } }, data.meetingId);
  });

const meetingDecisionInput = z.object({
  meetingId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

/**
 * Mänskligt beslut om ett mötes slutsats. Ändrar ENDAST intern
 * approval-/mötesstatus – aldrig någon extern effekt eller agentkörning.
 */
export const decideAgentMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => meetingDecisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { data: meeting, error: readError } = await ctx.supabase
      .from("agent_meetings")
      .select("id, status, approval_status")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!meeting) throw new Error("Mötet hittades inte.");
    if (meeting.status !== "awaiting_approval" || meeting.approval_status !== "pending") {
      throw new Error("Mötet väntar inte på godkännande.");
    }
    const { error } = await ctx.supabase
      .from("agent_meetings")
      .update({
        approval_status: data.decision,
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.meetingId)
      .eq("status", "awaiting_approval")
      .eq("approval_status", "pending");
    if (error) throw new Error(error.message);
    // Godkännande startar det interna genomförandet idempotent. Avvisat möte
    // skapar ingenting. Ingen extern effekt sker här.
    let execution: { created: number; needsPlanning: boolean } | null = null;
    if (data.decision === "approved") {
      const { startMeetingExecutionCore } = await import("@/lib/agents/execution.server");
      const started = await startMeetingExecutionCore(ctx, data.meetingId);
      execution = { created: started.created, needsPlanning: Boolean(started.needsPlanning) };
    }
    return {
      ok: true as const,
      decision: data.decision,
      status: "completed" as const,
      execution,
      externalEffect: false as const,
    };
  });

/* --------------------------------------------- genomförande efter godkännande */

const meetingIdInput = z.object({ meetingId: z.string().uuid() });

/** Läser execution-batchen för ett godkänt möte. Ingen körning, ingen extern effekt. */
export const getMeetingExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => meetingIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { listExecutionCore } = await import("@/lib/agents/execution.server");
    return listExecutionCore(ctx, data.meetingId);
  });

/** Kör nästa genomförandeuppgift. Max ett provider-anrop per anrop. */
export const advanceMeetingExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => meetingIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { advanceExecutionCore } = await import("@/lib/agents/execution.server");
    return advanceExecutionCore({ ...ctx, harness: { request: getRequest() } }, data.meetingId);
  });

/**
 * Mänskligt beslut om en kundkontakt-uppgift. Ändrar endast intern status:
 * ingen mail-, SMS- eller Make-sändning finns i den här versionen.
 */
export const decideExecutionContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ taskId: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { decideExecutionContactCore } = await import("@/lib/agents/execution.server");
    return decideExecutionContactCore(ctx, data);
  });

/**
 * Avbryter ett pågående möte. Sätter ett terminalt stoppläge, släpper
 * arbetslåset och frigör ett-aktivt-möte-spärren. Ingen extern effekt,
 * ingen agentkörning. Idempotent: redan avbrutet möte ger samma svar.
 */
export const cancelAgentMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ meetingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { ACTIVE_MEETING_STATUSES } = await import("@/lib/agents/boardroom");
    const { data: meeting, error: readError } = await ctx.supabase
      .from("agent_meetings")
      .select("id, status")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!meeting) throw new Error("Mötet hittades inte.");
    if (!ACTIVE_MEETING_STATUSES.includes(meeting.status)) {
      if (meeting.status === "failed") {
        return { ok: true as const, status: "failed" as const, alreadyCancelled: true as const, externalEffect: false as const };
      }
      throw new Error("Mötet är redan avslutat och kan inte avbrytas.");
    }
    const now = new Date().toISOString();
    const { error } = await ctx.supabase
      .from("agent_meetings")
      .update({
        status: "failed",
        error: "Mötet avbröts manuellt av ägaren.",
        processing_token: null,
        claimed_at: null,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", data.meetingId)
      .in("status", ACTIVE_MEETING_STATUSES);
    if (error) throw new Error(error.message);

    // Städa alla aktiva interna Boardroom-turns för mötet. Provider-sessionen
    // kan ha hunnit starta, så behåll runs_used/provider_run_id för audit och
    // kostnadsredovisning men lämna aldrig tasken som running efter att
    // parent-mötet blivit terminalt avbrutet.
    const boardroomKey = `boardroom:${data.meetingId}:%`;
    const { error: taskCleanupError } = await ctx.supabase
      .from("agent_tasks")
      .update({
        status: "cancelled",
        run_status: "failed",
        updated_at: now,
      })
      .eq("source_event", "boardroom_turn")
      .like("idempotency_key", boardroomKey)
      .in("status", ["queued", "in_progress"]);
    if (taskCleanupError) throw new Error(taskCleanupError.message);

    return { ok: true as const, status: "failed" as const, alreadyCancelled: false as const, externalEffect: false as const };
  });

/* ---------------------------------------------- orchestrator (legacy) */


const eventInput = z.object({
  type: z.enum(["new_lead", "delivery_error", "lead_followup_due"]),
  leadId: z.string().uuid(),
  occurrence: z.string().max(64).optional(),
});

/**
 * Deterministisk orchestrator: tar ett internt event och skapar exakt en
 * uppgift. Samma event ger aldrig en dubblett (unik idempotensnyckel).
 */
export const dispatchAgentEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => eventInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);

    const { data: lead, error: leadErr } = await ctx.supabase
      .from("leads")
      .select("id, customer_id")
      .eq("id", data.leadId)
      .maybeSingle();
    if (leadErr) throw new Error(leadErr.message);
    if (!lead) throw new Error("Förfrågan hittades inte.");

    const { data: state } = await ctx.supabase
      .from("growth_lead_state")
      .select("intent_level")
      .eq("lead_id", data.leadId)
      .maybeSingle();

    const event: AgentEvent = {
      type: data.type,
      leadId: data.leadId,
      customerId: lead.customer_id ?? null,
      ...(state?.intent_level
        ? { leadPriority: state.intent_level as NonNullable<AgentEvent["leadPriority"]> }
        : {}),
      ...(data.occurrence ? { occurrence: data.occurrence } : {}),
    };
    const spec = routeEvent(event);

    const { data: existing } = await ctx.supabase
      .from("agent_tasks")
      .select("id")
      .eq("idempotency_key", spec.idempotencyKey)
      .maybeSingle();
    if (existing) return { ok: true as const, taskId: existing.id as string, duplicate: true as const };

    const { data: created, error } = await ctx.supabase
      .from("agent_tasks")
      .insert({
        customer_id: lead.customer_id ?? null,
        lead_id: data.leadId,
        assigned_agent: spec.assignedAgent,
        task_type: spec.taskType,
        priority: spec.priority,
        status: "queued",
        instructions: spec.instructions,
        requires_approval: spec.requiresApproval,
        approval_status: spec.requiresApproval ? "pending" : "not_required",
        source_event: spec.sourceEvent,
        idempotency_key: spec.idempotencyKey,
        execution_mode: "test",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await logEvent(ctx, created.id, "task_created", "system", {
      event: spec.sourceEvent,
      agent: spec.assignedAgent,
      taskType: spec.taskType,
      priority: spec.priority,
    });
    return { ok: true as const, taskId: created.id as string, duplicate: false as const };
  });

/* ------------------------------------------------ intern systemgranskning */

/**
 * Skapar EN intern systemgranskning (CTO-agenten) utan lead-koppling.
 * Uppgiften körs sedan med samma "Kör"-knapp som övriga uppgifter.
 */
export const createImprovementReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { createImprovementReviewCore } = await import("@/lib/agents/improvement.server");
    const result = await createImprovementReviewCore(ctx, { executionMode: "test" });
    if (result.status !== 200) throw new Error(String(result.body["error"] ?? "Kunde inte skapa."));
    return {
      ok: true as const,
      taskId: String(result.body["taskId"] ?? ""),
      duplicate: Boolean(result.body["duplicate"]),
      externalEffect: false as const,
    };
  });

/* -------------------------------------------------------------- workers */

const idInput = z.object({ taskId: z.string().uuid() });

/** Kör tilldelad worker i testläge. Deterministiskt, ingen extern effekt. */
export const runAgentTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const task = await loadTask(ctx, data.taskId);

    assertTransition(task["status"] as TaskStatus, "in_progress");
    await ctx.supabase.from("agent_tasks").update({ status: "in_progress" }).eq("id", task["id"]);
    await logEvent(ctx, task["id"], "task_started", "agent", { agent: task["assigned_agent"] });

    // Samma deterministiska workerlogik som det HMAC-skyddade TEST-endpointet.
    const result = await buildTaskResult(ctx, task);

    const nextStatus: TaskStatus = task["requires_approval"] ? "awaiting_review" : "done";
    const { error } = await ctx.supabase
      .from("agent_tasks")
      .update({ status: nextStatus, result })
      .eq("id", task["id"]);
    if (error) throw new Error(error.message);

    await logEvent(ctx, task["id"], "result_saved", "agent", {
      resultKind: result["kind"],
      status: nextStatus,
      externalEffect: false,
    });
    return { ok: true as const, status: nextStatus };
  });

/** Systems & QA verifierar ett resultat deterministiskt. */
export const verifyAgentTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const task = await loadTask(ctx, data.taskId);

    // Deterministisk normalisering av sparade resultat (alias/nästlade fält).
    // Inget innehåll uppfinns; saknas innehåll underkänns uppgiften som förut.
    const { normalizeTaskResult } = await import("@/lib/agents/normalize-result");
    const normalized = normalizeTaskResult(
      task["task_type"],
      (task["result"] ?? null) as Record<string, unknown> | null,
    );

    const verdict = verifyTaskResult({
      taskType: task["task_type"],
      requiresApproval: Boolean(task["requires_approval"]),
      result: normalized.result,
    });

    const update: Record<string, unknown> = {
      verification_status: verdict.status,
      verification_reasons: verdict.reasons,
    };
    if (normalized.addedKeys.length > 0 && normalized.result) {
      update["result"] = normalized.result;
    }

    const { error } = await ctx.supabase.from("agent_tasks").update(update).eq("id", task["id"]);
    if (error) throw new Error(error.message);

    await logEvent(ctx, task["id"], "task_verified", "agent", {
      verification: verdict.status,
      reasons: verdict.reasons,
      normalizedKeys: normalized.addedKeys,
      externalEffect: false,
    });

    return { ok: true as const, ...verdict };
  });

/* ------------------------------------------------------------ godkänn */

const decisionInput = z.object({
  taskId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

/**
 * Mänskligt beslut. Ändrar ENDAST intern approval-state – ingen agent får
 * någon extern förmåga av att en uppgift godkänns i den här versionen.
 */
export const decideAgentTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => decisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const task = await loadTask(ctx, data.taskId);

    // Ren regelutvärdering. Inga mail, SMS, bokningar eller Make-anrop får ske
    // av ett beslut – funktionen returnerar endast en intern statusändring.
    const { nextStatus } = evaluateApprovalDecision({
      executionMode: String(task["execution_mode"] ?? "test"),
      status: task["status"] as TaskStatus,
      requiresApproval: Boolean(task["requires_approval"]),
      approvalStatus: task["approval_status"],
      verificationStatus: task["verification_status"] ?? "not_started",
      decision: data.decision,
    });

    const { error } = await ctx.supabase
      .from("agent_tasks")
      .update({ approval_status: data.decision, status: nextStatus })
      .eq("id", task["id"]);
    if (error) throw new Error(error.message);

    await logEvent(ctx, task["id"], `task_${data.decision}`, "human", { externalEffect: false });
    return { ok: true as const, status: nextStatus };
  });
