/**
 * Utfalls- och funnelberäkning för Noryva 2.0.
 * Rena funktioner. Saknad data redovisas som null – aldrig som gissning.
 */
import { z } from "zod";

export const growthOutcomeTypeSchema = z.enum([
  "lead_created",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
  "revenue",
]);
export type GrowthOutcomeType = z.infer<typeof growthOutcomeTypeSchema>;

export const OUTCOME_LABEL: Record<GrowthOutcomeType, string> = {
  lead_created: "Förfrågan",
  contacted: "Kontaktad",
  replied: "Svarat",
  meeting_booked: "Möte bokat",
  won: "Vunnen",
  lost: "Förlorad",
  revenue: "Intäkt",
};

export type OutcomeRecord = {
  leadId: string;
  variantId: string | null;
  outcomeType: GrowthOutcomeType;
  outcomeValue: number | null;
  revenueValue: number | null;
};

/** Idempotensnyckel: ett utfall per lead, variant och typ. */
export function outcomeKey(
  leadId: string,
  outcomeType: GrowthOutcomeType,
  variantId: string | null,
): string {
  return `${leadId}:${outcomeType}:${variantId ?? "none"}`;
}

/** Tar bort dubbletter enligt idempotensnyckeln (första posten vinner). */
export function dedupeOutcomes(rows: OutcomeRecord[]): OutcomeRecord[] {
  const seen = new Set<string>();
  const out: OutcomeRecord[] = [];
  for (const row of rows) {
    const key = outcomeKey(row.leadId, row.outcomeType, row.variantId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export type VariantMetrics = {
  variantId: string;
  leads: number;
  contacted: number;
  replied: number;
  meetings: number;
  won: number;
  lost: number;
  revenue: number;
  aiCost: number;
  /** Andelar 0-1, null när underlag saknas. */
  conversionRate: number | null;
  meetingRate: number | null;
  winRate: number | null;
  revenuePerLead: number | null;
  aiCostPerLead: number | null;
  costPerWon: number | null;
  /** (intäkt - AI-kostnad) / AI-kostnad. null utan kostnad eller intäkt. */
  roi: number | null;
};

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function computeVariantMetrics(
  variantId: string,
  rows: OutcomeRecord[],
  aiCost = 0,
): VariantMetrics {
  const unique = dedupeOutcomes(rows.filter((r) => (r.variantId ?? "") === variantId));
  const leadIds = new Set(unique.map((r) => r.leadId));
  const count = (t: GrowthOutcomeType) => unique.filter((r) => r.outcomeType === t).length;

  const leads = Math.max(count("lead_created"), leadIds.size);
  const won = count("won");
  const meetings = count("meeting_booked");
  const revenue =
    Math.round(
      unique
        .filter((r) => r.outcomeType === "revenue" || r.outcomeType === "won")
        .reduce((acc, r) => acc + (r.revenueValue ?? 0), 0) * 100,
    ) / 100;

  return {
    variantId,
    leads,
    contacted: count("contacted"),
    replied: count("replied"),
    meetings,
    won,
    lost: count("lost"),
    revenue,
    aiCost: Math.round(aiCost * 1e6) / 1e6,
    conversionRate: ratio(won, leads),
    meetingRate: ratio(meetings, leads),
    winRate: ratio(won, leads),
    revenuePerLead: leads > 0 ? revenue / leads : null,
    aiCostPerLead: leads > 0 ? Math.round((aiCost / leads) * 1e6) / 1e6 : null,
    costPerWon: won > 0 ? Math.round((aiCost / won) * 1e6) / 1e6 : null,
    roi: aiCost > 0 && revenue > 0 ? (revenue - aiCost) / aiCost : null,
  };
}

export function computeAllVariantMetrics(
  variantIds: string[],
  rows: OutcomeRecord[],
  costByVariant: Record<string, number> = {},
): VariantMetrics[] {
  return variantIds.map((id) => computeVariantMetrics(id, rows, costByVariant[id] ?? 0));
}
