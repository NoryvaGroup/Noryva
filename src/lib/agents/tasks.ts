/**
 * Agent HQ – ren domänlogik (ingen databas, ingen AI, inga externa effekter).
 *
 * Orchestratorn är i det här steget helt deterministisk: den mappar ett internt
 * event till exakt en uppgift. Sales- och QA-workern är också deterministiska
 * och producerar endast intern text/analys. Ingenting här kan skicka mail,
 * boka möten eller anropa Make.
 */
import { qualifyLead, type Qualification } from "@/lib/ai-sales/qualify";
import type { CustomerProfile } from "@/lib/ai-sales/profile";

export const AGENTS = [
  "orchestrator",
  "sales",
  "systems_qa",
  "customer_success",
  "growth",
  "admin_finance",
  "noryva_manager",
  "product_tech",
  "growth_sales",
  "qa_risk",
  "operations_finance",
] as const;
export type AgentName = (typeof AGENTS)[number];

export const AGENT_LABEL: Record<AgentName, string> = {
  orchestrator: "Orchestrator",
  sales: "Sales",
  systems_qa: "Systems & QA",
  customer_success: "Customer Success",
  growth: "Growth",
  admin_finance: "Admin & Finance",
  noryva_manager: "Noryva Manager",
  product_tech: "Product & Tech",
  growth_sales: "Growth & Sales",
  qa_risk: "QA / Risk",
  operations_finance: "Operations & Finance",
};

/** Aktiva roller i v1. Endast dessa får starta ett agent-run. */
export const ACTIVE_AGENTS_V1 = ["noryva_manager", "product_tech"] as const;
export type ActiveAgentV1 = (typeof ACTIVE_AGENTS_V1)[number];

/**
 * Målbildens fyra specialistroller. De är fullt konfigurerade men PLANERADE:
 * de kan inte köras och kan inte skapa provider-run förrän de aktiveras
 * explicit och har ett eget OpenAI agent-id.
 */
export const PLANNED_AGENTS_V1 = [
  "growth_sales",
  "customer_success",
  "qa_risk",
  "operations_finance",
] as const;
export type PlannedAgentV1 = (typeof PLANNED_AGENTS_V1)[number];

/** Bakåtkompatibelt alias till tidigare namn. */
export const DORMANT_AGENTS_V1 = PLANNED_AGENTS_V1;

export type PlannedAgentConfig = {
  key: PlannedAgentV1;
  taskType: TaskType;
  /** Env-nyckel som ska fyllas med rollens OpenAI reusable agent-id. */
  agentIdEnvKey: string;
  description: string;
  /** Spegel av rollens policy till OpenAI-agenten när den aktiveras. */
  instructions: string;
  /** Framtida verifieringssteg för andra agenters resultat. */
  canVerifyOtherAgents: boolean;
  activated: false;
};

const NO_EXTERNAL =
  "Du får aldrig utföra externa åtgärder: inga mail, inga SMS, inga bokningar, inga Make-ändringar, ingen publicering och ingen ändring av produktion eller kunddata. Svara med enbart JSON.";

