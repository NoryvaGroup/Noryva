import type { AiSalesContext } from "./context";
import type { AssistantOutput, ContactSpeed, SalesAction } from "./types";

/**
 * Deterministisk policy. Används för två saker:
 *  1. som facit för att kontrollera/justera modellens rekommendation,
 *  2. som säkert reservutkast när modellen inte kan anropas.
 * Ingen AI-matematik: samma kontext ger alltid samma policyväg.
 */
export type PolicyPath = {
  action: SalesAction;
  contactSpeed: ContactSpeed;
  humanTakeover: boolean;
  reason: string;
};

/** Ord som alltid kräver mänsklig handläggning. */
export const HUMAN_TAKEOVER_TERMS = [
  "offert",
  "pris",
  "prisuppgift",
  "kostar",
  "kostnad",
  "rabatt",
  "garanti",
  "förhandling",
  "avtal",
  "juridik",
  "jurist",
  "advokat",
  "tvist",
  "klagomål",
  "missnöjd",
  "reklamation",
  "skadestånd",
  "försäkring",
];

/**
 * Påståenden som modellen aldrig får göra: att något redan skickats/bokats,
 * eller konkreta priser, garantier och leveranstider. Upptäcks i utkastet
 * som skyddsnät, oavsett vad systemprompten säger.
 */
const FABRICATION_PATTERNS: { flag: string; re: RegExp }[] = [
  {
    flag: "claim:already_sent",
    re: /(har|är|vi har)\s+(nu\s+)?(skickat|skickats|mailat|utskickat)/i,
  },
  {
    flag: "claim:already_booked",
    re: /(har|är|vi har)\s+(nu\s+)?(bokat|bokats|inbokat|reserverat)/i,
  },
  { flag: "claim:price", re: /\d[\d\s.,]*\s*(kr|sek|kronor)\b/i },
  { flag: "claim:guarantee", re: /\d+\s*(års|åriga|år)\s*garanti/i },
  {
    flag: "claim:delivery_time",
    re: /(leverans|leveransen|montering|monteringen|installation|installationen)\s+(sker\s+)?(inom|om|på)\s+\d/i,
  },
];


/** Returnerar flaggor för påhittade påståenden i en text. */
export function detectFabricatedClaims(text: string): string[] {
  return FABRICATION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.flag);
}


export function needsHumanTakeover(context: AiSalesContext): boolean {
  const haystack = [context.need, context.description, ...Object.values(context.signals)]
    .join(" ")
    .toLowerCase();
  return HUMAN_TAKEOVER_TERMS.some((term) => haystack.includes(term));
}

export function resolvePolicyPath(context: AiSalesContext): PolicyPath {
  if (needsHumanTakeover(context)) {
    return {
      action: "Mänsklig handläggning",
      contactSpeed: "Omgående",
      humanTakeover: true,
      reason: "Förfrågan rör pris, offert, avtal eller annan känslig fråga och eskaleras.",
    };
  }

  const priority = (context.priority ?? "").toUpperCase();
  const incomplete = context.missingInformation.length > 0;

  if (priority === "HÖG" || priority === "AKUT") {
    return {
      action: "Kontakta nu",
      contactSpeed: "Omgående",
      humanTakeover: false,
      reason: "Hög prioritet enligt kvalificeringen – snabb personlig kontakt rekommenderas.",
    };
  }

  if (incomplete || priority === "LÅG") {
    return {
      action: "Be om komplettering",
      contactSpeed: "Inom 2 arbetsdagar",
      humanTakeover: false,
      reason: incomplete
        ? `Underlaget saknar: ${context.missingInformation.join(", ")}.`
        : "Låg prioritet – komplettera underlaget innan säljinsats.",
    };
  }

  return {
    action: "Följ upp",
    contactSpeed: "Inom 24 timmar",
    humanTakeover: false,
    reason: "Normal prioritet – vanlig uppföljning inom ett dygn.",
  };
}

/**
 * Applicerar policyn som skyddsnät på modellens svar: mänsklig handläggning
 * kan aldrig tas bort av modellen, bara läggas till. Dessutom eskaleras
 * utkast som påstår att något redan skickats/bokats eller innehåller pris,
 * garanti eller leveranstid som saknar täckning i underlaget.
 */
export function applyPolicyGuardrails(
  output: AssistantOutput,
  context: AiSalesContext,
): AssistantOutput {
  const policy = resolvePolicyPath(context);
  const claims = detectFabricatedClaims(`${output.subject}\n${output.emailDraft}`);
  if (!policy.humanTakeover && claims.length === 0) return output;
  return {
    ...output,
    action: "Mänsklig handläggning",
    humanTakeover: true,
    safetyFlags: Array.from(
      new Set([
        ...output.safetyFlags,
        ...(policy.humanTakeover ? ["policy:human_takeover"] : []),
        ...claims,
      ]),
    ),
  };
}


/**
 * Säkert reservutkast utan modellanrop.
 *
 * MOTTAGARE: kunden som skickat förfrågan – aldrig en intern instruktion till
 * säljaren. Interna råd hör hemma i `strategyReason`. Texten hålls under ~70
 * ord, har max två följdfrågor och signeras med företagsnamnet.
 */
export function fallbackOutput(context: AiSalesContext): AssistantOutput {
  const policy = resolvePolicyPath(context);
  const geographyVerified =
    context.geography?.configured === true &&
    (context.geography.verdict === "local" || context.geography.verdict === "regional");

  const questions = context.missingInformation
    // Ingen platsfråga när servern redan verifierat geografin.
    .filter((m) => !(geographyVerified && /plats|ort|omr[åa]de/i.test(m)))
    .map((m) => `Kan du beskriva ${m} lite närmare?`)
    .slice(0, 2);

  const signature = context.companyName?.trim() || "Kundteamet";

  return {
    action: policy.action,
    contactSpeed: policy.contactSpeed,
    subject: "Tack för din förfrågan",
    emailDraft: [
      "Hej!",
      "",
      "Tack för din förfrågan – vi har tagit emot den och återkommer med nästa steg.",
      questions.length > 0
        ? "För att kunna hjälpa dig rätt behöver vi veta lite mer:"
        : "Hör gärna av dig om du har frågor under tiden.",
      ...questions.map((q) => `- ${q}`),
      "",
      "Vänliga hälsningar",
      signature,
    ].join("\n"),
    followupQuestions: questions,
    humanTakeover: policy.humanTakeover,
    strategyReason: `Reservutkast utan modellanrop. ${policy.reason}`,
    confidence: 0.3,
    safetyFlags: ["fallback:no_model"],
  };
}
