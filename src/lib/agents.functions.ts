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
  role: z.enum(["noryva_manager", "product_tech"]),
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

    const verdict = verifyTaskResult({
      taskType: task["task_type"],
      requiresApproval: Boolean(task["requires_approval"]),
      result: (task["result"] ?? null) as Record<string, unknown> | null,
    });

    const { error } = await ctx.supabase
      .from("agent_tasks")
      .update({ verification_status: verdict.status, verification_reasons: verdict.reasons })
      .eq("id", task["id"]);
    if (error) throw new Error(error.message);

    await logEvent(ctx, task["id"], "task_verified", "agent", {
      verification: verdict.status,
      reasons: verdict.reasons,
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
