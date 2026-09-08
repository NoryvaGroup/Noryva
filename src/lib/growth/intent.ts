/**
 * Intent Engine – deterministisk, billig intent-score per lead.
 *
 * Principen är "Low-cost nurture, never discard relevant leads": ett lead med
 * låg score kastas aldrig bort, det hanteras bara billigare (0 AI-anrop) och
 * kan när som helst uppgraderas av nya signaler.
 *
 * INGEN LLM används här. Allt är rena funktioner över befintlig kvalificering
 * och redan registrerade utfall i `growth_outcomes`.
 */
import { dedupeOutcomes, type GrowthOutcomeType, type OutcomeRecord } from "./outcomes";

export type IntentLevel = "LÅG" | "NORMAL" | "HÖG" | "AKUT";

/** Trösklar för score 0-100. AKUT sätts aldrig av score, bara av hårda regler. */
export const INTENT_THRESHOLDS = { high: 70, normal: 40 } as const;

/**
 * Vikter per signal. Poäng adderas ovanpå basnivån från kvalificeringen.
 * `won`/`lost` är terminala och hanteras separat.
 */
export const INTENT_WEIGHTS: Record<GrowthOutcomeType, number> = {
  lead_created: 0,
  contacted: 3,
  replied: 18,
  meeting_booked: 32,
  // Intäkt stärker värdet men dubbelräknar inte `won` (som redan är terminal 100).
  revenue: 6,
  won: 0,
  lost: 0,
};

export const SIGNAL_LABEL: Partial<Record<GrowthOutcomeType, string>> = {
  contacted: "kontaktad",
  replied: "svar från kunden",
  meeting_booked: "möte bokat",
  revenue: "intäkt registrerad",
};

export type IntentState = {
  score: number;
  level: IntentLevel;
  reason: string;
  /** true när utfallet är avgjort (won/lost) – ingen vidare uppgradering. */
  terminal: boolean;
};

export function levelFromScore(score: number): IntentLevel {
  if (score >= INTENT_THRESHOLDS.high) return "HÖG";
  if (score >= INTENT_THRESHOLDS.normal) return "NORMAL";
  return "LÅG";
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export type IntentInput = {
  /** Score 0-100 från den befintliga deterministiska kvalificeringen. */
  baseScore: number;
  /** Hård prioritet från kvalificeringen – endast "AKUT" tas hänsyn till här. */
  basePriority?: string | null | undefined;
  /** Redan registrerade utfall för leadet (dubbletter tas bort). */
  outcomes?: OutcomeRecord[] | undefined;
};

/**
 * Räknar fram aktuell intent. Idempotent: samma utfall två gånger ger samma
 * score eftersom dubbletter filtreras på idempotensnyckeln.
 */
export function computeIntent(input: IntentInput): IntentState {
  const base = clamp(input.baseScore ?? 0);
  const unique = dedupeOutcomes(input.outcomes ?? []);
  const types = new Set(unique.map((o) => o.outcomeType));
  const isAkut = String(input.basePriority ?? "").toUpperCase() === "AKUT";

  if (types.has("lost")) {
    return {
      score: 0,
      level: "LÅG",
      reason: "Leadet är markerat som förlorat – terminalt, ingen AI-kostnad.",
      terminal: true,
    };
  }

  if (types.has("won")) {
    return {
      score: 100,
      level: "HÖG",
      reason: "Leadet är vunnet – terminalt positivt.",
      terminal: true,
    };
  }

  let score = base;
  const signals: string[] = [];
  for (const type of ["contacted", "replied", "meeting_booked", "revenue"] as const) {
    if (!types.has(type)) continue;
    score += INTENT_WEIGHTS[type];
    signals.push(SIGNAL_LABEL[type] ?? type);
  }

  score = clamp(score);
  const level: IntentLevel = isAkut ? "AKUT" : levelFromScore(score);

  const reason = signals.length
    ? `Basnivå ${base} från kvalificering, höjd av: ${signals.join(", ")}.`
    : `Basnivå ${base} från kvalificering – inga utfall registrerade ännu.`;

  return {
    score,
    level,
    reason: isAkut ? `${reason} Hård regel: AKUT.` : reason,
    terminal: false,
  };
}
