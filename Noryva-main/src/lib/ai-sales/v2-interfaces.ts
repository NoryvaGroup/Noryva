/**
 * v2-FÖRBEREDELSER – ENDAST INTERFACES OCH STUBBAR.
 * Ingenting här är kopplat till verklig inkorg, kalender eller CRM.
 * Alla implementationer kastar tills respektive feature flag aktiveras.
 */
import type { AiSalesFlags } from "./flags";

export type ReplyAction = "reply_needed" | "book_meeting" | "handoff_human" | "no_action";

export type IncomingReply = {
  leadId: string;
  customerId: string;
  receivedAt: string;
  /** PII-fri, redan maskerad text. */
  redactedBody: string;
};

export type ReplyClassification = {
  action: ReplyAction;
  reason: string;
  confidence: number;
};

export interface ReplyClassifier {
  classify(reply: IncomingReply): Promise<ReplyClassification>;
}

export type ConversationStage =
  | "new"
  | "draft_ready"
  | "approved"
  | "contacted"
  | "replied"
  | "meeting_booked"
  | "closed";

export type ConversationState = {
  leadId: string;
  customerId: string;
  stage: ConversationStage;
  lastEventAt: string;
  humanOwner: string | null;
};

export interface MeetingBookingAdapter {
  proposeSlots(leadId: string): Promise<string[]>;
  book(leadId: string, isoSlot: string): Promise<{ bookingId: string }>;
}

export interface CrmUpdateAdapter {
  upsertLead(leadId: string, fields: Record<string, unknown>): Promise<void>;
  recordOutcome(leadId: string, outcome: LeadOutcome): Promise<void>;
}

export type LeadOutcome = "contacted" | "replied" | "meeting" | "offert" | "won" | "lost";

export interface AnalyticsFeedbackLoop {
  recordOutcome(leadId: string, outcome: LeadOutcome, at: string): Promise<void>;
}

function notEnabled(name: string): never {
  throw new Error(`${name} är inte aktiverad i den här versionen (v2-stub).`);
}

export function createReplyClassifierStub(flags: AiSalesFlags): ReplyClassifier {
  return {
    async classify() {
      if (!flags.replyAgentEnabled) notEnabled("AI_REPLY_AGENT");
      return notEnabled("AI_REPLY_AGENT");
    },
  };
}

export function createMeetingBookingStub(flags: AiSalesFlags): MeetingBookingAdapter {
  return {
    async proposeSlots() {
      if (!flags.bookingAgentEnabled) notEnabled("AI_BOOKING_AGENT");
      return notEnabled("AI_BOOKING_AGENT");
    },
    async book() {
      return notEnabled("AI_BOOKING_AGENT");
    },
  };
}

export function createCrmAdapterStub(): CrmUpdateAdapter {
  return {
    async upsertLead() {
      return notEnabled("CRM_ADAPTER");
    },
    async recordOutcome() {
      return notEnabled("CRM_ADAPTER");
    },
  };
}
