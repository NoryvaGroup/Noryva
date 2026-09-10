/**
 * Agent HQ – maskin-till-maskin-dispatch (TEST).
 *
 * Skapar exakt EN uppgift från ett internt event via befintlig deterministisk
 * `routeEvent()`. Ingen worker körs, ingen LLM anropas och ingen extern effekt
 * kan uppstå. Anropas endast efter verifierad HMAC i Growth API-lagret.
 */
import { routeEvent, type AgentEvent, type AgentEventType } from "./tasks";

export type DispatchContext = { supabase: any };

export type DispatchInput = {
  type: AgentEventType;
  leadId: string;
  occurrence?: string | undefined;
};

export type DispatchOutcome = { status: number; body: Record<string, unknown> };

export async function dispatchAgentEventCore(
  ctx: DispatchContext,
  input: DispatchInput,
): Promise<DispatchOutcome> {
  const { data: lead, error: leadErr } = await ctx.supabase
    .from("leads")
    .select("id, customer_id")
    .eq("id", input.leadId)
    .maybeSingle();
  if (leadErr) throw new Error(leadErr.message);
  if (!lead) return { status: 404, body: { error: "Förfrågan hittades inte." } };

  const { data: state } = await ctx.supabase
    .from("growth_lead_state")
    .select("intent_level")
    .eq("lead_id", input.leadId)
    .maybeSingle();

  const event: AgentEvent = {
    type: input.type,
    leadId: input.leadId,
    customerId: lead.customer_id ?? null,
    ...(state?.intent_level
      ? { leadPriority: state.intent_level as NonNullable<AgentEvent["leadPriority"]> }
      : {}),
    ...(input.occurrence ? { occurrence: input.occurrence } : {}),
  };
  const spec = routeEvent(event);

  const base = {
    assignedAgent: spec.assignedAgent,
    taskType: spec.taskType,
    priority: spec.priority,
    requiresApproval: spec.requiresApproval,
    executionMode: "test" as const,
    externalEffect: false as const,
  };

  const { data: existing } = await ctx.supabase
    .from("agent_tasks")
    .select("id")
    .eq("idempotency_key", spec.idempotencyKey)
    .maybeSingle();
  if (existing) {
    return { status: 200, body: { ok: true, taskId: existing.id, duplicate: true, ...base } };
  }

  const { data: created, error } = await ctx.supabase
    .from("agent_tasks")
    .insert({
      customer_id: lead.customer_id ?? null,
      lead_id: input.leadId,
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

  // Audit: endast metadata, aldrig lead-PII.
  try {
    await ctx.supabase.from("agent_task_events").insert({
      task_id: created.id,
      actor: "system",
      event_type: "task_created",
      detail: {
        event: spec.sourceEvent,
        agent: spec.assignedAgent,
        taskType: spec.taskType,
        priority: spec.priority,
        source: "make_growth",
        externalEffect: false,
      },
    });
  } catch {
    /* audit får aldrig blockera */
  }

  return { status: 200, body: { ok: true, taskId: created.id, duplicate: false, ...base } };
}
