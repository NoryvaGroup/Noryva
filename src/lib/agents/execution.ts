/**
 * Post-approval execution – ren domänlogik (ingen databas, ingen AI).
 *
 * När en Boardroom-slutsats godkänts bryts den ned i små konkreta uppgifter
 * som körs internt. Hårda regler som inte kan kringgås av task-typ eller roll:
 * - All kund-/leadkontakt stannar i AWAITING_HUMAN_APPROVAL. Ingen sändning
 *   byggs här; godkännande ändrar endast intern status.
 * - Kodändringar kan inte appliceras utan en verklig repo-executor. Saknas den
 *   produceras ett strukturerat change-set märkt READY_FOR_REPO_EXECUTOR.
 * - Interna konfigurationsändringar kräver en explicit whitelist av säkra
 *   write-paths. Tom whitelist = förslag, aldrig utförande.
 */
import { z } from "zod";
import { normalizeRoleKey } from "./boardroom";
import { ACTIVE_AGENTS_V1, type ActiveAgentV1 } from "./tasks";

export const EXECUTION_ACTION_TYPES = [
  "internal_analysis",
  "internal_config",
  "code_change",
  "qa_verification",
  "customer_contact",
  "external_other",
] as const;
export type ExecutionActionType = (typeof EXECUTION_ACTION_TYPES)[number];

/** Ingen repo-executor finns i Noryva-runtime. Sätts aldrig true utan riktig write-path. */
export const REPO_EXECUTOR_AVAILABLE = false;

/** Explicit whitelist av säkra interna writes. Tom = allt internal_config är proposal-only. */
export const SAFE_INTERNAL_CONFIG_WRITES: readonly string[] = [];

/** Kundkontakt kräver alltid en människa, även efter godkänd Boardroom-slutsats. */
export const CUSTOMER_CONTACT_REQUIRES_HUMAN = true as const;

export const EXECUTION_SOURCE_PREFIX = "boardroom_execution";

