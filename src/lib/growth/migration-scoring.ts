/**
 * Deterministisk scoring enligt LIVE Make-kontraktet (opt-in migration).
 *
 * Aktiveras endast när anroparen skickar `makeContext`. Utan det används den
 * befintliga `qualifyLead`-modellen oförändrat, så nuvarande anropare påverkas
 * inte. Ingen AI, inga sidoeffekter, inga nätverksanrop.
 *
 * Reglerna nedan är hämtade från det körande Make-scenariot och får inte
 * ändras utan att både detta kontrakt och Make uppdateras.
 */
import type { MakeLeadFields } from "@/lib/landing/make-adapter";
import type { GeographyResult } from "./geography";

export const MIGRATION_SCORING_VERSION = "noryva.make.scoring.v1";

export type MigrationPriority = "AKUT" | "HÖG" | "NORMAL" | "LÅG";

export type MigrationScore = {
  score: number;
  qualification: "Hög" | "Medel" | "Låg";
  priority: MigrationPriority;
  source: string;
  breakdown: Record<string, number>;
  /** true = underlag saknas; leadet ska granskas manuellt, inte tolkas som 0. */
  manualReview: boolean;
  manualReviewReasons: string[];
  acute: boolean;
  geography: GeographyResult;
};

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
/** Normaliserar tankstreck/långt bindestreck och blanksteg. */
const norm = (v: unknown) =>
  lower(v).replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();

