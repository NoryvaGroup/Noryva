/**
 * Agent HQ – gemensam körnings-/verifieringskärna (TEST).
 *
 * Både adminvyn och det HMAC-skyddade TEST-endpointet använder samma logik här,
 * så workerbeteendet finns på exakt ett ställe. Ingen LLM, inga mail, inga
 * bokningar, inga Make-anrop – allt är deterministiskt och internt.
 */
import { defaultProfile, rowToProfile } from "@/lib/ai-sales/profile";
import { enrichSalesResult, type ReasoningDeps } from "./reasoning.server";
import { runSalesWorker, verifyTaskResult, type TaskStatus } from "./tasks";

export type AgentRunContext = { supabase: any; reasoning?: ReasoningDeps };

export const AGENT_TASK_COLUMNS =
  "id, customer_id, lead_id, assigned_agent, task_type, priority, status, instructions, result, verification_status, verification_reasons, requires_approval, approval_status, source_event, idempotency_key, execution_mode, created_at, updated_at";

/**
 * Kör tilldelad worker och returnerar ett internt resultat. Sales bygger endast
 * intern analys/utkast, Systems & QA gör en ren läsning av leveransstatus.
 */
export async function buildTaskResult(
  ctx: AgentRunContext,
  task: Record<string, any>,
): Promise<Record<string, unknown>> {
  if (task["assigned_agent"] === "sales") {
    const { data: lead } = await ctx.supabase
      .from("leads")
      .select("id, industry, payload, customer_id")
      .eq("id", task["lead_id"])
      .maybeSingle();
    if (!lead) throw new Error("Förfrågan hittades inte.");

    const { data: customer } = await ctx.supabase
      .from("customers")
      .select("name")
      .eq("id", lead.customer_id)
      .maybeSingle();
    const { data: profileRow } = await ctx.supabase
      .from("customer_profiles")
      .select("*")
      .eq("customer_id", lead.customer_id)
      .maybeSingle();

    const profile = profileRow
      ? rowToProfile(profileRow)
      : defaultProfile(lead.customer_id, lead.industry ?? "");

    const answers = ((lead.payload as { answers?: Record<string, unknown> } | null)?.answers ??
      {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) values[k] = String(v ?? "");

    const companyName = customer?.name ?? "Noryva";
    const deterministic = runSalesWorker({
      taskType: task["task_type"],
      industry: lead.industry ?? "",
      values,
      profile,
      companyName,
    });

    // Ett (1) LLM-anrop max. Utan nyckel eller vid minsta fel behålls det
    // deterministiska resultatet. Utkastet går ändå till mänsklig granskning.
    const enriched = await enrichSalesResult(
      deterministic,
      {
        taskType: task["task_type"],
        industry: lead.industry ?? "",
        companyName,
        priority: deterministic.qualification.priority,
        values,
      },
      ctx.reasoning ?? {},
    );
    return enriched as unknown as Record<string, unknown>;
  }

  const { data: lead } = await ctx.supabase
    .from("leads")
    .select("delivery_status, delivery_error, delivery_attempts")
    .eq("id", task["lead_id"])
    .maybeSingle();
  return {
    kind: "delivery_check",
    deliveryStatus: lead?.delivery_status ?? "",
    deliveryError: lead?.delivery_error ?? "",
    attempts: lead?.delivery_attempts ?? 0,
    generatedBy: "deterministic",
  };
}

async function audit(
  ctx: AgentRunContext,
  taskId: string,
  eventType: string,
  actor: "agent" | "system",
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

export type ProcessOutcome = { status: number; body: Record<string, unknown> };

function snapshot(task: Record<string, any>, alreadyProcessed: boolean) {
  return {
    ok: true,
    taskId: task["id"],
    assignedAgent: task["assigned_agent"],
    taskType: task["task_type"],
    status: task["status"],
    verificationStatus: task["verification_status"] ?? "not_started",
    requiresApproval: Boolean(task["requires_approval"]),
    approvalStatus: task["approval_status"] ?? "not_required",
    executionMode: "test" as const,
    externalEffect: false as const,
    alreadyProcessed,
  };
}

/**
 * Kör + verifierar EN uppgift i testläge. Idempotent: bara `queued` kan startas,
 * och en redan behandlad uppgift returnerar sitt nuvarande läge utan ny effekt.
 */
export async function processAgentTaskCore(
  ctx: AgentRunContext,
  input: { taskId: string },
): Promise<ProcessOutcome> {
  const { data: task, error } = await ctx.supabase
    .from("agent_tasks")
    .select(AGENT_TASK_COLUMNS)
    .eq("id", input.taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!task) return { status: 404, body: { error: "Uppgiften hittades inte." } };

  if (task["execution_mode"] !== "test") {
    return { status: 403, body: { error: "Endast uppgifter i testläge kan köras här." } };
  }

  const status = task["status"] as TaskStatus;
  if (status === "awaiting_review" || status === "done") {
    return { status: 200, body: snapshot(task, true) };
  }
  if (status !== "queued") {
    // Ingen auto-retry från in_progress/failed/cancelled – kräver mänsklig hantering.
    return { status: 409, body: { error: "Uppgiften kan inte köras i nuvarande status.", status } };
  }

  // Atomisk start: bara den som vinner övergången queued -> in_progress kör.
  const { data: claimed } = await ctx.supabase
    .from("agent_tasks")
    .update({ status: "in_progress" })
    .eq("id", task["id"])
    .eq("status", "queued")
    .select("id");
  if (!claimed || claimed.length === 0) {
    return { status: 409, body: { error: "Uppgiften körs redan." } };
  }
  await audit(ctx, task["id"], "task_started", "agent", {
    agent: task["assigned_agent"],
    taskType: task["task_type"],
    source: "make_growth",
    externalEffect: false,
  });

  const result = await buildTaskResult(ctx, task);
  const llm = result["llm"] as Record<string, unknown> | undefined;
  if (llm) {
    // Endast metadata: modell, försök, kostnadssignaler. Aldrig prompt eller svar.
    await audit(ctx, task["id"], "llm_call", "agent", {
      model: llm["model"],
      promptVersion: llm["promptVersion"],
      attempts: llm["attempts"],
      used: llm["used"],
      usedFallback: llm["usedFallback"],
      fallbackReason: llm["fallbackReason"],
      latencyMs: llm["latencyMs"],
      inputTokens: llm["inputTokens"],
      outputTokens: llm["outputTokens"],
      externalEffect: false,
    });
  }
  const nextStatus: TaskStatus = task["requires_approval"] ? "awaiting_review" : "done";

  const { error: saveErr } = await ctx.supabase
    .from("agent_tasks")
    .update({ status: nextStatus, result })
    .eq("id", task["id"]);
  if (saveErr) throw new Error(saveErr.message);
  await audit(ctx, task["id"], "result_saved", "agent", {
    resultKind: result["kind"],
    status: nextStatus,
    externalEffect: false,
  });

  const verdict = verifyTaskResult({
    taskType: task["task_type"],
    requiresApproval: Boolean(task["requires_approval"]),
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

  return {
    status: 200,
    body: snapshot(
      {
        ...task,
        status: nextStatus,
        verification_status: verdict.status,
      },
      false,
    ),
  };
}
