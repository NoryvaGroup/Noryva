/**
 * Nurture – serverlogik ovanpå befintlig Growth/Intent-motor.
 *
 * SÄKERHET:
 *  - Ingenting här skickar mail, SMS eller bokar möten. Statusen `sent` betyder
 *    "markerad som skickad i test/granskning", aldrig ett verkligt utskick.
 *  - Körläget valideras mot `assertExecutableMode` – live är hårdspärrat.
 *  - Inkommande svar lagras alltid PII-maskerade.
 *  - Modulen är fri från auth; anroparen ansvarar för behörighet.
 */
import { assertExecutableMode } from "@/lib/ai-sales/execution-mode";
import { classifyReplyDeterministic } from "@/lib/ai-sales/reply";
import { redactText } from "@/lib/ai-sales/context";
import {
  applyReplyToNurture,
  buildNurturePlan,
  canTransitionNurture,
  nextNurtureStepAt,
  nurtureStatusSchema,
  type NurtureStatus,
} from "./nurture";
import { readExecutionMode } from "@/lib/ai-sales/execution-mode";
import {
  loadLeadBundle,
  readLeadOutcomes,
  recomputeIntentCore,
  registerOutcomeCore,
  type GrowthContext,
} from "./service.server";
import { computeIntent } from "./intent";
import { needsHumanTakeover } from "@/lib/ai-sales/policy";
import { buildNurturePreview } from "./nurture-preview";
import type { MakeContext } from "./make-contract";

const TABLE = "growth_nurture_state";
const CONVERSATIONS = "conversations";
const MESSAGES = "conversation_messages";

export type NurtureRow = {
  lead_id: string;
  customer_id: string;
  status: NurtureStatus;
  reason: string;
  intent_level: string;
  questions: string[];
  next_step_at: string | null;
  steps_taken: number;
  last_reply_intent: string;
  human_takeover: boolean;
  upgrade_signal: boolean;
  stopped_reason: string;
  execution_mode: "test" | "review";
  updated_at?: string;
};

async function readNurtureRow(ctx: GrowthContext, leadId: string): Promise<NurtureRow | null> {
  const { data } = await ctx.supabase.from(TABLE).select("*").eq("lead_id", leadId).maybeSingle();
  return (data as NurtureRow) ?? null;
}

/** Stabil, kort hash för idempotenta source_ref-nycklar (inte kryptografisk). */
function stableHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hämtar eller skapar konversationen för ett lead. Idempotent: `conversations`
 * har unik lead_id, så en samtidig insert läses tillbaka i stället för att
 * skapa en dubblett. Ingen extern effekt.
 */
export async function ensureConversationCore(
  ctx: GrowthContext,
  lead: { id: string; customer_id: string },
): Promise<{ id: string; stage: string; created: boolean }> {
  const { data: existing } = await ctx.supabase
    .from(CONVERSATIONS)
    .select("id, stage")
    .eq("lead_id", lead.id)
    .maybeSingle();
  if (existing) return { id: existing.id, stage: existing.stage, created: false };

  const { data, error } = await ctx.supabase
    .from(CONVERSATIONS)
    .insert({ lead_id: lead.id, customer_id: lead.customer_id, stage: "new" })
    .select("id, stage")
    .single();
  if (error || !data) {
    const { data: retry } = await ctx.supabase
      .from(CONVERSATIONS)
      .select("id, stage")
      .eq("lead_id", lead.id)
      .maybeSingle();
    if (retry) return { id: retry.id, stage: retry.stage, created: false };
    throw new Error(error?.message ?? "Kunde inte skapa konversation.");
  }
  return { id: data.id, stage: data.stage ?? "new", created: true };
}

/** Skriver ett meddelande om samma source_ref inte redan finns. Aldrig utskick. */
async function insertMessageOnce(
  ctx: GrowthContext,
  message: {
    conversationId: string;
    leadId: string;
    customerId: string;
    direction: "inbound" | "outbound";
    redactedBody: string;
    intent: string;
    confidence: number;
    escalate: boolean;
    escalationReason: string;
    suggestedAction: string;
    sourceRef: string;
  },
): Promise<{ stored: boolean; duplicate: boolean; sourceRef: string }> {
  const { data: existing } = await ctx.supabase
    .from(MESSAGES)
    .select("id")
    .eq("conversation_id", message.conversationId)
    .eq("direction", message.direction)
    .eq("source_ref", message.sourceRef)
    .maybeSingle();
  if (existing) return { stored: false, duplicate: true, sourceRef: message.sourceRef };

  await ctx.supabase.from(MESSAGES).insert({
    conversation_id: message.conversationId,
    lead_id: message.leadId,
    customer_id: message.customerId,
    direction: message.direction,
    channel: "mock",
    redacted_body: message.redactedBody,
    intent: message.intent,
    confidence: message.confidence,
    escalate: message.escalate,
    escalation_reason: message.escalationReason,
    suggested_action: message.suggestedAction,
    source_ref: message.sourceRef,
  });
  return { stored: true, duplicate: false, sourceRef: message.sourceRef };
}

