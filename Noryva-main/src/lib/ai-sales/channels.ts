/**
 * Kanaladaptrar: e-post, inkorg för svar och kalender/bokning.
 *
 * SÄKERHET: samtliga implementationer här är mockar. Ingen av dem gör ett
 * nätverksanrop – de registrerar bara vad som SKULLE ha skett. Riktiga
 * adaptrar tillkommer först när live-läget öppnas i en senare fas.
 */
import { assertExecutableMode } from "./execution-mode";

export type ChannelKind = "email" | "inbox" | "calendar";

export type ChannelResult = {
  performed: false;
  mode: "mock";
  channel: ChannelKind;
  operation: string;
  wouldHaveDone: string;
  at: string;
};

export type EmailDraft = {
  /** Mottagaren refereras med ett internt id, aldrig med e-postadress. */
  recipientRef: string;
  subject: string;
  body: string;
};

export interface EmailChannel {
  readonly kind: "email";
  send(draft: EmailDraft, mode: string, now?: Date): Promise<ChannelResult>;
}

export type InboxMessage = {
  externalId: string;
  /** Redan PII-maskerad text. Rådata får aldrig passera här. */
  redactedBody: string;
  receivedAt: string;
};

export interface ReplyInboxChannel {
  readonly kind: "inbox";
  /** Mockad hämtning: returnerar alltid tom lista, ingen inkorg är kopplad. */
  poll(mode: string): Promise<InboxMessage[]>;
  acknowledge(externalId: string, mode: string, now?: Date): Promise<ChannelResult>;
}

export type MeetingRequest = {
  leadRef: string;
  durationMinutes: number;
  isoSlot: string;
};

export interface CalendarChannel {
  readonly kind: "calendar";
  proposeSlots(leadRef: string, mode: string, now?: Date): Promise<string[]>;
  book(request: MeetingRequest, mode: string, now?: Date): Promise<ChannelResult>;
}

function result(
  channel: ChannelKind,
  operation: string,
  wouldHaveDone: string,
  now: Date,
): ChannelResult {
  return {
    performed: false,
    mode: "mock",
    channel,
    operation,
    wouldHaveDone,
    at: now.toISOString(),
  };
}

export function createMockEmailChannel(): EmailChannel {
  return {
    kind: "email",
    async send(draft, mode, now = new Date()) {
      assertExecutableMode(mode);
      return result(
        "email",
        "send",
        `Ett mail med ämnet "${draft.subject.slice(0, 80)}" (${draft.body.length} tecken) skulle ha skickats till ${draft.recipientRef}.`,
        now,
      );
    },
  };
}

export function createMockReplyInbox(): ReplyInboxChannel {
  return {
    kind: "inbox",
    async poll(mode) {
      assertExecutableMode(mode);
      // Ingen inkorg är kopplad: svar matas in manuellt i adminvyn.
      return [];
    },
    async acknowledge(externalId, mode, now = new Date()) {
      assertExecutableMode(mode);
      return result("inbox", "acknowledge", `Svaret ${externalId} skulle ha kvitterats.`, now);
    },
  };
}

export function createMockCalendarChannel(): CalendarChannel {
  return {
    kind: "calendar",
    async proposeSlots(_leadRef, mode) {
      assertExecutableMode(mode);
      // Deterministiska mocktider, ingen kalender läses.
      return [];
    },
    async book(request, mode, now = new Date()) {
      assertExecutableMode(mode);
      return result(
        "calendar",
        "book",
        `Ett möte på ${request.durationMinutes} minuter (${request.isoSlot}) skulle ha bokats för ${request.leadRef}.`,
        now,
      );
    },
  };
}

export type ChannelRegistry = {
  email: EmailChannel;
  inbox: ReplyInboxChannel;
  calendar: CalendarChannel;
};

/** Standardregistret i den här fasen: enbart mockar. */
export function createMockChannels(): ChannelRegistry {
  return {
    email: createMockEmailChannel(),
    inbox: createMockReplyInbox(),
    calendar: createMockCalendarChannel(),
  };
}
