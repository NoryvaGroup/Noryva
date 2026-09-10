/**
 * Utskickskontrakt för granskade uppföljningar – RENA FUNKTIONER.
 *
 * SÄKERHET: modulen avgör om ett godkänt utkast över huvud taget FÅR lämnas ut
 * för utskick. Den läser aldrig databasen, skickar aldrig något och har inga
 * fallbacks: saknas något stoppas utskicket.
 *
 * Tre hårda krav:
 *  1. Kunden härleds ur granskningsposten OCH förfrågan – de måste vara samma.
 *  2. Mottagaren måste vara exakt den adress som ligger lagrad på förfrågan.
 *     Aldrig info@noryva.se, aldrig en annan kunds adress.
 *  3. Kundens mailidentitet måste vara verifierad med avsändaradress,
 *     svarsadress och anslutningsalias.
 */
import { evaluateOutboundIdentity, type MailChannel } from "./mail-channel";
import { normalizeEmail } from "./nurture-review";

export type SendContractCode =
  | "ok"
  | "customer_mismatch"
  | "recipient_missing"
  | "recipient_mismatch"
  | "mail_identity_unverified";

export type SendContractResult = {
  ok: boolean;
  code: SendContractCode;
  /** Läsbar spärrorsak på svenska. Tom sträng när kontraktet håller. */
  reason: string;
};

export type SendContractInput = {
  /** Kund enligt granskningsposten. */
  reviewCustomerId: string;
  /** Kund enligt den verkliga förfrågan (leads.customer_id). */
  leadCustomerId: string;
  /** Mottagare enligt granskningsposten. */
  reviewRecipient: string;
  /** Mottagare härledd ur den lagrade lead-payloaden. */
  storedLeadRecipient: string;
  /** Kundens mailidentitet (metadata, aldrig credentials). */
  mailChannel: MailChannel;
};

/** Fail closed: allt utom ett fullständigt uppfyllt kontrakt spärrar utskicket. */
export function evaluateSendContract(input: SendContractInput): SendContractResult {
  const reviewCustomer = (input.reviewCustomerId ?? "").trim();
  const leadCustomer = (input.leadCustomerId ?? "").trim();
  if (!reviewCustomer || !leadCustomer || reviewCustomer !== leadCustomer) {
    return {
      ok: false,
      code: "customer_mismatch",
      reason: "Kundbindningen stämmer inte mellan förfrågan och granskningsposten.",
    };
  }

  const stored = normalizeEmail(input.storedLeadRecipient);
  const review = normalizeEmail(input.reviewRecipient);
  if (!stored || !review) {
    return {
      ok: false,
      code: "recipient_missing",
      reason: "Ingen lagrad mottagaradress finns på förfrågan.",
    };
  }
  if (stored !== review) {
    return {
      ok: false,
      code: "recipient_mismatch",
      reason: "Mottagaren matchar inte den adress som ligger lagrad på förfrågan.",
    };
  }

  const identity = evaluateOutboundIdentity(input.mailChannel);
  if (!identity.allowed) {
    return { ok: false, code: "mail_identity_unverified", reason: identity.reason };
  }
  if (!input.mailChannel.connectionAlias) {
    return {
      ok: false,
      code: "mail_identity_unverified",
      reason: "Mailidentitetens anslutning saknas.",
    };
  }

  return { ok: true, code: "ok", reason: "" };
}

/** Manuella avstämningslägen. Inget läge tillåter automatiskt omförsök. */
export const RECONCILE_OUTCOMES = ["SENT", "NOT_SENT", "UNKNOWN"] as const;
export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

export type ReconcileGate =
  | { ok: true; outcome: ReconcileOutcome }
  | { ok: false; code: string; reason: string };

/**
 * Prövar en manuell avstämning innan databasen rörs.
 * SENT kräver transportens meddelande-id – annars kan utskicket inte styrkas.
 */
export function evaluateReconcileRequest(input: {
  reviewStatus: string;
  outcome: string;
  transportMessageId?: string | undefined;
}): ReconcileGate {
  const outcome = (input.outcome ?? "").trim().toUpperCase() as ReconcileOutcome;
  if (!RECONCILE_OUTCOMES.includes(outcome)) {
    return { ok: false, code: "invalid_outcome", reason: "Ogiltigt avstämningsläge." };
  }
  if (!["claimed", "unknown"].includes(input.reviewStatus)) {
    return {
      ok: false,
      code: "invalid_status",
      reason: `Posten kan inte stämmas av i status ${input.reviewStatus}.`,
    };
  }
  if (outcome === "SENT" && !(input.transportMessageId ?? "").trim()) {
    return {
      ok: false,
      code: "missing_message_id",
      reason: "Ett bekräftat utskick kräver transportens meddelande-id.",
    };
  }
  return { ok: true, outcome };
}
