/**
 * Agent HQ v2 – isolerad server-adapter mot OpenAI Agents API (public beta).
 *
 * Harnessen är OpenAI:s: sessioner, orkestrering och kontext hanteras där.
 * Noryva behåller kontroll- och auditlagret i Supabase och kontrollpanelen i
 * Lovable. Den här filen är den ENDA platsen som får prata med providern.
 *
 * Hårda regler:
 * - Fail closed: saknas nyckel eller konfiguration görs INGEN nätverkstrafik
 *   och ingen tyst reserv till något annat (aldrig en extern action).
 * - Miljö `type: "none"` – ingen sandbox, inga verktyg, inga MCP-servrar.
 * - Ingen streaming, ingen retry, inga kedjade run.
 * - Ingen nyckel eller hemlighet lämnar servern; statusen är alltid PII-fri.
 *
 * Verifierad REST-form enligt OpenAI:s dokumentation för Agents API:
 *   POST https://api.openai.com/v1/agents/sessions
 *   Header: OpenAI-Beta: agents=v1
 *   Body:   { agent: { id | model, instructions }, environment: { type },
 *             input: [ { role, content: [ { type: "input_text", text } ] } ] }
 */
import { runtimeEnvFromRequest, type RuntimeEnv } from "@/lib/growth/runtime-env";

export const AGENTS_PROVIDER = "openai_agents" as const;
export const AGENTS_SESSIONS_URL = "https://api.openai.com/v1/agents/sessions";
export const AGENTS_BETA_HEADER = "agents=v1";
export const AGENTS_DEFAULT_MODEL = "gpt-5.4-mini";
export const AGENTS_DEFAULT_TIMEOUT_MS = 60_000;

/** Roller som får köras mot harnessen i v1. */
export type HarnessRole = "noryva_manager" | "product_tech";

/**
 * Config-slots för målbildens fyra planerade roller. Env-nycklarna är
 * förberedda men får inga värden här – rollerna aktiveras separat.
 */
export const PLANNED_AGENT_ENV_KEYS = {
  growth_sales: "NORYVA_OPENAI_GROWTH_SALES_AGENT_ID",
  customer_success: "NORYVA_OPENAI_CUSTOMER_SUCCESS_AGENT_ID",
  qa_risk: "NORYVA_OPENAI_QA_RISK_AGENT_ID",
  operations_finance: "NORYVA_OPENAI_OPERATIONS_FINANCE_AGENT_ID",
} as const;
export type PlannedHarnessRole = keyof typeof PLANNED_AGENT_ENV_KEYS;

export type PlannedAgentSlot = {
  role: PlannedHarnessRole;
  envKey: string;
  /** Sant först när ett agent-id finns i miljön. Aktiverar ändå ingenting. */
  hasAgentId: boolean;
  /** Hårdspärr: planerade roller kan aldrig köras i den här versionen. */
  runnable: false;
};

/** Läser slot-status för planerade roller. Returnerar aldrig själva id:t. */
export function readPlannedAgentSlots(deps: HarnessDeps = {}): PlannedAgentSlot[] {
  const env = readEnv(deps);
  return (Object.keys(PLANNED_AGENT_ENV_KEYS) as PlannedHarnessRole[]).map((role) => ({
    role,
    envKey: PLANNED_AGENT_ENV_KEYS[role],
    hasAgentId: str(env, PLANNED_AGENT_ENV_KEYS[role]).length > 0,
    runnable: false as const,
  }));
}

export function isRunnableHarnessRole(role: string): role is HarnessRole {
  return role === "noryva_manager" || role === "product_tech";
}

