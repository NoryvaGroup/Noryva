/**
 * Agent Core – resonemangslager (TEST-only).
 *
 * Anropar OpenAI Responses API DIREKT med serverhemligheten OPENAI_API_KEY.
 * Ingen Lovable AI Gateway används här.
 *
 * Hårda regler:
 * - Max ETT anrop per uppgift. Ingen retry, inga verktyg, ingen kedja.
 * - Strikt JSON-schema. Ogiltigt svar => deterministisk fallback.
 * - Timeout => deterministisk fallback (fortfarande ett försök).
 * - Saknad nyckel => ingen nätverkstrafik alls, deterministisk fallback.
 * - Prompten innehåller aldrig personuppgifter.
 * - Ingen extern effekt: inga mail, bokningar eller callbacks.
 */
import { z } from "zod";
import { PII_FIELD_KEYS, redactText } from "@/lib/ai-sales/context";
import { runtimeEnvFromRequest, type RuntimeEnv } from "@/lib/growth/runtime-env";
import type { AgentName, SalesWorkerResult, TaskType } from "./tasks";

export const REASONING_MODEL = "gpt-5.4-mini";
export const REASONING_PROMPT_VERSION = "agent-core-reasoning-v1";
export const DEFAULT_REASONING_TIMEOUT_MS = 20_000;

export type LlmMeta = {
  used: boolean;
  model: string;
  promptVersion: string;
  /** 0 eller 1 – aldrig mer. */
  attempts: 0 | 1;
  usedFallback: boolean;
  fallbackReason: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

export type ReasoningDeps = {
  env?: RuntimeEnv;
  request?: Request;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function metaFallback(reason: string, attempts: 0 | 1, latencyMs = 0): LlmMeta {
  return {
    used: false,
    model: REASONING_MODEL,
    promptVersion: REASONING_PROMPT_VERSION,
    attempts,
    usedFallback: true,
    fallbackReason: reason,
    latencyMs,
    inputTokens: 0,
    outputTokens: 0,
  };
}

export function readOpenAiKey(deps: ReasoningDeps = {}): string {
  const env = deps.env ?? runtimeEnvFromRequest(deps.request);
  const key = env["OPENAI_API_KEY"];
  return typeof key === "string" ? key.trim() : "";
}

/* ------------------------------------------------------------ PII-skydd */

const PII_KEYS = new Set<string>(PII_FIELD_KEYS as readonly string[]);

/** Bygger en kompakt, PII-fri kontextrad av leadets svar. */
export function safeContextLines(values: Record<string, string>): string[] {
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const k = key.toLowerCase();
    if (PII_KEYS.has(k)) continue;
    if (/namn|post|mail|tele|mobil|adress|person/.test(k)) continue;
    const value = redactText(String(raw ?? "")).slice(0, 240);
    if (!value) continue;
    lines.push(`${k}: ${value}`);
    if (lines.length >= 20) break;
  }
  return lines;
}

/* ------------------------------------------------------------- schemat */

const salesReasoningSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(20).max(2000),
  nextStep: z.string().trim().min(3).max(200),
  internalNotes: z.array(z.string().trim().min(3).max(300)).max(5),
  confidence: z.number().min(0).max(1),
});
export type SalesReasoning = z.infer<typeof salesReasoningSchema>;

const SALES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body", "nextStep", "internalNotes", "confidence"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    nextStep: { type: "string" },
    internalNotes: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
} as const;

const SALES_SYSTEM = `Du är säljassistent åt ett svenskt tjänsteföretag och arbetar i TESTLÄGE.
Du skickar aldrig något själv – allt går till mänsklig granskning.

REGLER
- Svara endast med JSON enligt schemat.
- "body" är ett första svarsmail TILL kunden, högst cirka 70 ord.
- Inled med "Hej!" och avsluta med "Vänliga hälsningar" och företagsnamnet.
- Nämn aldrig pris, offert, rabatt eller garanti.
- Skriv aldrig personnamn, e-postadresser eller telefonnummer.
- Hitta aldrig på fakta, tider eller att något redan gjorts.
- "internalNotes" och "nextStep" är interna och skrivs på svenska.`;

