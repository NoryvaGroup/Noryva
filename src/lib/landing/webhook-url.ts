/**
 * Säkerhetskontroll av kundens leveransadress (webhook).
 *
 * Adressen sätts manuellt av administratör i databasen och anropas server-side.
 * Kontrollen är defense-in-depth mot SSRF: endast externa https-adresser
 * tillåts, aldrig interna/privata nät.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "[::1]", "::1", "metadata.google.internal"]);

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isSafeDeliveryUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (isPrivateIpv4(host)) return false;
  // IPv6-literaler tillåts inte alls – kundwebhookar använder alltid DNS-namn.
  if (host.includes(":")) return false;
  return true;
}
