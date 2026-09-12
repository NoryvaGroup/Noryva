/**
 * Agent HQ v2 – isolerad server-adapter mot OpenAI Agents API (public beta).
 *
 * Harnessen är OpenAI:s: sessioner, orkestrering och kontext hanteras där.
 * Noryva behåller kontroll- och auditlagret i Supabase och kontrollpanelen i
 * Lovable. Den här filen är den ENDA platsen som får prata med providern.
 *
 * Hårda regler:
 * - Fail closed: saknas nyckel, flagga eller environment template görs INGEN
 *   nätverkstrafik och ingen tyst reserv till något annat.
 * - Ingen streaming, ingen retry, inga kedjade run.
 * - Ingen nyckel eller hemlighet lämnar servern; statusen är alltid PII-fri.
 *
 * Verifierat mot OpenAI:s aktuella Agents API-dokumentation:
 *   POST https://api.openai.com/v1/agents/sessions
 *   Header: OpenAI-Beta: agents=v1
 *   Återanvändbar agent: top-level `agent_id` (INTE `agent.id`).
 *   Ad hoc-agent:        `agent: { model, instructions }`.
 *   Hostad miljö:        `environment: { type: "openai_hosted",
 *                          environment_template_id: "envtmpl_..." }`.
 */
import { runtimeEnvFromRequest, type RuntimeEnv } from "@/lib/growth/runtime-env";

export const AGENTS_PROVIDER = "openai_agents" as const;
export const AGENTS_SESSIONS_URL = "https://api.openai.com/v1/agents/sessions";
export const AGENTS_BETA_HEADER = "agents=v1";
/** Endast reserv när ett agent-id saknas. Med agent-id styr OpenAI modellen. */
export const AGENTS_DEFAULT_MODEL = "gpt-5.4-mini";
export const AGENTS_DEFAULT_TIMEOUT_MS = 60_000;

/** Alla sex interna roller. Inga av dem har externa verktyg. */
export const HARNESS_ROLES = [
  "noryva_manager",
  "product_tech",
  "growth_sales",
  "customer_success",
  "qa_risk",
  "operations_finance",
] as const;
export type HarnessRole = (typeof HARNESS_ROLES)[number];

/** Env-nyckel per roll. Värdet är ett agent-id, inte en hemlighet. */
export const AGENT_ENV_KEYS: Record<HarnessRole, string> = {
  noryva_manager: "NORYVA_OPENAI_MANAGER_AGENT_ID",
  product_tech: "NORYVA_OPENAI_PRODUCT_TECH_AGENT_ID",
  growth_sales: "NORYVA_OPENAI_GROWTH_SALES_AGENT_ID",
  customer_success: "NORYVA_OPENAI_CUSTOMER_SUCCESS_AGENT_ID",
  qa_risk: "NORYVA_OPENAI_QA_RISK_AGENT_ID",
  operations_finance: "NORYVA_OPENAI_OPERATIONS_FINANCE_AGENT_ID",
};

/**
 * Central mapping av Noryvas återanvändbara OpenAI-agenter. Detta är inte
 * hemligheter – de kan överstyras per miljö med `AGENT_ENV_KEYS` ovan.
 */
export const DEFAULT_AGENT_IDS: Record<HarnessRole, string> = {
  noryva_manager: "agent_95cc9942a05847fb9cce479340eed36adf10e2ea0029431ab4",
  product_tech: "agent_87c79d1adf914afe85ad8d4d6d00273a4944facc95014bed89",
  growth_sales: "agent_29b1bef0218f478bb13c760e899255d8cae8bae0f1c8410bab",
  customer_success: "agent_616c6f367cb648bbbf647d8563316703aab81539fdad4f20a1",
  qa_risk: "agent_43a8b74da1ba478cb29c749cbde48d197728ad6b7fd64ea28d",
  operations_finance: "agent_f1557f32b62e45e19d6dc47fa54eaedc17ab1e8ffcb549018e",
};

/** Gemensam, återanvändbar environment template för alla sex roller. */
export const DEFAULT_ENVIRONMENT_TEMPLATE_ID =
  "envtmpl_28145d6c83734e1d9f2f88b52b3f009e87223290abd94f9785";
export const ENVIRONMENT_TEMPLATE_ENV_KEY = "NORYVA_OPENAI_ENVIRONMENT_TEMPLATE_ID";

