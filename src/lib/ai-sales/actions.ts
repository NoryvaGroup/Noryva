/**
 * Säljåtgärder: typer, statusmaskin, idempotens och säkra TEST-utförare.
 *
 * SÄKERHET: ingen funktion här får någonsin göra ett externt anrop.
 * Alla "executors" är no-op/test och registrerar bara vad som SKULLE ha skett.
 */
import { z } from "zod";
import type { AiSalesFlags } from "./flags";

export const actionTypeSchema = z.enum([
  "send_email",
  "schedule_followup",
  "request_information",
  "handoff_to_human",
  "update_crm",
  "book_meeting",
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const actionStatusSchema = z.enum([
  "draft",
  "review",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
]);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  send_email: "Skicka mail",
  schedule_followup: "Planera uppföljning",
  request_information: "Be om komplettering",
  handoff_to_human: "Överlämna till människa",
  update_crm: "Uppdatera CRM",
  book_meeting: "Boka möte",
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  draft: "Utkast",
  review: "Granskas",
  approved: "Godkänd",
  rejected: "Avvisad",
  executed: "Utförd (test)",
  failed: "Misslyckad",
  cancelled: "Avbruten",
};

/** Åtgärder som skulle ha extern effekt om de kördes skarpt. */
export const EXTERNAL_EFFECT_ACTIONS: ActionType[] = [
  "send_email",
  "book_meeting",
  "update_crm",
  "request_information",
];

/** Tillåtna statusövergångar. Allt annat avvisas. */
const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  draft: ["review", "approved", "rejected", "cancelled"],
  review: ["approved", "rejected", "cancelled"],
  approved: ["executed", "failed", "cancelled"],
  rejected: ["draft", "cancelled"],
  executed: [],
  failed: ["approved", "cancelled"],
  cancelled: [],
};

export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: ActionStatus, to: ActionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Ogiltig statusövergång: ${ACTION_STATUS_LABEL[from]} → ${ACTION_STATUS_LABEL[to]}.`,
    );
  }
}

/**
 * Idempotensnyckel: samma lead + åtgärdstyp + logiskt försök ger samma nyckel,
 * så en åtgärd aldrig kan skapas eller utföras dubbelt.
 */
export function buildActionKey(input: {
  leadId: string;
  actionType: ActionType;
  attempt?: string;
}): string {
  const attempt = (input.attempt ?? "1").trim() || "1";
  return `${input.leadId}:${input.actionType}:${attempt}`;
}

export type SalesAction = {
  id?: string;
  leadId: string;
  customerId: string;
  runId?: string | null;
  actionType: ActionType;
  status: ActionStatus;
  humanTakeover: boolean;
  subject: string;
  body: string;
  followupQuestions: string[];
  strategyReason: string;
  params: Record<string, unknown>;
  scheduledFor?: string | null;
  idempotencyKey: string;
  executionMode: "test" | "live";
  executionResult: Record<string, unknown>;
  executedAt?: string | null;
};

export type ExecutionOutcome = {
  performed: false;
  mode: "test";
  actionType: ActionType;
  wouldHaveDone: string;
  externalEffectBlocked: boolean;
  at: string;
};

/**
 * Kör en godkänd åtgärd i TEST-läge. Inget lämnar systemet.
 * Kastar om något försöker köra skarpt innan v2 är godkänt.
 */
export function executeActionInTestMode(
  action: Pick<SalesAction, "actionType" | "status" | "executionMode">,
  flags: AiSalesFlags,
  now: Date = new Date(),
): ExecutionOutcome {
  if (action.status !== "approved") {
    throw new Error("Endast godkända åtgärder kan utföras.");
  }
  if (action.executionMode === "live" || flags.autoSend) {
    throw new Error("Skarpt läge är avstängt i den här versionen.");
  }

  const description: Record<ActionType, string> = {
    send_email: "Mailutkastet skulle ha skickats till leadets e-postadress.",
    schedule_followup: "En uppföljning skulle ha lagts i kön.",
    request_information: "En kompletteringsfråga skulle ha skickats till leadet.",
    handoff_to_human: "Leadet skulle ha tilldelats en människa internt.",
    update_crm: "CRM-posten skulle ha uppdaterats.",
    book_meeting: "Ett mötesförslag skulle ha skickats/bokats.",
  };

  return {
    performed: false,
    mode: "test",
    actionType: action.actionType,
    wouldHaveDone: description[action.actionType],
    externalEffectBlocked: EXTERNAL_EFFECT_ACTIONS.includes(action.actionType),
    at: now.toISOString(),
  };
}

/** Beräknar när första uppföljningen bör ske, utifrån kundens regler. */
export function followupAt(
  priority: "HÖG" | "NORMAL" | "LÅG",
  hoursByPriority: { HÖG: number; NORMAL: number; LÅG: number },
  from: Date = new Date(),
): string {
  const hours = hoursByPriority[priority];
  return new Date(from.getTime() + hours * 3600_000).toISOString();
}
