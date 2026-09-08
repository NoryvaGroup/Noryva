/**
 * Noryva 2.0 – Growth Engine, serverfunktioner.
 *
 * SÄKERHET: samtliga funktioner kräver inloggad administratör. Ingenting här
 * skickar e-post, bokar möten eller kontaktar kunder. Analys ger endast interna
 * utkast; optimizern ger endast rekommendationer.
 *
 * SCHEMAN (bakåtkompatibla med nuvarande landing/Make-data):
 *
 *   routeLead            { leadId }
 *     -> { route, requestedRoute, reason, requiresHuman, llmCalls, budgetState,
 *          qualification: { score, qualification, priority }, budget }
 *
 *   analyzeLead          { leadId, force? }
 *     -> { ok, route, tier, model, usedFallback, cost, runId, analysis }
 *
 *   assignLeadVariant    { leadId, experimentId? }
 *     -> { assigned, experimentId, variantId, variantName } | { assigned: false, reason }
 *
 *   registerOutcome      { leadId, outcomeType, outcomeValue?, revenueValue?, source? }
 *     -> { ok, created, idempotencyKey }
 *
 *   getGrowthRecommendation { experimentId }
 *     -> { experiment, metrics[], recommendation }
 *
 *   getGrowthDashboard   { }
 *     -> { today, month, experiments[], recommendations[], flags }
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAiSalesContext } from "./ai-sales/context";
import { serverAiSalesFlags, assertNoExternalSend } from "./ai-sales/flags";
import { readStoredPayload } from "./landing/make-adapter";
import { defaultProfile, rowToProfile } from "./ai-sales/profile";
import { qualifyLead } from "./ai-sales/qualify";
import { runToRow, assistantRunSchema } from "./ai-sales/types";
import { DEFAULT_BUDGET, budgetState, estimateCost, sumCost, type Budget } from "./growth/cost";
import { routeLead as decideRoute, type AgentRoute } from "./growth/router";
import { assignVariant } from "./growth/experiments";
import {
  computeAllVariantMetrics,
  growthOutcomeTypeSchema,
  outcomeKey,
  type OutcomeRecord,
} from "./growth/outcomes";
import { recommendWinner } from "./growth/optimizer";
import { analyzeWithTier, deterministicAnalysis } from "./growth/analyze.server";

type AdminContext = { supabase: any; userId: string };

async function assertAdmin(context: AdminContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Behörighet saknas.");
}

function startOfDayIso(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function loadLeadBundle(ctx: AdminContext, leadId: string) {
  const { data: lead, error } = await ctx.supabase
    .from("leads")
    .select("id, customer_id, industry, payload, created_at")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead) throw new Error("Förfrågan hittades inte.");

  const { data: customer } = await ctx.supabase
    .from("customers")
    .select("id, name, industry")
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

  const budget: Budget = {
    dailyLimitUsd: Number(profileRow?.["ai_daily_budget_usd"] ?? DEFAULT_BUDGET.dailyLimitUsd),
    monthlyLimitUsd: Number(profileRow?.["ai_monthly_budget_usd"] ?? DEFAULT_BUDGET.monthlyLimitUsd),
  };

  const stored = readStoredPayload(lead.payload);
  const answers = (stored.answers ?? {}) as Record<string, string>;
  const qualification = qualifyLead(lead.industry ?? "", answers, profile);
  const context = buildAiSalesContext(
    {
      leadId: lead.id,
      customerId: lead.customer_id,
      industry: lead.industry ?? "",
      createdAt: lead.created_at,
      payload: lead.payload,
    },
    {
      name: customer?.name ?? "Kunden",
      industry: customer?.industry ?? lead.industry ?? "",
      serviceArea: "",
    },
  );

  return { lead, profile, budget, qualification, context };
}

async function readUsage(ctx: AdminContext, customerId: string) {
  const { data: dayRows } = await ctx.supabase
    .from("ai_cost_events")
    .select("estimated_cost")
    .eq("customer_id", customerId)
    .gte("created_at", startOfDayIso());
  const { data: monthRows } = await ctx.supabase
    .from("ai_cost_events")
    .select("estimated_cost")
    .eq("customer_id", customerId)
    .gte("created_at", startOfMonthIso());
  return {
    spentTodayUsd: sumCost((dayRows ?? []).map((r: any) => ({ estimatedCost: Number(r.estimated_cost) }))),
    spentMonthUsd: sumCost((monthRows ?? []).map((r: any) => ({ estimatedCost: Number(r.estimated_cost) }))),
  };
}

async function logCost(
  ctx: AdminContext,
  row: {
    customerId: string | null;
    leadId: string | null;
    variantId?: string | null;
    tier: string;
    route: AgentRoute | string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCost: number;
    assumed: boolean;
  },
) {
  try {
    await ctx.supabase.from("ai_cost_events").insert({
      customer_id: row.customerId,
      lead_id: row.leadId,
      variant_id: row.variantId ?? null,
      tier: row.tier,
      route: String(row.route),
      model: row.model,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      estimated_cost: row.estimatedCost,
      assumed: row.assumed,
    });
  } catch {
    /* kostnadslogg får aldrig blockera flödet */
  }
}