/** Tillåtna steg enligt databasens check-villkor. */
type ConversationStage =
  | "new"
  | "draft_ready"
  | "approved"
  | "contacted"
  | "replied"
  | "meeting_booked"
  | "closed";

async function touchConversation(ctx: GrowthContext, conversationId: string, stage: ConversationStage) {
  await ctx.supabase
    .from(CONVERSATIONS)
    .update({ stage, last_event_at: new Date().toISOString() })
    .eq("id", conversationId);
}


/** Statusar som betyder att den automatiska uppföljningen är avslutad. */
const TERMINAL_STATUSES: NurtureStatus[] = ["cancelled"];

/**
 * Skapar eller uppdaterar nurture-planen för ett lead.
 *
 * Idempotent: samma underlag ger samma rad. En redan avslutad eller besvarad
 * plan skrivs aldrig över av en ny planering.
 */
export async function planNurtureCore(
  ctx: GrowthContext,
  leadId: string,
  options: { now?: Date; makeContext?: MakeContext | null } = {},
) {
  // Samma auktoritativa underlag som route/analyze – intent kan inte divergera.
  const bundle = await loadLeadBundle(ctx, leadId, { makeContext: options.makeContext ?? null });
  const { lead, profile, qualification, context: aiContext, geography } = bundle;

  const outcomes = await readLeadOutcomes(ctx, lead.id);
  const intent = computeIntent({
    baseScore: qualification.score,
    basePriority: qualification.priority,
    outcomes,
  });

  const existing = await readNurtureRow(ctx, lead.id);
  const executionMode = assertExecutableMode(
    readExecutionMode(profile.executionMode ?? "review"),
  );

  const humanTakeover = needsHumanTakeover(aiContext);
  const companyName = aiContext.companyName ?? "";

  if (existing && (TERMINAL_STATUSES.includes(existing.status) || existing.status === "replied")) {
    return {
      ok: true as const,
      changed: false,
      intent,
      state: existing,
      humanTakeover,
      companyName,
    };
  }

  const geographyVerified =
    geography.configured && (geography.verdict === "local" || geography.verdict === "regional");

  const plan = buildNurturePlan({
    intentLevel: intent.level,
    terminal: intent.terminal,
    humanTakeover,
    missingInformation: aiContext.missingInformation ?? [],
    geographyVerified,
    executionMode,
    ...(options.now ? { now: options.now } : {}),
  });

  // Behåll ett redan planerat tillfälle så att omplanering inte skjuter fram det.
  const nextStepAt = plan.eligible && plan.nextStepAt ? (existing?.next_step_at ?? plan.nextStepAt) : null;

  const row: NurtureRow = {
    lead_id: lead.id,
    customer_id: lead.customer_id,
    status: plan.status,
    reason: plan.reason,
    intent_level: intent.level,
    questions: plan.questions,
    next_step_at: nextStepAt,
    steps_taken: existing?.steps_taken ?? 0,
    last_reply_intent: existing?.last_reply_intent ?? "",
    human_takeover: existing?.human_takeover ?? false,
    upgrade_signal: existing?.upgrade_signal ?? false,
    stopped_reason: plan.eligible ? "" : plan.reason,
    execution_mode: plan.executionMode,
  };

  await ctx.supabase.from(TABLE).upsert(row, { onConflict: "lead_id" });

  return { ok: true as const, changed: true, intent, state: row, plan, humanTakeover, companyName };
}

/**
 * TEST/REVIEW-brygga för Make.
 *
 * Planerar nurture och returnerar ett kundriktat utkast som INTE skickas.
 * `externalEffect` är alltid false: modulen har ingen mail-, SMS-, boknings-
 * eller notifieringsväg. Körläget normaliseras till test/review innan något
 * annat sker, så en kund som skulle vara live kan ändå inte utlösa utskick.
 */
export async function previewNurtureTestCore(
  ctx: GrowthContext,
  leadId: string,
  options: { now?: Date; makeContext?: MakeContext | null } = {},
) {
  const planned = await planNurtureCore(ctx, leadId, options);
  const state = planned.state;
  const eligible = state.status !== "cancelled" && (state.questions ?? []).length > 0;

  const preview = buildNurturePreview({
    questions: state.questions ?? [],
    companyName: planned.companyName,
    blocked: !eligible || planned.humanTakeover,
  });

  return {
    ok: true as const,
    eligible: eligible && preview !== null,
    intent: { score: planned.intent.score, level: planned.intent.level, reason: planned.intent.reason },
    status: state.status,
    reason: state.reason,
    questions: state.questions ?? [],
    nextStepAt: state.next_step_at,
    humanTakeover: planned.humanTakeover,
    executionMode: state.execution_mode,
    preview,
    notificationSent: false as const,
    externalEffect: false as const,
  };
}

