/**
 * Agent HQ – kostnads- och budgetlager (ren logik, inga sidoeffekter).
 *
 * Budgeten här är NORYVAS EGEN interna guardrail, inte OpenAI:s project budget.
 * Den är medvetet konservativ: vi hellre överskattar kostnaden än underskattar,
 * så att det hårda taket aldrig avsiktligt passeras i intern bokföring.
 *
 * Priserna är CENTRAL server-side config. När OpenAI ändrar priser uppdateras
 * `MODEL_PRICING_USD_PER_MILLION` här, eller tillfälligt via env-overrides.
 */
import type { RuntimeEnv } from "@/lib/growth/runtime-env";

/**
 * Rollnycklarna speglas här medvetet i stället för att importeras från
 * server-adaptern: budgetlogiken används även i Agent HQ:s klient-UI.
 */
export const BUDGET_ROLES = [
  "noryva_manager",
  "product_tech",
  "growth_sales",
  "customer_success",
  "qa_risk",
  "operations_finance",
] as const;
export type BudgetRole = (typeof BUDGET_ROLES)[number];

/** USD per 1M tokens. Uppdateras när OpenAI ändrar prislistan. */
export const MODEL_PRICING_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.25, output: 2 },
  "gpt-5.4": { input: 1.25, output: 10 },
};

/** Modell per återanvändbar agent (konfigurerad i OpenAI, speglad här för kostnad). */
export const ROLE_MODEL: Record<BudgetRole, string> = {
  noryva_manager: "gpt-5.4-mini",
  product_tech: "gpt-5.4",
  growth_sales: "gpt-5.4-mini",
  customer_success: "gpt-5.4-mini",
  qa_risk: "gpt-5.4",
  operations_finance: "gpt-5.4-mini",
};

export type RunKind = "manual" | "autonomous" | "boardroom";

export type BudgetConfig = {
  softCapSek: number;
  hardCapSek: number;
  /** Dygnstak för autonoma körningar PER AGENT/ROLL (inte globalt). */
  maxAutonomousRunsPerDay: number;
  /** Globalt månadstak, satt så att det inte blockerar 2 runs/dygn/roll. */
  maxAutonomousRunsPerMonth: number;
  /** Konservativ, konfigurerbar växelkurs. Ingen live-FX-integration. */
  usdToSek: number;
  /** Säkerhetsmarginal ovanpå listpriset (1.25 = +25 %). */
  safetyMargin: number;
  /** Schablontokens för preflight-reservation innan riktig usage är känd. */
  assumedInputTokens: number;
  assumedOutputTokens: number;
  /** Normal dagsbudget för SAMTLIGA agentmöten tillsammans. */
  boardroomDayCapSek: number;
  /** Defensivt nödstopp per dygn för agentmöten. Kan aldrig höjas via env. */
  boardroomEmergencyDayCapSek: number;
};

/** Absolut kodtak för boardroomens nödstopp – env kan aldrig höja detta. */
export const BOARDROOM_EMERGENCY_CEILING_SEK = 15;

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  softCapSek: 300,
  hardCapSek: 500,
  maxAutonomousRunsPerDay: 2,
  // 6 roller x 2 runs/dygn x 30 dygn = 360. Kostnadstaken 300/500 SEK är den
  // primära totalspärren; månadstaket är bara ett extra skyddsnät.
  maxAutonomousRunsPerMonth: 360,
  usdToSek: 11.5,
  safetyMargin: 1.25,
  assumedInputTokens: 12_000,
  assumedOutputTokens: 2_000,
};