export const EXECUTION_STATUSES = [
  "queued",
  "done",
  "proposal_only",
  "ready_for_repo_executor",
  "awaiting_human_approval",
  "blocked",
  "failed",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatus, string> = {
  queued: "Väntar",
  done: "Klar",
  proposal_only: "Förslag – kräver säker write-path",
  ready_for_repo_executor: "Klar för repo-executor",
  awaiting_human_approval: "Väntar mänskligt godkännande",
  blocked: "Blockerad",
  failed: "Misslyckad",
};

export const EXECUTION_ACTION_LABEL: Record<ExecutionActionType, string> = {
  internal_analysis: "Intern analys",
  internal_config: "Intern konfiguration",
  code_change: "Kodändring",
  qa_verification: "QA-verifiering",
  customer_contact: "Kundkontakt",
  external_other: "Extern åtgärd",
};

export type ExecutionTaskPlan = {
  index: number;
  role: ActiveAgentV1;
  actionType: ExecutionActionType;
  goal: string;
  successCriteria: string;
  requiresCustomerContact: boolean;
  dependencies: number[];
};

const planItemSchema = z.object({
  role: z.string().trim().min(2).max(60),
  actionType: z.string().trim().min(3).max(40),
  goal: z.string().trim().min(3).max(400),
  successCriteria: z.string().trim().max(400).optional(),
  requiresCustomerContact: z.boolean().optional(),
  dependencies: z.array(z.number().int().min(0).max(11)).max(4).optional(),
});

export const MAX_EXECUTION_TASKS = 6;

/** Zod-schema för executionPlan i Manager-syntesen. Kort och billigt. */
export const executionPlanSchema = z.array(planItemSchema).max(MAX_EXECUTION_TASKS);

function asActionType(raw: string, requiresCustomerContact: boolean): ExecutionActionType {
  if (requiresCustomerContact) return "customer_contact";
  const slug = raw.toLowerCase().replace(/[^a-z]+/g, "_");
  const direct = EXECUTION_ACTION_TYPES.find((type) => type === slug);
  if (direct) return direct;
  if (slug.includes("customer") || slug.includes("contact") || slug.includes("kund")) return "customer_contact";
  if (slug.includes("code") || slug.includes("kod") || slug.includes("patch") || slug.includes("repo")) {
    return "code_change";
  }
  if (slug.includes("qa") || slug.includes("verif") || slug.includes("test")) return "qa_verification";
  if (slug.includes("config") || slug.includes("setting")) return "internal_config";
  if (slug.includes("external") || slug.includes("mail") || slug.includes("sms") || slug.includes("make")) {
    return "external_other";
  }
  return "internal_analysis";
}

/** Normaliserar en plan från Manager till körbara, säkert klassade uppgifter. */
export function normalizeExecutionPlan(raw: unknown): ExecutionTaskPlan[] {
  const parsed = executionPlanSchema.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.slice(0, MAX_EXECUTION_TASKS).map((item, index) => {
    const roleKey = normalizeRoleKey(item.role);
    const role = (ACTIVE_AGENTS_V1 as readonly string[]).includes(roleKey)
      ? (roleKey as ActiveAgentV1)
      : "noryva_manager";
    const requiresCustomerContact = Boolean(item.requiresCustomerContact);
    const actionType = asActionType(item.actionType, requiresCustomerContact);
    return {
      index,
      role,
      actionType,
      goal: item.goal,
      successCriteria: item.successCriteria ?? "",
      requiresCustomerContact: requiresCustomerContact || actionType === "customer_contact",
      dependencies: (item.dependencies ?? []).filter((dep) => dep < index),
    };
  });
}

export type ExecutionPolicy = {
  /** Får uppgiften kosta ett provider-anrop? */
  providerRun: boolean;
  /** Terminalt exekveringsläge när steget är färdigt. */
  finalStatus: ExecutionStatus;
  blockedReason: string;
};

/**
 * Snäv action policy. Enda vägen till extern effekt går genom en människa –
 * ingen roll och ingen task-typ kan kringgå det.
 */
export function classifyExecutionTask(task: {
  actionType: ExecutionActionType;
  requiresCustomerContact?: boolean;
  configWriteKey?: string;
}): ExecutionPolicy {
  if (task.requiresCustomerContact || task.actionType === "customer_contact") {
    return {
      providerRun: false,
      finalStatus: "awaiting_human_approval",
      blockedReason: "Kund- eller leadkontakt kräver separat mänskligt godkännande före varje utskick.",
    };
  }
  if (task.actionType === "internal_analysis" || task.actionType === "qa_verification") {
    return { providerRun: true, finalStatus: "done", blockedReason: "" };
  }
  if (task.actionType === "code_change") {
    // Policybeslut, inte en teknisk begränsning: agenter får aldrig applicera kod
    // i Lovable/repo automatiskt (kostnad + kontroll). Alltid change-set till människa.
    return {
      providerRun: true,
      finalStatus: "ready_for_repo_executor",
      blockedReason:
        "Kodändringar appliceras aldrig automatiskt. Levereras som strukturerat change-set för manuell körning.",
    };
  }
  if (task.actionType === "internal_config") {
    const key = task.configWriteKey ?? "";
    if (key && SAFE_INTERNAL_CONFIG_WRITES.includes(key)) {
      return { providerRun: true, finalStatus: "done", blockedReason: "" };
    }
    return {
      providerRun: true,
      finalStatus: "proposal_only",
      blockedReason: "Ingen whitelistad säker write-path. Uppgiften levereras som förslag.",
    };
  }
  return {
    providerRun: false,
    finalStatus: "blocked",
    blockedReason: "Extern åtgärd saknar säker executor och är fail-closed.",
  };
}

export type ExecutionItem = {
  index: number;
  role: ActiveAgentV1;
  actionType: ExecutionActionType;
  goal: string;
  successCriteria: string;
  dependencies: number[];
  executionStatus: ExecutionStatus;
  blockedReason: string;
};

/** Dependency-aware: nästa köade uppgift vars beroenden är färdigbehandlade. */
export function nextExecutionTask(items: ExecutionItem[]): ExecutionItem | null {
  const settled = new Set(items.filter((item) => item.executionStatus !== "queued").map((item) => item.index));
  return (
    items
      .slice()
      .sort((a, b) => a.index - b.index)
      .find((item) => item.executionStatus === "queued" && item.dependencies.every((dep) => settled.has(dep))) ?? null
  );
}

export type ExecutionBatchStatus =
  | "not_started"
  | "running"
  | "awaiting_human_approval"
  | "ready_for_repo_executor"
  | "completed";

export function executionBatchStatus(items: ExecutionItem[]): ExecutionBatchStatus {
  if (items.length === 0) return "not_started";
  if (nextExecutionTask(items)) return "running";
  if (items.some((item) => item.executionStatus === "awaiting_human_approval")) return "awaiting_human_approval";
  if (items.some((item) => item.executionStatus === "ready_for_repo_executor")) return "ready_for_repo_executor";
  return "completed";
}

export const EXECUTION_BATCH_LABEL: Record<ExecutionBatchStatus, string> = {
  not_started: "Genomförandet förbereds",
  running: "Agenterna arbetar",
  awaiting_human_approval: "Väntar ditt godkännande för kundkontakt",
  ready_for_repo_executor: "Klar – väntar repo executor",
  completed: "Intern implementation klar",
};

export function executionTaskKey(meetingId: string, index: number) {
  return `${EXECUTION_SOURCE_PREFIX}:${meetingId}:${index}`;
}

export function executionPlanKey(meetingId: string) {
  return `${EXECUTION_SOURCE_PREFIX}-plan:${meetingId}`;
}

export function executionSourceEvent(meetingId: string) {
  return `${EXECUTION_SOURCE_PREFIX}:${meetingId}`;
}

/** Kort promptkontrakt för Manager-planering av ett gammalt möte utan executionPlan. */
export const EXECUTION_PLAN_CONTRACT =
  'Bryt ned den godkända slutsatsen i högst 5 små konkreta uppgifter. Svara med ETT JSON-objekt och inget annat: {"tasks":[{"role":"product_tech","actionType":"internal_analysis|internal_config|code_change|qa_verification|customer_contact","goal":"kort mål","successCriteria":"kort kriterium","requiresCustomerContact":false,"dependencies":[]}]}. Kundkontakt måste märkas requiresCustomerContact=true och utförs aldrig av dig.';

/** Kort instruktion per execution-uppgift. Ingen extern effekt tillåten. */
export function executionTaskPrompt(item: {
  actionType: ExecutionActionType;
  goal: string;
  successCriteria: string;
  recommendation: string;
  contextPack: string;
}): string {
  const shape =
    item.actionType === "code_change"
      ? '{"summary":"...","implementationPatch":{"files":["sökväg"],"changes":["konkret ändring"]},"risks":["..."]}'
      : item.actionType === "internal_config"
        ? '{"summary":"...","proposedChange":["..."],"risks":["..."]}'
        : item.actionType === "qa_verification"
          ? '{"summary":"...","checks":["..."],"verdict":"pass|concerns|fail"}'
          : '{"summary":"...","findings":["..."],"recommendations":["..."]}';
  return [
    item.contextPack,
    `Godkänd slutsats: ${item.recommendation.slice(0, 600)}`,
    `Din uppgift: ${item.goal}`,
    item.successCriteria ? `Klart när: ${item.successCriteria}` : "",
    "Du utför ingen extern åtgärd: inga mail, SMS, bokningar, Make-ändringar, deploy eller kunddataändringar.",
    item.actionType === "code_change"
      ? "Det finns ingen repo-executor. Leverera ett strukturerat change-set som en människa kan applicera."
      : "",
    "Var kort: högst 3–5 punkter. Svara med ETT giltigt JSON-objekt och ingenting annat.",
    `Format: ${shape}`,
  ]
    .filter(Boolean)
    .join("\n");
}
