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
  input: { leadId: string; body: string; source?: string },
) {
  const { lead } = await loadLeadBundle(ctx, input.leadId);
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
    intent,
    state: row,
    /** Aldrig ett utskick: bara en intern flagga. */
    notificationSent: false as const,
    redactedBody: redacted,
  };
}
