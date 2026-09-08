/**
 * Versionerat, normaliserat svarsformat för Noryva Growth API.
 *
 * Make ska kunna skriva över sin egen fallback atomiskt: därför returnerar
 * BÅDE `route-lead` och `analyze-lead` exakt samma schema, även när svaret är
 * helt deterministiskt eller kräver mänsklig handläggning. Alla sju CRM-fält
 * är alltid ifyllda med svenska strängar.
 *
 * PRIVACY: objektet byggs enbart från `AiSalesContext`, som redan är rensad
 * från namn, e-post, telefon och adress. Ingen kontakt-PII får läggas till här.
 */
import type { AiSalesContext } from "@/lib/ai-sales/context";
import type { Qualification } from "@/lib/ai-sales/qualify";
import type { AssistantOutput } from "@/lib/ai-sales/types";
import type { IntentState } from "./intent";
import type { RouteDecision } from "./router";
import type { CostEstimate, ModelTier } from "./cost";
import type { GrowthAnalysis } from "./agents";

/** Bumpa vid varje icke bakåtkompatibel förändring av `normalized`. */
export const NORMALIZED_SCHEMA_VERSION = "noryva.growth.normalized.v1";
/**
 * Nyckel för analys-claim i databasen.
 *
 * FÅR INTE bumpas för kontraktsändringar: en ny version skulle släppa igenom
 * ytterligare ett modellanrop för redan analyserade leads. Äldre cachade svar
 * transformeras i stället deterministiskt (se `refreshStoredNormalized`).
 */
export const ANALYSIS_VERSION = "growth-analysis-v1";
/** Semantik för kundtexten i `sales`. Äldre svar saknar fältet. */
export const DRAFT_CONTRACT_VERSION = "noryva.customer-draft.v1";

export type NormalizedSales = {
  action: string;
  contact_speed: string;
  subject: string;
  email_draft: string;
  followup_questions: string[];
  human_takeover: boolean;
  strategy_reason: string;
};

export type NormalizedOutput = {
  schema_version: string;
  analysis_version: string;
  lead_id: string;
  customer_id: string;
  industry: string;
  /** Alltid true i v1 – ingenting skickas utan mänsklig granskning. */
  review_required: true;
  review_status: "draft";
  requires_human: boolean;
  route: string;
  requested_route: string;
  route_reason: string;
  budget_state: string;
  tier: ModelTier;
  model: string | null;
  attempted_tier: ModelTier | null;
  attempted_model: string | null;
  /** Faktiskt antal modellförsök: 0 eller 1. Aldrig härlett ur tier. */
  llm_attempts: 0 | 1;
  used_fallback: boolean;
  error: string | null;
  reused: boolean;
  run_id: string | null;
  /** Semantik för `sales`-texten. Saknas i äldre cachade svar. */
  draft_contract: string;
  /** Satt när anroparen skickade `makeContext`, annars null. */
  migration_contract: string | null;
  qualification: {
    score: number;
    qualification: string;
    priority: string;
    source: string;
    /** Poängkomponenter när migrationsmodellen använts. */
    breakdown: Record<string, number>;
    /** Serververifierad geografi. Aldrig exakt postnummer. */
    geography: { verdict: string; service_area: string; configured: boolean };
    /** true = underlag saknas och leadet ska granskas manuellt. */
    manual_review: boolean;
    manual_review_reasons: string[];
  };
  intent: { score: number; level: string; reason: string; terminal: boolean };
  context: {
    need: string;
    timeline: string;
    description: string;
    missing_information: string[];
    /** PII-fria affärssignaler från formuläret. */
    signals: Record<string, string>;
    /** Samma strukturerade affärssvar, uttryckligen bevarade för Make. */
    business_answers: Record<string, string>;
    /** Tak-specifika fält när de finns i underlaget. */
    roof: Record<string, string>;
  };
  research: {
    need_summary: string;
    buying_signals: string[];
    risks: string[];
    qualification_note: string;
  };
  sales: NormalizedSales;
  confidence: number;
  safety_flags: string[];
  cost: { estimated_usd: number; input_tokens: number; output_tokens: number; assumed: boolean };
};

const ROOF_KEY_PATTERNS = ["tak", "yta", "lutning", "material", "vaning", "våning", "byggnad"];

/** Plockar ut tak-/byggnadsrelaterade signaler. Endast PII-fria fält. */
export function roofFields(signals: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(signals)) {
    const k = key.toLowerCase();
    if (ROOF_KEY_PATTERNS.some((p) => k.includes(p))) out[key] = value;
  }
  return out;
}

export type BuildNormalizedInput = {
  context: AiSalesContext;
  qualification: Qualification | { score: number; qualification: string; priority: string; source: string };
  intent: IntentState;
  decision: RouteDecision;
  analysis: GrowthAnalysis | (AssistantOutput & { research?: GrowthAnalysis["research"] });
  tier: ModelTier;
  model: string | null;
  attemptedTier?: ModelTier | null;
  attemptedModel?: string | null;
  llmAttempts: 0 | 1;
  usedFallback: boolean;
  error?: string | null;
  cost: CostEstimate;
  runId?: string | null;
  reused?: boolean;
  /** Extra kvalificeringsmetadata från Make-migrationens scoringmodell. */
  breakdown?: Record<string, number>;
  manualReview?: boolean;
  manualReviewReasons?: string[];
  migrationContract?: string | null;
};

