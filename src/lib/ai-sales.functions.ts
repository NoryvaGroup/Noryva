import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAiSalesContext } from "./ai-sales/context";
import { serverAiSalesFlags, assertNoExternalSend } from "./ai-sales/flags";
import { resolvePolicyPath } from "./ai-sales/policy";
import { reviewStatusV1Schema, runToRow, type AssistantRun } from "./ai-sales/types";

type AdminContext = { supabase: any; userId: string };

const RUN_TABLE = "ai_sales_assistant_runs";
const RUN_COLUMNS =
  "id, lead_id, customer_id, action, contact_speed, subject, email_draft, followup_questions, human_takeover, strategy_reason, confidence, safety_flags, review_status, reviewer_notes, prompt_version, model, created_at, updated_at";

async function assertAdmin(context: AdminContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Behörighet saknas.");
}

function missingTable(message: string): boolean {
  return /relation .* does not exist|schema cache|42P01/i.test(message);
}

/**
 * Audit-logg. Endast metadata och beslut – aldrig personuppgifter eller
 * mailtext. Loggen får aldrig stoppa huvudflödet.
 */
async function logEvent(
  context: AdminContext,
  event: {
    eventType: string;
    actor: "ai" | "human" | "system";
    leadId?: string | null;
    customerId?: string | null;
    runId?: string | null;
    detail?: Record<string, unknown>;
  },
) {
  try {
    await context.supabase.from("ai_sales_events").insert({
      event_type: event.eventType,
      actor: event.actor,
      actor_user_id: context.userId,
      lead_id: event.leadId ?? null,
      customer_id: event.customerId ?? null,
      run_id: event.runId ?? null,
      detail: event.detail ?? {},
    });
  } catch {
    /* audit får aldrig blockera */
  }
}


export const getAiSalesFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as AdminContext);
    const flags = serverAiSalesFlags();
    assertNoExternalSend(flags);
    return { flags };
  });

/** Listar review-kön (senaste körningen per lead visas i UI:t). */
export const listAssistantRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { customerId?: string }) =>
    z.object({ customerId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AdminContext);
    const supabase = (context as AdminContext).supabase;
    let query = supabase
      .from(RUN_TABLE)
      .select(RUN_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.customerId) query = query.eq("customer_id", data.customerId);
    const { data: rows, error } = await query;
    if (error) {
      if (missingTable(error.message)) return { runs: [], tableMissing: true as const };
      throw new Error(error.message);
    }
    return { runs: rows ?? [], tableMissing: false as const };
  });

/** Skapar ett utkast för ett lead. Skickar aldrig något externt. */
export const generateAssistantRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string }) =>
    z.object({ leadId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AdminContext);
    const flags = serverAiSalesFlags();
    assertNoExternalSend(flags);
    if (!flags.enabled) {
      return { ok: false as const, message: "AI-säljassistenten är avstängd (AI_SALES_ASSISTANT_ENABLED)." };
    }

    const supabase = (context as AdminContext).supabase;
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, customer_id, industry, payload, created_at")
      .eq("id", data.leadId)
      .maybeSingle();
    if (leadErr) throw new Error(leadErr.message);
    if (!lead) return { ok: false as const, message: "Förfrågan hittades inte." };

    const { data: customer } = await supabase
      .from("customers")
      .select("name, industry, service_area")
      .eq("id", lead.customer_id)
      .maybeSingle();

    const aiContext = buildAiSalesContext(
      {
        leadId: lead.id,
        customerId: lead.customer_id,
        industry: lead.industry,
        createdAt: lead.created_at,
        payload: lead.payload,
      },
      {
        name: customer?.name ?? "",
        industry: customer?.industry ?? lead.industry,
        serviceArea: customer?.service_area ?? "",
      },
    );

    const { generateAssistantDraft } = await import("./ai-sales/generate.server");
    const result = await generateAssistantDraft(aiContext);

    const run: AssistantRun = {
      ...result.output,
      leadId: lead.id,
      customerId: lead.customer_id,
      reviewStatus: "draft",
      reviewerNotes: "",
      promptVersion: result.promptVersion,
      model: result.model,
    };

    const { data: saved, error } = await supabase
      .from(RUN_TABLE)
      .insert(runToRow(run))
      .select(RUN_COLUMNS)
      .maybeSingle();
    if (error) {
      if (missingTable(error.message)) {
        return {
          ok: false as const,
          message: "Historiktabellen är inte skapad ännu – kör migrationen för ai_sales_assistant_runs.",
        };
      }
      throw new Error(error.message);
    }

    const policy = resolvePolicyPath(aiContext);
    await logEvent(context as AdminContext, {
      eventType: "ai_run_generated",
      actor: "ai",
      leadId: lead.id,
      customerId: lead.customer_id,
      runId: saved?.id ?? null,
      detail: {
        action: result.output.action,
        contactSpeed: result.output.contactSpeed,
        humanTakeover: result.output.humanTakeover,
        confidence: result.output.confidence,
        usedFallback: result.usedFallback,
        model: result.model,
        promptVersion: result.promptVersion,
        policy,
      },
    });

    return {
      ok: true as const,
      run: saved,
      usedFallback: result.usedFallback,
      generationError: result.error ?? "",
      policy,
    };

  });

/**
 * Uppdaterar review-status. "sent" är inte tillåtet i v1 – ingen extern
 * kommunikation sker någonstans i den här funktionen.
 */
export const setAssistantReviewStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reviewStatus: string; reviewerNotes?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        reviewStatus: reviewStatusV1Schema,
        reviewerNotes: z.string().max(4000).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AdminContext);
    const { data: updated, error } = await (context as AdminContext).supabase
      .from(RUN_TABLE)
      .update({ review_status: data.reviewStatus, reviewer_notes: data.reviewerNotes })
      .eq("id", data.id)
      .select(RUN_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    await logEvent(context as AdminContext, {
      eventType: `ai_run_${data.reviewStatus}`,
      actor: "human",
      leadId: updated?.lead_id ?? null,
      customerId: updated?.customer_id ?? null,
      runId: data.id,
      detail: { reviewStatus: data.reviewStatus, hasNotes: data.reviewerNotes.length > 0 },
    });
    return { ok: true as const, run: updated };

  });

/** Sparar en redigerad ämnesrad/mailtext. Skickar inget. */
export const updateAssistantDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; subject: string; emailDraft: string }) =>
    z
      .object({
        id: z.string().uuid(),
        subject: z.string().trim().min(3).max(120),
        emailDraft: z.string().trim().min(20).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AdminContext);
    const { data: updated, error } = await (context as AdminContext).supabase
      .from(RUN_TABLE)
      .update({ subject: data.subject, email_draft: data.emailDraft })
      .eq("id", data.id)
      .select(RUN_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true as const, run: updated };
  });
