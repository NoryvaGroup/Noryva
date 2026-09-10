/**
 * Förberedelse för svarshantering (fas 2). Deterministisk intent-klassificering
 * med tydliga eskaleringsregler. Ingen inboxkoppling finns i den här fasen.
 */
import { z } from "zod";

export const replyIntentSchema = z.enum([
  "intresserad",
  "vill_boka",
  "pris_offert",
  "forhandling",
  "invandning",
  "klagomal",
  "juridik",
  "avbojer",
  "ovrigt",
]);
export type ReplyIntent = z.infer<typeof replyIntentSchema>;

export type ReplyClassification = {
  intent: ReplyIntent;
  escalate: boolean;
  escalationReason: string;
  suggestedAction:
    | "send_email"
    | "schedule_followup"
    | "request_information"
    | "handoff_to_human"
    | "book_meeting";
  confidence: number;
  /** Sätts endast av den semantiska serverbedömningen av det aktuella svaret. */
  positivePurchaseIntent?: boolean;
  /** Sätts endast när aktuell text uttryckligen vill boka/gå vidare via möte. */
  explicitMeetingIntent?: boolean;
};

/** Intents som ALLTID går till människa – AI får aldrig svara själv. */
export const ESCALATION_INTENTS: ReplyIntent[] = [
  "pris_offert",
  "forhandling",
  "klagomal",
  "juridik",
];

const PATTERNS: Array<{ intent: ReplyIntent; terms: string[] }> = [
  { intent: "juridik", terms: ["jurist", "advokat", "gdpr", "avtalsbrott", "stämning", "rättslig", "polisanmäl"] },
  { intent: "klagomal", terms: ["klagomål", "missnöjd", "besviken", "reklamation", "dåligt bemötande"] },
  { intent: "forhandling", terms: ["rabatt", "förhandla", "billigare", "matcha priset", "prispress"] },
  { intent: "pris_offert", terms: ["pris", "kostar", "kostnad", "offert", "vad blir det för"] },
  { intent: "vill_boka", terms: ["boka", "möte", "träffas", "ring mig", "samtal"] },
  { intent: "avbojer", terms: ["inte intresserad", "nej tack", "avregistrera", "sluta kontakta"] },
  { intent: "invandning", terms: ["men ", "osäker", "vet inte", "har redan", "tveksam"] },
  { intent: "intresserad", terms: ["intresserad", "låter bra", "gärna", "berätta mer"] },
];

export function classifyReplyDeterministic(redactedBody: string): ReplyClassification {
  const text = (redactedBody ?? "").toLowerCase();

  const match = PATTERNS.find((p) => p.terms.some((t) => text.includes(t)));
  const intent: ReplyIntent = match?.intent ?? "ovrigt";
  const escalate = ESCALATION_INTENTS.includes(intent);

  const suggestedAction: ReplyClassification["suggestedAction"] = escalate
    ? "handoff_to_human"
    : intent === "vill_boka"
      ? "book_meeting"
      : intent === "invandning"
        ? "request_information"
        : intent === "avbojer"
          ? "handoff_to_human"
          : intent === "intresserad"
            ? "send_email"
            : "schedule_followup";

  return {
    intent,
    escalate,
    escalationReason: escalate
      ? "Pris, förhandling, klagomål och juridik hanteras alltid av en människa."
      : "",
    suggestedAction,
    confidence: match ? 0.7 : 0.3,
  };
}

/** Konversationens tillstånd, sparas i fas 2. */
export const conversationStageSchema = z.enum([
  "new",
  "draft_ready",
  "approved",
  "contacted",
  "replied",
  "meeting_booked",
  "closed",
]);
export type ConversationStage = z.infer<typeof conversationStageSchema>;

export type IncomingReplyDraft = {
  leadId: string;
  customerId: string;
  receivedAt: string;
  /** Redan PII-maskerad text. Rådata får aldrig lagras här. */
  redactedBody: string;
};
