/**
 * Gemensam orkestrerare för säljåtgärder.
 *
 * Alla åtgärder passerar här innan de "utförs". I den här fasen kan endast
 * mockade kanaler köras: läget valideras, statusen valideras och resultatet
 * beskriver vad som skulle ha hänt.
 */
import type { ActionType, SalesAction } from "./actions";
import { executeActionInTestMode } from "./actions";
import type { AiSalesFlags } from "./flags";
import { assertExecutableMode } from "./execution-mode";
import type { ChannelRegistry, ChannelResult } from "./channels";
import { createMockChannels } from "./channels";

export type OrchestratedOutcome = {
  performed: false;
  mode: "mock";
  actionType: ActionType;
  wouldHaveDone: string;
  externalEffectBlocked: boolean;
  channel: ChannelResult | null;
  at: string;
};

export type OrchestratorInput = Pick<
  SalesAction,
  "actionType" | "status" | "executionMode" | "subject" | "body"
> & {
  /** Internt id/referens – aldrig en e-postadress eller ett telefonnummer. */
  recipientRef?: string;
  meetingMinutes?: number;
  meetingSlot?: string;
};

/** Kör en godkänd åtgärd via mockade kanaler. Ingen extern effekt. */
export async function runAction(
  input: OrchestratorInput,
  flags: AiSalesFlags,
  options: { channels?: ChannelRegistry; now?: Date } = {},
): Promise<OrchestratedOutcome> {
  const now = options.now ?? new Date();
  const channels = options.channels ?? createMockChannels();

  assertExecutableMode(input.executionMode);
  const base = executeActionInTestMode(
    { actionType: input.actionType, status: input.status, executionMode: input.executionMode },
    flags,
    now,
  );

  let channel: ChannelResult | null = null;
  if (input.actionType === "send_email" || input.actionType === "request_information") {
    channel = await channels.email.send(
      {
        recipientRef: input.recipientRef ?? "lead",
        subject: input.subject,
        body: input.body,
      },
      input.executionMode,
      now,
    );
  } else if (input.actionType === "book_meeting") {
    channel = await channels.calendar.book(
      {
        leadRef: input.recipientRef ?? "lead",
        durationMinutes: input.meetingMinutes ?? 30,
        isoSlot: input.meetingSlot ?? now.toISOString(),
      },
      input.executionMode,
      now,
    );
  }

  return {
    performed: false,
    mode: "mock",
    actionType: base.actionType,
    wouldHaveDone: base.wouldHaveDone,
    externalEffectBlocked: base.externalEffectBlocked,
    channel,
    at: base.at,
  };
}
