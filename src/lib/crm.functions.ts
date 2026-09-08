/**
 * Server-side CRM/åtgärdslager för AI-säljassistenten.
 *
 * SÄKERHET: samtliga funktioner kräver inloggad administratör. Ingen funktion
 * här gör något externt anrop – utförande sker i TEST-läge och loggas.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readStoredPayload } from "./landing/make-adapter";
import {
  ACTION_STATUS_LABEL,
  actionStatusSchema,
  actionTypeSchema,
  assertTransition,
  buildActionKey,
  executeActionInTestMode,
  followupAt,
  type ActionStatus,
  type ActionType,
} from "./ai-sales/actions";
import { serverAiSalesFlags, assertNoExternalSend } from "./ai-sales/flags";
import { defaultProfile, profileToRow, rowToProfile, customerProfileSchema } from "./ai-sales/profile";
import { qualifyLead } from "./ai-sales/qualify";
import { runAction } from "./ai-sales/orchestrator";
import { LIVE_MODE_AVAILABLE, readExecutionMode } from "./ai-sales/execution-mode";

type AdminContext = { supabase: any; userId: string };

const ACTION_COLUMNS =
  "id, lead_id, customer_id, run_id, action_type, status, human_takeover, subject, body, followup_questions, strategy_reason, params, scheduled_for, idempotency_key, execution_mode, execution_result, executed_at, approved_at, created_at, updated_at";

const PROFILE_COLUMNS =
  "customer_id, tone, language, lead_prefix, qualification_profile, followup_rules, booking_rules, notify_recipients, ai_assistant_enabled, execution_mode, created_at, updated_at";

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
    runId?: string | null;
    detail?: Record<string, unknown>;
  },
) {
  await context.supabase.from("ai_sales_events").insert({
    event_type: event.eventType,
    actor: event.actor,
    actor_user_id: context.userId,
    lead_id: event.leadId ?? null,
    customer_id: event.customerId ?? null,
    action_id: event.actionId ?? null,
    run_id: event.runId ?? null,
    detail: event.detail ?? {},
  });
}

async function loadProfile(context: AdminContext, customerId: string, industry: string) {
  const { data } = await context.supabase
    .from("customer_profiles")
    .select(PROFILE_COLUMNS)
    .eq("customer_id", customerId)
    .maybeSingle();
  return data ? rowToProfile(data) : defaultProfile(customerId, industry);
}

/** Kundprofil – styr ton, kvalificering, uppföljning och bokning per kund. */
export const getCustomerProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { customerId: string }) =>
    z.object({ customerId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { data: customer } = await ctx.supabase
      .from("customers")
      .select("industry")
      .eq("id", data.customerId)
      .maybeSingle();
    const profile = await loadProfile(ctx, data.customerId, customer?.industry ?? "");
    return { profile };
  });

export const saveCustomerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => customerProfileSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase
      .from("customer_profiles")
      .upsert(profileToRow(data), { onConflict: "customer_id" });
    if (error) throw new Error(error.message);
    await logEvent(ctx, {
      eventType: "profile_updated",
      actor: "human",
      customerId: data.customerId,
      detail: { tone: data.tone, aiAssistantEnabled: data.aiAssistantEnabled },
    });
    return { ok: true as const };
  });

/** CRM-vy: leads med deterministisk kvalificering, AI-bedömning och åtgärder. */
export const listLeadOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { customerId?: string }) =>
    z.object({ customerId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);

    let leadQuery = ctx.supabase
      .from("leads")
      .select("id, customer_id, industry, payload, delivery_status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.customerId) leadQuery = leadQuery.eq("customer_id", data.customerId);
    const { data: leads, error } = await leadQuery;
    if (error) throw new Error(error.message);

    const { data: customers } = await ctx.supabase
      .from("customers")
      .select("id, name, industry, slug");
    const { data: profileRows } = await ctx.supabase
      .from("customer_profiles")
      .select(PROFILE_COLUMNS);

    const customerById = new Map<string, any>((customers ?? []).map((c: any) => [c.id, c]));
    const profileById = new Map<string, any>(
      (profileRows ?? []).map((p: any) => [p.customer_id, rowToProfile(p)]),
    );

    const leadIds = (leads ?? []).map((l: any) => l.id);
    const runs = leadIds.length
      ? (
          await ctx.supabase
            .from("ai_sales_assistant_runs")
            .select(
              "id, lead_id, action, contact_speed, subject, email_draft, followup_questions, human_takeover, strategy_reason, confidence, safety_flags, review_status, created_at",
            )
            .in("lead_id", leadIds)
            .order("created_at", { ascending: false })
        ).data ?? []
      : [];
    const actions = leadIds.length
      ? (await ctx.supabase.from("sales_actions").select(ACTION_COLUMNS).in("lead_id", leadIds))
          .data ?? []
      : [];

    const latestRunByLead = new Map<string, any>();
    for (const run of runs) if (!latestRunByLead.has(run.lead_id)) latestRunByLead.set(run.lead_id, run);

    const rows = (leads ?? []).map((lead: any) => {
      const customer = customerById.get(lead.customer_id);
      const profile =
        profileById.get(lead.customer_id) ??
        defaultProfile(lead.customer_id, customer?.industry ?? lead.industry);
      const stored = readStoredPayload(lead.payload);
      const answers = stored.answers ?? {};
      const qualification = qualifyLead(lead.industry, answers, profile);
      const make = stored.make;

      return {
        id: lead.id,
        customerId: lead.customer_id,
        customerName: customer?.name ?? "Okänd kund",
        industry: lead.industry,
        createdAt: lead.created_at,
        deliveryStatus: lead.delivery_status,
        reference: `${profile.leadPrefix}${profile.leadPrefix ? "-" : ""}${String(lead.id).slice(0, 8)}`,
        // Endast icke-identifierande sammanfattning i listan.
        summary: (make?.behov ?? "").slice(0, 160),
        qualification,
        run: latestRunByLead.get(lead.id) ?? null,
        actions: actions.filter((a: any) => a.lead_id === lead.id),
      };
    });

    return { leads: rows, flags: serverAiSalesFlags() };
  });

