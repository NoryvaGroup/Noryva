/**
 * Growth Engine – delad serverlogik.
 *
 * Modulen är avsiktligt fri från auth: anroparen (adminserverfunktion eller
 * HMAC-verifierad maskinendpoint) ansvarar för behörighet och skickar in en
 * färdig Supabase-klient. Ingenting här skickar e-post, bokar möten eller
 * ändrar experimentvikter.
 */
import { buildAiSalesContext } from "@/lib/ai-sales/context";
import { serverAiSalesFlags, readAiSalesFlags, assertNoExternalSend } from "@/lib/ai-sales/flags";
import type { RuntimeEnv } from "./runtime-env";
import {
  ANALYSIS_VERSION,
  buildNormalized,
  refreshStoredNormalized,
  type NormalizedOutput,
} from "./normalized";
import { resolveGeography } from "./geography";
import { scoreMigrationLead, type MigrationScore } from "./migration-scoring";
import { LeadBindingError, MIGRATION_CONTRACT_VERSION, type MakeContext } from "./make-contract";

import { readStoredPayload } from "@/lib/landing/make-adapter";
import { defaultProfile, rowToProfile } from "@/lib/ai-sales/profile";
import { qualifyLead } from "@/lib/ai-sales/qualify";
import { runToRow, assistantRunSchema } from "@/lib/ai-sales/types";
import { DEFAULT_BUDGET, budgetState, estimateCost, sumCost, type Budget } from "./cost";
import { routeLead as decideRoute, type AgentRoute } from "./router";
import { assignVariant } from "./experiments";
import { computeAllVariantMetrics, outcomeKey, type GrowthOutcomeType, type OutcomeRecord } from "./outcomes";
import { computeIntent, type IntentState } from "./intent";

import { recommendWinner } from "./optimizer";
import { analyzeWithTier, deterministicAnalysis } from "./analyze.server";

export type GrowthContext = { supabase: any; userId?: string | null };

export function startOfDayIso(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function startOfMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type LeadBundleOptions = { makeContext?: MakeContext | null };

/**
 * Laddar lead + kund + profil och räknar ut EN auktoritativ kvalificering.
 * Modellkontexten får exakt samma siffror – ingen andra scoring körs.
 */
export async function loadLeadBundle(
  ctx: GrowthContext,
  leadId: string,
  options: LeadBundleOptions = {},
) {
  const { data: lead, error } = await ctx.supabase
    .from("leads")
    .select("id, customer_id, industry, payload, created_at")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead) throw new Error("Förfrågan hittades inte.");

  const makeContext = options.makeContext ?? null;
  // Bindningskontroll före allt annat – aldrig något modellanrop för fel kund.
  if (makeContext && makeContext.customerId !== lead.customer_id) {
    throw new LeadBindingError();
  }

  const { data: customer } = await ctx.supabase
    .from("customers")
    .select("id, name, industry, service_area")
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

  // Postnumret används ENDAST här, på servern. Det lämnar aldrig funktionen.
  const postalCode = answers["postnummer"] ?? stored.make?.postnummer ?? "";
  const serviceArea = (makeContext?.serviceArea || customer?.service_area || "").trim();
  // Prefix kommer i första hand från anropet, annars från kundens sparade
  // profil. Geografi avgörs alltid deterministiskt av postnumret – aldrig av
  // ortsnamn och aldrig av modellen.
  const localPostalPrefix =
    makeContext?.localPostalPrefix || String(profileRow?.["local_postal_prefix"] ?? "");
  const regionalPostalPrefix =
    makeContext?.regionalPostalPrefix || String(profileRow?.["regional_postal_prefix"] ?? "");
  const geography = resolveGeography(postalCode, {
    serviceArea,
    ...(localPostalPrefix ? { localPostalPrefix } : {}),
    ...(regionalPostalPrefix ? { regionalPostalPrefix } : {}),
  });

  // Make-migrationens scoring används när anroparen skickar makeContext ELLER
  // när kunden har konfigurerad geografi – annars oförändrad befintlig modell.
  const migration =
    makeContext || geography.configured
      ? scoreMigrationLead({
          industry: lead.industry ?? "",
          answers,
          make: stored.make,
          geography,
        })
      : null;

  const qualification = migration
    ? {
        score: migration.score,
        qualification: migration.qualification,
        priority: migration.priority,
        source: migration.source,
      }
    : qualifyLead(lead.industry ?? "", answers, profile);

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
      serviceArea,
    },
    {
      qualification,
      geography: {
        verdict: geography.verdict,
        serviceArea: geography.serviceArea,
        configured: geography.configured,
      },
    },
  );

  return { lead, profile, budget, qualification, context, geography, migration, makeContext };
}

