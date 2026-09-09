/**
 * Granskningsregister för uppföljningsutskick – serverlogik.
 *
 * SÄKERHET:
 *  - Ingen kod här skickar mail. Utskicket görs av Make/SMTP efter att en
 *    administratör godkänt och Make hämtat posten via signerad endpoint.
 *  - Databasen är facit: godkännande, hämtning, slutförande och misslyckande
 *    körs som atomära SQL-funktioner med radlås.
 *  - Frontenden skickar aldrig mottagare, ämne eller brödtext – bara reviewId
 *    och det avtryck den faktiskt visat.
 *  - En hämtad post släpps aldrig automatiskt tillbaka till kön.
 */
import { buildNurturePreview } from "./nurture-preview";
import { computeIntent } from "./intent";
import { needsHumanTakeover } from "@/lib/ai-sales/policy";
import { readStoredPayload } from "@/lib/landing/make-adapter";
import {
  loadLeadBundle,
  readLeadOutcomes,
  recomputeIntentCore,
  type GrowthContext,
} from "./service.server";
import {
  ensureConversationCore,
  dueNurtureItemsCore,
  planNurtureCore,
  registerNurtureReplyCore,
} from "./nurture.server";
import {
  NURTURE_REPLY_TO,
  evaluateReviewGate,
  externalSendDecision,
  isValidEmail,
  normalizeEmail,
  occurrenceKey,
  readBooleanFlag,
  reviewFingerprint,
  sourceFingerprint,
  stableHash,
} from "./nurture-review";
import type { RuntimeEnv } from "./runtime-env";

const TABLE = "nurture_reviews";
const MESSAGES = "conversation_messages";

export const EXTERNAL_SEND_FLAG = "NORYVA_NURTURE_EXTERNAL_SEND_ENABLED";
export const REVIEW_WEBHOOK_ENV = "NORYVA_NURTURE_REVIEW_WEBHOOK_URL";

export type NurtureReviewRow = {
  id: string;
  lead_id: string;
  customer_id: string;
  conversation_id: string | null;
  occurrence_key: string;
  step_index: number;
  due_at: string;
  intent_level: string;
  company_name: string;
  recipient_email: string;
  subject: string;
  body: string;
  questions: string[];
  content_fingerprint: string;
  source_fingerprint: string;
  source_revision: string;
  reason: string;
  human_takeover: boolean;
  intent_score: number;
  status: string;
  blocked_reason: string;
  execution_mode: string;
  approved_by: string | null;
  approved_at: string | null;
  attempt_id: string | null;
  transport_message_id: string | null;
  sent_at: string | null;
  failure_reason: string;
  updated_at?: string;
};

/** Mottagaradressen kommer ALLTID från lagrad lead-payload. */
export function recipientFromLead(payload: unknown): string {
  const stored = readStoredPayload(payload);
  const fromMake = normalizeEmail(stored.make?.epost);
  if (isValidEmail(fromMake)) return fromMake;
  const answers = (stored.answers ?? {}) as Record<string, string>;
  for (const key of ["epost", "email", "e-post"]) {
    const value = normalizeEmail(answers[key]);
    if (isValidEmail(value)) return value;
  }
  return "";
}

export type BuiltReview = {
  leadId: string;
  customerId: string;
  conversationId: string | null;
  dueAt: string | null;
  stepIndex: number;
  intentLevel: string;
  intentScore: number;
  companyName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  questions: string[];
  blockedReason: string;
  /** Uppföljningsplanens egen motivering (visas för administratören). */
  reason: string;
  /** Faktisk flagga för mänsklig handläggning, inte bara indirekt spärrorsak. */
  humanTakeover: boolean;
  executionMode: string;
  contentFingerprint: string;
  sourceFingerprint: string;
  /** Databasens avtryck av underlaget. Facit vid godkännande och hämtning. */
  sourceRevision: string;
  /** Databasens auktoritativa spärrorsak, tom sträng när inget hindrar. */
  sqlBlockedReason: string;
};

