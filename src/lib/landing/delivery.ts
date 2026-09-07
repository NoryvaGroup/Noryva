import { buildMakeFields, readStoredPayload, type MakeLeadFields } from "./make-adapter";
import type { PublicQuestion } from "./schema";

export type DeliveryStatus = "delivered" | "sending" | "failed";

export type SubmitResult =
  | { ok: true; duplicate: boolean; delivered: boolean; status: DeliveryStatus }
  | { ok: false; message: string; errors?: Record<string, string> };

/**
 * Ren tolkning av resultatet från claim_lead_delivery.
 * Endast ett verkligt "delivered" får rapporteras som levererat.
 */
export function resolveClaim(input: {
  claim: string | null | undefined;
  claimError: boolean;
  existing: boolean;
}): SubmitResult | "proceed" {
  const { claim, claimError, existing } = input;

  // Vi vet inte om leveransen skett – förfrågan är sparad men inte bekräftad.
  if (claimError) return { ok: true, duplicate: existing, delivered: false, status: "failed" };

  if (claim === "delivered") return { ok: true, duplicate: true, delivered: true, status: "delivered" };
  if (claim === "missing") return { ok: false, message: "Förfrågan kunde inte hittas. Försök igen." };
  if (claim === "claimed") return "proceed";

  // "sending" eller okänt svar: ett parallellt försök pågår, inget bekräftat.
  return { ok: true, duplicate: true, delivered: false, status: "sending" };
}

/**
 * Väljer vilka Make-fält som ska levereras. Nya leads har både råsvar och
 * normaliserade fält sparade; äldre leads har bara platta Make-fält.
 */
export function pickDeliveryFields(input: {
  storedPayload: unknown;
  industry: string;
  questions: PublicQuestion[];
  fallback: MakeLeadFields;
}): MakeLeadFields {
  const stored = readStoredPayload(input.storedPayload);
  if (stored.answers) {
    return buildMakeFields({
      industry: input.industry,
      questions: input.questions,
      values: stored.answers,
    });
  }
  return stored.make ?? input.fallback;
}
