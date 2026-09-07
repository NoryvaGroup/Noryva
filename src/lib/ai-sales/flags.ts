/**
 * Centrala funktionsflaggor / kill switches för AI-säljassistenten.
 *
 * SÄKERHETSPRINCIP: allt riskfyllt är AV som standard. Saknad env-variabel
 * ger alltid `false` för riskfyllda flaggor, och AUTO_SEND kan aldrig bli
 * sant via en default – den kräver ett explicit "true" i miljön OCH att
 * review-kravet uttryckligen stängts av.
 */
export type AiSalesFlags = {
  /** Får AI-säljassistenten köras alls (endast interna utkast). */
  enabled: boolean;
  /** Får utkast skickas automatiskt? Ska vara false i v1. */
  autoSend: boolean;
  /** Kräver mänskligt godkännande innan något kan markeras som skickat. */
  reviewRequired: boolean;
  /** v2-stub: AI som klassificerar inkommande svar. */
  replyAgentEnabled: boolean;
  /** v2-stub: AI som bokar möten. */
  bookingAgentEnabled: boolean;
};

export type FlagEnv = Record<string, string | undefined>;

/** Strikt tolkning: endast exakt "true" räknas som sant. */
function isTrue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

/** Review krävs som standard: endast exakt "false" stänger av kravet. */
function isFalse(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "false";
}

export function readAiSalesFlags(env: FlagEnv = {}): AiSalesFlags {
  const reviewRequired = !isFalse(env["AI_SALES_ASSISTANT_REVIEW_REQUIRED"]);
  const autoSendRequested = isTrue(env["AI_SALES_ASSISTANT_AUTO_SEND"]);

  return {
    enabled: isTrue(env["AI_SALES_ASSISTANT_ENABLED"]),
    // Dubbel spärr: auto-send kräver explicit true OCH att review-kravet är avstängt.
    autoSend: autoSendRequested && !reviewRequired,
    reviewRequired,
    replyAgentEnabled: isTrue(env["AI_REPLY_AGENT_ENABLED"]),
    bookingAgentEnabled: isTrue(env["AI_BOOKING_AGENT_ENABLED"]),
  };
}

/** Läser flaggorna från processmiljön (endast serverkod). */
export function serverAiSalesFlags(): AiSalesFlags {
  return readAiSalesFlags(typeof process !== "undefined" ? process.env : {});
}

/**
 * v1-invariant: ingen extern kommunikation får ske från den här kodbasen.
 * Anropas innan varje tänkbar utskicksväg som skydd mot framtida misstag.
 */
export const V1_EXTERNAL_SEND_ALLOWED = false;

export function assertNoExternalSend(flags: AiSalesFlags): void {
  if (V1_EXTERNAL_SEND_ALLOWED === false && flags.autoSend) {
    throw new Error("Auto-send är blockerat i v1: extern kommunikation är avstängd i kod.");
  }
}
