/**
 * Cost-aware Agent Router.
 *
 * Enda beslutspunkten för om ett lead behöver ett LLM-anrop. Deterministiska
 * regler körs alltid först; AI används bara när reglerna inte räcker.
 * Funktionen är ren och kan återanvändas från Make/API utan sidoeffekter.
 */
import { budgetState, type Budget, type BudgetState, type BudgetUsage, DEFAULT_BUDGET } from "./cost";

export type AgentRoute = "deterministic" | "ai_light" | "ai_full" | "human";

export type LeadPriority = "AKUT" | "HÖG" | "NORMAL" | "LÅG";

export type RouterInput = {
  priority: LeadPriority | string;
  qualification?: string | null;
  /** Fält som saknas i förfrågan (behov, tidsplan, beskrivning …). */
  missingInformation?: string[];
  /** PII-fri fritext från leadet – används endast för nyckelordsmatchning. */
  text?: string;
  /** Deterministisk säkerhet 0-1 om den finns. */
  confidence?: number | null;
  budgetUsage?: BudgetUsage;
  budget?: Budget;
  /** Om AI-generering är avstängd för kunden. */
  aiEnabled?: boolean;
};

export type RouteDecision = {
  route: AgentRoute;
  reason: string;
  /** true när en människa måste läsa/godkänna innan något går vidare. */
  requiresHuman: boolean;
  /** Route innan eventuell budget-degradering. */
  requestedRoute: AgentRoute;
  budgetState: BudgetState;
  /** Antal LLM-anrop beslutet innebär (0 eller 1). */
  llmCalls: 0 | 1;
};

/** Ämnen som alltid kräver mänsklig hantering (pris, avtal, klagomål, juridik). */
export const HUMAN_TERMS = [
  "pris",
  "prisuppgift",
  "kostar",
  "kostnad",
  "offert",
  "rabatt",
  "förhandl",
  "avtal",
  "garanti",
  "klagomål",
  "reklamation",
  "missnöjd",
  "jurist",
  "advokat",
  "tvist",
  "skadestånd",
];

export function containsHumanTerm(text: string | undefined | null): boolean {
  const t = (text ?? "").toLowerCase();
  return HUMAN_TERMS.some((term) => t.includes(term));
}

function normalizePriority(value: string): LeadPriority {
  const v = value.trim().toUpperCase();
  if (v === "AKUT" || v === "HÖG" || v === "NORMAL" || v === "LÅG") return v;
  return "NORMAL";
}

const ORDER: AgentRoute[] = ["deterministic", "ai_light", "ai_full"];

/** Degraderar ai_full -> ai_light -> deterministic när budgeten är slut. */
export function downgradeRoute(route: AgentRoute, state: BudgetState): AgentRoute {
  if (route === "human" || route === "deterministic") return route;
  if (state === "exceeded") return "deterministic";
  if (state === "warn" && route === "ai_full") return "ai_light";
  return route;
}

export function routeLead(input: RouterInput): RouteDecision {
  const priority = normalizePriority(String(input.priority ?? ""));
  const missing = input.missingInformation ?? [];
  const state = budgetState(
    input.budgetUsage ?? { spentTodayUsd: 0, spentMonthUsd: 0 },
    input.budget ?? DEFAULT_BUDGET,
  );

  const decide = (
    requested: AgentRoute,
    reason: string,
    requiresHuman: boolean,
  ): RouteDecision => {
    const route = downgradeRoute(requested, state);
    const degraded = route !== requested;
    return {
      route,
      requestedRoute: requested,
      reason: degraded ? `${reason} (nedgraderad: AI-budget ${state})` : reason,
      requiresHuman,
      budgetState: state,
      llmCalls: route === "ai_light" || route === "ai_full" ? 1 : 0,
    };
  };

  // 1. Pris/offert/klagomål/juridik går alltid till människa, aldrig till AI.
  if (containsHumanTerm(input.text)) {
    return {
      route: "human",
      requestedRoute: "human",
      reason: "Förfrågan rör pris, avtal, klagomål eller juridik – kräver handläggare.",
      requiresHuman: true,
      budgetState: state,
      llmCalls: 0,
    };
  }

  // 2. AI avstängd för kunden.
  if (input.aiEnabled === false) {
    return decide("deterministic", "AI är avstängd för kunden – deterministisk rekommendation.", true);
  }

  const ambiguous = missing.length >= 2;
  const lowConfidence = typeof input.confidence === "number" && input.confidence < 0.5;

  // 3. Låg prioritet med komplett underlag klaras helt utan AI.
  if (priority === "LÅG" && !ambiguous && !lowConfidence) {
    return decide("deterministic", "Låg prioritet och tydligt standardfall – inget AI-anrop behövs.", false);
  }

  // 4. Akut/hög eller tvetydigt underlag får full analys.
  if (priority === "AKUT" || priority === "HÖG" || ambiguous || lowConfidence) {
    return decide(
      "ai_full",
      priority === "AKUT" || priority === "HÖG"
        ? `Prioritet ${priority} – full analys.`
        : "Tvetydigt eller ofullständigt underlag – full analys.",
      true,
    );
  }

  // 5. Normalfallet: billig modell räcker.
  return decide("ai_light", "Normalprioritet med tillräckligt underlag – lätt AI-analys.", true);
}
