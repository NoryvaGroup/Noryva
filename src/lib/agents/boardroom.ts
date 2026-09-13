import { z } from "zod";
import {
  SPECIALIST_AGENTS_V1,
  type ActiveAgentV1,
  type SpecialistAgentV1,
} from "./tasks";

export const MEETING_TYPES = ["strategy", "product", "growth", "risk", "operations", "general"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_STATUSES = [
  "draft",
  "manager_kickoff",
  "round_1",
  "cross_review",
  "qa_review",
  "manager_synthesis",
  "awaiting_approval",
  "completed",
  "paused_budget",
  "failed",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const ACTIVE_MEETING_STATUSES: MeetingStatus[] = [
  "draft",
  "manager_kickoff",
  "round_1",
  "cross_review",
  "qa_review",
  "manager_synthesis",
  "paused_budget",
];
export const MAX_SPECIALISTS = 5;
export const MAX_ROUNDS = 2;

export function isActiveMeetingStatus(status: MeetingStatus): boolean {
  return ACTIVE_MEETING_STATUSES.includes(status);
}

export function budgetPause(reason: string) {
  return { status: "paused_budget" as const, error: reason || "Budgetspärren stoppade mötet." };
}

export type MeetingMessage = {
  role: ActiveAgentV1 | "system";
  message_type: "kickoff" | "analysis" | "critique" | "qa_review" | "synthesis" | "system";
  content: string;
  round: number;
  sequence: number;
};

export type MeetingLike = {
  agenda: string;
  meeting_type: MeetingType;
  status: MeetingStatus;
  selected_roles: string[];
  max_specialists: number;
  needs_cross_review: boolean | null;
};

export type TurnPlan = {
  role: ActiveAgentV1;
  messageType: Exclude<MeetingMessage["message_type"], "system">;
  round: 0 | 1 | 2;
  nextStatus: MeetingStatus;
};

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  draft: "Redo för kickoff",
  manager_kickoff: "Manager kickoff",
  round_1: "Specialistanalys",
  cross_review: "Kritikrunda",
  qa_review: "QA / Risk-granskning",
  manager_synthesis: "Manager slutsats",
  awaiting_approval: "Väntar godkännande",
  completed: "Klar",
  paused_budget: "Pausad av spärr",
  failed: "Stoppad",
};

export function hasLikelyPii(value: string): boolean {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phone = /(?:\+?46|0)[\s-]?(?:\d[\s-]?){7,10}\b/;
  return email.test(value) || phone.test(value);
}

export function validateMeetingInput(input: { agenda: string; maxSpecialists: number }) {
  const agenda = input.agenda.trim();
  if (agenda.length < 10 || agenda.length > 2000) throw new Error("Agendan måste vara 10–2000 tecken.");
  if (hasLikelyPii(agenda)) throw new Error("Ta bort e-postadress eller telefonnummer från agendan.");
  if (!Number.isInteger(input.maxSpecialists) || input.maxSpecialists < 2 || input.maxSpecialists > MAX_SPECIALISTS) {
    throw new Error("Välj mellan 2 och 5 specialister.");
  }
  return agenda;
}

function completedRoles(messages: MeetingMessage[], type: "analysis" | "critique") {
  return new Set(messages.filter((m) => m.message_type === type).map((m) => m.role));
}

export function planNextTurn(meeting: MeetingLike, messages: MeetingMessage[]): TurnPlan | null {
  if (meeting.status === "draft" || meeting.status === "manager_kickoff") {
    if (messages.some((m) => m.message_type === "kickoff")) return null;
    return { role: "noryva_manager", messageType: "kickoff", round: 0, nextStatus: "round_1" };
  }
  const selected = meeting.selected_roles.filter((role): role is SpecialistAgentV1 =>
    (SPECIALIST_AGENTS_V1 as readonly string[]).includes(role),
  ).slice(0, MAX_SPECIALISTS);
  if (selected.length < 2) return null;

  if (meeting.status === "round_1") {
    const done = completedRoles(messages, "analysis");
    const role = selected.find((candidate) => !done.has(candidate));
    if (role) {
      const isLast = selected.every((candidate) => candidate === role || done.has(candidate));
      return {
        role,
        messageType: "analysis",
        round: 1,
        nextStatus: isLast ? (meeting.needs_cross_review ? "cross_review" : "qa_review") : "round_1",
      };
    }
    return null;
  }
  if (meeting.status === "cross_review") {
    const done = completedRoles(messages, "critique");
    const role = selected.find((candidate) => !done.has(candidate));
    if (role) {
      const isLast = selected.every((candidate) => candidate === role || done.has(candidate));
      return { role, messageType: "critique", round: 2, nextStatus: isLast ? "qa_review" : "cross_review" };
    }
    return null;
  }
  if (meeting.status === "qa_review") {
    if (messages.some((m) => m.message_type === "qa_review")) return null;
    return { role: "qa_risk", messageType: "qa_review", round: meeting.needs_cross_review ? 2 : 1, nextStatus: "manager_synthesis" };
  }
  if (meeting.status === "manager_synthesis") {
    if (!messages.some((m) => m.message_type === "qa_review") || messages.some((m) => m.message_type === "synthesis")) return null;
    return { role: "noryva_manager", messageType: "synthesis", round: meeting.needs_cross_review ? 2 : 1, nextStatus: "awaiting_approval" };
  }
  return null;
}

const summary = z.string().trim().min(10).max(4000);
const list = z.array(z.string().trim().min(2).max(1200)).max(8);
const schemas = {
  kickoff: z.object({
    summary,
    selectedRoles: z.array(z.enum(SPECIALIST_AGENTS_V1)).min(2).max(MAX_SPECIALISTS).refine(
      (roles) => new Set(roles).size === roles.length,
      "Specialistrollerna måste vara unika.",
    ),
    needsCrossReview: z.boolean(),
  }),
  analysis: z.object({ summary, findings: list, recommendations: list }),
  critique: z.object({ summary, concerns: list, refinements: list }),
  qa_review: z.object({ summary, risks: list, verdict: z.enum(["pass", "concerns", "fail"]), riskLevel: z.enum(["low", "medium", "high"]) }),
  synthesis: z.object({
    summary,
    recommendation: z.string().trim().min(5).max(4000),
    alternatives: list,
    expectedEffect: z.string().trim().min(3).max(2000),
    riskLevel: z.enum(["low", "medium", "high"]),
    estimatedEffort: z.string().trim().min(2).max(500),
    nextStep: z.string().trim().min(3).max(1000),
  }),
};

/** Normaliserar rollnamn ("Product & Tech", "Product/Tech") till interna nycklar. */
export function normalizeRoleKey(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase().trim();
  const slug = s.replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  const direct = (SPECIALIST_AGENTS_V1 as readonly string[]).find((r) => r === slug);
  if (direct) return direct;
  if (slug.includes("product") || slug.includes("tech")) return "product_tech";
  if (slug.includes("growth") || slug.includes("sales")) return "growth_sales";
  if (slug.includes("customer")) return "customer_success";
  if (slug.includes("qa") || slug.includes("risk")) return "qa_risk";
  if (slug.includes("operation") || slug.includes("finance")) return "operations_finance";
  return slug;
}

export function parseMeetingOutput(type: Exclude<MeetingMessage["message_type"], "system">, text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Agentens svar innehöll ingen giltig JSON.");
  let value: unknown;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error("Agentens svar kunde inte tolkas som JSON."); }
  if (type === "kickoff" && value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v["selectedRoles"])) {
      const unique = Array.from(new Set((v["selectedRoles"] as unknown[]).map(normalizeRoleKey)));
      v["selectedRoles"] = unique.slice(0, MAX_SPECIALISTS);
    }
    if (typeof v["needsCrossReview"] !== "boolean") v["needsCrossReview"] = false;
  }
  const parsed = schemas[type].safeParse(value);
  if (!parsed.success) throw new Error("Agentens svar matchade inte mötesstegets format.");
  return parsed.data;
}