export const PLANNED_AGENT_CONFIG: Record<PlannedAgentV1, PlannedAgentConfig> = {
  growth_sales: {
    key: "growth_sales",
    taskType: "growth_sales_review",
    agentIdEnvKey: "NORYVA_OPENAI_GROWTH_SALES_AGENT_ID",
    description:
      "Prospektering, outreach-utkast, funnel och konvertering, marknadsföring, segmentering och säljanalys. Får endast analysera, föreslå och skriva utkast – aldrig autonom outbound.",
    instructions: `Du är Noryvas Growth & Sales-agent. Du analyserar funnel, segment och konvertering och skriver interna utkast till outreach som en människa granskar. ${NO_EXTERNAL}`,
    canVerifyOtherAgents: false,
    activated: false,
  },
  customer_success: {
    key: "customer_success",
    taskType: "customer_success_review",
    agentIdEnvKey: "NORYVA_OPENAI_CUSTOMER_SUCCESS_AGENT_ID",
    description:
      "Kundhälsa, resultat, användning, förbättringar, churn-risk och förslag på uppföljning. Arbetar som standard endast på aggregerad, PII-minimerad data och tar aldrig kundkontakt själv.",
    instructions: `Du är Noryvas Customer Success-agent. Du arbetar endast med aggregerad, avidentifierad data om kundhälsa, användning och churn-risk och föreslår uppföljning internt. ${NO_EXTERNAL}`,
    canVerifyOtherAgents: false,
    activated: false,
  },
  qa_risk: {
    key: "qa_risk",
    taskType: "qa_risk_review",
    agentIdEnvKey: "NORYVA_OPENAI_QA_RISK_AGENT_ID",
    description:
      "Granskar edge cases, regressionsrisk, säkerhet, integritet, kostnadsrisk, fel kund/fel lead, loopar, idempotens och godkännanden. Ska i framtiden kunna verifiera andra agenters resultat, men aldrig ge produktionseffekt.",
    instructions: `Du är Noryvas QA/Risk-agent. Du granskar andra agenters resultat och systemets risker: edge cases, regressioner, säkerhet, integritet, kostnad, idempotens och godkännandekedjor. Du levererar endast ett granskningsutlåtande. ${NO_EXTERNAL}`,
    canVerifyOtherAgents: true,
    activated: false,
  },
  operations_finance: {
    key: "operations_finance",
    taskType: "operations_finance_review",
    agentIdEnvKey: "NORYVA_OPENAI_OPERATIONS_FINANCE_AGENT_ID",
    description:
      "Intern kostnads- och usageanalys, driftöversikt, administrativa förbättringsförslag, KPI/rapportering och budgetvarningar. Ersätter gamla Admin & Finance som synlig målroll. Ingen bokföring, inga betalningar, ingen extern action.",
    instructions: `Du är Noryvas Operations & Finance-agent. Du analyserar intern kostnad, usage, drift och KPI:er och varnar när budgetmål riskerar att överskridas. Du hanterar aldrig bokföring eller betalningar. ${NO_EXTERNAL}`,
    canVerifyOtherAgents: false,
    activated: false,
  },
};

export function isActiveAgentV1(agent: string): agent is ActiveAgentV1 {
  return (ACTIVE_AGENTS_V1 as readonly string[]).includes(agent);
}

export function isPlannedAgentV1(agent: string): agent is PlannedAgentV1 {
  return (PLANNED_AGENTS_V1 as readonly string[]).includes(agent);
}

/** Sant endast för roller som får starta ett provider-run i den här versionen. */
export function isRunnableAgent(agent: string): boolean {
  return isActiveAgentV1(agent);
}

/**
 * Befogenhetskedjan. UTFÖRA är spärrat i den här versionen för allt som kan
 * påverka produktion, kunder eller externa system.
 */
export const AUTHORITY_CHAIN = [
  "LÄSA",
  "ANALYSERA",
  "FÖRESLÅ",
  "TESTA",
  "BE OM GODKÄNNANDE",
  "UTFÖRA",
] as const;
export const AUTHORITY_EXECUTE_ENABLED = false;

export type TaskType =
  | "sales_draft"
  | "delivery_check"
  | "followup_review"
  | "qa_review"
  | "cto_improvement_review"
  | "manager_directive"
  | "product_tech_review"
  | "growth_sales_review"
  | "customer_success_review"
  | "qa_risk_review"
  | "operations_finance_review";