/** Skapar en åtgärd som utkast. Idempotent per lead + typ + försök. */
export const createSalesAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      leadId: string;
      actionType: ActionType;
      subject?: string;
      body?: string;
      strategyReason?: string;
      followupQuestions?: string[];
      runId?: string | null;
      attempt?: string;
      params?: Record<string, unknown>;
    }) =>
      z
        .object({
          leadId: z.string().uuid(),
          actionType: actionTypeSchema,
          subject: z.string().max(200).optional().default(""),
          body: z.string().max(8000).optional().default(""),
          strategyReason: z.string().max(2000).optional().default(""),
          followupQuestions: z.array(z.string().max(300)).max(10).optional().default([]),
          runId: z.string().uuid().nullish(),
          attempt: z.string().max(40).optional(),
          params: z.record(z.string(), z.unknown()).optional().default({}),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const flags = serverAiSalesFlags();
    assertNoExternalSend(flags);

    const { data: lead, error: leadErr } = await ctx.supabase
      .from("leads")
      .select("id, customer_id, industry, payload")
      .eq("id", data.leadId)
      .maybeSingle();
    if (leadErr) throw new Error(leadErr.message);
    if (!lead) return { ok: false as const, message: "Förfrågan hittades inte." };

    const key = buildActionKey({
      leadId: data.leadId,
      actionType: data.actionType,
      ...(data.attempt ? { attempt: data.attempt } : {}),
    });

    const { data: existing } = await ctx.supabase
      .from("sales_actions")
      .select(ACTION_COLUMNS)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing) return { ok: true as const, action: existing, deduplicated: true as const };

    const profile = await loadProfile(ctx, lead.customer_id, lead.industry);
    const stored = readStoredPayload(lead.payload);
    const qualification = qualifyLead(lead.industry, stored.answers ?? {}, profile);

    const scheduledFor =
      data.actionType === "schedule_followup"
        ? followupAt(qualification.priority, profile.followupRules.firstFollowupHours)
        : null;

    const { data: created, error } = await ctx.supabase
      .from("sales_actions")
      .insert({
        lead_id: lead.id,
        customer_id: lead.customer_id,
        run_id: data.runId ?? null,
        action_type: data.actionType,
        status: "draft",
        human_takeover: data.actionType === "handoff_to_human",
        subject: data.subject,
        body: data.body,
        followup_questions: data.followupQuestions,
        strategy_reason: data.strategyReason,
        params: data.params,
        scheduled_for: scheduledFor,
        idempotency_key: key,
        execution_mode: "test",
      })
      .select(ACTION_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);

    await logEvent(ctx, {
      eventType: "action_created",
      actor: "human",
      leadId: lead.id,
      customerId: lead.customer_id,
      actionId: created?.id,
      runId: data.runId ?? null,
      detail: { actionType: data.actionType, priority: qualification.priority },
    });

    return { ok: true as const, action: created, deduplicated: false as const };
  });

export const listSalesActions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { leadId?: string; status?: ActionStatus }) =>
    z
      .object({ leadId: z.string().uuid().optional(), status: actionStatusSchema.optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    let query = ctx.supabase
      .from("sales_actions")
      .select(ACTION_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.leadId) query = query.eq("lead_id", data.leadId);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { actions: rows ?? [] };
  });