/** Läser lagrad uppföljningsplan utan att skriva. */
async function readNurtureState(ctx: GrowthContext, leadId: string) {
  const { data } = await ctx.supabase
    .from("growth_nurture_state")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle();
  return (data as Record<string, any> | null) ?? null;
}

/**
 * Bygger den auktoritativa granskningsposten för ett lead utifrån live-data.
 *
 * HELT LÄSANDE: ingen planering, ingen upsert, ingen konversation skapas.
 * Funktionen körs vid godkännande och hämtning, där en skrivning skulle kunna
 * nollställa en redan godkänd post. Endast den schemalagda planeringen
 * (refreshDueNurtureReviewsCore) får skriva.
 */
export async function buildReviewCandidate(
  ctx: GrowthContext,
  leadId: string,
  options: { now?: Date } = {},
): Promise<BuiltReview> {
  const now = options.now ?? new Date();

  const bundle = await loadLeadBundle(ctx, leadId);
  const outcomes = await readLeadOutcomes(ctx, leadId);
  const intent = computeIntent({
    baseScore: bundle.qualification.score,
    basePriority: bundle.qualification.priority,
    outcomes,
  });

  const state = await readNurtureState(ctx, leadId);
  const customerId = String(state?.["customer_id"] ?? bundle.lead.customer_id);

  const { data: customer } = await ctx.supabase
    .from("customers")
    .select("id, name, status")
    .eq("id", customerId)
    .maybeSingle();

  const { data: conversationRow } = await ctx.supabase
    .from("conversations")
    .select("id, human_owner")
    .eq("lead_id", leadId)
    .maybeSingle();

  const recipientEmail = recipientFromLead(bundle.lead.payload);
  const questions: string[] = (state?.["questions"] as string[]) ?? [];
  const companyName = bundle.context.companyName ?? "";
  const preview = state
    ? buildNurturePreview({ questions, companyName, blocked: false })
    : null;

  const { data: sourceRow } = await ctx.supabase.rpc("nurture_source_revision", {
    p_lead_id: leadId,
    p_lock: false,
  });
  const source = (sourceRow ?? {}) as { ok?: boolean; reason?: string; revision?: string };
  const sqlBlockedReason = source.ok === true ? "" : String(source.reason ?? "Underlaget kunde inte prövas.");

  const humanTakeover = needsHumanTakeover(bundle.context) || state?.["human_takeover"] === true;
  const optedOut = String(state?.["last_reply_intent"] ?? "") === "avbojer";
  const dueAt = (state?.["next_step_at"] as string | null) ?? null;
  const executionMode = String(state?.["execution_mode"] ?? "review");

  const tsBlockedReason = state
    ? evaluateReviewGate({
        intentLevel: intent.level,
        terminal: intent.terminal,
        humanTakeover,
        conversationHumanOwner: conversationRow?.human_owner ?? null,
        optedOut,
        nurtureStatus: String(state["status"] ?? ""),
        customerStatus: String(customer?.status ?? ""),
        recipientEmail,
        hasPreview: preview !== null,
        executionMode,
        dueAt,
        now,
      })
    : "Ingen uppföljningsplan finns för förfrågan.";
  // Databasens prövning väger tyngst; TS-lagret är ett extra skyddsnät.
  const blockedReason = sqlBlockedReason || tsBlockedReason;

  const subject = preview?.subject ?? "";
  const body = preview?.body ?? "";

  return {
    leadId,
    customerId,
    conversationId: (conversationRow?.id as string | undefined) ?? null,
    dueAt,
    stepIndex: Number(state?.["steps_taken"] ?? 0),
    intentLevel: intent.level,
    intentScore: intent.score,
    companyName,
    recipientEmail,
    subject,
    body,
    questions,
    blockedReason,
    reason: String(state?.["reason"] ?? ""),
    humanTakeover,
    executionMode,
    sourceRevision: String(source.revision ?? ""),
    sqlBlockedReason,
    contentFingerprint: await reviewFingerprint({
      leadId,
      customerId,
      recipientEmail,
      subject,
      body,
      questions,
      dueAt: dueAt ?? "",
    }),
    sourceFingerprint: await sourceFingerprint({
      intentLevel: intent.level,
      intentScore: intent.score,
      intentTerminal: intent.terminal,
      nurtureStatus: String(state?.["status"] ?? ""),
      stepsTaken: Number(state?.["steps_taken"] ?? 0),
      humanTakeover,
      lastReplyIntent: String(state?.["last_reply_intent"] ?? ""),
      executionMode,
      customerStatus: String(customer?.status ?? ""),
      leadPayload: bundle.lead.payload,
      profile: bundle.profile,
      outcomes: (outcomes ?? []).map((o: any) => `${o?.outcome_type ?? o?.stage ?? ""}:${o?.id ?? ""}`),
      conversationHumanOwner: String(conversationRow?.human_owner ?? ""),
    }),
  };
}

