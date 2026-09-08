/**
 * Kostnadskontroll för Noryva 2.0.
 *
 * All AI-kostnad uppskattas deterministiskt utifrån modellnivå och tokens.
 * Ingen nivå får byta modell på egen hand – nivåerna är fasta i kod och
 * budgetarna avgör endast om ett anrop ska degraderas eller uteblir.
 */

export type ModelTier = "deterministic" | "ai_light" | "ai_full" | "optimizer";

export type TierConfig = {
  /** null = inget LLM-anrop alls. */
  model: string | null;
  /** Max tecken kontext som får skickas. */
  maxContextChars: number;
  /** USD per 1M tokens. */
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  /** Uppskattning när tokenantal saknas. */
  assumedInputTokens: number;
  assumedOutputTokens: number;
};

export const MODEL_TIERS: Record<ModelTier, TierConfig> = {
  deterministic: {
    model: null,
    maxContextChars: 0,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    assumedInputTokens: 0,
    assumedOutputTokens: 0,
  },
  ai_light: {
    model: "openai/gpt-5.4-mini",
    maxContextChars: 3000,
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 2,
    assumedInputTokens: 900,
    assumedOutputTokens: 350,
  },
  ai_full: {
    model: "openai/gpt-6-astra",
    maxContextChars: 12000,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
    assumedInputTokens: 2500,
    assumedOutputTokens: 800,
  },
  optimizer: {
    model: "openai/gpt-5.4-mini",
    maxContextChars: 8000,
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 2,
    assumedInputTokens: 2000,
    assumedOutputTokens: 600,
  },
};

export type CostEstimateInput = {
  tier: ModelTier;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export type CostEstimate = {
  tier: ModelTier;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  /** USD, avrundat till 6 decimaler. */
  estimatedCost: number;
  /** true när tokenantal saknades och schablon användes. */
  assumed: boolean;
};

export function estimateCost(input: CostEstimateInput): CostEstimate {
  const cfg = MODEL_TIERS[input.tier];
  const assumed = input.inputTokens == null || input.outputTokens == null;
  const inTok = input.inputTokens ?? cfg.assumedInputTokens;
  const outTok = input.outputTokens ?? cfg.assumedOutputTokens;
  const cost =
    (inTok / 1_000_000) * cfg.inputCostPerMillion +
    (outTok / 1_000_000) * cfg.outputCostPerMillion;
  return {
    tier: input.tier,
    model: cfg.model,
    inputTokens: inTok,
    outputTokens: outTok,
    estimatedCost: Math.round(cost * 1e6) / 1e6,
    assumed,
  };
}

export type Budget = {
  /** USD per kund och dygn. */
  dailyLimitUsd: number;
  /** USD per kund och månad. */
  monthlyLimitUsd: number;
};

export const DEFAULT_BUDGET: Budget = { dailyLimitUsd: 2, monthlyLimitUsd: 40 };

export type BudgetUsage = { spentTodayUsd: number; spentMonthUsd: number };

export type BudgetState = "ok" | "warn" | "exceeded";

/** Varning vid 80 % av någon gräns, stopp vid 100 %. */
export function budgetState(usage: BudgetUsage, budget: Budget = DEFAULT_BUDGET): BudgetState {
  const dayRatio = budget.dailyLimitUsd > 0 ? usage.spentTodayUsd / budget.dailyLimitUsd : 0;
  const monthRatio = budget.monthlyLimitUsd > 0 ? usage.spentMonthUsd / budget.monthlyLimitUsd : 0;
  const worst = Math.max(dayRatio, monthRatio);
  if (worst >= 1) return "exceeded";
  if (worst >= 0.8) return "warn";
  return "ok";
}

/** Summerar loggade kostnadshändelser. */
export function sumCost(events: { estimatedCost: number | null }[]): number {
  const total = events.reduce((acc, e) => acc + (e.estimatedCost ?? 0), 0);
  return Math.round(total * 1e6) / 1e6;
}
