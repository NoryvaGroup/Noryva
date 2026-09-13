/**
 * Deterministisk normalisering av SPARADE agentresultat inför verifiering.
 *
 * Syfte: äldre/interna uppgifter kan ha samma innehåll under alias- eller
 * nästlade nycklar (t.ex. `output.summary`, `rekommendationer`, `next_steps`).
 * Här mappas ENDAST tydliga, säkra alias till Noryvas kanoniska schema.
 *
 * Hårda regler:
 * - Ingen LLM, ingen gissning, ingen uppfinning av innehåll.
 * - Originalfält skrivs aldrig över; endast saknade kanoniska fält fylls i.
 * - Saknas innehåll helt lämnas fältet tomt så verifieringen underkänner.
 * - Nya provider-körningar går fortsatt via det strikta V2-schemat.
 */
import type { TaskType } from "./tasks";

/** Behållare som ofta omsluter det faktiska svaret. */
const CONTAINERS = ["result", "output", "data", "analysis", "payload", "response", "content"];

const SUMMARY_ALIASES = [
  "summary",
  "sammanfattning",
  "overview",
  "executive_summary",
  "executiveSummary",
  "analysis_summary",
  "analysisSummary",
  "conclusion",
  "slutsats",
];

const PROMPT_ALIASES = [
  "implementationPrompt",
  "implementation_prompt",
  "implementationPlan",
  "implementation_plan",
  "implementation",
  "buildPrompt",
  "build_prompt",
];

const LIST_ALIASES: Record<string, string[]> = {
  priorities: ["priorities", "prioriteringar", "priority_list", "top_priorities", "topPriorities"],
  recommendations: [
    "recommendations",
    "rekommendationer",
    "suggestions",
    "improvements",
    "actions",
    "action_items",
    "actionItems",
    "next_steps",
    "nextSteps",
  ],
  risks: ["risks", "risker", "risk_list", "riskList", "concerns", "issues"],
};

const SCORE_ALIASES = ["healthScore", "health_score", "score", "halsopoang"];

type Bag = Record<string, unknown>;

function isBag(v: unknown): v is Bag {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Alla bags att leta i: rot först, sedan kända behållare (en nivå). */
function scopes(result: Bag): Bag[] {
  const out: Bag[] = [result];
  for (const key of CONTAINERS) {
    const nested = result[key];
    if (isBag(nested)) out.push(nested);
  }
  return out;
}

function findString(result: Bag, aliases: string[], minLength: number): string | null {
  for (const scope of scopes(result)) {
    for (const alias of aliases) {
      const value = scope[alias];
      if (typeof value === "string" && value.trim().length >= minLength) return value.trim();
    }
  }
  return null;
}

/** Plockar ut en ren textrad ur ett listelement utan att hitta på innehåll. */
function itemToString(item: unknown): string | null {
  if (typeof item === "string") return item.trim() || null;
  if (typeof item === "number") return String(item);
  if (isBag(item)) {
    const head = ["title", "name", "label", "text", "recommendation", "risk", "priority", "action"]
      .map((k) => item[k])
      .find((v) => typeof v === "string" && v.trim().length > 0) as string | undefined;
    const body = ["description", "detail", "details", "rationale", "why"]
      .map((k) => item[k])
      .find((v) => typeof v === "string" && v.trim().length > 0) as string | undefined;
    const joined = [head, body].filter(Boolean).join(" – ").trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function findList(result: Bag, aliases: string[]): string[] | null {
  for (const scope of scopes(result)) {
    for (const alias of aliases) {
      const value = scope[alias];
      if (!Array.isArray(value) || value.length === 0) continue;
      const items = value.map(itemToString).filter((v): v is string => Boolean(v));
      if (items.length > 0) return items;
    }
  }
  return null;
}

function findScore(result: Bag): number | null {
  for (const scope of scopes(result)) {
    for (const alias of SCORE_ALIASES) {
      const raw = scope[alias];
      const n = typeof raw === "string" ? Number(raw) : raw;
      if (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

/** Kanoniska fält per uppgiftstyp (samma kontrakt som verifyTaskResult). */
const CANONICAL: Partial<Record<TaskType, { summary: boolean; lists: string[]; prompt: boolean; score: boolean }>> = {
  manager_directive: { summary: true, lists: ["priorities"], prompt: false, score: false },
  product_tech_review: { summary: true, lists: ["recommendations"], prompt: true, score: false },
  growth_sales_review: { summary: true, lists: ["recommendations"], prompt: false, score: false },
  customer_success_review: { summary: true, lists: ["recommendations"], prompt: false, score: false },
  qa_risk_review: { summary: true, lists: ["risks"], prompt: false, score: false },
  operations_finance_review: { summary: true, lists: ["recommendations"], prompt: false, score: false },
  cto_improvement_review: { summary: true, lists: ["recommendations"], prompt: true, score: true },
};

export type NormalizedResult = {
  /** Resultat med endast tillagda kanoniska fält. Originalinnehåll bevaras. */
  result: Bag | null;
  /** Fält som normaliseringen faktiskt tillförde. */
  addedKeys: string[];
};

/**
 * Normaliserar ett sparat resultat mot rollens kanoniska schema.
 * Returnerar samma objekt (oförändrat) när inget säkert alias hittas.
 */
export function normalizeTaskResult(taskType: TaskType, result: unknown): NormalizedResult {
  if (!isBag(result)) return { result: (result as Bag | null) ?? null, addedKeys: [] };

  const spec = CANONICAL[taskType];
  if (!spec) return { result, addedKeys: [] };

  const added: Bag = {};

  if (spec.summary && typeof result["summary"] !== "string") {
    const summary = findString(result, SUMMARY_ALIASES, 10);
    if (summary) added["summary"] = summary;
  }

  for (const key of spec.lists) {
    const current = result[key];
    if (Array.isArray(current) && current.length > 0) continue;
    const list = findList(result, LIST_ALIASES[key] ?? [key]);
    if (list) added[key] = list;
  }

  if (spec.prompt && typeof result["implementationPrompt"] !== "string") {
    const prompt = findString(result, PROMPT_ALIASES, 30);
    if (prompt) added["implementationPrompt"] = prompt;
  }

  if (spec.score && !Number.isFinite(Number(result["healthScore"]))) {
    const score = findScore(result);
    if (score !== null) added["healthScore"] = score;
  }

  // externalEffect: aldrig true -> false. Endast saknat/uttryckligen falskt
  // värde normaliseras till kanoniskt false. Interna resultat har ingen
  // extern effekt, men ett true-värde respekteras och underkänns.
  const ext = result["externalEffect"];
  if (ext === undefined || ext === null || ext === "false") added["externalEffect"] = false;

  const addedKeys = Object.keys(added);
  if (addedKeys.length === 0) return { result, addedKeys: [] };
  return { result: { ...result, ...added }, addedKeys };
}