export type HarnessDeps = {
  env?: RuntimeEnv;
  request?: Request;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type HarnessStatus = {
  provider: typeof AGENTS_PROVIDER;
  configured: boolean;
  /** PII-fri och hemlighetsfri förklaring, visas i Agent HQ. */
  reason: string;
  model: string;
  /** Sparade agent-id per roll. Tom sträng = agenten konfigureras per session. */
  agentIds: Record<HarnessRole, string>;
};

function readEnv(deps: HarnessDeps): RuntimeEnv {
  return deps.env ?? runtimeEnvFromRequest(deps.request);
}

function str(env: RuntimeEnv, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Läser harness-konfigurationen. Returnerar aldrig nycklar eller hemligheter. */
export function readHarnessStatus(deps: HarnessDeps = {}): HarnessStatus {
  const env = readEnv(deps);
  const model = str(env, "NORYVA_OPENAI_AGENT_MODEL") || AGENTS_DEFAULT_MODEL;
  const agentIds: Record<HarnessRole, string> = {
    noryva_manager: str(env, "NORYVA_OPENAI_MANAGER_AGENT_ID"),
    product_tech: str(env, "NORYVA_OPENAI_PRODUCT_TECH_AGENT_ID"),
  };

  const enabled = str(env, "NORYVA_AGENTS_API_ENABLED").toLowerCase() === "true";
  const hasKey = str(env, "OPENAI_API_KEY").length > 0;

  const reason = !enabled
    ? "NORYVA_AGENTS_API_ENABLED är inte satt till true."
    : !hasKey
      ? "OPENAI_API_KEY saknas i serverns miljö."
      : "";

  return { provider: AGENTS_PROVIDER, configured: reason === "", reason, model, agentIds };
}

/* ------------------------------------------------------------- budget */

export type BudgetInput = { runBudget: number; runsUsed: number };
export type BudgetVerdict = { allowed: boolean; reason: string };

/**
 * Hårt tak per uppgift. Utan kvar i budgeten startas aldrig ett nytt agent-run.
 * Ren funktion – inga sidoeffekter och ingen nätverkstrafik.
 */
export function evaluateRunBudget(input: BudgetInput): BudgetVerdict {
  const budget = Number.isFinite(input.runBudget) ? Math.trunc(input.runBudget) : 0;
  const used = Number.isFinite(input.runsUsed) ? Math.trunc(input.runsUsed) : 0;
  if (budget <= 0) return { allowed: false, reason: "Ingen körbudget är satt för uppgiften." };
  if (used >= budget) {
    return { allowed: false, reason: `Körbudgeten är förbrukad (${used}/${budget}).` };
  }
  return { allowed: true, reason: "" };
}

/* ---------------------------------------------------------------- run */

export type HarnessRunInput = {
  role: HarnessRole;
  instructions: string;
  /** PII-fri text. Fri kundpayload får aldrig skickas hit. */
  input: string;
};

export type HarnessUsage = { inputTokens: number; outputTokens: number; runs: number };

export type HarnessRunResult = {
  ok: boolean;
  providerType: typeof AGENTS_PROVIDER;
  providerAgentId: string;
  providerRunId: string;
  runStatus: "completed" | "failed" | "blocked";
  usage: HarnessUsage;
  /** Rå textoutput från agenten (tom vid fel). */
  outputText: string;
  error: string;
  externalEffect: false;
};

function blocked(reason: string, agentId = ""): HarnessRunResult {
  return {
    ok: false,
    providerType: AGENTS_PROVIDER,
    providerAgentId: agentId,
    providerRunId: "",
    runStatus: "blocked",
    usage: { inputTokens: 0, outputTokens: 0, runs: 0 },
    outputText: "",
    error: reason,
    externalEffect: false,
  };
}

function collectText(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (value.trim()) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj["text"] === "string") {
      collectText(obj["text"], out);
      return;
    }
    for (const key of ["output_text", "output", "content", "items", "message"]) {
      if (key in obj) collectText(obj[key], out);
    }
  }
}

/**
 * Startar EN session/turn hos harnessen och väntar in resultatet.
 * Fail closed: utan giltig konfiguration görs inget anrop alls.
 */
export async function runHarnessSession(
  input: HarnessRunInput,
  deps: HarnessDeps = {},
): Promise<HarnessRunResult> {
  // Hårdspärr: endast aktiva v1-roller kan nå providern. Planerade roller
  // stoppas här innan någon nätverkstrafik sker.
  if (!isRunnableHarnessRole(input.role)) {
    return blocked("Rollen är planerad och kan inte köras ännu.");
  }
  const status = readHarnessStatus(deps);
  const agentId = status.agentIds[input.role];
  if (!status.configured) return blocked(status.reason, agentId);

  const env = readEnv(deps);
  const key = str(env, "OPENAI_API_KEY");
  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? AGENTS_DEFAULT_TIMEOUT_MS);

  const agent = agentId
    ? { id: agentId, instructions: input.instructions }
    : { model: status.model, instructions: input.instructions };

  try {
    const response = await doFetch(AGENTS_SESSIONS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": AGENTS_BETA_HEADER,
      },
      body: JSON.stringify({
        agent,
        // Ingen sandbox, inga verktyg: agenten kan inte röra något utanför svaret.
        environment: { type: "none" },
        input: [{ role: "user", content: [{ type: "input_text", text: input.input }] }],
        stream: false,
      }),
    });

    if (!response.ok) {
      return {
        ...blocked(`Harnessen svarade med status ${response.status}.`, agentId),
        runStatus: "failed",
      };
    }

    const body = (await response.json()) as Record<string, unknown>;
    const parts: string[] = [];
    collectText(body["output"] ?? body["items"] ?? body["output_text"] ?? "", parts);
    const usageRaw = (body["usage"] ?? {}) as Record<string, unknown>;

    return {
      ok: true,
      providerType: AGENTS_PROVIDER,
      providerAgentId: agentId || String(body["agent_id"] ?? ""),
      providerRunId: String(body["id"] ?? body["session_id"] ?? ""),
      runStatus: "completed",
      usage: {
        inputTokens: Number(usageRaw["input_tokens"] ?? 0) || 0,
        outputTokens: Number(usageRaw["output_tokens"] ?? 0) || 0,
        runs: 1,
      },
      outputText: parts.join("\n").trim(),
      error: "",
      externalEffect: false,
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? "Körningen avbröts på grund av tidsgräns."
      : "Kunde inte nå harnessen.";
    return { ...blocked(reason, agentId), runStatus: "failed" };
  } finally {
    clearTimeout(timer);
  }
}