export function compactContext(messages: MeetingMessage[], maxItems = 8): string {
  return messages.slice(-maxItems).map((m) => `${m.role}/${m.message_type}: ${m.content.slice(0, 1600)}`).join("\n");
}

export function meetingPrompt(meeting: MeetingLike, turn: TurnPlan, messages: MeetingMessage[]): string {
  const base = [
    "Internt Noryva Boardroom. REVIEW-only. Inga externa åtgärder, delegationer eller nya möten.",
    `Typ: ${meeting.meeting_type}. Agenda: ${meeting.agenda}`,
  ];
  if (turn.messageType === "kickoff") return [...base, `Välj 2–${meeting.max_specialists} relevanta specialistroller. Kalla inte alla utan skäl.`, `Tillåtna rollnycklar (använd exakt dessa strängar): ${SPECIALIST_AGENTS_V1.join(", ")}.`, 'Svara JSON: {"summary":"kort dekomposition","selectedRoles":["product_tech"],"needsCrossReview":false}'].join("\n");
  const context = compactContext(messages);
  if (turn.messageType === "analysis") return [...base, "Analysera självständigt utifrån din sparade roll.", 'Svara JSON: {"summary":"...","findings":["..."],"recommendations":["..."]}'].join("\n");
  if (turn.messageType === "critique") return [...base, "Kondenserade relevanta bidrag:", context, "Gör en enda konstruktiv cross-review.", 'Svara JSON: {"summary":"...","concerns":["..."],"refinements":["..."]}'].join("\n");
  if (turn.messageType === "qa_review") return [...base, "Kondenserat mötesunderlag:", context, "Gör explicit risk- och kvalitetsgranskning.", 'Svara JSON: {"summary":"...","risks":["..."],"verdict":"pass|concerns|fail","riskLevel":"low|medium|high"}'].join("\n");
  return [...base, "Kondenserat mötesunderlag inklusive QA:", context, "Gör slutsyntes. Föreslå endast nästa steg för mänsklig prövning.", 'Svara JSON: {"summary":"...","recommendation":"...","alternatives":["..."],"expectedEffect":"...","riskLevel":"low|medium|high","estimatedEffort":"...","nextStep":"..."}'].join("\n");
}