function num(env: RuntimeEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Läser budgetkonfigurationen. Hard cap kan aldrig höjas över 500 SEK. */
export function readBudgetConfig(env: RuntimeEnv = {}): BudgetConfig {
  const d = DEFAULT_BUDGET_CONFIG;
  const hardCapSek = Math.min(num(env, "NORYVA_AGENT_HARD_CAP_SEK", d.hardCapSek), d.hardCapSek);
  const softCapSek = Math.min(num(env, "NORYVA_AGENT_SOFT_CAP_SEK", d.softCapSek), hardCapSek);
  return {
    softCapSek,
    hardCapSek,
    maxAutonomousRunsPerDay: Math.min(
      Math.trunc(num(env, "NORYVA_AGENT_MAX_AUTONOMOUS_RUNS_DAY", d.maxAutonomousRunsPerDay)),
      d.maxAutonomousRunsPerDay,
    ),
    maxAutonomousRunsPerMonth: Math.min(
      Math.trunc(num(env, "NORYVA_AGENT_MAX_AUTONOMOUS_RUNS_MONTH", d.maxAutonomousRunsPerMonth)),
      d.maxAutonomousRunsPerMonth,
    ),
    usdToSek: num(env, "NORYVA_AGENT_USD_TO_SEK", d.usdToSek),
    safetyMargin: Math.max(num(env, "NORYVA_AGENT_COST_SAFETY_MARGIN", d.safetyMargin), 1),
    assumedInputTokens: d.assumedInputTokens,
    assumedOutputTokens: d.assumedOutputTokens,
  };
}

export function modelForRole(role: string): string {
  return (ROLE_MODEL as Record<string, string>)[role] ?? "gpt-5.4";
}

/** Konservativ kostnad i SEK för en körning. Okänd modell prissätts som dyraste. */
export function estimateRunCostSek(input: {
  role: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  config?: BudgetConfig;
}): number {
  const cfg = input.config ?? DEFAULT_BUDGET_CONFIG;
  const model = modelForRole(input.role);
  const price = MODEL_PRICING_USD_PER_MILLION[model] ?? { input: 1.25, output: 10 };
  const inTok = Math.max(Number(input.inputTokens ?? cfg.assumedInputTokens) || 0, 0);
  const outTok = Math.max(Number(input.outputTokens ?? cfg.assumedOutputTokens) || 0, 0);
  const usd = (inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output;
  const sek = usd * cfg.usdToSek * cfg.safetyMargin;
  return Math.round(sek * 10_000) / 10_000;
}

/** Reservationskostnad före körning – alltid schablon (överskattning). */
export function reservationCostSek(role: string, config: BudgetConfig): number {
  return estimateRunCostSek({ role, config });
}

export type BudgetSnapshot = {
  spentMonthSek: number;
  spentTodaySek: number;
  /** Totalt antal autonoma körningar idag (alla roller) – endast visning. */
  autonomousRunsToday: number;
  /** Dagens autonoma körningar per roll – styr dygnstaket. */
  autonomousRunsTodayByRole: Record<string, number>;
  autonomousRunsMonth: number;
};

export const EMPTY_SNAPSHOT: BudgetSnapshot = {
  spentMonthSek: 0,
  spentTodaySek: 0,
  autonomousRunsToday: 0,
  autonomousRunsTodayByRole: {},
  autonomousRunsMonth: 0,
};

/** Dagens autonoma körningar för en specifik roll. */
export function autonomousRunsTodayForRole(snapshot: BudgetSnapshot, role: string): number {
  return Math.max(Number(snapshot.autonomousRunsTodayByRole?.[role] ?? 0) || 0, 0);
}

export type BudgetState = "ok" | "soft_paused" | "hard_blocked" | "run_capped";

export type BudgetGate = { allowed: boolean; state: BudgetState; reason: string };

/**
 * Samma regler som SQL-reservationen, men som ren funktion för UI och tester.
 * SOFT CAP pausar endast autonoma körningar; HARD CAP stoppar allt.
 */
export function evaluateBudgetGate(input: {
  kind: RunKind;
  role: string;
  snapshot: BudgetSnapshot;
  config?: BudgetConfig;
}): BudgetGate {
  const cfg = input.config ?? DEFAULT_BUDGET_CONFIG;
  const projected = input.snapshot.spentMonthSek + reservationCostSek(input.role, cfg);

  if (projected > cfg.hardCapSek) {
    return {
      allowed: false,
      state: "hard_blocked",
      reason: "Månadens hårda kostnadstak är nått. Inga nya agentkörningar startas.",
    };
  }
  // Run caps och soft cap gäller ENDAST autonoma körningar. Manuella och
  // manuellt startade boardroom-körningar begränsas av hard cap (500 SEK).
  if (input.kind === "autonomous") {
    if (projected > cfg.softCapSek) {
      return {
        allowed: false,
        state: "soft_paused",
        reason: "Månadens mjuka kostnadstak är nått. Autonoma körningar pausas.",
      };
    }
    // Dygnstaket gäller PER ROLL: två agenter som kört en gång var blockerar inte varandra.
    if (autonomousRunsTodayForRole(input.snapshot, input.role) >= cfg.maxAutonomousRunsPerDay) {
      return {
        allowed: false,
        state: "run_capped",
        reason: "Dygnets tak för autonoma körningar är nått för den här agenten.",
      };
    }
    if (input.snapshot.autonomousRunsMonth >= cfg.maxAutonomousRunsPerMonth) {
      return {
        allowed: false,
        state: "run_capped",
        reason: "Månadens tak för autonoma körningar är nått.",
      };
    }
  }
  return { allowed: true, state: "ok", reason: "" };
}

/**
 * Övergripande status som visas i Agent HQ.
 * RUN CAP NÅTT visas endast när månadstaket är nått eller när SAMTLIGA roller
 * har nått sina 2 autonoma körningar för dygnet – aldrig för att två olika
 * agenter tillsammans kört två gånger.
 */
export function budgetStatusLabel(snapshot: BudgetSnapshot, config: BudgetConfig): BudgetState {
  if (snapshot.spentMonthSek >= config.hardCapSek) return "hard_blocked";
  if (snapshot.spentMonthSek >= config.softCapSek) return "soft_paused";
  const allRolesCapped = BUDGET_ROLES.every(
    (role) => autonomousRunsTodayForRole(snapshot, role) >= config.maxAutonomousRunsPerDay,
  );
  if (allRolesCapped || snapshot.autonomousRunsMonth >= config.maxAutonomousRunsPerMonth) {
    return "run_capped";
  }
  return "ok";
}

export const BUDGET_STATE_LABEL: Record<BudgetState, string> = {
  ok: "OK",
  soft_paused: "SOFT PAUSED",
  hard_blocked: "HARD BLOCKED",
  run_capped: "RUN CAP NÅTT",
};

/** Alla roller har en känd modell – skydd mot framtida rollutökning utan pris. */
export function assertPricingCoverage(): void {
  for (const role of BUDGET_ROLES) {
    if (!MODEL_PRICING_USD_PER_MILLION[ROLE_MODEL[role]]) {
      throw new Error(`Saknar prissättning för rollen ${role}.`);
    }
  }
}
