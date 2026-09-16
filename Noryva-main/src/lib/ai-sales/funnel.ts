/**
 * Utfallstrappa: lead -> contacted -> replied -> meeting -> won/lost.
 * Deterministisk logik, ingen modellträning. Används för att senare kunna
 * mäta konvertering per kund, kanal och poängband.
 */
import { z } from "zod";

export const outcomeStageSchema = z.enum(["lead", "contacted", "replied", "meeting", "won", "lost"]);
export type OutcomeStage = z.infer<typeof outcomeStageSchema>;

export const OUTCOME_STAGE_LABEL: Record<OutcomeStage, string> = {
  lead: "Förfrågan",
  contacted: "Kontaktad",
  replied: "Svarat",
  meeting: "Möte",
  won: "Vunnen",
  lost: "Förlorad",
};

export const FUNNEL_ORDER: OutcomeStage[] = ["lead", "contacted", "replied", "meeting", "won"];

export const scoreBandSchema = z.enum(["hog", "medel", "lag", "unknown"]);
export type ScoreBand = z.infer<typeof scoreBandSchema>;

export function scoreBandFor(qualification: string | null | undefined): ScoreBand {
  switch ((qualification ?? "").toLowerCase()) {
    case "hög":
      return "hog";
    case "medel":
      return "medel";
    case "låg":
      return "lag";
    default:
      return "unknown";
  }
}

/** Tillåtna steg framåt. Backåtgång kräver ny förfrågan. */
const NEXT: Record<OutcomeStage, OutcomeStage[]> = {
  lead: ["contacted", "lost"],
  contacted: ["replied", "lost"],
  replied: ["meeting", "won", "lost"],
  meeting: ["won", "lost"],
  won: [],
  lost: [],
};

export function canAdvance(from: OutcomeStage, to: OutcomeStage): boolean {
  return (NEXT[from] ?? []).includes(to);
}

export function assertAdvance(from: OutcomeStage, to: OutcomeStage): void {
  if (!canAdvance(from, to)) {
    throw new Error(
      `Ogiltigt steg: ${OUTCOME_STAGE_LABEL[from]} → ${OUTCOME_STAGE_LABEL[to]}.`,
    );
  }
}

export type OutcomeRow = { leadId: string; stage: OutcomeStage; scoreBand: ScoreBand; channel: string };

export type FunnelSummary = {
  counts: Record<OutcomeStage, number>;
  /** Andel av leads som nått respektive steg, null när inga leads finns. */
  conversion: Record<OutcomeStage, number | null>;
  byScoreBand: Record<ScoreBand, { leads: number; won: number }>;
  dataComplete: boolean;
};

/** Senaste steget per lead avgör var leadet står. */
export function latestStagePerLead(rows: OutcomeRow[]): Map<string, OutcomeRow> {
  const rank = (s: OutcomeStage) => (s === "lost" ? 99 : FUNNEL_ORDER.indexOf(s));
  const out = new Map<string, OutcomeRow>();
  for (const row of rows) {
    const current = out.get(row.leadId);
    if (!current || rank(row.stage) > rank(current.stage)) out.set(row.leadId, row);
  }
  return out;
}

export function summarizeFunnel(rows: OutcomeRow[]): FunnelSummary {
  const counts: Record<OutcomeStage, number> = {
    lead: 0,
    contacted: 0,
    replied: 0,
    meeting: 0,
    won: 0,
    lost: 0,
  };
  // Ett lead som nått "meeting" räknas även i tidigare steg.
  for (const [, row] of latestStagePerLead(rows)) {
    if (row.stage === "lost") {
      counts.lost += 1;
      counts.lead += 1;
      continue;
    }
    const idx = FUNNEL_ORDER.indexOf(row.stage);
    for (let i = 0; i <= idx; i += 1) counts[FUNNEL_ORDER[i]!] += 1;
  }

  const total = counts.lead;
  const conversion = {} as Record<OutcomeStage, number | null>;
  for (const stage of Object.keys(counts) as OutcomeStage[]) {
    conversion[stage] = total > 0 ? counts[stage] / total : null;
  }

  const byScoreBand: FunnelSummary["byScoreBand"] = {
    hog: { leads: 0, won: 0 },
    medel: { leads: 0, won: 0 },
    lag: { leads: 0, won: 0 },
    unknown: { leads: 0, won: 0 },
  };
  for (const [, row] of latestStagePerLead(rows)) {
    byScoreBand[row.scoreBand].leads += 1;
    if (row.stage === "won") byScoreBand[row.scoreBand].won += 1;
  }

  return { counts, conversion, byScoreBand, dataComplete: total > 0 };
}
