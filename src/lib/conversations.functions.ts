/**
 * Konversations-, svars- och utfallslager (TEST/REVIEW).
 *
 * SÄKERHET: alla funktioner kräver inloggad administratör. Ingen inkorg är
 * kopplad – svar matas in manuellt i adminvyn. Endast maskerad text lagras;
 * personuppgifter tvättas bort innan de sparas eller klassificeras.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readStoredPayload } from "./landing/make-adapter";
import { redactReplyBody } from "./ai-sales/reply-redact";
import { classifyReplyDeterministic } from "./ai-sales/reply";
import { assertAdvance, outcomeStageSchema, scoreBandFor, summarizeFunnel, type OutcomeStage } from "./ai-sales/funnel";
import { buildActionKey, actionTypeSchema } from "./ai-sales/actions";
import { defaultProfile, rowToProfile } from "./ai-sales/profile";
import { qualifyLead } from "./ai-sales/qualify";

type AdminContext = { supabase: any; userId: string };

const MESSAGE_COLUMNS =
  "id, conversation_id, lead_id, customer_id, direction, channel, redacted_body, intent, confidence, escalate, escalation_reason, suggested_action, action_id, source_ref, received_at, created_at";

async function assertAdmin(context: AdminContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Behörighet saknas.");
}

async function logEvent(
  context: AdminContext,
  event: {
    eventType: string;
    actor: "ai" | "human" | "system";
    leadId?: string | null;
    customerId?: string | null;
    actionId?: string | null;
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
      action_id: event.actionId ?? null,
      detail: event.detail ?? {},
    });
  } catch {
    // Loggning får aldrig blockera flödet.
  }
}

async function loadLead(ctx: AdminContext, leadId: string) {
  const { data, error } = await ctx.supabase
    .from("leads")
    .select("id, customer_id, industry, payload, created_at")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Förfrågan hittades inte.");
  return data;
}

async function ensureConversation(ctx: AdminContext, lead: { id: string; customer_id: string }) {
  const { data: existing } = await ctx.supabase
    .from("conversations")
    .select("id, stage")
    .eq("lead_id", lead.id)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await ctx.supabase
    .from("conversations")
    .insert({ lead_id: lead.id, customer_id: lead.customer_id, stage: "new" })
    .select("id, stage")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function scoreBandForLead(ctx: AdminContext, lead: any) {
  const { data: profileRow } = await ctx.supabase
    .from("customer_profiles")
    .select("*")
    .eq("customer_id", lead.customer_id)
    .maybeSingle();
  const profile = profileRow
    ? rowToProfile(profileRow)
    : defaultProfile(lead.customer_id, lead.industry ?? "");
  const stored = readStoredPayload(lead.payload);
  const q = qualifyLead(lead.industry ?? "", (stored.answers ?? {}) as Record<string, string>, profile);
  return scoreBandFor(q.qualification);
}

/** Lista konversationer med meddelanden (endast maskerad text). */
export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { customerId?: string }) =>
    z.object({ customerId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);

    let query = ctx.supabase
      .from("conversations")
      .select("id, lead_id, customer_id, stage, human_owner, last_event_at, created_at")
      .order("last_event_at", { ascending: false })
      .limit(50);
    if (data.customerId) query = query.eq("customer_id", data.customerId);
    const { data: conversations, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (conversations ?? []).map((c: any) => c.id);
    let messages: any[] = [];
    if (ids.length > 0) {
      const { data: rows } = await ctx.supabase
        .from("conversation_messages")
        .select(MESSAGE_COLUMNS)
        .in("conversation_id", ids)
        .order("received_at", { ascending: true });
      messages = rows ?? [];
    }

    return {
      conversations: (conversations ?? []).map((c: any) => ({
        ...c,
        messages: messages.filter((m) => m.conversation_id === c.id),
      })),
    };
  });

/**
 * Matar in ett testsvar manuellt: texten maskeras, klassificeras
 * deterministiskt och eskaleras vid pris/förhandling/klagomål/juridik.
 */
export const addTestReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string; body: string }) =>
    z.object({ leadId: z.string().uuid(), body: z.string().min(1).max(5000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);

    const lead = await loadLead(ctx, data.leadId);
    const conversation = await ensureConversation(ctx, lead);
    const redacted = redactReplyBody(data.body, lead.payload);
    const classification = classifyReplyDeterministic(redacted);

    const { data: message, error } = await ctx.supabase
      .from("conversation_messages")
      .insert({
        conversation_id: conversation.id,
        lead_id: lead.id,
        customer_id: lead.customer_id,
        direction: "inbound",
        channel: "mock",
        redacted_body: redacted,
        intent: classification.intent,
        confidence: classification.confidence,
        escalate: classification.escalate,
        escalation_reason: classification.escalationReason,
        suggested_action: classification.suggestedAction,
        source_ref: "manual-test",
      })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    await ctx.supabase
      .from("conversations")
      .update({ stage: "replied", last_event_at: new Date().toISOString() })
      .eq("id", conversation.id);

    await logEvent(ctx, {
      eventType: "reply_classified",
      actor: "system",
      leadId: lead.id,
      customerId: lead.customer_id,
      detail: {
        intent: classification.intent,
        escalate: classification.escalate,
        suggestedAction: classification.suggestedAction,
      },
    });

    return { ok: true as const, message, classification };
  });