/** Statusar där innehållet fortfarande får uppdateras. */
const MUTABLE_STATUSES = ["pending_review", "blocked"];

async function upsertReview(
  writer: GrowthContext,
  candidate: BuiltReview,
  now: Date,
): Promise<{ row: NurtureReviewRow | null; created: boolean; updated: boolean }> {
  if (!candidate.dueAt || new Date(candidate.dueAt).getTime() > now.getTime()) {
    return { row: null, created: false, updated: false };
  }
  const key = occurrenceKey(candidate.stepIndex, candidate.dueAt);

  const { data: existing } = await writer
    .supabase.from(TABLE)
    .select("*")
    .eq("lead_id", candidate.leadId)
    .eq("occurrence_key", key)
    .maybeSingle();

  const payload = {
    lead_id: candidate.leadId,
    customer_id: candidate.customerId,
    conversation_id: candidate.conversationId,
    occurrence_key: key,
    step_index: candidate.stepIndex,
    due_at: candidate.dueAt,
    intent_level: candidate.intentLevel,
    intent_score: candidate.intentScore,
    company_name: candidate.companyName,
    recipient_email: candidate.recipientEmail,
    subject: candidate.subject,
    body: candidate.body,
    questions: candidate.questions,
    content_fingerprint: candidate.contentFingerprint,
    source_fingerprint: candidate.sourceFingerprint,
    source_revision: candidate.sourceRevision,
    status: candidate.blockedReason ? "blocked" : "pending_review",
    blocked_reason: candidate.blockedReason,
    reason: candidate.reason,
    human_takeover: candidate.humanTakeover,
    execution_mode: candidate.executionMode,
  };

  if (!existing) {
    const { data, error } = await writer
      .supabase.from(TABLE)
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      const { data: retry } = await writer
        .supabase.from(TABLE)
        .select("*")
        .eq("lead_id", candidate.leadId)
        .eq("occurrence_key", key)
        .maybeSingle();
      return { row: (retry as NurtureReviewRow) ?? null, created: false, updated: false };
    }
    return { row: data as NurtureReviewRow, created: true, updated: false };
  }

  // Godkända, hämtade, skickade och avslutade poster rörs aldrig av en refresh.
  if (!MUTABLE_STATUSES.includes(existing.status)) {
    return { row: existing as NurtureReviewRow, created: false, updated: false };
  }
  if (existing.content_fingerprint === candidate.contentFingerprint &&
      existing.blocked_reason === candidate.blockedReason &&
      (existing as any).source_revision === candidate.sourceRevision) {
    return { row: existing as NurtureReviewRow, created: false, updated: false };
  }

  // Compare-and-swap i databasen: uppdateringen träffar bara om posten
  // fortfarande står i samma granskningsbara status med samma innehåll.
  // En samtidig refresh kan därför aldrig backa ett godkännande, en hämtning
  // eller ett avslag till "pending_review".
  const { data } = await writer
    .supabase.from(TABLE)
    .update(payload)
    .eq("id", existing.id)
    .in("status", MUTABLE_STATUSES)
    .eq("content_fingerprint", existing.content_fingerprint)
    .select("*")
    .maybeSingle();
  if (!data) {
    const { data: fresh } = await writer
      .supabase.from(TABLE)
      .select("*")
      .eq("id", existing.id)
      .maybeSingle();
    return { row: (fresh as NurtureReviewRow) ?? (existing as NurtureReviewRow), created: false, updated: false };
  }
  return { row: data as NurtureReviewRow, created: false, updated: true };
}

