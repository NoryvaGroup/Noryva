/**
 * Granskningsregister för uppföljningsutskick – RENA FUNKTIONER.
 *
 * Modulen avgör vad som får godkännas och skickas. Den skickar aldrig något
 * själv och läser aldrig databasen. All spärrlogik ligger här så att den kan
 * köras identiskt vid tre tillfällen: när posten skapas, när en administratör
 * godkänner och när Make hämtar posten för utskick.
 */

/** Svarsadress för alla uppföljningsmail. Aldrig klientstyrd. */
export const NURTURE_REPLY_TO = "info@noryva.se";

/**
 * Mottagare som får passera även när externa utskick är avstängda.
 * Adressen måste vara den FAKTISKT lagrade mottagaren – ingen override.
 */
export const NURTURE_TEST_RECIPIENTS = ["info@noryva.se"];

export type NurtureReviewStatus =
  | "pending_review"
  | "blocked"
  | "approved"
  | "claimed"
  | "sent"
  | "failed"
  | "unknown"
  | "cancelled";

/**
 * Stabil, icke-kryptografisk hash. Används ENDAST för idempotensnycklar
 * (source_ref), aldrig för avtryck som avgör om ett utskick får godkännas.
 */
export function stableHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Kryptografiskt avtryck (SHA-256, hex). Kollisionssäkert underlag. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}


const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}

/** Unik nyckel per uppföljningstillfälle: steg + planerad tidpunkt. */
export function occurrenceKey(stepIndex: number, dueAt: string): string {
  return `${Math.max(0, Math.trunc(stepIndex))}:${dueAt}`;
}

export type FingerprintInput = {
  leadId: string;
  customerId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  questions: string[];
  dueAt: string;
};

/**
 * Avtryck av exakt det innehåll en administratör ser. Kryptografiskt (SHA-256)
 * över kanoniserad data. Ändras underlaget måste posten granskas på nytt –
 * ett gammalt godkännande kan aldrig återanvändas.
 */
export async function reviewFingerprint(input: FingerprintInput): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      v: 2,
      leadId: input.leadId,
      customerId: input.customerId,
      recipientEmail: normalizeEmail(input.recipientEmail),
      subject: input.subject,
      body: input.body,
      questions: input.questions ?? [],
      dueAt: input.dueAt,
    }),
  );
}

export type SourceFingerprintInput = {
  intentLevel: string;
  intentScore: number;
  intentTerminal: boolean;
  nurtureStatus: string;
  stepsTaken: number;
  humanTakeover: boolean;
  lastReplyIntent: string;
  executionMode: string;
  customerStatus: string;
  /** Kanoniserad lagrad lead-payload. */
  leadPayload: unknown;
  /** Kundprofilens beslutspåverkande delar. */
  profile: unknown;
  /** Registrerade utfall, i stabil ordning. */
  outcomes: string[];
  conversationHumanOwner: string;
};

/**
 * Avtryck av HELA det underlag posten byggdes av: payload, profil, utfall,
 * intent, konversationsägare. Kryptografiskt, så en ändring aldrig kan
 * kollidera bort.
 */
export async function sourceFingerprint(input: SourceFingerprintInput): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      v: 2,
      intentLevel: input.intentLevel,
      intentScore: input.intentScore,
      intentTerminal: input.intentTerminal,
      nurtureStatus: input.nurtureStatus,
      stepsTaken: input.stepsTaken,
      humanTakeover: input.humanTakeover,
      lastReplyIntent: input.lastReplyIntent,
      executionMode: input.executionMode,
      customerStatus: input.customerStatus,
      leadPayload: input.leadPayload ?? null,
      profile: input.profile ?? null,
      outcomes: [...(input.outcomes ?? [])].sort(),
      conversationHumanOwner: input.conversationHumanOwner,
    }),
  );
}

/** Intent-nivåer som över huvud taget får hamna i granskningskön. */
export const ALLOWED_REVIEW_INTENT_LEVELS = ["LÅG", "NORMAL"];

export type ReviewGateInput = {
  intentLevel: string;
  /** Utfallet är avgjort (won/lost). */
  terminal: boolean;
  /** Policy-/profilbaserad eskalering. */
  humanTakeover: boolean;
  /** Konversationen har en utsedd mänsklig ägare. */
  conversationHumanOwner?: string | null;
  optedOut?: boolean;
  nurtureStatus: string;
  customerStatus: string;
  recipientEmail: string;
  hasPreview: boolean;
  executionMode: string;
  /** Planerat tillfälle. Saknas eller ligger i framtiden = inte godkännbart. */
  dueAt?: string | null;
  now?: Date;
};

/** Tom sträng = inget hinder. Annars en läsbar spärrorsak på svenska. */
export function evaluateReviewGate(input: ReviewGateInput): string {
  const level = (input.intentLevel ?? "").trim().toUpperCase();
  // Allowlist: bara LÅG och NORMAL passerar. Okänd eller saknad nivå spärrar.
  if (!ALLOWED_REVIEW_INTENT_LEVELS.includes(level)) {
    return level === ""
      ? "Intent saknas för förfrågan – kör om analysen innan uppföljning."
      : `Intent ${level} hanteras personligen – inget automatiskt utskick.`;
  }
  if (input.terminal) return "Utfallet är avgjort – ingen uppföljning skickas.";
  if (input.humanTakeover) return "Kräver mänsklig handläggning (pris, avtal eller känslig fråga).";
  if ((input.conversationHumanOwner ?? "") !== "") {
    return "Konversationen har en mänsklig ägare – uppföljningen hanteras manuellt.";
  }
  if (input.optedOut) return "Leadet har tackat nej – ingen vidare uppföljning.";
  if (input.nurtureStatus === "cancelled") return "Uppföljningen är avslutad.";
  if (input.nurtureStatus === "replied") return "Leadet har svarat – hanteras i konversationen.";
  if (input.customerStatus !== "published") return "Kunden är inte aktiv.";
  if (!isValidEmail(input.recipientEmail)) return "Ingen giltig mottagaradress finns på förfrågan.";
  if (!input.hasPreview) return "Inget utkast kunde byggas för förfrågan.";
  if (input.executionMode !== "test" && input.executionMode !== "review") {
    return "Ogiltigt körläge – endast test och granskning tillåts.";
  }
  if (input.dueAt !== undefined) {
    const due = input.dueAt ? Date.parse(input.dueAt) : NaN;
    if (!Number.isFinite(due)) return "Inget uppföljningstillfälle är planerat.";
    if (due > (input.now ?? new Date()).getTime()) {
      return "Uppföljningstillfället har inte inträffat än.";
    }
  }
  return "";
}


/** Läser en boolesk flagga. Saknad eller okänd flagga betyder alltid AV. */
export function readBooleanFlag(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

export type ExternalSendDecision = { allowed: boolean; reason: string };

/**
 * Externa utskick är avstängda som standard. Undantaget gäller endast när den
 * FAKTISKT lagrade mottagaren är en av Noryvas egna testadresser.
 */
export function externalSendDecision(input: {
  enabled: boolean;
  storedRecipient: string;
}): ExternalSendDecision {
  const recipient = normalizeEmail(input.storedRecipient);
  if (input.enabled) return { allowed: true, reason: "" };
  if (NURTURE_TEST_RECIPIENTS.includes(recipient)) {
    return { allowed: true, reason: "Testmottagare tillåten." };
  }
  return {
    allowed: false,
    reason: "Externa utskick är avstängda (NORYVA_NURTURE_EXTERNAL_SEND_ENABLED).",
  };
}