/** Statusövergång med validering. Kan aldrig hoppa förbi granskning. */
export const transitionSalesAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: ActionStatus; note?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        status: actionStatusSchema,
        note: z.string().max(2000).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);

    const { data: current, error: readErr } = await ctx.supabase
      .from("sales_actions")
      .select(ACTION_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) return { ok: false as const, message: "Åtgärden hittades inte." };
    if (data.status === "executed") {
      return { ok: false as const, message: "Utförande sker via testkörning, inte statusbyte." };
    }

    assertTransition(current.status as ActionStatus, data.status);

    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "approved") {
      patch["approved_by"] = ctx.userId;
      patch["approved_at"] = new Date().toISOString();
    }

    const { data: updated, error } = await ctx.supabase
      .from("sales_actions")
      .update(patch)
      .eq("id", data.id)
      .eq("status", current.status)
      .select(ACTION_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) return { ok: false as const, message: "Åtgärden ändrades av någon annan." };

    await logEvent(ctx, {
      eventType: `action_${data.status}`,
      actor: "human",
      leadId: current.lead_id,
      customerId: current.customer_id,
      actionId: current.id,
      detail: { from: current.status, to: data.status, note: data.note },
    });

    return { ok: true as const, action: updated };
  });

/**
 * Utför en godkänd åtgärd i TEST-läge. Ingen extern effekt, en gång per åtgärd.
 */
export const executeSalesActionTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const flags = serverAiSalesFlags();
    assertNoExternalSend(flags);

    const { data: action, error: readErr } = await ctx.supabase
      .from("sales_actions")
      .select(ACTION_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!action) return { ok: false as const, message: "Åtgärden hittades inte." };
    if (action.status === "executed") {
      return { ok: true as const, action, alreadyExecuted: true as const };
    }
    if (action.status !== "approved") {
      return {
        ok: false as const,
        message: `Endast godkända åtgärder kan testköras (status: ${
          ACTION_STATUS_LABEL[action.status as ActionStatus]
        }).`,
      };
    }

    // Orkestreraren validerar körläget och kör endast mockade kanaler.
    const outcome = await runAction(
      {
        actionType: action.action_type as ActionType,
        status: "approved",
        executionMode: readExecutionMode(action.execution_mode),
        subject: action.subject ?? "",
        body: action.body ?? "",
        recipientRef: `lead:${String(action.lead_id).slice(0, 8)}`,
      },
      flags,
    );

    // Optimistisk lås: bara om raden fortfarande är godkänd.
    const { data: updated, error } = await ctx.supabase
      .from("sales_actions")
      .update({
        status: "executed",
        executed_at: outcome.at,
        execution_result: outcome,
      })
      .eq("id", action.id)
      .eq("status", "approved")
      .select(ACTION_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) return { ok: false as const, message: "Åtgärden hade redan utförts." };

    await logEvent(ctx, {
      eventType: "action_executed_test",
      actor: "system",
      leadId: action.lead_id,
      customerId: action.customer_id,
      actionId: action.id,
      detail: outcome,
    });

    return { ok: true as const, action: updated, outcome, alreadyExecuted: false as const };
  });

export const listAuditEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { leadId?: string }) =>
    z.object({ leadId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    let query = ctx.supabase
      .from("ai_sales_events")
      .select("id, lead_id, customer_id, action_id, run_id, event_type, actor, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.leadId) query = query.eq("lead_id", data.leadId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { events: rows ?? [] };
  });

/** Alla kundprofiler (för admin-UI). Skapar defaults för kunder utan rad. */
export const listCustomerProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { data: customers, error } = await ctx.supabase
      .from("customers")
      .select("id, name, industry, slug, status")
      .order("name");
    if (error) throw new Error(error.message);
    const { data: rows } = await ctx.supabase.from("customer_profiles").select(PROFILE_COLUMNS);
    const byId = new Map<string, any>((rows ?? []).map((r: any) => [r.customer_id, r]));
    return {
      customers: (customers ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        industry: c.industry,
        slug: c.slug,
        status: c.status,
        saved: byId.has(c.id),
        profile: byId.has(c.id) ? rowToProfile(byId.get(c.id)) : defaultProfile(c.id, c.industry),
      })),
    };
  });

/**
 * Systemstatus för admin: vilka delar som är aktiva respektive avstängda.
 * Returnerar aldrig nycklar eller hemligheter – endast av/på.
 */
export const getSystemReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const flags = serverAiSalesFlags();
    assertNoExternalSend(flags);

    const { count: customerCount } = await ctx.supabase
      .from("customers")
      .select("id", { count: "exact", head: true });
    const { data: enabledRows } = await ctx.supabase
      .from("customer_profiles")
      .select("customer_id")
      .eq("ai_assistant_enabled", true);
    const { count: pendingReview } = await ctx.supabase
      .from("ai_sales_assistant_runs")
      .select("id", { count: "exact", head: true })
      .eq("review_status", "draft");
    const { count: pendingActions } = await ctx.supabase
      .from("sales_actions")
      .select("id", { count: "exact", head: true })
      .in("status", ["draft", "review"]);

    return {
      mode: "TEST/REVIEW" as const,
      flags,
      externalSendAllowed: false as const,
      liveModeAvailable: LIVE_MODE_AVAILABLE,
      modelKeyConfigured: Boolean(process.env["LOVABLE_API_KEY"]),
      counts: {
        customers: customerCount ?? 0,
        aiEnabledCustomers: (enabledRows ?? []).length,
        runsAwaitingReview: pendingReview ?? 0,
        actionsAwaitingDecision: pendingActions ?? 0,
      },
    };
  });