/** Skapar ett åtgärdsutkast utifrån ett klassificerat svar. Inget skickas. */
export const createActionFromReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messageId: string }) =>
    z.object({ messageId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);

    const { data: message, error: readErr } = await ctx.supabase
      .from("conversation_messages")
      .select(MESSAGE_COLUMNS)
      .eq("id", data.messageId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!message) return { ok: false as const, message: "Meddelandet hittades inte." };

    const actionType = actionTypeSchema.parse(message.suggested_action || "handoff_to_human");
    const key = buildActionKey({
      leadId: message.lead_id,
      actionType,
      attempt: `reply-${message.id.slice(0, 8)}`,
    });

    const { data: existing } = await ctx.supabase
      .from("sales_actions")
      .select("id")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing) {
      return { ok: true as const, actionId: existing.id, duplicate: true as const };
    }

    const { data: action, error } = await ctx.supabase
      .from("sales_actions")
      .insert({
        lead_id: message.lead_id,
        customer_id: message.customer_id,
        action_type: actionType,
        status: "draft",
        human_takeover: message.escalate || actionType === "handoff_to_human",
        subject: "",
        body: "",
        followup_questions: [],
        strategy_reason: message.escalate
          ? message.escalation_reason
          : `Föreslagen åtgärd utifrån svarets avsikt: ${message.intent}.`,
        params: { fromMessageId: message.id, intent: message.intent },
        idempotency_key: key,
        execution_mode: "test",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await ctx.supabase
      .from("conversation_messages")
      .update({ action_id: action.id })
      .eq("id", message.id);

    await logEvent(ctx, {
      eventType: "action_created_from_reply",
      actor: "human",
      leadId: message.lead_id,
      customerId: message.customer_id,
      actionId: action.id,
      detail: { actionType, escalate: message.escalate },
    });

    return { ok: true as const, actionId: action.id, duplicate: false as const };
  });

/** Registrerar ett steg i utfallstrappan. Varje steg kan bara sättas en gång. */
export const recordLeadOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string; stage: OutcomeStage; channel?: string }) =>
    z
      .object({
        leadId: z.string().uuid(),
        stage: outcomeStageSchema,
        channel: z.string().max(30).default("mock"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const lead = await loadLead(ctx, data.leadId);

    const { data: rows } = await ctx.supabase
      .from("lead_outcomes")
      .select("stage")
      .eq("lead_id", data.leadId);
    const existing = (rows ?? []).map((r: any) => r.stage as OutcomeStage);
    if (existing.includes(data.stage)) {
      return { ok: true as const, duplicate: true as const };
    }

    const order: OutcomeStage[] = ["lead", "contacted", "replied", "meeting", "won"];
    const current: OutcomeStage =
      existing.includes("lost")
        ? "lost"
        : ([...order].reverse().find((s) => existing.includes(s)) ?? "lead");
    if (data.stage !== "lead") assertAdvance(current, data.stage);

    const scoreBand = await scoreBandForLead(ctx, lead);
    const { error } = await ctx.supabase.from("lead_outcomes").insert({
      lead_id: lead.id,
      customer_id: lead.customer_id,
      stage: data.stage,
      channel: data.channel,
      score_band: scoreBand,
    });
    if (error) throw new Error(error.message);

    await logEvent(ctx, {
      eventType: "outcome_recorded",
      actor: "human",
      leadId: lead.id,
      customerId: lead.customer_id,
      detail: { stage: data.stage, scoreBand },
    });

    return { ok: true as const, duplicate: false as const, stage: data.stage, scoreBand };
  });

/** Funnelöversikt: antal per steg och konvertering per poängband. */
export const getFunnelSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { customerId?: string }) =>
    z.object({ customerId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);

    let query = ctx.supabase.from("lead_outcomes").select("lead_id, stage, score_band, channel");
    if (data.customerId) query = query.eq("customer_id", data.customerId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const summary = summarizeFunnel(
      (rows ?? []).map((r: any) => ({
        leadId: r.lead_id,
        stage: r.stage,
        scoreBand: r.score_band,
        channel: r.channel,
      })),
    );
    return { summary };
  });