/** Bygger det kompletta, versionerade svaret. Ren funktion – inga sidoeffekter. */
export function buildNormalized(input: BuildNormalizedInput): NormalizedOutput {
  const c = input.context;
  const a = input.analysis;
  const research = (a as GrowthAnalysis).research ?? {
    needSummary: c.need || "",
    buyingSignals: [],
    risks: [],
    qualificationNote: "",
  };

  return {
    schema_version: NORMALIZED_SCHEMA_VERSION,
    analysis_version: ANALYSIS_VERSION,
    draft_contract: DRAFT_CONTRACT_VERSION,
    migration_contract: input.migrationContract ?? null,
    lead_id: c.leadId,
    customer_id: c.customerId,
    industry: c.industry,
    review_required: true,
    review_status: "draft",
    requires_human: input.decision.requiresHuman || a.humanTakeover,
    route: input.decision.route,
    requested_route: input.decision.requestedRoute,
    route_reason: input.decision.reason,
    budget_state: input.decision.budgetState,
    tier: input.tier,
    model: input.model === "deterministic" ? null : input.model,
    attempted_tier: input.attemptedTier ?? null,
    attempted_model: input.attemptedModel ?? null,
    llm_attempts: input.llmAttempts,
    used_fallback: input.usedFallback,
    error: input.error ?? null,
    reused: input.reused ?? false,
    run_id: input.runId ?? null,
    qualification: {
      score: input.qualification.score,
      qualification: input.qualification.qualification,
      priority: input.qualification.priority,
      source: input.qualification.source,
      breakdown: input.breakdown ?? {},
      geography: {
        verdict: c.geography?.verdict ?? "not_configured",
        service_area: c.geography?.serviceArea ?? c.serviceArea ?? "",
        configured: c.geography?.configured ?? false,
      },
      manual_review: input.manualReview ?? false,
      manual_review_reasons: input.manualReviewReasons ?? [],
    },
    intent: {
      score: input.intent.score,
      level: input.intent.level,
      reason: input.intent.reason,
      terminal: input.intent.terminal,
    },
    context: {
      need: c.need,
      timeline: c.timeline,
      description: c.description,
      missing_information: c.missingInformation,
      signals: c.signals,
      business_answers: c.signals,
      roof: roofFields(c.signals),
    },
    research: {
      need_summary: research.needSummary,
      buying_signals: research.buyingSignals,
      risks: research.risks,
      qualification_note: research.qualificationNote,
    },
    sales: {
      action: a.action,
      contact_speed: a.contactSpeed,
      subject: a.subject,
      email_draft: a.emailDraft,
      followup_questions: a.followupQuestions,
      human_takeover: a.humanTakeover || input.decision.requiresHuman,
      strategy_reason: a.strategyReason,
    },
    confidence: a.confidence,
    safety_flags: a.safetyFlags,
    cost: {
      estimated_usd: input.cost.estimatedCost,
      input_tokens: input.cost.inputTokens,
      output_tokens: input.cost.outputTokens,
      assumed: input.cost.assumed,
    },
  };
}

/**
 * Transformerar ett tidigare cachat svar till aktuellt kontrakt UTAN nytt
 * modellanrop.
 *
 * - Kvalificering, geografi, intent och kontext ersätts med det auktoritativa,
 *   nyss omräknade underlaget (`fresh`).
 * - Är den lagrade säljtexten skriven under en äldre semantik (internt utkast)
 *   byts den mot det säkra deterministiska kundutkastet och svaret flaggas för
 *   granskning.
 * - Kostnad, modell, tier och historiskt antal försök behålls oförändrade.
 */
export function refreshStoredNormalized(
  stored: NormalizedOutput,
  fresh: NormalizedOutput,
): NormalizedOutput {
  const stale = stored.draft_contract !== DRAFT_CONTRACT_VERSION;
  return {
    ...stored,
    schema_version: NORMALIZED_SCHEMA_VERSION,
    analysis_version: stored.analysis_version ?? ANALYSIS_VERSION,
    draft_contract: DRAFT_CONTRACT_VERSION,
    migration_contract: fresh.migration_contract,
    qualification: fresh.qualification,
    intent: fresh.intent,
    context: fresh.context,
    route: fresh.route,
    requested_route: fresh.requested_route,
    route_reason: fresh.route_reason,
    budget_state: fresh.budget_state,
    review_required: true,
    review_status: "draft",
    reused: true,
    sales: stale ? fresh.sales : stored.sales,
    research: stale ? fresh.research : stored.research,
    confidence: stale ? fresh.confidence : stored.confidence,
    requires_human: stale ? true : stored.requires_human || fresh.requires_human,
    used_fallback: stale ? true : stored.used_fallback,
    safety_flags: stale
      ? Array.from(new Set([...(stored.safety_flags ?? []), "migration:stale_draft_replaced"]))
      : stored.safety_flags,
  };
}