/* ------------------------------------------------------------ anropet */

type CallOutcome =
  | { ok: true; data: SalesReasoning; meta: LlmMeta }
  | { ok: false; meta: LlmMeta };

function extractText(json: any): string {
  if (typeof json?.output_text === "string") return json.output_text;
  const texts: string[] = [];
  for (const item of json?.output ?? []) {
    for (const c of item?.content ?? []) {
      if (typeof c?.text === "string") texts.push(c.text);
    }
  }
  return texts.join("");
}

export async function callOpenAiStructured(
  system: string,
  user: string,
  schemaName: string,
  schema: unknown,
  deps: ReasoningDeps,
): Promise<{ text: string; meta: LlmMeta } | { text: null; meta: LlmMeta }> {
  const apiKey = readOpenAiKey(deps);
  if (!apiKey) return { text: null, meta: metaFallback("missing_api_key", 0) };

  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_REASONING_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await doFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: REASONING_MODEL,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: {
          format: { type: "json_schema", name: schemaName, strict: true, schema },
        },
      }),
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return { text: null, meta: metaFallback(`http_${res.status}`, 1, latencyMs) };
    }
    const json: any = await res.json();
    const text = extractText(json);
    if (!text) return { text: null, meta: metaFallback("empty_response", 1, latencyMs) };

    return {
      text,
      meta: {
        used: true,
        model: REASONING_MODEL,
        promptVersion: REASONING_PROMPT_VERSION,
        attempts: 1,
        usedFallback: false,
        fallbackReason: "",
        latencyMs,
        inputTokens: Number(json?.usage?.input_tokens ?? 0) || 0,
        outputTokens: Number(json?.usage?.output_tokens ?? 0) || 0,
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const aborted = (error as { name?: string } | null)?.name === "AbortError";
    return { text: null, meta: metaFallback(aborted ? "timeout" : "network_error", 1, latencyMs) };
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------- sales */

export type SalesReasoningInput = {
  taskType: TaskType;
  industry: string;
  companyName: string;
  priority: string;
  values: Record<string, string>;
};

async function reasonSales(
  input: SalesReasoningInput,
  deps: ReasoningDeps,
): Promise<CallOutcome> {
  const lines = safeContextLines(input.values);
  const user = [
    `Bransch: ${input.industry || "okänd"}`,
    `Företagsnamn (avsändare): ${input.companyName}`,
    `Deterministisk prioritet: ${input.priority}`,
    `Uppgiftstyp: ${input.taskType}`,
    "Anonymiserad förfrågan:",
    ...(lines.length ? lines : ["(inga strukturerade uppgifter)"]),
  ].join("\n");

  const call = await callOpenAiStructured(SALES_SYSTEM, user, "sales_reasoning", SALES_JSON_SCHEMA, deps);
  if (call.text === null) return { ok: false, meta: call.meta };

  try {
    const parsed = salesReasoningSchema.parse(JSON.parse(call.text));
    return { ok: true, data: parsed, meta: call.meta };
  } catch {
    return { ok: false, meta: metaFallback("schema_error", 1, call.meta.latencyMs) };
  }
}

export type SalesResultWithMeta = Omit<SalesWorkerResult, "generatedBy"> & {
  generatedBy: "deterministic" | "llm";
  llm: LlmMeta;
};

/**
 * Förbättrar ett redan framtaget deterministiskt Sales-resultat med LLM.
 * Faller alltid tillbaka på det deterministiska resultatet vid minsta problem.
 */
export async function enrichSalesResult(
  deterministic: SalesWorkerResult,
  input: SalesReasoningInput,
  deps: ReasoningDeps = {},
): Promise<SalesResultWithMeta> {
  const outcome = await reasonSales(input, deps);
  if (!outcome.ok) {
    return { ...deterministic, generatedBy: "deterministic", llm: outcome.meta };
  }

  const { data } = outcome;
  return {
    ...deterministic,
    generatedBy: "llm",
    nextStep: data.nextStep,
    internalNotes: [...data.internalNotes, `Konfidens ${data.confidence.toFixed(2)} (modell).`],
    draft: { subject: data.subject, body: data.body },
    llm: outcome.meta,
  };
}

/* -------------------------------------------------- oklar orchestrering */

const ROUTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignedAgent", "taskType", "reason"],
  properties: {
    assignedAgent: { type: "string", enum: ["sales", "systems_qa"] },
    taskType: { type: "string", enum: ["sales_draft", "delivery_check", "qa_review"] },
    reason: { type: "string" },
  },
} as const;

const routeSchema = z.object({
  assignedAgent: z.enum(["sales", "systems_qa"]),
  taskType: z.enum(["sales_draft", "delivery_check", "qa_review"]),
  reason: z.string().trim().max(300),
});

export type UnclearRouting = {
  assignedAgent: Extract<AgentName, "sales" | "systems_qa">;
  taskType: TaskType;
  reason: string;
  llm: LlmMeta;
};

/**
 * Används ENDAST när ett event inte kan klassificeras av reglerna.
 * Kända event går aldrig hit och kostar därför noll LLM-anrop.
 */
export async function classifyUnclearEvent(
  description: string,
  deps: ReasoningDeps = {},
): Promise<UnclearRouting> {
  const fallback: UnclearRouting = {
    assignedAgent: "systems_qa",
    taskType: "qa_review",
    reason: "Regelfallback: oklart event går till teknisk kontroll.",
    llm: metaFallback("missing_api_key", 0),
  };

  const call = await callOpenAiStructured(
    "Du dirigerar interna uppgifter i testläge. Svara endast med JSON enligt schemat.",
    `Oklart internt event (anonymiserat): ${redactText(description).slice(0, 500)}`,
    "event_routing",
    ROUTE_SCHEMA,
    deps,
  );
  if (call.text === null) return { ...fallback, llm: call.meta };

  try {
    const parsed = routeSchema.parse(JSON.parse(call.text));
    return { ...parsed, llm: call.meta };
  } catch {
    return { ...fallback, llm: metaFallback("schema_error", 1, call.meta.latencyMs) };
  }
}

/* --------------------------------------- intern systemgranskning (CTO) */

const IMPROVEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "healthScore", "findings", "recommendations", "implementationPrompt"],
  properties: {
    summary: { type: "string" },
    healthScore: { type: "number" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "observation", "severity"],
        properties: {
          area: { type: "string" },
          observation: { type: "string" },
          severity: { type: "string" },
        },
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "priority", "evidence", "risk", "suggestedAction"],
        properties: {
          title: { type: "string" },
          priority: { type: "string" },
          evidence: { type: "string" },
          risk: { type: "string" },
          suggestedAction: { type: "string" },
        },
      },
    },
    implementationPrompt: { type: "string" },
  },
} as const;

