/**
 * Noryvas tre agentroller.
 *
 * Research/Qualification och Sales är LOGISKA roller i EN och samma
 * strukturerade LLM-förfrågan – aldrig två separata anrop. Optimizer körs
 * aldrig per lead, endast batchvis när tillräckligt underlag finns.
 */
import { z } from "zod";
import { assistantOutputSchema } from "@/lib/ai-sales/types";
import type { ModelTier } from "./cost";

export const GROWTH_PROMPT_VERSION = "growth-engine-v2.1.0";

export type AgentRole = "research" | "sales" | "optimizer";

export const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  research: "Research/kvalificering",
  sales: "Sälj",
  optimizer: "Optimering",
};

/** Research + Sales i ett svar. Basen är den befintliga, testade strukturen. */
export const growthAnalysisSchema = assistantOutputSchema.extend({
  research: z.object({
    needSummary: z.string().trim().max(600).default(""),
    buyingSignals: z.array(z.string().trim().max(200)).max(6).default([]),
    risks: z.array(z.string().trim().max(200)).max(6).default([]),
    qualificationNote: z.string().trim().max(400).default(""),
  }),
});
export type GrowthAnalysis = z.infer<typeof growthAnalysisSchema>;

const SHARED_RULES = `ABSOLUTA FÖRBUD
- Hitta aldrig på priser, rabatter, garantier, leveranstider, tillgänglighet eller referenser.
- Påstå aldrig att något redan skickats, bokats eller utförts.
- Skriv aldrig personnamn, telefonnummer eller e-postadresser.
- Skriv aldrig tekniska fält (route, tier, modell, score, LLM) i mailtexten.
- Fråga aldrig om ort/område när kontextens geography.verdict är "local" eller "regional".
- Sätt humanTakeover = true vid pris, offert, förhandling, klagomål eller juridik.`;

/**
 * En systeminstruktion per nivå. `emailDraft` är ALLTID ett färdigt första
 * svar TILL kunden som skickat förfrågan – aldrig en intern instruktion till
 * säljaren. Interna råd hör hemma i `strategyReason` och `research`.
 */
export function systemPromptFor(tier: Extract<ModelTier, "ai_light" | "ai_full">): string {
  const depth =
    tier === "ai_light"
      ? "Håll researchen kort: max två punkter per lista."
      : "Gör en noggrann analys: väg signaler mot risker och motivera nästa steg tydligt.";

  return `Du arbetar som två roller i ett och samma svar åt ett svenskt tjänsteföretag:
1) Research/kvalificering – tolka behov, köpsignaler och risker i förfrågan (internt).
2) Sälj – välj nästa steg och skriv ett färdigt första svarsmail TILL kunden.

MAILET (emailDraft)
- Mottagare är kunden som skickat förfrågan, inte en kollega.
- Inled alltid med "Hej!" (du får ingen personinformation).
- Högst cirka 70 ord totalt.
- Ställ 0–2 följdfrågor, och bara sådana som verkligen behövs.
- Avsluta med "Vänliga hälsningar" och företagsnamnet i kontextens companyName.
- Ingen intern analys, ingen prioritet, inga interna termer i texten.

${depth}

${SHARED_RULES}

SVARSFORMAT – endast giltig JSON, utan kodstaket:
{
  "action": "Kontakta nu" | "Följ upp" | "Be om komplettering" | "Mänsklig handläggning",
  "contactSpeed": "Omgående" | "Inom 24 timmar" | "Inom 2 arbetsdagar" | "Avvakta",
  "subject": "kort ämnesrad till kunden",
  "emailDraft": "mail till kunden som börjar med Hej! och signeras med företagsnamnet",
  "followupQuestions": ["..."],
  "humanTakeover": true | false,
  "strategyReason": "kort intern motivering på svenska",
  "confidence": 0.0-1.0,
  "safetyFlags": ["..."],
  "research": {
    "needSummary": "...",
    "buyingSignals": ["..."],
    "risks": ["..."],
    "qualificationNote": "..."
  }
}`;
}

export type VariantHint = {
  variantId: string;
  experimentType: string;
  /** Fri instruktion från varianten, t.ex. "kort ämnesrad utan frågetecken". */
  instruction: string;
};

export function buildGrowthUserPrompt(
  serializedContext: string,
  variant?: VariantHint | null,
): string {
  const variantBlock = variant
    ? `\n\nVARIANT (${variant.experimentType} / ${variant.variantId}): ${variant.instruction}`
    : "";
  return `Ny förfrågan (anonymiserad kontext, JSON):\n\n${serializedContext}${variantBlock}\n\nSvara med endast JSON enligt formatet.`;
}

/** Klipper kontexten till nivåns tak så att kostnaden hålls förutsägbar. */
export function truncateContext(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n…[avkortat]`;
}

/**
 * Optimizer-prompt. Används ENDAST batchvis över aggregerad statistik och
 * aldrig per lead. Beslutet är fortfarande en rekommendation till människa.
 */
export function buildOptimizerBatchPrompt(summaryJson: string): string {
  return `Här är aggregerad experimentstatistik (JSON):\n\n${summaryJson}\n\nFöreslå vilken variant som bör vinna och varför. Svara kort på svenska. Du får aldrig ändra något själv – detta är endast en rekommendation.`;
}
