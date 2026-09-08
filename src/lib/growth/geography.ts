/**
 * Geografibedömning (serverside).
 *
 * PRIVACY: exakt postnummer används ENDAST här, på servern, för att räkna ut
 * ett verdict. Postnumret får aldrig läggas i modellkontexten eller i det
 * normaliserade API-svaret – bara verdict och konfigurerat område.
 *
 * Matchning sker alltid med `startsWith` mot ett konfigurerat prefix, aldrig
 * med `includes`, så att t.ex. 41876 inte kan matcha prefixet "50".
 */
export type GeographyVerdict = "local" | "regional" | "outside" | "unknown" | "not_configured";

export type GeographyConfig = {
  serviceArea: string;
  localPostalPrefix: string;
  regionalPostalPrefix: string;
};

export type GeographyResult = {
  verdict: GeographyVerdict;
  /** Poäng enligt Make-migrationens kontrakt: lokal 20, regional 10, annars 0. */
  points: number;
  serviceArea: string;
  configured: boolean;
  /** Prefixet som matchade, aldrig hela postnumret. */
  matchedPrefix: string | null;
};

/** Tar bort mellanslag och icke-siffror. "503 30" -> "50330". */
export function normalizePostalCode(raw: unknown): string {
  return String(raw ?? "").replace(/\D+/g, "");
}

export function normalizePrefix(raw: unknown): string {
  return String(raw ?? "").replace(/\D+/g, "");
}

export function resolveGeography(
  postalCode: unknown,
  config?: Partial<GeographyConfig> | null,
): GeographyResult {
  const serviceArea = String(config?.serviceArea ?? "").trim();
  const local = normalizePrefix(config?.localPostalPrefix);
  const regional = normalizePrefix(config?.regionalPostalPrefix);
  const configured = Boolean(local || regional);

  if (!configured) {
    return { verdict: "not_configured", points: 0, serviceArea, configured: false, matchedPrefix: null };
  }

  const code = normalizePostalCode(postalCode);
  if (!code) {
    return { verdict: "unknown", points: 0, serviceArea, configured: true, matchedPrefix: null };
  }

  if (local && code.startsWith(local)) {
    return { verdict: "local", points: 20, serviceArea, configured: true, matchedPrefix: local };
  }
  if (regional && code.startsWith(regional)) {
    return { verdict: "regional", points: 10, serviceArea, configured: true, matchedPrefix: regional };
  }
  return { verdict: "outside", points: 0, serviceArea, configured: true, matchedPrefix: null };
}

/** PII-fri projektion som får skickas till modellen och ut i API-svaret. */
export function publicGeography(result: GeographyResult) {
  return {
    verdict: result.verdict,
    service_area: result.serviceArea,
    configured: result.configured,
  };
}
