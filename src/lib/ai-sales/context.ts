import type { Industry } from "../landing/templates";
import { readStoredPayload } from "../landing/make-adapter";
import { scoreVaruautomat } from "../landing/scoring";

/**
 * PRIVACY BY DESIGN
 * -----------------
 * Kontexten som skickas till modellen får ALDRIG innehålla personuppgifter.
 * Följande fältnycklar och mönster tas alltid bort: namn, e-post, telefon,
 * adress och exakt postnummer. Regeln testas i context.test.ts – ändra inte
 * utan att uppdatera testerna.
 */
export const PII_FIELD_KEYS = [
  "fullstandigt_namn",
  "kontaktperson",
  "namn",
  "epost",
  "email",
  "e-post",
  "telefonnummer",
  "telefon",
  "mobil",
  "adress",
  "gatuadress",
  "postnummer",
  "personnummer",
] as const;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(\+?\d[\d\s-]{6,}\d)/g;
const ORGNR_RE = /\b\d{6}-?\d{4}\b/g;

/** Maskerar PII-mönster i fri text (skydd för beskrivningsfält). */
export function redactText(value: string): string {
  return value
    .replace(EMAIL_RE, "[epost borttagen]")
    .replace(ORGNR_RE, "[nummer borttaget]")
    .replace(PHONE_RE, "[telefon borttaget]")
    .replace(/\s+/g, " ")
    .trim();
}

function isPiiKey(key: string): boolean {
  const k = key.toLowerCase();
  return PII_FIELD_KEYS.some((p) => k === p || k.includes(p));
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Samlar konkreta PII-värden (namn, e-post, telefon) ur svaren. */
export function collectKnownPii(
  answers: Record<string, unknown>,
  make: Record<string, unknown> | null,
): string[] {
  const values: string[] = [];
  const push = (raw: unknown) => {
    const v = String(raw ?? "").trim();
    if (!v) return;
    values.push(v);
    // Personnamn förekommer ofta som enstaka förnamn i fritext.
    for (const part of v.split(/[\s,]+/)) if (part.length >= 3) values.push(part);
  };
  for (const [key, raw] of Object.entries(answers)) if (isPiiKey(key)) push(raw);
  for (const key of ["fullstandigt_namn", "epost", "telefonnummer"]) push(make?.[key]);
  return Array.from(new Set(values)).sort((a, b) => b.length - a.length);
}

/** Stryker kända PII-värden ur fritext (personnamn fångas inte av mönster). */
export function stripKnownPii(text: string, knownPii: string[]): string {
  let out = text;
  for (const value of knownPii) {
    out = out.replace(new RegExp(escapeRe(value), "gi"), "[borttaget]");
  }
  return out;
}


export type AiLeadInput = {
  leadId: string;
  customerId: string;
  industry: Industry | string;
  createdAt: string;
  /** Rå payload från leads-tabellen (svar + normaliserade Make-fält). */
  payload: unknown;
};

export type AiCustomerProfile = {
  name: string;
  industry: Industry | string;
  serviceArea: string;
};

export type AiSalesContext = {
  leadId: string;
  customerId: string;
  industry: string;
  companyName: string;
  serviceArea: string;
  createdAt: string;
  /** Affärsrelevanta svar, helt utan personuppgifter. */
  signals: Record<string, string>;
  need: string;
  timeline: string;
  description: string;
  score: number | null;
  qualification: string | null;
  priority: string | null;
  missingInformation: string[];
};

const BUSINESS_TIMELINE_KEYS = ["tidsram", "planerad_tidpunkt"];
const BUSINESS_NEED_KEYS = ["behov", "onskad_automat"];

/**
 * Bygger AI-kontext från lead + kundprofil. Serverside-only användning.
 * Inga namn, telefonnummer eller e-postadresser inkluderas.
 */
export function buildAiSalesContext(
  lead: AiLeadInput,
  customer: AiCustomerProfile,
): AiSalesContext {
  const stored = readStoredPayload(lead.payload);
  const answers = stored.answers ?? {};
  const make = stored.make;

  // Kända PII-värden (namn, e-post, telefon) plockas ut och stryks även när
  // de förekommer i fritextfält – mönstermatchning fångar inte personnamn.
  const knownPii = collectKnownPii(answers, make as Record<string, unknown> | null);
  const clean = (value: unknown) => redactText(stripKnownPii(String(value ?? ""), knownPii));

  const signals: Record<string, string> = {};
  for (const [key, raw] of Object.entries(answers)) {
    if (isPiiKey(key)) continue;
    const value = clean(raw);
    if (value) signals[key] = value;
  }


  const need =
    BUSINESS_NEED_KEYS.map((k) => signals[k]).find(Boolean) ??
    (make?.behov ? clean(make.behov) : "");
  const timeline =
    BUSINESS_TIMELINE_KEYS.map((k) => signals[k]).find(Boolean) ??
    (make?.planerad_tidpunkt ? clean(make.planerad_tidpunkt) : "");
  const description = clean(
    signals["projektbeskrivning"] ?? signals["meddelande"] ?? make?.projektbeskrivning ?? "",
  );

  const scoring =
    lead.industry === "varuautomater" ? scoreVaruautomat(answers as Record<string, string>) : null;

  const missingInformation: string[] = [];
  if (!need) missingInformation.push("behov");
  if (!timeline) missingInformation.push("tidsplan");
  if (!description) missingInformation.push("beskrivning av uppdraget");

  return {
    leadId: lead.leadId,
    customerId: lead.customerId,
    industry: String(lead.industry),
    companyName: customer.name,
    serviceArea: customer.serviceArea,
    createdAt: lead.createdAt,
    signals,
    need,
    timeline,
    description,
    score: scoring?.deterministic_score ?? null,
    qualification: scoring?.deterministic_kvalificering ?? null,
    priority: scoring?.deterministic_prioritet ?? null,
    missingInformation,
  };
}

/** Serialiserar kontexten till modellinput (JSON, redan PII-fri). */
export function serializeContext(context: AiSalesContext): string {
  const { leadId: _l, customerId: _c, ...safe } = context;
  return JSON.stringify(safe, null, 2);
}