/** Extra normaliseringsmetadata som gäller både route och analyze. */
function normalizedExtras(bundle: {
  migration: MigrationScore | null;
  makeContext: MakeContext | null;
}) {
  return {
    breakdown: bundle.migration?.breakdown ?? {},
    manualReview: bundle.migration?.manualReview ?? false,
    manualReviewReasons: bundle.migration?.manualReviewReasons ?? [],
    migrationContract: bundle.makeContext ? MIGRATION_CONTRACT_VERSION : null,
  };
}

export async function readUsage(ctx: GrowthContext, customerId: string) {
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

export async function logCost(
  ctx: GrowthContext,
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

/** Läser leadets registrerade utfall som rena records. */
export async function readLeadOutcomes(ctx: GrowthContext, leadId: string): Promise<OutcomeRecord[]> {
  const { data } = await ctx.supabase
    .from("growth_outcomes")
    .select("lead_id, variant_id, outcome_type, outcome_value, revenue_value")
    .eq("lead_id", leadId);
  return (data ?? []).map((r: any) => ({
    leadId: r.lead_id,
    variantId: r.variant_id ?? null,
    outcomeType: r.outcome_type,
    outcomeValue: r.outcome_value == null ? null : Number(r.outcome_value),
    revenueValue: r.revenue_value == null ? null : Number(r.revenue_value),
  }));
}

/**
 * Intent Engine: deterministisk omräkning av leadets intent-score.
 * Idempotent – samma utfall ger alltid samma score. Inga LLM-anrop, inga
 * externa actions. Persistering får aldrig fälla flödet.
 */
export async function recomputeIntentCore(
  ctx: GrowthContext,
  leadId: string,
  options: { persist?: boolean } = {},
): Promise<IntentState> {
  const { lead, qualification } = await loadLeadBundle(ctx, leadId);
  const outcomes = await readLeadOutcomes(ctx, lead.id);
  const state = computeIntent({
    baseScore: qualification.score,
    basePriority: qualification.priority,
    outcomes,
  });

  if (options.persist !== false) {
    try {
      await ctx.supabase.from("growth_lead_state").upsert(
        {
          lead_id: lead.id,
          customer_id: lead.customer_id,
          intent_score: state.score,
          intent_level: state.level,
          intent_reason: state.reason,
          intent_terminal: state.terminal,
          intent_updated_at: new Date().toISOString(),
        },
        { onConflict: "lead_id" },
      );
    } catch {
      /* intent-state är ett cachelager – får aldrig blockera */
    }
  }
  return state;
}

/** Flaggor läses från samma runtime-env i BÅDE route och analyze. */
function resolveFlags(env?: RuntimeEnv) {
  return env ? readAiSalesFlags(env) : serverAiSalesFlags();
}

type ClaimStatus = "claimed" | "in_progress" | "done" | "failed" | "skipped";

/** Atomisk reservation per (lead, analysversion). Skyddar mot Make-retries. */
async function claimAnalysis(ctx: GrowthContext, leadId: string): Promise<ClaimStatus> {
  const { data, error } = await ctx.supabase.rpc("claim_growth_analysis", {
    p_lead_id: leadId,
    p_analysis_version: ANALYSIS_VERSION,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string") return "claimed";
  return (data as ClaimStatus) ?? "in_progress";
}

/** Tidigare sparat normaliserat resultat, om analysen redan är gjord. */
async function readClaimResult(
  ctx: GrowthContext,
  leadId: string,
): Promise<NormalizedOutput | null> {
  const { data } = await ctx.supabase
    .from("growth_analysis_claims")
    .select("status, run_id, result")
    .eq("lead_id", leadId)
    .eq("analysis_version", ANALYSIS_VERSION)
    .maybeSingle();
  const result = data?.result;
  if (result && typeof result === "object" && result["schema_version"]) {
    return result as NormalizedOutput;
  }
  return null;
}

async function completeClaim(
  ctx: GrowthContext,
  leadId: string,
  customerId: string,
  status: "done" | "failed",
  runId: string | null,
  normalized: NormalizedOutput,
): Promise<void> {
  try {
    await ctx.supabase
      .from("growth_analysis_claims")
      .update({ status, run_id: runId, customer_id: customerId, result: normalized })
      .eq("lead_id", leadId)
      .eq("analysis_version", ANALYSIS_VERSION);
  } catch {
    /* claim-uppdatering får aldrig blockera svaret */
  }
}

/** 1) Beslut: behöver leadet AI alls? Sparar intent, inga LLM-anrop. */
export async function routeLeadCore(
  ctx: GrowthContext,
  leadId: string,
  options: { env?: RuntimeEnv; makeContext?: MakeContext | null } = {},
) {
  const flags = resolveFlags(options.env);
  const bundle = await loadLeadBundle(ctx, leadId, { makeContext: options.makeContext ?? null });
  const { lead, profile, budget, qualification, context: aiContext } = bundle;
  const usage = await readUsage(ctx, lead.customer_id);
  const outcomes = await readLeadOutcomes(ctx, lead.id);
  const intent = computeIntent({
    baseScore: qualification.score,
    basePriority: qualification.priority,
    outcomes,
  });

  // Routern är första Growth-steget för varje lead. Spara intent även när
  // analyze-lead hoppas över för en deterministisk eller mänsklig route.
  const { error: intentStateError } = await ctx.supabase.from("growth_lead_state").upsert(
    {
      lead_id: lead.id,
      customer_id: lead.customer_id,
      intent_score: intent.score,
      intent_level: intent.level,
      intent_reason: intent.reason,
      intent_terminal: intent.terminal,
      intent_updated_at: new Date().toISOString(),
    },
    { onConflict: "lead_id" },
  );
  if (intentStateError) throw new Error(`Growth intent-state kunde inte sparas: ${intentStateError.message}`);

  const decision = decideRoute({
    priority: qualification.priority,
    qualification: qualification.qualification,
    intentLevel: intent.level,
    missingInformation: aiContext.missingInformation,
    text: [aiContext.need, aiContext.description, aiContext.timeline].join(" "),
    budgetUsage: usage,
    budget,
    // Samma villkor som i analyzeLeadCore – route och analys kan aldrig glida isär.
    aiEnabled: profile.aiAssistantEnabled && flags.enabled,
  });

  // Deterministiskt komplett underlag, utan modellanrop. Make kan skriva över
  // sin fallback direkt även när svaret är human/deterministic.
  const deterministic = deterministicAnalysis(aiContext);
  const normalized = buildNormalized({
    context: aiContext,
    qualification,
    intent,
    decision,
    analysis: deterministic.analysis,
    tier: "deterministic",
    model: null,
    llmAttempts: 0,
    usedFallback: false,
    cost: deterministic.cost,
    ...normalizedExtras(bundle),
  });

  return { decision, qualification, intent, budget, usage, normalized };
}


/**
 * 2) Analys. Kör högst ETT LLM-anrop (research + sälj i samma svar).
 * `forceTier` är endast tillgängligt för inloggad admin – maskinanropare får
 * aldrig kunna tvinga fram ai_full.
 */
export async function analyzeLeadCore(
  ctx: GrowthContext,
  leadId: string,
  options: {
    forceTier?: "ai_light" | "ai_full" | null;
    actor?: "ai" | "system";
    env?: RuntimeEnv;
    /** false = hoppa över claim (admin-omanalys). Default: claim på. */
    claim?: boolean;
    makeContext?: MakeContext | null;
  } = {},
) {
  const flags = resolveFlags(options.env);
  assertNoExternalSend(flags);

  const bundle = await loadLeadBundle(ctx, leadId, { makeContext: options.makeContext ?? null });
  const { lead, profile, budget, qualification, context: aiContext } = bundle;
  const usage = await readUsage(ctx, lead.customer_id);
  const intent = computeIntent({
    baseScore: qualification.score,
    basePriority: qualification.priority,
    outcomes: await readLeadOutcomes(ctx, lead.id),
  });
  const decision = decideRoute({
    priority: qualification.priority,
    qualification: qualification.qualification,
    intentLevel: intent.level,
    missingInformation: aiContext.missingInformation,
    text: [aiContext.need, aiContext.description, aiContext.timeline].join(" "),
    budgetUsage: usage,
    budget,
    aiEnabled: profile.aiAssistantEnabled && flags.enabled,
  });


  const routedTier =
    decision.route === "ai_full" || decision.route === "ai_light" ? decision.route : null;
  const tier = options.forceTier ?? routedTier;
  const willCallModel = Boolean(tier) && flags.enabled;

  // Retries från Make har nya event-id:n – replayskyddet räcker inte. Claim
  // per (lead, analysversion) garanterar högst ETT modellförsök per lead.
  let claimStatus: ClaimStatus = "skipped";
  if (willCallModel && options.claim !== false) {
    claimStatus = await claimAnalysis(ctx, lead.id);
    if (claimStatus !== "claimed") {
      const stored = await readClaimResult(ctx, lead.id);
      // Deterministiskt, auktoritativt underlag för DEN HÄR förfrågan. Används
      // både som svar när inget resultat finns och för att uppdatera ett
      // cachat äldre svar – utan nytt modellanrop.
      const freshNormalized = buildNormalized({
        context: aiContext,
        qualification,
        intent,
        decision,
        analysis: deterministicAnalysis(aiContext).analysis,
        tier: "deterministic",
        model: null,
        llmAttempts: 0,
        usedFallback: true,
        error: "Analys pågår redan för detta lead.",
        cost: estimateCost({ tier: "deterministic", inputTokens: 0, outputTokens: 0 }),
        reused: true,
        ...normalizedExtras(bundle),
      });
      const normalized: NormalizedOutput = stored
        ? refreshStoredNormalized(stored, freshNormalized)
        : freshNormalized;
      return {
        ok: true as const,
        decision,
        tier: normalized.tier,
        model: normalized.model ?? "deterministic",
        usedFallback: normalized.used_fallback,
        error: normalized.error,
        cost: {
          tier: normalized.tier,
          model: normalized.model,
          inputTokens: normalized.cost.input_tokens,
          outputTokens: normalized.cost.output_tokens,
          estimatedCost: normalized.cost.estimated_usd,
          assumed: normalized.cost.assumed,
        },
        runId: normalized.run_id,
        research: {
          needSummary: normalized.research.need_summary,
          buyingSignals: normalized.research.buying_signals,
          risks: normalized.research.risks,
          qualificationNote: normalized.research.qualification_note,
        },
        // Inget nytt modellanrop gjordes i den här förfrågan.
        llmAttempts: 0 as const,
        attemptedTier: normalized.attempted_tier,
        attemptedModel: normalized.attempted_model,
        reused: true as const,
        claimStatus,

        normalized,
      };
    }
  }

  const result =
    willCallModel && tier
      ? await analyzeWithTier(aiContext, tier, { apiKey: (options.env ?? process.env)["LOVABLE_API_KEY"] })
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
      actor: options.actor ?? "ai",
      actor_user_id: ctx.userId ?? null,
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

  const normalized = buildNormalized({
    context: aiContext,
    qualification,
    intent,
    decision,
    analysis: result.analysis,
    tier: result.tier,
    model: result.model,
    attemptedTier: result.attemptedTier,
    attemptedModel: result.attemptedModel,
    llmAttempts: result.attempts,
    usedFallback: result.usedFallback,
    error: result.error ?? null,
    cost: result.cost,
    runId: inserted?.id ?? null,
    ...normalizedExtras(bundle),
  });

  if (claimStatus === "claimed") {
    await completeClaim(
      ctx,
      lead.id,
      lead.customer_id,
      result.usedFallback ? "failed" : "done",
      inserted?.id ?? null,
      normalized,
    );
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
    /** Faktiska modellförsök i denna förfrågan (0 eller 1). */
    llmAttempts: result.attempts,
    attemptedTier: result.attemptedTier,
    attemptedModel: result.attemptedModel,
    reused: false as const,
    claimStatus,
    normalized,
  };
}


/** 3) Stabil varianttilldelning. Samma lead får alltid samma variant. */
export async function assignLeadVariantCore(
  ctx: GrowthContext,
  leadId: string,
  experimentId?: string | null,
) {
  const { lead } = await loadLeadBundle(ctx, leadId);

  const query = experimentId
    ? ctx.supabase
        .from("growth_experiments")
        .select("id, name, experiment_type")
        .eq("id", experimentId)
        .limit(1)
    : ctx.supabase
        .from("growth_experiments")
        .select("id, name, experiment_type")
        .eq("customer_id", lead.customer_id)
        .eq("status", "running")
        .order("created_at", { ascending: true })
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
    return {
      assigned: true as const,
      experimentId: experiment.id,
      variantId: existing.variant_id,
      reused: true,
    };
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
}

/** 4) Idempotent registrering av utfall. Dubbletter skapar inget nytt. */
export async function registerOutcomeCore(
  ctx: GrowthContext,
  input: {
    leadId: string;
    outcomeType: GrowthOutcomeType;
    outcomeValue?: number | undefined;
    revenueValue?: number | undefined;
    source: string;
  },
) {
  const { lead } = await loadLeadBundle(ctx, input.leadId);

  const { data: assignment } = await ctx.supabase
    .from("growth_assignments")
    .select("experiment_id, variant_id")
    .eq("lead_id", lead.id)
    .maybeSingle();

  const key = outcomeKey(lead.id, input.outcomeType, assignment?.variant_id ?? null);
  const { data: existing } = await ctx.supabase
    .from("growth_outcomes")
    .select("id")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existing) {
    // Idempotent återanvändning: räkna ändå om intent (samma resultat).
    const intent = await recomputeIntentCore(ctx, lead.id);
    return { ok: true as const, created: false, idempotencyKey: key, intent };
  }

  const { error } = await ctx.supabase.from("growth_outcomes").insert({
    customer_id: lead.customer_id,
    lead_id: lead.id,
    experiment_id: assignment?.experiment_id ?? null,
    variant_id: assignment?.variant_id ?? null,
    outcome_type: input.outcomeType,
    outcome_value: input.outcomeValue ?? null,
    revenue_value: input.revenueValue ?? null,
    idempotency_key: key,
    source: input.source,
  });
  // Unik nyckel i databasen gör parallella anrop säkra.
  if (error && !/duplicate key|23505/i.test(error.message)) throw new Error(error.message);

  // Intent räknas om deterministiskt – inga externa actions.
  const intent = await recomputeIntentCore(ctx, lead.id);

  return { ok: true as const, created: !error, idempotencyKey: key, intent };

}

export async function experimentReport(ctx: GrowthContext, experimentId: string) {
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
export async function growthRecommendationCore(
  ctx: GrowthContext,
  experimentId: string,
  persist = false,
) {
  const report = await experimentReport(ctx, experimentId);

  if (persist) {
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
}

/** 6) Adminöversikt. Tomma states när data saknas – inga påhittade siffror. */
export async function growthDashboardCore(ctx: GrowthContext) {
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

  // Aktuell intent per lead – visas bara när data faktiskt finns.
  let leadStates: any[] = [];
  try {
    const { data } = await ctx.supabase
      .from("growth_lead_state")
      .select("lead_id, intent_score, intent_level, intent_reason, intent_terminal, intent_updated_at")
      .order("intent_updated_at", { ascending: false })
      .limit(20);
    leadStates = data ?? [];
  } catch {
    /* tomt state är ett giltigt svar */
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
      budgetState: budgetState({ spentTodayUsd: spentToday, spentMonthUsd: spentMonth }, DEFAULT_BUDGET),
    },
    experiments: experiments ?? [],
    leadStates,
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
}
