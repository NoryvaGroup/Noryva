/**
 * Serverside-anrop till Lovable AI Gateway för att ta fram ett utkast.
 * Endast internt: resultatet lagras i review-kön och skickas aldrig externt.
 */
import { serializeContext, type AiSalesContext } from "./context";
import { ASSISTANT_MODEL, PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { applyPolicyGuardrails, fallbackOutput } from "./policy";
import { assistantOutputSchema, type AssistantOutput } from "./types";

export type GenerationResult = {
  output: AssistantOutput;
  model: string;
  promptVersion: string;
  usedFallback: boolean;
  error?: string;
};

function extractText(json: unknown): string {
  const j = json as Record<string, any>;
  if (typeof j?.["output_text"] === "string") return j["output_text"];
  const parts = j?.["output"];
  if (Array.isArray(parts)) {
    const texts: string[] = [];
    for (const item of parts) {
      for (const c of item?.content ?? []) {
        if (typeof c?.text === "string") texts.push(c.text);
      }
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

export async function generateAssistantDraft(
  context: AiSalesContext,
): Promise<GenerationResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    return {
      output: fallbackOutput(context),
      model: "fallback",
      promptVersion: PROMPT_VERSION,
      usedFallback: true,
      error: "LOVABLE_API_KEY saknas.",
    };
  }

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(serializeContext(context)) },
        ],
      }),
    });

    if (!res.ok) {
      const message = await res.text();
      return {
        output: fallbackOutput(context),
        model: "fallback",
        promptVersion: PROMPT_VERSION,
        usedFallback: true,
        error: `AI-tjänsten svarade ${res.status}: ${message.slice(0, 300)}`,
      };
    }

    const parsed = assistantOutputSchema.parse(parseJson(extractText(await res.json())));
    return {
      output: applyPolicyGuardrails(parsed, context),
      model: ASSISTANT_MODEL,
      promptVersion: PROMPT_VERSION,
      usedFallback: false,
    };
  } catch (error) {
    return {
      output: fallbackOutput(context),
      model: "fallback",
      promptVersion: PROMPT_VERSION,
      usedFallback: true,
      error: error instanceof Error ? error.message : "Okänt fel vid AI-anrop.",
    };
  }
}
