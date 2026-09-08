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
  { flag: "claim:already_sent", re: /\b(har|är)\s+(nu\s+)?(skickat|skickats|mailat|utskickat)\b/i },
  { flag: "claim:already_booked", re: /\b(har|är)\s+(nu\s+)?(bokat|bokats|inbokat|reserverat)\b/i },
  { flag: "claim:price", re: /\b\d[\d\s.,]*\s*(kr|sek|kronor)\b/i },
  { flag: "claim:guarantee", re: /\b\d+\s*(års|åriga)\s*garanti\b/i },
  { flag: "claim:delivery_time", re: /\b(leverans|montering|installation)\s+(sker|inom|om)\s+\d/i },
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


/** Säkert reservutkast utan modellanrop. */
export function fallbackOutput(context: AiSalesContext): AssistantOutput {
  const policy = resolvePolicyPath(context);
  const questions = context.missingInformation.map((m) => `Kan du beskriva ${m} lite närmare?`);
  return {
    action: policy.action,
    contactSpeed: policy.contactSpeed,
    subject: "Din förfrågan till oss",
    emailDraft: [
      "Hej!",
      "",
      "Tack för din förfrågan. Vi har tagit emot den och återkommer med nästa steg.",
      questions.length > 0
        ? "För att kunna ge dig ett bra svar behöver vi några kompletterande uppgifter."
        : "Hör gärna av dig om du har frågor under tiden.",
      "",
      "Vänliga hälsningar",
    ].join("\n"),
    followupQuestions: questions.slice(0, 3),
    humanTakeover: policy.humanTakeover,
    strategyReason: `Reservutkast utan modellanrop. ${policy.reason}`,
    confidence: 0.3,
    safetyFlags: ["fallback:no_model"],
  };
}
