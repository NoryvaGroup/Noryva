/**
 * Optimizer: transparent, deterministisk och rådgivande.
 *
 * SÄKERHET: optimizern REKOMMENDERAR endast. Den ändrar aldrig produktion,
 * skickar aldrig något och får aldrig ändra vikter automatiskt. Utfallet är
 * ett förslag som en människa beslutar om.
 */
import type { VariantMetrics } from "./outcomes";

export type OptimizerConfig = {
  /** Minsta antal leads per variant innan en vinnare får utses. */
  minSampleSize: number;
  /** Minsta andel trafik en variant alltid behåller. */
  explorationFloor: number;
  /** Minsta relativa förbättring mot tvåan för att räknas som vinnare. */
  minRelativeLift: number;
};

export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  minSampleSize: 30,
  explorationFloor: 0.1,
  minRelativeLift: 0.2,
};

export type OptimizerRecommendation = {
  winnerVariantId: string | null;
  confidence: number;
  reason: string;
  /** Rekommenderad viktfördelning 0-1 per variant. Summerar till 1. */
  allocations: Record<string, number>;
  /** true när underlaget ännu är för litet. */
  needsMoreData: boolean;
  /** Metriken som jämförts. */
  metric: "winRate" | "meetingRate";
};

function primaryValue(m: VariantMetrics, metric: OptimizerRecommendation["metric"]): number {
  return (metric === "winRate" ? m.winRate : m.meetingRate) ?? 0;
}

function evenAllocations(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = ids.length > 0 ? 1 / ids.length : 0;
  return out;
}

export function recommendWinner(
  metrics: VariantMetrics[],
  config: OptimizerConfig = DEFAULT_OPTIMIZER_CONFIG,
): OptimizerRecommendation {
  const ids = metrics.map((m) => m.variantId);
  // Utan vunna affärer är mötesgrad den enda meningsfulla signalen.
  const metric: OptimizerRecommendation["metric"] = metrics.some((m) => m.won > 0)
    ? "winRate"
    : "meetingRate";

  if (metrics.length < 2) {
    return {
      winnerVariantId: null,
      confidence: 0,
      reason: "Minst två varianter krävs för en jämförelse.",
      allocations: evenAllocations(ids),
      needsMoreData: true,
      metric,
    };
  }

  const underpowered = metrics.filter((m) => m.leads < config.minSampleSize);
  if (underpowered.length > 0) {
    return {
      winnerVariantId: null,
      confidence: 0,
      reason: `För få leads: ${underpowered
        .map((m) => `${m.variantId} (${m.leads}/${config.minSampleSize})`)
        .join(", ")}.`,
      allocations: evenAllocations(ids),
      needsMoreData: true,
      metric,
    };
  }

  const sorted = [...metrics].sort((a, b) => primaryValue(b, metric) - primaryValue(a, metric));
  const best = sorted[0]!;
  const second = sorted[1]!;
  const bestValue = primaryValue(best, metric);
  const secondValue = primaryValue(second, metric);

  if (bestValue <= 0) {
    return {
      winnerVariantId: null,
      confidence: 0,
      reason: "Ingen variant har ännu något positivt utfall.",
      allocations: evenAllocations(ids),
      needsMoreData: true,
      metric,
    };
  }

  const lift = secondValue > 0 ? (bestValue - secondValue) / secondValue : 1;
  if (lift < config.minRelativeLift) {
    return {
      winnerVariantId: null,
      confidence: Math.round(Math.max(0, lift / config.minRelativeLift) * 100) / 100,
      reason: `Skillnaden är för liten (${Math.round(lift * 100)} % mot ${Math.round(
        config.minRelativeLift * 100,
      )} % krav).`,
      allocations: evenAllocations(ids),
      needsMoreData: true,
      metric,
    };
  }

  // Vinnaren får resten, men varje övrig variant behåller exploration floor.
  const others = ids.filter((id) => id !== best.variantId);
  const floor = Math.min(config.explorationFloor, others.length > 0 ? 1 / (others.length + 1) : 0);
  const allocations: Record<string, number> = {};
  for (const id of others) allocations[id] = floor;
  allocations[best.variantId] = Math.round((1 - floor * others.length) * 1000) / 1000;

  return {
    winnerVariantId: best.variantId,
    confidence: Math.min(0.95, Math.round(Math.min(1, lift) * 100) / 100),
    reason: `${best.variantId} leder på ${
      metric === "winRate" ? "vinstgrad" : "mötesgrad"
    } med ${Math.round(lift * 100)} % förbättring vid ${best.leads} leads. Endast en rekommendation.`,
    allocations,
    needsMoreData: false,
    metric,
  };
}