const improvementSchema = z.object({
  summary: z.string().trim().min(10).max(1200),
  healthScore: z.number().min(0).max(100),
  findings: z
    .array(
      z.object({
        area: z.string().trim().min(2).max(80),
        observation: z.string().trim().min(5).max(500),
        severity: z.string().trim().min(1).max(20),
      }),
    )
    .max(10),
  recommendations: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(120),
        priority: z.string().trim().min(1).max(20),
        evidence: z.string().trim().min(3).max(500),
        risk: z.string().trim().min(3).max(300),
        suggestedAction: z.string().trim().min(3).max(500),
      }),
    )
    .min(1)
    .max(8),
  implementationPrompt: z.string().trim().min(30).max(4000),
});
export type SystemImprovement = z.infer<typeof improvementSchema>;

const IMPROVEMENT_SYSTEM = `Du är teknisk chef (CTO) för det svenska systemet Noryva och arbetar i TESTLÄGE.
Du analyserar endast aggregerad driftstatistik – du ser aldrig kunddata.

REGLER
- Svara endast med JSON enligt schemat, på svenska.
- Du får ALDRIG utföra något: du analyserar, prioriterar och föreslår.
- "healthScore" är 0-100 där 100 är felfri drift.
- "priority" och "severity" är ett av: låg, normal, hög.
- "evidence" ska referera till konkreta siffror i telemetrin.
- "implementationPrompt" är en färdig, avgränsad instruktion som en människa
  senare kan godkänna och ge till Lovable för EN säker kodändring.
- Hitta aldrig på siffror som saknas i telemetrin.`;