/** OpenAI-projektet som äger agenterna. Inte en hemlighet. */
export const DEFAULT_OPENAI_PROJECT_ID = "proj_rkaXcjn0pJ2Xba3MxY27nFrK";
export const OPENAI_PROJECT_ENV_KEY = "NORYVA_OPENAI_PROJECT_ID";

export function isRunnableHarnessRole(role: string): role is HarnessRole {
  return (HARNESS_ROLES as readonly string[]).includes(role);
}

export type HarnessDeps = {
  env?: RuntimeEnv;
  request?: Request;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type AgentSlot = {
  role: HarnessRole;
  envKey: string;
  hasAgentId: boolean;
  /** Sant när rollen tekniskt kan köras (agent-id finns). */
  runnable: boolean;
};

export type HarnessStatus = {
  provider: typeof AGENTS_PROVIDER;
  configured: boolean;
  /** PII-fri och hemlighetsfri förklaring, visas i Agent HQ. */
  reason: string;
  /** Reservmodell, används bara när ett agent-id saknas. */
  model: string;
  /** Agent-id per roll. Tom sträng = rollen kan inte köras. */
  agentIds: Record<HarnessRole, string>;
  environmentTemplateId: string;
  hasEnvironmentTemplate: boolean;
  projectId: string;
};

function readEnv(deps: HarnessDeps): RuntimeEnv {
  return deps.env ?? runtimeEnvFromRequest(deps.request);
}

function str(env: RuntimeEnv, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function resolveAgentIds(env: RuntimeEnv): Record<HarnessRole, string> {
  const out = {} as Record<HarnessRole, string>;
  for (const role of HARNESS_ROLES) {
    out[role] = str(env, AGENT_ENV_KEYS[role]) || DEFAULT_AGENT_IDS[role];
  }
  return out;
}

/** Läser slot-status per roll. Returnerar aldrig hemligheter. */
export function readAgentSlots(deps: HarnessDeps = {}): AgentSlot[] {
  const ids = resolveAgentIds(readEnv(deps));
  return HARNESS_ROLES.map((role) => ({
    role,
    envKey: AGENT_ENV_KEYS[role],
    hasAgentId: ids[role].length > 0,
    runnable: ids[role].length > 0,
  }));
}

/** Läser harness-konfigurationen. Returnerar aldrig nycklar eller hemligheter. */
export function readHarnessStatus(deps: HarnessDeps = {}): HarnessStatus {
  const env = readEnv(deps);
  const model = str(env, "NORYVA_OPENAI_AGENT_MODEL") || AGENTS_DEFAULT_MODEL;
  const agentIds = resolveAgentIds(env);
  const environmentTemplateId =
    str(env, ENVIRONMENT_TEMPLATE_ENV_KEY) || DEFAULT_ENVIRONMENT_TEMPLATE_ID;
  const projectId = str(env, OPENAI_PROJECT_ENV_KEY) || DEFAULT_OPENAI_PROJECT_ID;

  const enabled = str(env, "NORYVA_AGENTS_API_ENABLED").toLowerCase() === "true";
  const hasKey = str(env, "OPENAI_API_KEY").length > 0;

  const reason = !enabled
    ? "NORYVA_AGENTS_API_ENABLED är inte satt till true."
    : !hasKey
      ? "OPENAI_API_KEY saknas i serverns miljö."
      : !environmentTemplateId
        ? "Environment template saknas i konfigurationen."
        : "";

  return {
    provider: AGENTS_PROVIDER,
    configured: reason === "",
    reason,
    model,
    agentIds,
    environmentTemplateId,
    hasEnvironmentTemplate: environmentTemplateId.length > 0,
    projectId,
  };
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
  /** Används ENDAST som reserv när rollen saknar återanvändbart agent-id. */
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
 * Bygger request-bodyn. Med ett återanvändbart agent-id skickas `agent_id` och
 * varken modell eller systeminstruktioner överstyrs – agentens sparade
 * konfiguration i OpenAI gäller. Uppgiftens mål ligger i session-input.
 */
export function buildSessionRequestBody(input: {
  agentId: string;
  model: string;
  instructions: string;
  environmentTemplateId: string;
  text: string;
}): Record<string, unknown> {
  const environment = {
    type: "openai_hosted",
    environment_template_id: input.environmentTemplateId,
  };
  const base = {
    environment,
    input: [{ role: "user", content: [{ type: "input_text", text: input.text }] }],
    stream: false,
  };
  return input.agentId
    ? { agent_id: input.agentId, ...base }
    : { agent: { model: input.model, instructions: input.instructions }, ...base };
}

/**
 * Startar EN session/turn hos harnessen och väntar in resultatet.
 * Fail closed: utan giltig konfiguration görs inget anrop alls.
 */
export async function runHarnessSession(
  input: HarnessRunInput,
  deps: HarnessDeps = {},
): Promise<HarnessRunResult> {
  // Hårdspärr: endast kända interna roller kan nå providern.
  if (!isRunnableHarnessRole(input.role)) {
    return blocked("Rollen är okänd och kan inte köras.");
  }
  const status = readHarnessStatus(deps);
  const agentId = status.agentIds[input.role];
  if (!status.configured) return blocked(status.reason, agentId);
  if (!agentId) return blocked("Rollen saknar agent-id och kan inte köras.", "");

  const env = readEnv(deps);
  const key = str(env, "OPENAI_API_KEY");
  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? AGENTS_DEFAULT_TIMEOUT_MS);

  try {
    const response = await doFetch(AGENTS_SESSIONS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": AGENTS_BETA_HEADER,
        "OpenAI-Project": status.projectId,
      },
      body: JSON.stringify(
        buildSessionRequestBody({
          agentId,
          model: status.model,
          instructions: input.instructions,
          environmentTemplateId: status.environmentTemplateId,
          text: input.input,
        }),
      ),
    });

    if (!response.ok) {
      return {
        ...blocked(`Harnessen svarade med status ${response.status}.`, agentId),
        runStatus: "failed",
      };
    }

    const body = (await response.json()) as Record<string, unknown>;
    const sessionId = String(body["id"] ?? body["session_id"] ?? "");

    // Turns körs asynkront. Sessionen returneras direkt, så svaret och usage
    // läses efteråt via read-only GET (ingen extra provider-run, ingen retry
    // av själva körningen).
    let usageRaw = (body["usage"] ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    collectText(body["output"] ?? body["output_text"] ?? "", parts);

    if (sessionId && !parts.length) {
      const headers = {
        Authorization: `Bearer ${key}`,
        "OpenAI-Beta": AGENTS_BETA_HEADER,
        "OpenAI-Project": status.projectId,
      };
      const deadline = Date.now() + (deps.timeoutMs ?? AGENTS_DEFAULT_TIMEOUT_MS);
      while (Date.now() < deadline) {
        const itemsRes = await doFetch(
          `${AGENTS_SESSIONS_URL}/${sessionId}/items?limit=20`,
          { method: "GET", headers, signal: controller.signal },
        );
        if (itemsRes.ok) {
          const itemsBody = (await itemsRes.json()) as Record<string, unknown>;
          const data = Array.isArray(itemsBody["data"]) ? itemsBody["data"] : [];
          const assistant = data.find(
            (item) =>
              item &&
              typeof item === "object" &&
              (item as Record<string, unknown>)["type"] === "message" &&
              (item as Record<string, unknown>)["role"] === "assistant" &&
              (item as Record<string, unknown>)["status"] === "completed",
          );
          if (assistant) {
            collectText((assistant as Record<string, unknown>)["content"], parts);
            // Usage bokförs strax efter att turen avslutats. Read-only GET,
            // ingen extra provider-run: några få försök innan vi ger upp.
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const sessionRes = await doFetch(`${AGENTS_SESSIONS_URL}/${sessionId}`, {
                method: "GET",
                headers,
                signal: controller.signal,
              });
              if (sessionRes.ok) {
                const sessionBody = (await sessionRes.json()) as Record<string, unknown>;
                const found = sessionBody["usage"] as Record<string, unknown> | null | undefined;
                if (found && Number(found["input_tokens"] ?? 0) > 0) {
                  usageRaw = found;
                  break;
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return {
      ok: true,
      providerType: AGENTS_PROVIDER,
      providerAgentId: agentId || String(body["agent_id"] ?? ""),
      providerRunId: sessionId,
      runStatus: "completed",
      usage: {
        inputTokens: Number(usageRaw?.["input_tokens"] ?? 0) || 0,
        outputTokens: Number(usageRaw?.["output_tokens"] ?? 0) || 0,
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