/**
 * Deterministisk, begränsad batch: bygger/uppdaterar granskningsposter för de
 * uppföljningar vars tillfälle passerat. Ingen extern effekt.
 *
 * SVÄLTSKYDD: kandidaterna som redan har en låst (godkänd/hämtad/skickad/
 * avslagen) post för samma tillfälle hoppas över och förbrukar ingen plats i
 * batchen, så leads längre bak i kön kommer fram.
 */
export async function refreshDueNurtureReviewsCore(
  ctx: GrowthContext,
  options: { now?: Date; limit?: number; writer?: GrowthContext } = {},
) {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(1, options.limit ?? 10), 25);
  const writer = options.writer ?? ctx;

  // Skanna bredare än batchen så att redan hanterade tillfällen inte blockerar.
  const due = await dueNurtureItemsCore(ctx, { now, limit: Math.min(limit * 5, 100) });
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let examined = 0;
  const reviewIds: string[] = [];

  for (const item of due.items) {
    if (created + updated + reviewIds.length >= limit * 2 || examined >= limit * 5) break;
    if (reviewIds.length >= limit) break;
    examined += 1;
    try {
      // Endast här får underlaget skrivas: planering och intent-omräkning.
      await planNurtureCore(ctx, item.lead_id, { now });
      await recomputeIntentCore(ctx, item.lead_id);
      await ensureConversationCore(ctx, { id: item.lead_id, customer_id: item.customer_id });

      const candidate = await buildReviewCandidate(ctx, item.lead_id, { now });
      const result = await upsertReview(writer, candidate, now);
      if (!result.row) {
        skipped += 1;
        continue;
      }
      if (result.created) created += 1;
      else if (result.updated) updated += 1;
      else if (!MUTABLE_STATUSES.includes(result.row.status)) {
        // Redan låst post – räknas inte mot batchen.
        continue;
      }
      reviewIds.push(result.row.id);
    } catch {
      skipped += 1;
    }
  }

  return {
    ok: true as const,
    now: now.toISOString(),
    examined,
    created,
    updated,
    skipped,
    reviewIds,
    externalEffect: false as const,
    notificationSent: false as const,
  };
}

/**
 * Läslista för adminvyn. Explicit projektion: interna transportfält som
 * attempt_id och source_revision lämnar aldrig servern.
 */
const REVIEW_ADMIN_COLUMNS =
  "id, lead_id, customer_id, conversation_id, occurrence_key, step_index, due_at, " +
  "intent_level, intent_score, company_name, recipient_email, subject, body, questions, " +
  "content_fingerprint, status, blocked_reason, reason, human_takeover, execution_mode, " +
  "approved_by, approved_at, transport_message_id, sent_at, failure_reason, updated_at";

export async function listNurtureReviewsCore(ctx: GrowthContext, limit = 50) {
  const { data } = await ctx.supabase
    .from(TABLE)
    .select(REVIEW_ADMIN_COLUMNS)
    .order("due_at", { ascending: true })
    .limit(Math.min(Math.max(1, limit), 100));
  return { items: (data ?? []) as unknown as NurtureReviewRow[] };
}


