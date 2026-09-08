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

export const GROWTH_PROMPT_VERSION = "growth-engine-v2.0.0";

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
- Hitta aldrig på priser, rabatter, garantier, leveranstider eller referenser.
- Påstå aldrig att något redan skickats, bokats eller utförts.
- Skriv aldrig namn, telefonnummer eller e-postadresser.
- Sätt humanTakeover = true vid pris, offert, förhandling, klagomål eller juridik.`;

/** En systeminstruktion per nivå: lätt nivå håller kontext och svar korta. */
export function systemPromptFor(tier: Extract<ModelTier, "ai_light" | "ai_full">): string {
  const depth =
    tier === "ai_light"
      ? "Håll dig kort: max 120 ord i mailtexten, max två följdfrågor, max två punkter per researchlista."
      : "Gör en noggrann analys: väg signaler mot risker och motivera nästa steg tydligt.";

  return `Du arbetar som två roller i ett och samma svar åt ett svenskt tjänsteföretag:
1) Research/kvalificering – tolka behov, köpsignaler och risker i förfrågan.
2) Sälj – välj nästa steg och skriv ett kort internt mailutkast på svenska.

${depth}

${SHARED_RULES}

Mailet inleds alltid med "Hej!" eftersom du inte får någon personinformation.

SVARSFORMAT – endast giltig JSON, utan kodstaket:
{
  "action": "Kontakta nu" | "Följ upp" | "Be om komplettering" | "Mänsklig handläggning",
  "contactSpeed": "Omgående" | "Inom 24 timmar" | "Inom 2 arbetsdagar" | "Avvakta",
  "subject": "kort ämnesrad",
  "emailDraft": "mailtext som börjar med Hej!",
  "followupQuestions": ["..."],
  "humanTakeover": true | false,
  "strategyReason": "kort motivering på svenska",
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