/** 1) Beslut: behöver leadet AI alls? Inga sidoeffekter, inga LLM-anrop. */
export const routeLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string }) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { lead, profile, budget, qualification, context: aiContext } = await loadLeadBundle(ctx, data.leadId);
    const usage = await readUsage(ctx, lead.customer_id);

    const decision = decideRoute({
      priority: qualification.priority,
      qualification: qualification.qualification,
      missingInformation: aiContext.missingInformation,
      text: [aiContext.need, aiContext.description, aiContext.timeline].join(" "),
      budgetUsage: usage,
      budget,
      aiEnabled: profile.aiAssistantEnabled,
    });

    return { decision, qualification, budget, usage };
  });

/** 2) Analys. Kör högst ETT LLM-anrop (research + sälj i samma svar). */
export const analyzeLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string; forceTier?: "ai_light" | "ai_full" }) =>
    z
      .object({
        leadId: z.string().uuid(),
        forceTier: z.enum(["ai_light", "ai_full"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const flags = serverAiSalesFlags();
    assertNoExternalSend(flags);

    const { lead, profile, budget, qualification, context: aiContext } = await loadLeadBundle(ctx, data.leadId);
    const usage = await readUsage(ctx, lead.customer_id);
    const decision = decideRoute({
      priority: qualification.priority,
      missingInformation: aiContext.missingInformation,
      text: [aiContext.need, aiContext.description, aiContext.timeline].join(" "),
      budgetUsage: usage,
      budget,
      aiEnabled: profile.aiAssistantEnabled && flags.enabled,
    });

    const tier = data.forceTier ?? (decision.route === "ai_full" || decision.route === "ai_light" ? decision.route : null);
    const result =
      tier && flags.enabled
        ? await analyzeWithTier(aiContext, tier)
        : deterministicAnalysis(aiContext);

    await logCost(ctx, {
      customerId: lead.customer_id,
      leadId: lead.id,
      tier: result.tier,
      route: decision.route,
      model: result.model === "deterministic" ? null : result.model,
      inputTokens: result.cost.inputTokens || null,
      outputTokens: result.cost.outputTokens || null,
      estimatedCost: result.cost.estimatedCost,
      assumed: result.cost.assumed,
    });

    // Utkastet sparas i den befintliga review-kön – oförändrat kontrakt.
    const run = assistantRunSchema.parse({
      leadId: lead.id,
      customerId: lead.customer_id,
      ...result.analysis,
      humanTakeover: result.analysis.humanTakeover || decision.requiresHuman,
      reviewStatus: "draft",
      reviewerNotes: "",
      promptVersion: result.promptVersion,
      model: result.model,
    });
    const { data: inserted } = await ctx.supabase
      .from("ai_sales_assistant_runs")
      .insert(runToRow(run))
      .select("id")
      .maybeSingle();

    try {
      await ctx.supabase.from("ai_sales_events").insert({
        event_type: "growth_analysis",
        actor: "ai",
        actor_user_id: ctx.userId,
        lead_id: lead.id,
        customer_id: lead.customer_id,
        run_id: inserted?.id ?? null,
        detail: {
          route: decision.route,
          requested_route: decision.requestedRoute,
          tier: result.tier,
          model: result.model,
          estimated_cost: result.cost.estimatedCost,
          prompt_version: result.promptVersion,
          used_fallback: result.usedFallback,
        },
      });
    } catch {
      /* audit får aldrig blockera */
    }

    return {
      ok: true as const,
      decision,
      tier: result.tier,
      model: result.model,
      usedFallback: result.usedFallback,
      error: result.error ?? null,
      cost: result.cost,
      runId: inserted?.id ?? null,
      research: result.analysis.research,
    };
  });

/** 3) Stabil varianttilldelning. Samma lead får alltid samma variant. */
export const assignLeadVariant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string; experimentId?: string }) =>
    z.object({ leadId: z.string().uuid(), experimentId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { lead } = await loadLeadBundle(ctx, data.leadId);

    let query = ctx.supabase
      .from("growth_experiments")
      .select("id, name, experiment_type")
      .eq("customer_id", lead.customer_id)
      .eq("status", "running")
      .order("created_at", { ascending: true })
      .limit(1);
    if (data.experimentId) query = ctx.supabase
      .from("growth_experiments")
      .select("id, name, experiment_type")
      .eq("id", data.experimentId)
      .limit(1);

    const { data: experiments } = await query;
    const experiment = experiments?.[0];
    if (!experiment) return { assigned: false as const, reason: "Inget aktivt experiment." };

    const { data: existing } = await ctx.supabase
      .from("growth_assignments")
      .select("id, variant_id")
      .eq("experiment_id", experiment.id)
      .eq("lead_id", lead.id)
      .maybeSingle();
    if (existing) {
      return { assigned: true as const, experimentId: experiment.id, variantId: existing.variant_id, reused: true };
    }

    const { data: variantRows } = await ctx.supabase
      .from("growth_variants")
      .select("id, name, weight, is_control, instruction")
      .eq("experiment_id", experiment.id);
    const chosen = assignVariant(
      experiment.id,
      lead.id,
      (variantRows ?? []).map((v: any) => ({
        id: v.id,
        name: v.name,
        weight: Number(v.weight),
        isControl: v.is_control,
      })),
    );
    if (!chosen) return { assigned: false as const, reason: "Experimentet saknar varianter." };

    await ctx.supabase.from("growth_assignments").insert({
      experiment_id: experiment.id,
      variant_id: chosen.id,
      lead_id: lead.id,
      customer_id: lead.customer_id,
    });

    return {
      assigned: true as const,
      experimentId: experiment.id,
      variantId: chosen.id,
      variantName: chosen.name,
      reused: false,
    };
  });