export type TaskPriority = "low" | "normal" | "high";
export type TaskStatus = "queued" | "in_progress" | "awaiting_review" | "done" | "failed" | "cancelled";
export type VerificationStatus = "not_started" | "passed" | "failed";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  sales_draft: "Utkast till första svar",
  delivery_check: "Verifiera leveransstatus",
  followup_review: "Uppföljning att granska",
  qa_review: "Teknisk kontroll",
  cto_improvement_review: "Intern systemgranskning",
  manager_directive: "Prioritering och delegering",
  product_tech_review: "Produkt- och teknikgranskning",
  growth_sales_review: "Tillväxt- och säljanalys",
  customer_success_review: "Kundhälsogranskning",
  qa_risk_review: "Risk- och kvalitetsgranskning",
  operations_finance_review: "Drift- och kostnadsöversikt",
};



export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Låg",
  normal: "Normal",
  high: "Hög",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Kö",
  in_progress: "Pågår",
  awaiting_review: "Väntar granskning",
  done: "Klar",
  failed: "Misslyckad",
  cancelled: "Avbruten",
};

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  not_started: "Ej påbörjad",
  passed: "Godkänd",
  failed: "Underkänd",
};

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  not_required: "Krävs ej",
  pending: "Väntar",
  approved: "Godkänd",
  rejected: "Avvisad",
};

