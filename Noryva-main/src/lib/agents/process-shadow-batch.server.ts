/**
 * Agent HQ – Auto Process Review Mode för Shadow Review-uppgifter (TEST-only).
 *
 * Hämtar ett litet antal köade Sales-uppgifter som Shadow Review skapat och kör
 * dem EN och EN genom befintlig `processAgentTaskCore` (Sales-worker + QA).
 * Inga parallella workers, inga externa actions, ingen auto-approval.
 */
import { processAgentTaskCore, type AgentRunContext } from "./run.server";
import { SHADOW_REVIEW_OCCURRENCE } from "./shadow-review.server";

export const PROCESS_SHADOW_BATCH_MAX = 3;

export type ProcessShadowBatchInput = {
  executionMode: "test";
  limit?: number | undefined;
};

export type ProcessShadowBatchResult = {
  ok: true;
  executionMode: "test";
  scanned: number;
  processed: number;
  awaitingReview: number;
  failed: number;
  skipped: number;
  taskIds: string[];
  externalEffect: false;
};

async function audit(
  ctx: AgentRunContext,
  taskId: string,
  detail: Record<string, unknown>,
) {
  try {
    await ctx.supabase.from("agent_task_events").insert({
      task_id: taskId,
      actor: "system",
      event_type: "shadow_batch_processed",
      detail: { source: "shadow_review_batch", externalEffect: false, ...detail },
    });
  } catch {
    /* audit får aldrig blockera */
  }
}

export async function processShadowBatchCore(
  ctx: AgentRunContext,
  input: ProcessShadowBatchInput,
): Promise<ProcessShadowBatchResult> {
  if (input.executionMode !== "test") {
    throw new Error("Auto Process får endast köras i testläge.");
  }

  const limit = Math.min(Math.max(input.limit ?? PROCESS_SHADOW_BATCH_MAX, 1), PROCESS_SHADOW_BATCH_MAX);

  const { data, error } = await ctx.supabase
    .from("agent_tasks")
    .select("id")
    .eq("source_event", "new_lead")
    .eq("assigned_agent", "sales")
    .eq("task_type", "sales_draft")
    .eq("execution_mode", "test")
    .eq("status", "queued")
    .like("idempotency_key", `new_lead:%:${SHADOW_REVIEW_OCCURRENCE}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const tasks = (Array.isArray(data) ? data : []) as Array<{ id?: string | null }>;
  let processed = 0;
  let awaitingReview = 0;
  let failed = 0;
  let skipped = 0;
  const taskIds: string[] = [];

  for (const task of tasks) {
    const taskId = task?.id;
    if (typeof taskId !== "string" || taskId.length === 0) {
      skipped += 1;
      continue;
    }

    let outcome;
    try {
      outcome = await processAgentTaskCore(ctx, { taskId });
    } catch {
      // Ingen retry-loop. Uppgiften markeras som failed och lämnas till människa.
      failed += 1;
      taskIds.push(taskId);
      try {
        await ctx.supabase
          .from("agent_tasks")
          .update({ status: "failed" })
          .eq("id", taskId)
          .eq("status", "in_progress");
      } catch {
        /* status får inte blockera batchen */
      }
      await audit(ctx, taskId, { outcome: "failed" });
      continue;
    }

    if (outcome.status !== 200) {
      // 409 = redan claimad av en samtidig körning, 404/403 = inte körbar här.
      skipped += 1;
      continue;
    }

    taskIds.push(taskId);
    if (outcome.body["alreadyProcessed"] === true) {
      skipped += 1;
      continue;
    }

    processed += 1;
    if (outcome.body["status"] === "awaiting_review") awaitingReview += 1;
    await audit(ctx, taskId, {
      outcome: "processed",
      status: outcome.body["status"],
      verificationStatus: outcome.body["verificationStatus"],
      approvalStatus: outcome.body["approvalStatus"],
    });
  }

  return {
    ok: true,
    executionMode: "test",
    scanned: tasks.length,
    processed,
    awaitingReview,
    failed,
    skipped,
    taskIds,
    externalEffect: false,
  };
}