/** 4) Idempotent registrering av utfall. Dubbletter skapar inget nytt. */
export const registerOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      leadId: string;
      outcomeType: string;
      outcomeValue?: number;
      revenueValue?: number;
      source?: string;
    }) =>
      z
        .object({
          leadId: z.string().uuid(),
          outcomeType: growthOutcomeTypeSchema,
          outcomeValue: z.number().optional(),
          revenueValue: z.number().optional(),
          source: z.string().max(40).default("admin"),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const { lead } = await loadLeadBundle(ctx, data.leadId);

    const { data: assignment } = await ctx.supabase
      .from("growth_assignments")
      .select("experiment_id, variant_id")
      .eq("lead_id", lead.id)
      .maybeSingle();

    const key = outcomeKey(lead.id, data.outcomeType, assignment?.variant_id ?? null);
    const { data: existing } = await ctx.supabase
      .from("growth_outcomes")
      .select("id")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing) return { ok: true as const, created: false, idempotencyKey: key };

    const { error } = await ctx.supabase.from("growth_outcomes").insert({
      customer_id: lead.customer_id,
      lead_id: lead.id,
      experiment_id: assignment?.experiment_id ?? null,
      variant_id: assignment?.variant_id ?? null,
      outcome_type: data.outcomeType,
      outcome_value: data.outcomeValue ?? null,
      revenue_value: data.revenueValue ?? null,
      idempotency_key: key,
      source: data.source,
    });
    // Unik nyckel i databasen gör parallella anrop säkra.
    if (error && !/duplicate key|23505/i.test(error.message)) throw new Error(error.message);

    return { ok: true as const, created: !error, idempotencyKey: key };
  });

async function experimentReport(ctx: AdminContext, experimentId: string) {
  const { data: experiment } = await ctx.supabase
    .from("growth_experiments")
    .select("id, customer_id, name, experiment_type, status, min_sample_size, exploration_floor")
    .eq("id", experimentId)
    .maybeSingle();
  if (!experiment) throw new Error("Experimentet hittades inte.");

  const { data: variants } = await ctx.supabase
    .from("growth_variants")
    .select("id, name, weight, is_control")
    .eq("experiment_id", experimentId);
  const { data: outcomes } = await ctx.supabase
    .from("growth_outcomes")
    .select("lead_id, variant_id, outcome_type, outcome_value, revenue_value")
    .eq("experiment_id", experimentId);
  const { data: costs } = await ctx.supabase
    .from("ai_cost_events")
    .select("variant_id, estimated_cost")
    .eq("customer_id", experiment.customer_id);

  const costByVariant: Record<string, number> = {};
  for (const row of costs ?? []) {
    const id = row.variant_id ?? "";
    if (!id) continue;
    costByVariant[id] = (costByVariant[id] ?? 0) + Number(row.estimated_cost ?? 0);
  }

  const records: OutcomeRecord[] = (outcomes ?? []).map((r: any) => ({
    leadId: r.lead_id,
    variantId: r.variant_id,
    outcomeType: r.outcome_type,
    outcomeValue: r.outcome_value == null ? null : Number(r.outcome_value),
    revenueValue: r.revenue_value == null ? null : Number(r.revenue_value),
  }));

  const ids = (variants ?? []).map((v: any) => v.id);
  const metrics = computeAllVariantMetrics(ids, records, costByVariant);
  const recommendation = recommendWinner(metrics, {
    minSampleSize: Number(experiment.min_sample_size ?? 30),
    explorationFloor: Number(experiment.exploration_floor ?? 0.1),
    minRelativeLift: 0.2,
  });

  return { experiment, variants: variants ?? [], metrics, recommendation };
}

