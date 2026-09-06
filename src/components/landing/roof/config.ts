/**
 * Central konfiguration för tak-landningssidan.
 *
 * Kopiera denna fil (och routen) per kund och ändra endast värdena nedan.
 * Inga personuppgifter får hårdkodas här.
 */
export type RoofClientConfig = {
  /** Varumärkesnamn som visas i header, hero och footer. */
  companyName: string;
  /** Accentfärg (valfri CSS-färg). Tom sträng = använd sidans standardblå. */
  accent: string;
  /** Telefonnummer. Tom sträng = visa icke-klickbar placeholder. */
  phone: string;
  /** Kontakt-e-post. Tom sträng = visa placeholder. */
  email: string;
  /** Verksamhetsområde, t.ex. "Stockholms län". */
  serviceArea: string;
  /** Make-webhook. Tom sträng = demo-läge, ingen nätverksrequest görs. */
  webhookUrl: string;
  /** Visar badgen "Demoversion för takföretag" högst upp. */
  showDemoBadge: boolean;
};

export const clientConfig: RoofClientConfig = {
  companyName: "Din takpartner",
  accent: "",
  phone: "",
  email: "",
  serviceArea: "",
  webhookUrl: "",
  showDemoBadge: true,
};

export const isDemoMode = (config: RoofClientConfig) => config.webhookUrl.trim() === "";
