/**
 * Agent HQ – Shadow Review-köfyllare (TEST-only).
 *
 * Läser endast säkra identifierare för nyliga, nya leads och delegerar dem
 * genom den befintliga Orchestrator-dispatchen. Inga workers, AI-anrop eller
 * externa actions körs här.
 */
import { dispatchAgentEventCore, type DispatchContext } from "./dispatch.server";

export const SHADOW_REVIEW_MAX_BATCH = 10;
export const SHADOW_REVIEW_OCCURRENCE = "shadow-review-v1";

export type ShadowReviewInput = {
  executionMode: "test";
  limit?: number | undefined;
  recentHours?: number | undefined;
};

type LeadRef = {
  id: string | null;
  customer_id: string | null;
};

export type ShadowReviewResult = {
  ok: true;
  executionMode: "test";
  scanned: number;
  created: number;
  duplicate: number;
  skipped: number;
  taskIds: string[];
  externalEffect: false;
};

export async function shadowReviewBatchCore(
  ctx: DispatchContext,
  input: ShadowReviewInput,
  now = new Date(),
): Promise<ShadowReviewResult> {
  if (input.executionMode !== "test") {
    throw new Error("Shadow Review får endast köras i testläge.");
  }

  const limit = Math.min(Math.max(input.limit ?? SHADOW_REVIEW_MAX_BATCH, 1), SHADOW_REVIEW_MAX_BATCH);
  const recentHours = input.recentHours ?? 24;
  const cutoff = new Date(now.getTime() - recentHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await ctx.supabase
    .from("leads")
    .select("id, customer_id, created_at")
    .eq("customer_status", "Ny")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const leads = (Array.isArray(data) ? data : []) as LeadRef[];
  let created = 0;
  let duplicate = 0;
  let skipped = 0;
  const taskIds: string[] = [];

  for (const lead of leads) {
    if (!lead.id || !lead.customer_id) {
      skipped += 1;
      continue;
    }

    const { data: customer, error: customerError } = await ctx.supabase
      .from("customers")
      .select("id")
      .eq("id", lead.customer_id)
      .maybeSingle();
    if (customerError) throw new Error(customerError.message);
    if (!customer) {
      skipped += 1;
      continue;
    }

    const dispatched = await dispatchAgentEventCore(ctx, {
      type: "new_lead",
      leadId: lead.id,
      occurrence: SHADOW_REVIEW_OCCURRENCE,
      auditSource: "shadow_review",
    });
    if (dispatched.status === 404) {
      skipped += 1;
      continue;
    }
    if (dispatched.status !== 200) throw new Error("Shadow-uppgiften kunde inte skapas.");

    const taskId = dispatched.body["taskId"];
    if (typeof taskId === "string") taskIds.push(taskId);
    if (dispatched.body["duplicate"] === true) duplicate += 1;
    else created += 1;
  }

  return {
    ok: true,
    executionMode: "test",
    scanned: leads.length,
    created,
    duplicate,
    skipped,
    taskIds,
    externalEffect: false,
  };
}