/** 5) Optimizer, batchvis. Rekommenderar endast – ändrar aldrig produktion. */
export const getGrowthRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { experimentId: string; persist?: boolean }) =>
    z.object({ experimentId: z.string().uuid(), persist: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const report = await experimentReport(ctx, data.experimentId);

    if (data.persist) {
      await ctx.supabase.from("growth_recommendations").insert({
        customer_id: report.experiment.customer_id,
        experiment_id: report.experiment.id,
        winner_variant_id: report.recommendation.winnerVariantId,
        metric: report.recommendation.metric,
        confidence: report.recommendation.confidence,
        reason: report.recommendation.reason,
        allocations: report.recommendation.allocations,
        needs_more_data: report.recommendation.needsMoreData,
      });
    }
    return report;
  });

/** 6) Adminöversikt. Tomma states när data saknas – inga påhittade siffror. */
export const getGrowthDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);
    const flags = serverAiSalesFlags();
    assertNoExternalSend(flags);

    const dayStart = startOfDayIso();
    const monthStart = startOfMonthIso();

    const [{ data: leadsToday }, { data: costToday }, { data: costMonth }, { data: experiments }, { data: recs }] =
      await Promise.all([
        ctx.supabase.from("leads").select("id").gte("created_at", dayStart),
        ctx.supabase.from("ai_cost_events").select("tier, estimated_cost").gte("created_at", dayStart),
        ctx.supabase.from("ai_cost_events").select("estimated_cost").gte("created_at", monthStart),
        ctx.supabase
          .from("growth_experiments")
          .select("id, customer_id, name, experiment_type, status, min_sample_size")
          .order("created_at", { ascending: false })
          .limit(20),
        ctx.supabase
          .from("growth_recommendations")
          .select("id, experiment_id, winner_variant_id, metric, confidence, reason, needs_more_data, created_at")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    const todayEvents = costToday ?? [];
    const aiCallsToday = todayEvents.filter((e: any) => e.tier === "ai_light" || e.tier === "ai_full").length;
    const deterministicToday = todayEvents.filter((e: any) => e.tier === "deterministic").length;
    const handled = aiCallsToday + deterministicToday;
    const leadCount = (leadsToday ?? []).length;
    const spentToday = sumCost(todayEvents.map((e: any) => ({ estimatedCost: Number(e.estimated_cost) })));
    const spentMonth = sumCost((costMonth ?? []).map((e: any) => ({ estimatedCost: Number(e.estimated_cost) })));

    const running = (experiments ?? []).filter((e: any) => e.status === "running");
    const reports = [];
    for (const exp of running.slice(0, 5)) {
      try {
        reports.push(await experimentReport(ctx, exp.id));
      } catch {
        /* ett trasigt experiment får inte fälla översikten */
      }
    }

    return {
      today: {
        leads: leadCount,
        aiCalls: aiCallsToday,
        deterministicShare: handled > 0 ? deterministicToday / handled : null,
        estimatedCost: spentToday,
        costPerLead: leadCount > 0 ? Math.round((spentToday / leadCount) * 1e6) / 1e6 : null,
      },
      month: {
        estimatedCost: spentMonth,
        budgetState: budgetState(
          { spentTodayUsd: spentToday, spentMonthUsd: spentMonth },
          DEFAULT_BUDGET,
        ),
      },
      experiments: experiments ?? [],
      reports,
      recommendations: recs ?? [],
      flags: {
        aiEnabled: flags.enabled,
        autoSend: flags.autoSend,
        reviewRequired: flags.reviewRequired,
        mode: "TEST/REVIEW" as const,
      },
      defaultBudget: DEFAULT_BUDGET,
      tierCost: estimateCost({ tier: "ai_light" }).estimatedCost,
    };
  });
