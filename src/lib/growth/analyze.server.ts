/**
 * Serverside-anrop för Growth Engine.
 * Ett enda LLM-anrop kör både research- och säljrollen. Ingen extern
 * kommunikation sker – resultatet är alltid ett internt utkast.
 */
import { serializeContext, type AiSalesContext } from "@/lib/ai-sales/context";
import { applyPolicyGuardrails, fallbackOutput } from "@/lib/ai-sales/policy";
import { MODEL_TIERS, estimateCost, type CostEstimate, type ModelTier } from "./cost";
import {
  GROWTH_PROMPT_VERSION,
  buildGrowthUserPrompt,
  growthAnalysisSchema,
  systemPromptFor,
  truncateContext,
  type GrowthAnalysis,
  type VariantHint,
} from "./agents";

export type AnalyzeResult = {
  analysis: GrowthAnalysis;
  tier: ModelTier;
  model: string;
  promptVersion: string;
  usedFallback: boolean;
  cost: CostEstimate;
  error?: string;
};

function extractText(json: unknown): string {
  const j = json as Record<string, any>;
  if (typeof j?.["output_text"] === "string") return j["output_text"];
  const parts = j?.["output"];
  if (Array.isArray(parts)) {
    const texts: string[] = [];
    for (const item of parts) {
      for (const c of item?.content ?? []) if (typeof c?.text === "string") texts.push(c.text);
    }
    if (texts.length) return texts.join("");
  }
  const choice = j?.["choices"]?.[0]?.message?.content;
  return typeof choice === "string" ? choice : "";
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Modellen returnerade inte JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Deterministisk rekommendation – noll LLM-anrop, noll kostnad. */
export function deterministicAnalysis(context: AiSalesContext): AnalyzeResult {
  const base = fallbackOutput(context);
  return {
    analysis: {
      ...base,
      research: {
        needSummary: context.need || "",
        buyingSignals: context.timeline ? [`Tidsram: ${context.timeline}`] : [],
        risks: context.missingInformation.map((m) => `Saknar ${m}`),
        qualificationNote: `Deterministisk kvalificering: ${context.qualification ?? "okänd"}.`,
      },
    },
    tier: "deterministic",
    model: "deterministic",
    promptVersion: GROWTH_PROMPT_VERSION,
    usedFallback: false,
    cost: estimateCost({ tier: "deterministic", inputTokens: 0, outputTokens: 0 }),
  };
}

export async function analyzeWithTier(
  context: AiSalesContext,
  tier: Extract<ModelTier, "ai_light" | "ai_full">,
  variant?: VariantHint | null,
): Promise<AnalyzeResult> {
  const cfg = MODEL_TIERS[tier];
  const apiKey = process.env["LOVABLE_API_KEY"];

  const fail = (error: string): AnalyzeResult => ({
    ...deterministicAnalysis(context),
    usedFallback: true,
    error,
  });

  if (!apiKey) return fail("LOVABLE_API_KEY saknas.");

  try {
    const body: Record<string, unknown> = {
      model: cfg.model,
      input: [
        { role: "system", content: systemPromptFor(tier) },
        {
          role: "user",
          content: truncateContext(
            buildGrowthUserPrompt(serializeContext(context), variant),
            cfg.maxContextChars,
          ),
        },
      ],
    };
    if (cfg.model === "openai/gpt-6-astra") body["reasoning"] = { effort: "low" };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const message = await res.text();
      return fail(`AI-tjänsten svarade ${res.status}: ${message.slice(0, 300)}`);
    }

    const json = (await res.json()) as Record<string, any>;
    const parsed = growthAnalysisSchema.parse(parseJson(extractText(json)));
    const guarded = applyPolicyGuardrails(
      {
        action: parsed.action,
        contactSpeed: parsed.contactSpeed,
        subject: parsed.subject,
        emailDraft: parsed.emailDraft,
        followupQuestions: parsed.followupQuestions,
        humanTakeover: parsed.humanTakeover,
        strategyReason: parsed.strategyReason,
        confidence: parsed.confidence,
        safetyFlags: parsed.safetyFlags,
      },
      context,
    );

    const usage = json["usage"] ?? {};
    const cost = estimateCost({
      tier,
      inputTokens: usage["input_tokens"] ?? usage["prompt_tokens"] ?? null,
      outputTokens: usage["output_tokens"] ?? usage["completion_tokens"] ?? null,
    });

    return {
      analysis: { ...guarded, research: parsed.research },
      tier,
      model: cfg.model!,
      promptVersion: GROWTH_PROMPT_VERSION,
      usedFallback: false,
      cost,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Okänt fel vid AI-anrop.");
  }
}
