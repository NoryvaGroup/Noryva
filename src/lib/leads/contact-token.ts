/**
 * Capability-token för kundens "Markera som kontaktad"-länk.
 *
 * Rent, testbart lager utan sidoeffekter. Token signeras server-side med
 * NORYVA_LEAD_ACTION_SECRET och gäller ETT specifikt lead under en begränsad
 * tid. Ingen inloggning krävs, men token går inte att förfalska och kan inte
 * återanvändas för ett annat lead.
 *
 * Format: `${expUnixSeconds}.${hexHmacSha256}`
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Standardgiltighet: 30 dagar. */
export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Publik bas-URL för kundlänkar. Pekar alltid på Noryva, aldrig på Make. */
export const PUBLIC_SITE_URL = "https://noryva.se";

/** Sökvägen som kundlänken pekar på. */
export const CONTACT_ACTION_PATH = "/lead/kontaktad";

const PURPOSE = "lead-contacted";

function sign(secret: string, leadId: string, exp: number): string {
  return createHmac("sha256", secret).update(`${PURPOSE}.${leadId}.${exp}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createContactToken(args: {
  secret: string;
  leadId: string;
  now?: Date;
  ttlSeconds?: number;
}): string {
  const now = args.now ?? new Date();
  const ttl = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const exp = Math.floor(now.getTime() / 1000) + ttl;
  return `${exp}.${sign(args.secret, args.leadId, exp)}`;
}

export type TokenCheck = { valid: boolean; reason: string };

export function verifyContactToken(args: {
  secret: string | undefined;
  leadId: string;
  token: string;
  now?: Date;
}): TokenCheck {
  if (!args.secret) return { valid: false, reason: "Länken kan inte kontrolleras just nu." };
  if (!args.leadId || !args.token) return { valid: false, reason: "Länken är ofullständig." };

  const [expRaw, signature] = args.token.split(".");
  const exp = Number(expRaw);
  if (!expRaw || !signature || !Number.isFinite(exp)) {
    return { valid: false, reason: "Länken är ogiltig." };
  }

  const expected = sign(args.secret, args.leadId, exp);
  if (!safeEqual(signature, expected)) return { valid: false, reason: "Länken är ogiltig." };

  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000);
  if (nowSeconds > exp) return { valid: false, reason: "Länken har gått ut." };

  return { valid: true, reason: "" };
}

/** Bygger den publika länk som skickas med i lead-mailet. */
export function buildContactUrl(args: {
  secret: string;
  leadId: string;
  now?: Date;
  ttlSeconds?: number;
  baseUrl?: string;
}): string {
  const token = createContactToken(args);
  const base = (args.baseUrl ?? PUBLIC_SITE_URL).replace(/\/+$/, "");
  return `${base}${CONTACT_ACTION_PATH}?lead=${encodeURIComponent(args.leadId)}&t=${encodeURIComponent(token)}`;
}