/** Leads vars planerade uppföljningstillfälle har passerat. Inga utskick. */
export async function dueNurtureItemsCore(
  ctx: GrowthContext,
  options: { now?: Date; limit?: number } = {},
) {
  const now = (options.now ?? new Date()).toISOString();
  const { data } = await ctx.supabase
    .from(TABLE)
    .select("*")
    .in("status", ["pending", "review", "approved"])
    .not("next_step_at", "is", null)
    .lte("next_step_at", now)
    .order("next_step_at", { ascending: true })
    .limit(options.limit ?? 25);

  return { ok: true as const, now, items: (data ?? []) as NurtureRow[] };
}

/** Full kö för adminvyn, senast uppdaterade först. */
export async function nurtureQueueCore(ctx: GrowthContext, limit = 25) {
  const { data } = await ctx.supabase
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return { items: (data ?? []) as NurtureRow[] };
}

/** Manuell statusändring i granskningsläge. Ingen extern effekt. */
export async function setNurtureStatusCore(
  ctx: GrowthContext,
  input: { leadId: string; status: NurtureStatus },
) {
  const status = nurtureStatusSchema.parse(input.status);
  const existing = await readNurtureRow(ctx, input.leadId);
  if (!existing) throw new Error("Ingen nurture-plan finns för förfrågan.");
  if (!canTransitionNurture(existing.status, status)) {
    throw new Error(`Ogiltig statusövergång: ${existing.status} → ${status}.`);
  }
  // Extra spärr: "sent" får bara betyda markerad i test/granskning.
  assertExecutableMode(existing.execution_mode);

  const patch: Record<string, unknown> = { status };
  if (status === "sent") patch["steps_taken"] = (existing.steps_taken ?? 0) + 1;
  if (status === "cancelled") patch["stopped_reason"] = "Avslutad manuellt.";

  await ctx.supabase.from(TABLE).update(patch).eq("lead_id", input.leadId);
  return { ok: true as const, status };
}

/**
 * Registrerar ett inkommande svar i test/granskningsläge.
 *
 * Kör befintlig deterministisk klassificering, uppdaterar nurture-state och
 * registrerar utfall så att intent räknas om. Ingen notifiering skickas –
 * `upgradeSignal` är enbart en flagga för ett senare, separat steg.
 */
export async function registerNurtureReplyCore(
  ctx: GrowthContext,
  input: { leadId: string; body: string; source?: string; makeContext?: MakeContext | null },
) {
  // makeContext kastas LeadBindingError om kunden inte matchar lagrat lead.
  const { lead } = await loadLeadBundle(ctx, input.leadId, {
    makeContext: input.makeContext ?? null,
  });
  const redacted = redactText(input.body ?? "");
  const classification = classifyReplyDeterministic(redacted);
  const effect = applyReplyToNurture(classification);

  const existing = await readNurtureRow(ctx, lead.id);
  const status: NurtureStatus =
    existing && !canTransitionNurture(existing.status, effect.status) ? existing.status : effect.status;

  const row: Partial<NurtureRow> & { lead_id: string; customer_id: string } = {
    lead_id: lead.id,
    customer_id: lead.customer_id,
    status,
    reason: effect.reason,
    last_reply_intent: classification.intent,
    human_takeover: effect.humanTakeover || (existing?.human_takeover ?? false),
    upgrade_signal: effect.upgradeSignal || (existing?.upgrade_signal ?? false),
    next_step_at: effect.stop ? null : nextNurtureStepAt("NORMAL"),
    stopped_reason: effect.stop ? effect.reason : "",
    execution_mode: existing?.execution_mode ?? "review",
  };
  await ctx.supabase.from(TABLE).upsert(row, { onConflict: "lead_id" });

  // Idempotent via outcomeKey – samma svarstyp två gånger skapar inget nytt.
  let intent = null;
  if (effect.outcome) {
    const registered = await registerOutcomeCore(ctx, {
      leadId: lead.id,
      outcomeType: effect.outcome,
      source: input.source ?? "nurture_reply",
    });
    intent = registered.intent;
  } else {
    intent = await recomputeIntentCore(ctx, lead.id);
  }

  return {
    ok: true as const,
    classification,
    effect,
    previousIntent: existing?.intent_level ?? null,
    intent,
    state: row,
    /** Aldrig ett utskick: bara en intern flagga. */
    notificationSent: false as const,
    externalEffect: false as const,
    redactedBody: redacted,
  };
}