async function readReview(ctx: GrowthContext, reviewId: string): Promise<NurtureReviewRow | null> {
  const { data } = await ctx.supabase.from(TABLE).select("*").eq("id", reviewId).maybeSingle();
  return (data as NurtureReviewRow) ?? null;
}

export type ApproveResult = {
  ok: boolean;
  code: string;
  message: string;
  reviewId: string;
  dispatched?: boolean;
  dispatchError?: string;
  contentFingerprint?: string;
};

/**
 * Godkännande: full auktoritativ omvalidering innan den atomära SQL-funktionen
 * körs. Är innehållet ändrat sedan administratören såg det uppdateras posten
 * och godkännandet AVVISAS – ett nytt godkännande krävs.
 *
 * Saknas brygg-konfiguration förbrukas inget godkännande alls.
 */
export async function approveNurtureReviewCore(
  ctx: GrowthContext,
  input: { reviewId: string; expectedFingerprint: string; now?: Date; writer?: GrowthContext },
  env: RuntimeEnv,
  dispatch?: (reviewId: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<ApproveResult> {
  const writer = input.writer ?? ctx;
  const existing = await readReview(ctx, input.reviewId);
  if (!existing) {
    return { ok: false, code: "not_found", message: "Granskningsposten hittades inte.", reviewId: input.reviewId };
  }
  if (existing.status !== "pending_review") {
    return {
      ok: false,
      code: "invalid_status",
      message: `Posten kan inte godkännas i status ${existing.status}.`,
      reviewId: existing.id,
    };
  }

  const webhookUrl = (env[REVIEW_WEBHOOK_ENV] ?? "").trim();
  if (!webhookUrl && !dispatch) {
    return {
      ok: false,
      code: "config_missing",
      message: `Utskicksbryggan saknas (${REVIEW_WEBHOOK_ENV}). Inget godkännande registrerades.`,
      reviewId: existing.id,
    };
  }

  // Auktoritativ omvalidering mot live-data.
  const candidate = await buildReviewCandidate(ctx, existing.lead_id, {
    ...(input.now ? { now: input.now } : {}),
  });
  if (candidate.blockedReason) {
    await writer.supabase
      .from(TABLE)
      .update({ status: "blocked", blocked_reason: candidate.blockedReason })
      .eq("id", existing.id);
    return { ok: false, code: "blocked", message: candidate.blockedReason, reviewId: existing.id };
  }
  if (
    candidate.contentFingerprint !== existing.content_fingerprint ||
    candidate.contentFingerprint !== input.expectedFingerprint
  ) {
    await upsertReview(writer, candidate, input.now ?? new Date());
    return {
      ok: false,
      code: "stale",
      message: "Underlaget har ändrats sedan du öppnade posten. Granska den nya versionen igen.",
      reviewId: existing.id,
      contentFingerprint: candidate.contentFingerprint,
    };
  }
  // Underlaget (payload, profil, utfall, intent) måste också vara oförändrat.
  if (candidate.sourceRevision !== (existing.source_revision ?? "")) {
    await upsertReview(writer, candidate, input.now ?? new Date());
    return {
      ok: false,
      code: "stale_source",
      message: "Underlaget bakom mailet har ändrats. Granska posten på nytt.",
      reviewId: existing.id,
      contentFingerprint: candidate.contentFingerprint,
    };
  }

  const { data: rpc, error } = await ctx.supabase.rpc("approve_nurture_review", {
    p_review_id: existing.id,
    p_fingerprint: input.expectedFingerprint,
    p_source_revision: candidate.sourceRevision,
  });
  if (error) {
    return { ok: false, code: "error", message: error.message, reviewId: existing.id };
  }
  const result = (rpc ?? {}) as { ok?: boolean; code?: string; reason?: string; status?: string };
  if (!result.ok) {
    return {
      ok: false,
      code: String(result.code ?? "rejected"),
      message: result.reason ?? `Godkännandet avvisades (${result.code ?? "okänt"}).`,
      reviewId: existing.id,
    };
  }

  const sent = dispatch
    ? await dispatch(existing.id)
    : await dispatchReviewToBridge(webhookUrl, existing.id, env);

  return {
    ok: true,
    code: "approved",
    message: sent.ok
      ? "Godkänd och skickad till utskicksbryggan."
      : "Godkänd, men utskicksbryggan svarade inte. Utskicket ligger kvar som godkänt.",
    reviewId: existing.id,
    dispatched: sent.ok,
    // Aldrig råa nätverksfel: de kan innehålla brygg-URL:en (en hemlighet).
    ...(sent.ok ? {} : { dispatchError: "Utskicksbryggan gick inte att nå." }),
  };
}


/** Skickar ENDAST reviewId till Make. Aldrig mottagare eller brödtext. */
async function dispatchReviewToBridge(
  url: string,
  reviewId: string,
  env: RuntimeEnv,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const body = JSON.stringify({ reviewId });
    const headers: Record<string, string> = { "content-type": "application/json" };
    const secret = env["NORYVA_GROWTH_API_SECRET"];
    if (secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      headers["x-noryva-timestamp"] = timestamp;
      headers["x-noryva-event-id"] = `review-dispatch:${reviewId}`;
      headers["x-noryva-signature"] = await hmacHex(secret, `${timestamp}.${body}`);
    }
    const response = await fetch(url, { method: "POST", headers, body });
    if (!response.ok) return { ok: false, error: `Bryggan svarade ${response.status}.` };
    return { ok: true };
  } catch {
    // Aldrig felmeddelandet: det kan innehålla den hemliga brygg-URL:en.
    return { ok: false, error: "Utskicksbryggan gick inte att nå." };
  }

}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Avslag. Skickar aldrig något. */
export async function cancelNurtureReviewCore(
  ctx: GrowthContext,
  input: { reviewId: string; reason?: string },
) {
  const { data, error } = await ctx.supabase.rpc("cancel_nurture_review", {
    p_review_id: input.reviewId,
    p_reason: (input.reason ?? "").trim(),
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { ok?: boolean; code?: string; status?: string };
  return {
    ok: result.ok === true,
    code: String(result.code ?? "unknown"),
    externalEffect: false as const,
    notificationSent: false as const,
  };
}

/**
 * Hämtning för utskick. Returnerar sändbart innehåll EXAKT en gång – även vid
 * omtagning av samma API-anrop. Innehållet omvalideras mot live-data först.
 */
export async function claimNurtureReviewCore(
  ctx: GrowthContext,
  input: { reviewId: string; now?: Date },
  env: RuntimeEnv,
) {
  const existing = await readReview(ctx, input.reviewId);
  if (!existing) return { ok: false as const, status: 404, code: "not_found" };
  if (existing.status !== "approved") {
    return { ok: false as const, status: 409, code: "not_claimable", reviewStatus: existing.status };
  }

  const gate = externalSendDecision({
    enabled: readBooleanFlag(env[EXTERNAL_SEND_FLAG]),
    storedRecipient: existing.recipient_email,
  });
  if (!gate.allowed) {
    return { ok: false as const, status: 403, code: "external_send_disabled", reason: gate.reason };
  }

  const candidate = await buildReviewCandidate(ctx, existing.lead_id, {
    ...(input.now ? { now: input.now } : {}),
  });
  if (candidate.blockedReason) {
    await ctx.supabase
      .from(TABLE)
      .update({ status: "blocked", blocked_reason: candidate.blockedReason })
      .eq("id", existing.id);
    return { ok: false as const, status: 409, code: "blocked", reason: candidate.blockedReason };
  }
  if (candidate.contentFingerprint !== existing.content_fingerprint) {
    return { ok: false as const, status: 409, code: "stale" };
  }
  if (candidate.sourceRevision !== (existing.source_revision ?? "")) {
    return { ok: false as const, status: 409, code: "stale_source" };
  }


  const { data, error } = await ctx.supabase.rpc("claim_nurture_review", {
    p_review_id: existing.id,
    p_source_revision: candidate.sourceRevision,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, any>;
  if (result["ok"] !== true) {
    return { ok: false as const, status: 409, code: String(result["code"] ?? "not_claimable") };
  }

  return {
    ok: true as const,
    status: 200,
    reviewId: result["reviewId"],
    attemptId: result["attemptId"],
    leadId: result["leadId"],
    customerId: result["customerId"],
    conversationId: result["conversationId"],
    recipientEmail: result["recipientEmail"],
    replyTo: NURTURE_REPLY_TO,
    subject: result["subject"],
    body: result["body"],
    contentFingerprint: result["contentFingerprint"],
    executionMode: "review" as const,
    externalEffect: false as const,
    notificationSent: false as const,
  };
}

/**
 * Slutförande efter bekräftat utskick. Idempotent via (reviewId, attemptId).
 * Räknar upp genomförda steg exakt en gång och loggar det verkliga utskicket.
 */
export async function completeNurtureReviewCore(
  ctx: GrowthContext,
  input: { reviewId: string; attemptId: string; transportMessageId: string },
) {
  const { data, error } = await ctx.supabase.rpc("complete_nurture_review", {
    p_review_id: input.reviewId,
    p_attempt_id: input.attemptId,
    p_transport_message_id: input.transportMessageId,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, any>;
  if (result["ok"] !== true) {
    return { ok: false as const, status: 409, code: String(result["code"] ?? "invalid") };
  }
  if (result["duplicate"] === true) {
    return {
      ok: true as const,
      status: 200,
      code: "already_sent",
      duplicate: true,
      transportMessageId: result["transportMessageId"],
    };
  }

  // Konversationslogg och stegräkning sker i samma SQL-transaktion som
  // statusövergången – inget efterarbete kan gå förlorat här.

  return {
    ok: true as const,
    status: 200,
    code: "sent",
    duplicate: false,
    transportMessageId: result["transportMessageId"],
  };
}

/**
 * Misslyckat utskick. `unknown` (standard) betyder att vi inte vet om mailet
 * gick iväg – posten släpps ALDRIG automatiskt tillbaka för nytt försök.
 */
export async function failNurtureReviewCore(
  ctx: GrowthContext,
  input: { reviewId: string; attemptId: string; outcome?: "not_sent" | "unknown"; reason?: string },
) {
  const outcome = input.outcome === "not_sent" ? "not_sent" : "unknown";
  const { data, error } = await ctx.supabase.rpc("fail_nurture_review", {
    p_review_id: input.reviewId,
    p_attempt_id: input.attemptId,
    p_outcome: outcome,
    p_reason: (input.reason ?? "").trim(),
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, any>;
  return {
    ok: result["ok"] === true,
    status: result["ok"] === true ? 200 : 409,
    code: String(result["code"] ?? "invalid"),
    reviewStatus: result["status"] ?? null,
    releasedForRetry: false as const,
  };
}

/**
 * Inkommande svar på ett verkligt skickat uppföljningsmail.
 *
 * Tråden identifieras av transportens meddelande-id (In-Reply-To/References) –
 * aldrig av ämnesrad. Avsändaren måste vara exakt den bundna mottagaren.
 * Kund och lead härleds från den lagrade posten, aldrig från anropet.
 *
 * IDEMPOTENS: databasen reserverar meddelande-id:t innan någon sidoeffekt
 * sker. Två samtidiga leveranser av samma svar kan därför inte tillämpa
 * effekten två gånger; den andra får det lagrade resultatet eller ett
 * "behandlas redan"-svar. Misslyckas behandlingen markeras reservationen som
 * misslyckad och kan köras om – anropet rapporteras ALDRIG som lyckat.
 */
export async function registerReviewedNurtureReplyCore(
  ctx: GrowthContext,
  input: {
    inReplyTo: string;
    fromEmail: string;
    body: string;
    messageId?: string | undefined;
  },
) {
  const threadRef = input.inReplyTo.trim();
  // Ett stabilt meddelande-id krävs. En texthash räcker inte: två olika svar
  // med samma text skulle deduplicera bort varandra.
  const messageId = (input.messageId ?? "").trim();
  if (!messageId) {
    return { ok: false as const, status: 400, code: "message_id_required" };
  }

  const { data: review } = await ctx.supabase
    .from(TABLE)
    .select("*")
    .eq("transport_message_id", threadRef)
    .maybeSingle();

  if (!review) return { ok: false as const, status: 404, code: "thread_not_found" };
  if (!["sent", "unknown"].includes(String(review.status))) {
    return { ok: false as const, status: 409, code: "thread_not_sent", reviewStatus: review.status };
  }

  if (normalizeEmail(input.fromEmail) !== normalizeEmail(review.recipient_email)) {
    return { ok: false as const, status: 403, code: "sender_mismatch" };
  }

  const sourceRef = `nurture-inbound:${messageId}`;
  const base = {
    reviewId: review.id,
    leadId: review.lead_id,
    customerId: review.customer_id,
    notificationSent: false as const,
    externalEffect: false as const,
  };

  // Atomär reservation FÖRE varje sidoeffekt.
  const { data: reservation, error: reserveError } = await ctx.supabase.rpc("reserve_nurture_inbound", {
    p_review_id: review.id,
    p_lead_id: review.lead_id,
    p_source_ref: sourceRef,
  });
  if (reserveError) throw new Error(reserveError.message);
  const state = String((reservation as any)?.state ?? "");

  if (state === "done") {
    const stored = ((reservation as any)?.result ?? {}) as Record<string, unknown>;
    return { ok: true as const, status: 200, code: "duplicate", duplicate: true, ...base, ...stored };
  }
  if (state === "in_progress") {
    return { ok: false as const, status: 409, code: "in_progress", ...base };
  }
  if (state !== "reserved") {
    return { ok: false as const, status: 400, code: "invalid_reservation", ...base };
  }

  try {
    const result = await registerNurtureReplyCore(ctx, {
      leadId: review.lead_id,
      body: input.body,
      source: "make_growth_reply",
      sourceRef,
      makeContext: null,
    });

    const payload = {
      conversationId: result.conversationId,
      classification: result.classification,
      effect: {
        stop: result.effect.stop,
        humanTakeover: result.effect.humanTakeover,
        upgradeSignal: result.effect.upgradeSignal,
        reason: result.effect.reason,
      },
      previousIntent: result.previousIntent,
      newIntent: result.intent,
      nurtureStatus: result.state.status,
      outcome: result.effect.outcome,
      stored: result.inboundStored,
    };

    const { error: finishError } = await ctx.supabase.rpc("finish_nurture_inbound", {
      p_source_ref: sourceRef,
      p_ok: true,
      p_result: payload,
    });
    // Ett fel här får inte tystas: reservationen står kvar och svaret får
    // köras om, men anropet redovisas inte som klart.
    if (finishError) {
      return { ok: false as const, status: 500, code: "not_finalized", ...base };
    }

    return { ok: true as const, status: 200, code: "registered", duplicate: false, ...base, ...payload };
  } catch (error) {
    await ctx.supabase.rpc("finish_nurture_inbound", {
      p_source_ref: sourceRef,
      p_ok: false,
      p_result: { error: "processing_failed" },
    });
    return {
      ok: false as const,
      status: 500,
      code: "processing_failed",
      message: (error as Error).message,
      ...base,
    };
  }
}