export type ImprovementReasoningResult = SystemImprovement & {
  generatedBy: "deterministic" | "llm";
  llm: LlmMeta;
};

/** Konservativ reserv när modellen inte kan användas. Rent regelbaserad. */
export function deterministicImprovement(telemetry: Record<string, any>): SystemImprovement {
  const tasks = telemetry?.["tasks"] ?? {};
  const failed = Number(tasks?.byStatus?.["failed"] ?? 0);
  const awaiting = Number(tasks?.byStatus?.["awaiting_review"] ?? 0);
  const fallbacks = Number(telemetry?.["events"]?.llmFallbacks ?? 0);
  const unverified = Number(telemetry?.["inboundWebhooks"]?.unverified ?? 0);
  const cost = Number(telemetry?.["aiCost"]?.estimatedCostTotal ?? 0);

  const healthScore = Math.max(
    0,
    100 - failed * 10 - fallbacks * 3 - unverified * 5 - (awaiting > 20 ? 10 : 0),
  );

  return {
    summary:
      "Deterministisk systemgranskning utan modellanrop. Bedömningen bygger enbart på aggregerad drifttelemetri.",
    healthScore,
    findings: [
      { area: "Uppgiftskö", observation: `${failed} misslyckade och ${awaiting} väntar granskning.`, severity: failed > 0 ? "hög" : "låg" },
      { area: "AI-drift", observation: `${fallbacks} körningar föll tillbaka på deterministisk logik.`, severity: fallbacks > 0 ? "normal" : "låg" },
      { area: "Inkommande webhookar", observation: `${unverified} anrop saknar verifierad signatur.`, severity: unverified > 0 ? "hög" : "låg" },
      { area: "Kostnad", observation: `Uppskattad AI-kostnad totalt ${cost}.`, severity: "låg" },
    ],
    recommendations: [
      {
        title: "Gå igenom misslyckade och väntande uppgifter manuellt",
        priority: failed > 0 ? "hög" : "låg",
        evidence: `failed=${failed}, awaiting_review=${awaiting}`,
        risk: "Ingen – endast läsning och manuell hantering.",
        suggestedAction: "Granska köns äldsta poster i Agent HQ och avgör om de ska köras om eller avbrytas.",
      },
    ],
    implementationPrompt:
      "Analysera Noryvas agentkö och föreslå EN liten, säker backendändring som minskar antalet misslyckade uppgifter. Ändra inget innan en människa godkänt förslaget. Inga externa actions.",
  };
}

/**
 * Max ETT modellanrop per granskning. Vid minsta problem används den
 * deterministiska reserven. Ingen retry-loop.
 */
export async function reasonSystemImprovement(
  telemetry: Record<string, any>,
  deps: ReasoningDeps = {},
): Promise<ImprovementReasoningResult> {
  const fallback = deterministicImprovement(telemetry);
  const user = [
    "Aggregerad systemtelemetri (ingen kunddata):",
    JSON.stringify(telemetry).slice(0, 6000),
  ].join("\n");

  const call = await callOpenAiStructured(
    IMPROVEMENT_SYSTEM,
    user,
    "system_improvement",
    IMPROVEMENT_SCHEMA,
    deps,
  );
  if (call.text === null) return { ...fallback, generatedBy: "deterministic", llm: call.meta };

  try {
    const parsed = improvementSchema.parse(JSON.parse(call.text));
    return { ...parsed, generatedBy: "llm", llm: call.meta };
  } catch {
    return {
      ...fallback,
      generatedBy: "deterministic",
      llm: metaFallback("schema_error", 1, call.meta.latencyMs),
    };
  }
}
