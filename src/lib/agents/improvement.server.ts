/**
 * Agent HQ – CTO / Systems Improvement Agent (v1, TEST/REVIEW-only).
 *
 * Den här agenten granskar Noryva-systemet självt i stället för ett lead.
 * Den läser ENDAST aggregerad drift-metadata (antal, statusar, kostnadssummor)
 * och aldrig kontaktuppgifter, lead-payloads eller mailtext.
 *
 * Agenten kan inte ändra kod, publicera, deploya, röra Make, skicka mail eller
 * skriva annan data än sin egen uppgift och audit. Resultatet stannar alltid i
 * `awaiting_review` och kräver mänskligt godkännande.
 */

export const IMPROVEMENT_TASK_TYPE = "cto_improvement_review" as const;
export const IMPROVEMENT_SOURCE_EVENT = "internal_improvement";
export const TELEMETRY_SAMPLE_LIMIT = 500;

export type ImprovementContext = { supabase: any };

export type SystemTelemetry = {
  generatedAt: string;
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byVerification: Record<string, number>;
    byApproval: Record<string, number>;
    byType: Record<string, number>;
  };
  events: { total: number; byType: Record<string, number>; llmFallbacks: number };
  aiCost: { events: number; estimatedCostTotal: number; byRoute: Record<string, number> };
  inboundWebhooks: { total: number; verified: number; unverified: number };
  leadDelivery: { total: number; byStatus: Record<string, number> };
};

function tally(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row?.[key] ?? "okänd");
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

async function readRows(
  ctx: ImprovementContext,
  table: string,
  columns: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const { data } = await ctx.supabase.from(table).select(columns).limit(TELEMETRY_SAMPLE_LIMIT);
    return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

/** Läser säker, aggregerad systemtelemetri. Ingen PII lämnar den här funktionen. */
export async function collectSystemTelemetry(
  ctx: ImprovementContext,
  now = new Date(),
): Promise<SystemTelemetry> {
  const [taskRows, eventRows, costRows, webhookRows, leadRows] = await Promise.all([
    readRows(ctx, "agent_tasks", "status, verification_status, approval_status, task_type"),
    readRows(ctx, "agent_task_events", "event_type, detail"),
    readRows(ctx, "ai_cost_events", "route, estimated_cost"),
    readRows(ctx, "inbound_webhook_events", "signature_verified"),
    readRows(ctx, "leads", "delivery_status"),
  ]);

  let llmFallbacks = 0;
  for (const row of eventRows) {
    const detail = (row?.["detail"] ?? {}) as Record<string, unknown>;
    if (row?.["event_type"] === "llm_call" && detail["usedFallback"] === true) llmFallbacks += 1;
  }

  const byRoute: Record<string, number> = {};
  let estimatedCostTotal = 0;
  for (const row of costRows) {
    const route = String(row?.["route"] ?? "okänd");
    const cost = Number(row?.["estimated_cost"] ?? 0) || 0;
    byRoute[route] = Number(((byRoute[route] ?? 0) + cost).toFixed(6));
    estimatedCostTotal += cost;
  }

  const verified = webhookRows.filter((r) => r?.["signature_verified"] === true).length;

  return {
    generatedAt: now.toISOString(),
    tasks: {
      total: taskRows.length,
      byStatus: tally(taskRows, "status"),
      byVerification: tally(taskRows, "verification_status"),
      byApproval: tally(taskRows, "approval_status"),
      byType: tally(taskRows, "task_type"),
    },
    events: { total: eventRows.length, byType: tally(eventRows, "event_type"), llmFallbacks },
    aiCost: {
      events: costRows.length,
      estimatedCostTotal: Number(estimatedCostTotal.toFixed(6)),
      byRoute,
    },
    inboundWebhooks: {
      total: webhookRows.length,
      verified,
      unverified: webhookRows.length - verified,
    },
    leadDelivery: { total: leadRows.length, byStatus: tally(leadRows, "delivery_status") },
  };
}

/* ------------------------------------------------------ skapa uppgiften */

export function improvementIdempotencyKey(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `${IMPROVEMENT_SOURCE_EVENT}:${day}`;
}

export type CreateImprovementInput = { executionMode: "test" };

export type CreateImprovementOutcome = { status: number; body: Record<string, unknown> };

const INSTRUCTIONS =
  "Granska Noryvas interna drift utifrån aggregerad systemtelemetri. Föreslå förbättringar och ett färdigt implementationPrompt. Ändra ingenting själv – allt går till mänsklig granskning.";

/**
 * Skapar EN intern improvement review per dygn. Ingen lead-koppling, ingen
 * worker körs här och ingen extern effekt kan uppstå.
 */
export async function createImprovementReviewCore(
  ctx: ImprovementContext,
  input: CreateImprovementInput,
  now = new Date(),
): Promise<CreateImprovementOutcome> {
  if (input.executionMode !== "test") {
    return { status: 403, body: { error: "Improvement review körs endast i testläge." } };
  }

  const idempotencyKey = improvementIdempotencyKey(now);
  const base = {
    assignedAgent: "systems_qa" as const,
    taskType: IMPROVEMENT_TASK_TYPE,
    executionMode: "test" as const,
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

  const { data: created, error } = await ctx.supabase
    .from("agent_tasks")
    .insert({
      customer_id: null,
      lead_id: null,
      assigned_agent: "systems_qa",
      task_type: IMPROVEMENT_TASK_TYPE,
      priority: "normal",
      status: "queued",
      instructions: INSTRUCTIONS,
      requires_approval: true,
      approval_status: "pending",
      source_event: IMPROVEMENT_SOURCE_EVENT,
      idempotency_key: idempotencyKey,
      execution_mode: "test",
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
    throw new Error(String(error.message ?? "Kunde inte skapa improvement review."));
  }

  try {
    await ctx.supabase.from("agent_task_events").insert({
      task_id: created.id,
      actor: "system",
      event_type: "task_created",
      detail: {
        event: IMPROVEMENT_SOURCE_EVENT,
        agent: "systems_qa",
        taskType: IMPROVEMENT_TASK_TYPE,
        source: "internal_cto_agent",
        externalEffect: false,
      },
    });
  } catch {
    /* audit får aldrig blockera */
  }

  return { status: 200, body: { ok: true, taskId: created.id, duplicate: false, ...base } };
}