function first(...values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

/** Plockar ut ett fält ur den legacy-normaliserade behovstexten från Make. */
function fromBehovText(behov: string, label: string): string {
  const re = new RegExp(`${label}\\s*:\\s*([^.\\n]+)`, "i");
  return behov.match(re)?.[1]?.trim() ?? "";
}

/* ------------------------------------------------------------------ */
/* Varuautomater                                                       */
/* ------------------------------------------------------------------ */

const AUTOMAT_TYPES = ["dryck", "snacks", "kombinerad", "kaffe"];

const EMPLOYEE_POINTS: Record<string, number> = {
  "1-9": 5,
  "10-24": 10,
  "25-49": 15,
  "50-99": 18,
  "100+": 20,
};

function employeePoints(raw: string): number | null {
  const key = norm(raw).replace(/\s/g, "");
  if (!key) return null;
  const direct = EMPLOYEE_POINTS[key];
  if (typeof direct === "number") return direct;
  return null;
}

function timelinePoints(raw: string, table: { snarast: number; m13: number; m36: number; senare: number }) {
  const t = norm(raw);
  if (!t) return null;
  if (t.includes("snarast") || t.includes("så snart") || t.includes("sa snart")) return table.snarast;
  if (t.includes("1-3")) return table.m13;
  if (t.includes("3-6")) return table.m36;
  if (t.includes("senare")) return table.senare;
  return null;
}

export function scoreVaruautomatMigration(input: {
  answers: Record<string, string>;
  make: MakeLeadFields | null;
  geography: GeographyResult;
}): MigrationScore {
  const { answers, make, geography } = input;
  const behovText = String(make?.behov ?? "");

  const automat = first(answers["onskad_automat"], fromBehovText(behovText, "Varuautomat"));
  const employeesRaw = first(answers["antal_anstallda"], fromBehovText(behovText, "Antal anställda"));
  const timelineRaw = first(answers["tidsram"], make?.planerad_tidpunkt);

  const specified = AUTOMAT_TYPES.some((t) => norm(automat).includes(t));
  const emp = employeePoints(employeesRaw);
  const time = timelinePoints(timelineRaw, { snarast: 25, m13: 20, m36: 10, senare: 5 });

  const breakdown = {
    automat: specified ? 25 : 15,
    employees: emp ?? 0,
    timeline: time ?? 0,
    geography: geography.points,
    intent: specified ? 10 : 5,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const reasons: string[] = [];
  if (!automat) reasons.push("automattyp saknas");
  if (emp === null) reasons.push("antal anställda saknas eller okänt intervall");
  if (time === null) reasons.push("tidsram saknas eller okänt värde");
  if (geography.verdict === "not_configured") reasons.push("geografi ej konfigurerad");
  else if (geography.verdict === "unknown") reasons.push("postnummer saknas");

  const qualification = score >= 80 ? "Hög" : score >= 45 ? "Medel" : "Låg";
  return {
    score,
    qualification,
    priority: qualification === "Hög" ? "HÖG" : qualification === "Medel" ? "NORMAL" : "LÅG",
    source: "make-migration-varuautomater",
    breakdown,
    manualReview: reasons.length > 0,
    manualReviewReasons: reasons,
    acute: false,
    geography,
  };
}

/* ------------------------------------------------------------------ */
/* Tak                                                                 */
/* ------------------------------------------------------------------ */

/**
 * AKUT endast vid genuint pågående läckage eller stormskada. Formuleringar om
 * att något ska ske "snart" är ALDRIG akut, och negerade/historiska
 * beskrivningar räknas heller inte.
 */
const ACUTE_PATTERNS = [
  /akut(?:a)? (?:läck|vattenskad|takskad)/,
  /(?:aktiv|pågående) läck/,
  /(?:det )?läcker (?:just )?nu/,
  /vatten (?:rinner|forsar) in/,
  /rinner in (?:vatten|genom taket)/,
  /storm(?:skad|en har|skada)/,
  /skad(?:a|or) efter storm/,
  /(?:taket|takplåt|takpannor) har blåst (?:av|bort)/,
  /hål i taket/,
];

const NEGATION_PATTERNS = [
  /\b(?:inte|ingen|inga|ej|utan)\b[^.]{0,40}\b(?:läck|vatten|skad|akut|hål)/,
  /\b(?:läck|skad)[a-zå-ö]*\b[^.]{0,20}\b(?:inte|ej)\b/,
];

const HISTORICAL_PATTERNS = [
  /\b(?:förra|tidigare|i fjol|förra året|för \d+ år sedan|i somras|i vintras)\b/,
  /\b(?:lagad|lagat|lagade|åtgärdad|åtgärdat|reparerad|reparerat|fixat|tätat)\b/,
];

/** Konservativ akutdetektion. Vid minsta tvekan: inte akut. */
export function detectAcuteRoof(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (!ACUTE_PATTERNS.some((re) => re.test(t))) return false;
  if (NEGATION_PATTERNS.some((re) => re.test(t))) return false;
  if (HISTORICAL_PATTERNS.some((re) => re.test(t))) return false;
  return true;
}

function roofNeedPoints(need: string): number {
  const n = norm(need);
  if (!n) return 0;
  if (n.includes("takbyte") || n.includes("byta tak") || n.includes("byte av tak")) return 30;
  if (n.includes("takrenovering") || n.includes("renover")) return 25;
  if (n.includes("tak")) return 20;
  return 0;
}

function roofAgePoints(age: string): number | null {
  const a = norm(age);
  if (!a) return null;
  if (a.includes("över 30") || a.includes("over 30") || a.includes("30+") || a.includes("äldre än 30"))
    return 25;
  if (a.includes("20-30")) return 20;
  if (a.includes("10-20")) return 15;
  return null;
}

export function scoreTakMigration(input: {
  answers: Record<string, string>;
  make: MakeLeadFields | null;
  geography: GeographyResult;
}): MigrationScore {
  const { answers, make, geography } = input;

  const need = first(answers["behov"], make?.behov);
  const ownerRaw = first(answers["ager_fastigheten"], make?.ager_fastigheten);
  const ageRaw = first(answers["takets_alder"], make?.takets_alder);
  const timeRaw = first(answers["planerad_tidpunkt"], answers["tidsram"], make?.planerad_tidpunkt);
  const description = first(answers["projektbeskrivning"], make?.projektbeskrivning);

  const owner = norm(ownerRaw);
  const isOwner = owner.startsWith("ja");
  const ownerAnswered = owner.startsWith("ja") || owner.startsWith("nej");

  const age = roofAgePoints(ageRaw);
  const time = timelinePoints(timeRaw, { snarast: 20, m13: 15, m36: 10, senare: 5 });

  // Ägs inte fastigheten är förfrågan inte relevant: behovs- och ägarpoäng = 0.
  const breakdown = {
    need: isOwner ? roofNeedPoints(need) : 0,
    owner: isOwner ? 20 : 0,
    age: age ?? 0,
    timeline: time ?? 0,
    needProvided: need.trim() ? 5 : 0,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const reasons: string[] = [];
  if (!need) reasons.push("behov saknas");
  if (!ownerAnswered) reasons.push("ägarförhållande saknas");
  if (age === null) reasons.push("takets ålder saknas eller okänt intervall");
  if (time === null) reasons.push("tidsram saknas eller okänt värde");
  if (geography.verdict === "not_configured") reasons.push("geografi ej konfigurerad");
  else if (geography.verdict === "unknown") reasons.push("postnummer saknas");

  const acute = detectAcuteRoof(`${need} ${description}`);
  const qualification = score >= 70 ? "Hög" : score >= 40 ? "Medel" : "Låg";
  const priority: MigrationPriority = acute
    ? "AKUT"
    : qualification === "Hög"
      ? "HÖG"
      : qualification === "Medel"
        ? "NORMAL"
        : "LÅG";

  return {
    score,
    qualification,
    priority,
    source: "make-migration-tak",
    breakdown,
    manualReview: reasons.length > 0,
    manualReviewReasons: reasons,
    acute,
    geography,
  };
}

/** Väljer branschmodell. Okänd bransch markeras för manuell granskning. */
export function scoreMigrationLead(input: {
  industry: string;
  answers: Record<string, string>;
  make: MakeLeadFields | null;
  geography: GeographyResult;
}): MigrationScore {
  const industry = lower(input.industry);
  if (industry === "varuautomater") return scoreVaruautomatMigration(input);
  if (industry === "tak") return scoreTakMigration(input);
  return {
    score: 0,
    qualification: "Låg",
    priority: "LÅG",
    source: "make-migration-unsupported",
    breakdown: {},
    manualReview: true,
    manualReviewReasons: [`ingen migrationsmodell för bransch "${input.industry}"`],
    acute: false,
    geography: input.geography,
  };
}
