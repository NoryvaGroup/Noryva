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

/** Stabil, icke-kryptografisk hash för idempotens- och avtrycksnycklar. */
export function stableHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
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
 * Avtryck av exakt det innehåll en administratör ser. Ändras underlaget måste
 * posten granskas på nytt – ett gammalt godkännande kan aldrig återanvändas.
 */
export function reviewFingerprint(input: FingerprintInput): string {
  const parts = [
    input.leadId,
    input.customerId,
    normalizeEmail(input.recipientEmail),
    input.subject,
    input.body,
    (input.questions ?? []).join("|"),
    input.dueAt,
  ].join("\u0000");
  return stableHash(parts);
}

/** Avtryck av det underlag posten byggdes av (profil, kund, intent, utfall). */
export function sourceFingerprint(input: {
  intentLevel: string;
  intentScore: number;
  nurtureStatus: string;
  stepsTaken: number;
  executionMode: string;
  customerStatus: string;
}): string {
  return stableHash(
    [
      input.intentLevel,
      String(input.intentScore),
      input.nurtureStatus,
      String(input.stepsTaken),
      input.executionMode,
      input.customerStatus,
    ].join("\u0000"),
  );
}

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
};

/** Tom sträng = inget hinder. Annars en läsbar spärrorsak på svenska. */
export function evaluateReviewGate(input: ReviewGateInput): string {
  const level = (input.intentLevel ?? "").toUpperCase();
  if (level === "HÖG" || level === "AKUT") {
    return `Intent ${level} hanteras personligen – inget automatiskt utskick.`;
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
