/**
 * Maskering av inkommande svar. Ren funktion, testbar utan server.
 * Rå text får aldrig lagras eller skickas till modellen.
 */
import { readStoredPayload } from "../landing/make-adapter";
import { collectKnownPii, redactText, stripKnownPii } from "./context";

export function redactReplyBody(body: string, payload: unknown): string {
  const stored = readStoredPayload(payload);
  const known = collectKnownPii(
    stored.answers ?? {},
    (stored.make ?? null) as Record<string, unknown> | null,
  );
  return redactText(stripKnownPii(body, known));
}
