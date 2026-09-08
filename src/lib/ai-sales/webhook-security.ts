/**
 * Säkerhetslager för framtida inkommande callbacks (svar, bokningar, CRM).
 * Ingen route är kopplad ännu – det här är ren, testbar logik som en framtida
 * endpoint måste använda innan någon nyttolast får behandlas.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type SignatureCheck = {
  valid: boolean;
  reason: string;
};

export interface WebhookVerifier {
  readonly source: string;
  verify(rawBody: string, headers: Record<string, string | undefined>, now?: Date): SignatureCheck;
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Beräknar HMAC-SHA256 över `${timestamp}.${body}` – standardformat. */
export function computeSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type HmacVerifierOptions = {
  source: string;
  secret: string;
  signatureHeader?: string;
  timestampHeader?: string;
  /** Maximal ålder i sekunder innan anropet räknas som replay. */
  toleranceSeconds?: number;
};

export function createHmacVerifier(options: HmacVerifierOptions): WebhookVerifier {
  const signatureHeader = options.signatureHeader ?? "x-signature";
  const timestampHeader = options.timestampHeader ?? "x-timestamp";
  const tolerance = options.toleranceSeconds ?? 300;

  return {
    source: options.source,
    verify(rawBody, headers, now = new Date()) {
      if (!options.secret) return { valid: false, reason: "Hemlighet saknas." };
      const signature = headers[signatureHeader];
      const timestamp = headers[timestampHeader];
      if (!signature || !timestamp) return { valid: false, reason: "Signatur eller tidsstämpel saknas." };

      const ts = Number(timestamp);
      if (!Number.isFinite(ts)) return { valid: false, reason: "Ogiltig tidsstämpel." };
      const ageSeconds = Math.abs(now.getTime() / 1000 - ts);
      if (ageSeconds > tolerance) return { valid: false, reason: "Anropet är för gammalt (replay)." };

      const expected = computeSignature(options.secret, timestamp, rawBody);
      if (!safeEqualHex(signature, expected)) return { valid: false, reason: "Signaturen stämmer inte." };
      return { valid: true, reason: "" };
    },
  };
}

/** Nyckel som gör att samma callback aldrig kan behandlas två gånger. */
export function buildInboundEventKey(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

export type ReplayDecision = {
  accept: boolean;
  duplicate: boolean;
  reason: string;
};

/**
 * Beslutar om ett verifierat anrop får behandlas. `seen` är resultatet av
 * uppslaget i inbound_webhook_events.
 */
export function decideInbound(check: SignatureCheck, seen: boolean): ReplayDecision {
  if (!check.valid) return { accept: false, duplicate: false, reason: check.reason };
  if (seen) return { accept: false, duplicate: true, reason: "Anropet har redan behandlats." };
  return { accept: true, duplicate: false, reason: "" };
}