/** Tillåtna statusövergångar. Allt annat avvisas server-side. */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["in_progress", "cancelled", "failed"],
  in_progress: ["awaiting_review", "done", "failed", "cancelled"],
  awaiting_review: ["done", "failed", "cancelled"],
  done: [],
  failed: ["queued"],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Ogiltig övergång: ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}.`);
  }
}

/* --------------------------------------------------- externa spärrar */

/** Ingen agent får någon extern förmåga i den här versionen. */
export const AGENT_EXTERNAL_ACTIONS_ENABLED = false;

/** Körlägen som ett mänskligt beslut får fattas i. */
const DECIDABLE_MODES = ["test", "review"] as const;

/**
 * Beslutsregler för mänsklig granskning. Ren funktion utan sidoeffekter:
 * resultatet är alltid en intern statusändring och aldrig en extern action.
 */
export function evaluateApprovalDecision(input: {
  executionMode: string;
  status: TaskStatus;
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  verificationStatus: VerificationStatus;
  decision: "approved" | "rejected";
}): { nextStatus: TaskStatus; externalEffect: false } {
  if (AGENT_EXTERNAL_ACTIONS_ENABLED) {
    throw new Error("Externa agent-actions är blockerade i den här versionen.");
  }
  if (!(DECIDABLE_MODES as readonly string[]).includes(input.executionMode)) {
    throw new Error("Endast uppgifter i test- eller granskningsläge kan beslutas.");
  }
  if (!input.requiresApproval) throw new Error("Uppgiften kräver inget godkännande.");
  if (input.approvalStatus !== "pending") throw new Error("Beslut är redan fattat.");
  if (input.status !== "awaiting_review") throw new Error("Uppgiften är inte redo för granskning.");
  if (input.decision === "approved" && input.verificationStatus !== "passed") {
    throw new Error("Uppgiften måste vara verifierad innan den kan godkännas.");
  }

  const nextStatus: TaskStatus = input.decision === "approved" ? "done" : "cancelled";
  assertTransition(input.status, nextStatus);
  return { nextStatus, externalEffect: false };
}

/* ---------------------------------------------------------------- events */

export type AgentEventType = "new_lead" | "delivery_error" | "lead_followup_due";

export type AgentEvent = {
  type: AgentEventType;
  leadId: string;
  customerId: string | null;
  /** Deterministisk prioritetssignal från befintlig motor (HÖG/NORMAL/LÅG). */
  leadPriority?: "HÖG" | "NORMAL" | "LÅG";
  /** Gör samma event idempotent, t.ex. attempt-nummer eller datum. */
  occurrence?: string;
};

export type TaskSpec = {
  assignedAgent: AgentName;
  taskType: TaskType;
  priority: TaskPriority;
  instructions: string;
  requiresApproval: boolean;
  sourceEvent: AgentEventType;
  idempotencyKey: string;
};

function priorityFromLead(level: AgentEvent["leadPriority"]): TaskPriority {
  if (level === "HÖG") return "high";
  if (level === "LÅG") return "low";
  return "normal";
}

/**
 * Deterministisk routing: ett event ger exakt en uppgift till rätt specialist.
 * Orchestratorn utför aldrig något själv.
 */
export function routeEvent(event: AgentEvent): TaskSpec {
  const occ = event.occurrence ?? "1";
  const key = `${event.type}:${event.leadId}:${occ}`;

  switch (event.type) {
    case "new_lead":
      return {
        assignedAgent: "sales",
        taskType: "sales_draft",
        priority: priorityFromLead(event.leadPriority),
        instructions:
          "Ta fram intern analys och ett utkast till första svar utifrån befintlig leaddata. Skicka ingenting.",
        requiresApproval: true,
        sourceEvent: event.type,
        idempotencyKey: key,
      };
    case "delivery_error":
      return {
        assignedAgent: "systems_qa",
        taskType: "delivery_check",
        priority: "high",
        instructions:
          "Kontrollera leveransstatus och felorsak för förfrågan. Endast läsning, ingen omsändning.",
        requiresApproval: false,
        sourceEvent: event.type,
        idempotencyKey: key,
      };
    case "lead_followup_due":
      return {
        assignedAgent: "sales",
        taskType: "followup_review",
        priority: priorityFromLead(event.leadPriority),
        instructions:
          "Föreslå nästa steg för uppföljning. Förslaget går till mänsklig granskning, inget utskick sker.",
        requiresApproval: true,
        sourceEvent: event.type,
        idempotencyKey: key,
      };
  }
}

/* --------------------------------------------------------------- workers */

export type SalesWorkerInput = {
  taskType: TaskType;
  industry: string;
  values: Record<string, string>;
  profile: CustomerProfile;
  companyName: string;
};

export type SalesWorkerResult = {
  kind: "sales_analysis";
  qualification: Qualification;
  nextStep: string;
  internalNotes: string[];
  /** Internt utkast utan personuppgifter. Skickas aldrig av en agent. */
  draft: { subject: string; body: string };
  generatedBy: "deterministic";
};

/** Kör Sales-agenten. Återanvänder befintlig kvalificeringsmotor, ingen LLM. */
export function runSalesWorker(input: SalesWorkerInput): SalesWorkerResult {
  const qualification = qualifyLead(input.industry, input.values, input.profile);
  const hours = input.profile.followupRules.firstFollowupHours[qualification.priority];

  const nextStep =
    qualification.priority === "HÖG"
      ? "Kontakta omgående"
      : qualification.priority === "NORMAL"
        ? `Kontakta inom ${hours} timmar`
        : `Följ upp inom ${hours} timmar`;

  const internalNotes = [
    `Poäng ${qualification.score} (${qualification.qualification}), källa ${qualification.source}.`,
    `Prioritet ${qualification.priority} enligt kundens kvalificeringsprofil.`,
    "Deterministisk körning – ingen AI-kostnad och inget utskick.",
  ];

  return {
    kind: "sales_analysis",
    qualification,
    nextStep,
    internalNotes,
    draft: {
      subject: "Uppföljning på din förfrågan",
      body: `Hej!\n\nTack för din förfrågan. Vi går igenom uppgifterna och återkommer med nästa steg.\n\nVänliga hälsningar\n${input.companyName}`,
    },
    generatedBy: "deterministic",
  };
}

export type QaWorkerInput = {
  taskType: TaskType;
  requiresApproval: boolean;
  result: Record<string, unknown> | null;
};

export type QaVerdict = { status: Exclude<VerificationStatus, "not_started">; reasons: string[] };

/** Deterministisk kontroll av ett uppgiftsresultat mot enkla regler. */
export function verifyTaskResult(input: QaWorkerInput): QaVerdict {
  const reasons: string[] = [];
  const result = input.result ?? {};
  const hasResult = Object.keys(result).length > 0;

  if (!hasResult) reasons.push("Uppgiften saknar resultat.");

  if (input.taskType === "sales_draft" || input.taskType === "followup_review") {
    const draft = (result as { draft?: { subject?: string; body?: string } }).draft;
    const body = draft?.body ?? "";
    if (!draft?.subject) reasons.push("Ämnesrad saknas.");
    if (body.trim().length < 20) reasons.push("Utkastet är för kort.");
    if (!/^Hej!/.test(body.trim())) reasons.push("Utkastet inleds inte med en hälsning.");
    if (/\b[\w.+-]+@[\w-]+\.[\w.]+\b/.test(body)) reasons.push("Utkastet innehåller en e-postadress.");
    if (/\+?\d[\d\s-]{7,}\d/.test(body)) reasons.push("Utkastet innehåller ett telefonnummer.");
    if (/\b(pris|offert|rabatt|garanti)\b/i.test(body)) reasons.push("Utkastet nämner pris eller villkor.");
    if (!input.requiresApproval) reasons.push("Kundnära utkast måste kräva godkännande.");
  }

  if (input.taskType === "cto_improvement_review") {
    const r = result as {
      summary?: unknown;
      healthScore?: unknown;
      recommendations?: unknown;
      implementationPrompt?: unknown;
    };
    const score = Number(r.healthScore);
    if (typeof r.summary !== "string" || r.summary.trim().length < 10) {
      reasons.push("Sammanfattningen saknas.");
    }
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      reasons.push("Hälsopoängen är utanför 0-100.");
    }
    if (!Array.isArray(r.recommendations) || r.recommendations.length === 0) {
      reasons.push("Minst en rekommendation krävs.");
    }
    if (typeof r.implementationPrompt !== "string" || r.implementationPrompt.trim().length < 30) {
      reasons.push("Implementationsprompt saknas.");
    }
    if (!input.requiresApproval) reasons.push("Systemgranskning måste kräva godkännande.");
  }

  if (input.taskType === "manager_directive") {
    const r = result as { summary?: unknown; priorities?: unknown; externalEffect?: unknown };
    if (typeof r.summary !== "string" || r.summary.trim().length < 10) {
      reasons.push("Sammanfattningen saknas.");
    }
    if (!Array.isArray(r.priorities) || r.priorities.length === 0) {
      reasons.push("Minst en prioritering krävs.");
    }
    if (r.externalEffect !== false) reasons.push("Resultatet får inte ha extern effekt.");
    if (!input.requiresApproval) reasons.push("Managerbeslut måste kräva godkännande.");
  }

  if (input.taskType === "product_tech_review") {
    const r = result as {
      summary?: unknown;
      recommendations?: unknown;
      implementationPrompt?: unknown;
      externalEffect?: unknown;
    };
    if (typeof r.summary !== "string" || r.summary.trim().length < 10) {
      reasons.push("Sammanfattningen saknas.");
    }
    if (!Array.isArray(r.recommendations) || r.recommendations.length === 0) {
      reasons.push("Minst en rekommendation krävs.");
    }
    if (typeof r.implementationPrompt !== "string" || r.implementationPrompt.trim().length < 30) {
      reasons.push("Implementationsprompt saknas.");
    }
    if (r.externalEffect !== false) reasons.push("Resultatet får inte ha extern effekt.");
    if (!input.requiresApproval) reasons.push("Granskningen måste kräva godkännande.");
  }


  if (input.taskType === "delivery_check" && hasResult) {
    const status = (result as { deliveryStatus?: unknown }).deliveryStatus;
    if (typeof status !== "string" || status === "") reasons.push("Leveransstatus saknas i resultatet.");
  }

  return reasons.length === 0
    ? { status: "passed", reasons: [] }
    : { status: "failed", reasons };
}
