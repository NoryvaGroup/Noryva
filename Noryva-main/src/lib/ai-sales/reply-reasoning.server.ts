/**
 * Semantisk bedömning av den NYA delen i ett nurture-svar.
 * Återanvänder Agent Cores enda strukturerade OpenAI-anrop och faller säkert
 * tillbaka utan positiv signal. Inga verktyg, retries eller externa actions.
 */
import { z } from "zod";
import {
  callOpenAiStructured,
  REASONING_MODEL,
  type LlmMeta,
  type ReasoningDeps,
} from "@/lib/agents/reasoning.server";
import { redactText } from "./context";
import {
  classifyReplyDeterministic,
  type ReplyClassification,
  type ReplyIntent,
} from "./reply";

export const REPLY_REASONING_PROMPT_VERSION = "nurture-reply-v1";

const resultSchema = z
  .object({
    intent: z.enum(["intresserad", "vill_boka", "invandning", "ovrigt"]),
    positivePurchaseIntent: z.boolean(),
    explicitMeetingIntent: z.boolean(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

const REPLY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "positivePurchaseIntent", "explicitMeetingIntent", "confidence", "reason"],
  properties: {
    intent: { type: "string", enum: ["intresserad", "vill_boka", "invandning", "ovrigt"] },
    positivePurchaseIntent: { type: "boolean" },
    explicitMeetingIntent: { type: "boolean" },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
} as const;

const SYSTEM = `Du klassificerar endast den nya, ociterade delen av ett inkommande kundsvar i TEST/REVIEW.
Svara endast med JSON enligt schemat.
- positivePurchaseIntent=true endast när avsändaren tydligt vill gå vidare, beställa, få nästa konkreta steg eller aktivt boka.
- explicitMeetingIntent=true endast när avsändaren själv tydligt vill boka eller ordna ett möte/samtal.
- Hälsningar, testmeddelanden, tack, småprat, neutrala kompletteringar och enbart frågor är inte positiv köpintention.
- Ett omnämnande av ord som möte, offert eller boka utan uttryckt vilja räcker aldrig.
- Hitta inte på kontext utanför texten.`;

const QUOTE_BOUNDARIES = [
  /^\s*>/m,
  /^\s*-{2,}\s*(?:original(?: message)?|ursprungligt meddelande)\s*-{2,}\s*$/im,
  /^\s*(?:on|den)\s+.+(?:wrote|skrev).*:\s*$/im,
  /^\s*(?:from|från):\s*.+$/im,
  /^\s*(?:mvh|med vänlig hälsning|vänliga hälsningar|best regards)[,!]?\s*$/im,
];

/** Tar bort vanlig citerad mailhistorik och signatur från klassificeringsunderlaget. */
export function extractCurrentReply(raw: string): string {
  const normalized = String(raw ?? "").replace(/\r\n?/g, "\n");
  let end = normalized.length;
  for (const boundary of QUOTE_BOUNDARIES) {
    const match = boundary.exec(normalized);
    if (match?.index !== undefined) end = Math.min(end, match.index);
  }
  const current = normalized.slice(0, end).split(/^\s*--\s*$/m)[0] ?? "";
  return redactText(current).slice(0, 4000);
}

/**
 * Fail-closed för helt uppenbara hälsnings-/test-/tack-svar. Modellen ska inte
 * kunna hallucinera köpavsikt ur dessa och behöver därför inte anropas.
 */
function isClearlyNeutralReply(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase("sv-SE")
    .replace(/\/test\b/g, " test ")
    .replace(/[^a-zåäö0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;

  const neutralWords = new Set([
    "hej",
    "hejsan",
    "hallå",
    "test",
    "tack",
    "tackar",
    "mvh",
    "vänligen",
  ]);
  return normalized.split(" ").every((word) => neutralWords.has(word));
}

export type SemanticReplyClassification = ReplyClassification & {
  positivePurchaseIntent: boolean;
  explicitMeetingIntent: boolean;
  generatedBy: "safety_rule" | "llm" | "conservative_fallback";
  llm: LlmMeta;
};

function fallbackMeta(reason: string, attempts: 0 | 1, latencyMs = 0): LlmMeta {
  return {
    used: false,
    model: REASONING_MODEL,
    promptVersion: REPLY_REASONING_PROMPT_VERSION,
    attempts,
    usedFallback: true,
    fallbackReason: reason,
    latencyMs,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function withSignals(
  classification: ReplyClassification,
  generatedBy: SemanticReplyClassification["generatedBy"],
  llm: LlmMeta,
): SemanticReplyClassification {
  return {
    ...classification,
    positivePurchaseIntent: false,
    explicitMeetingIntent: false,
    generatedBy,
    llm,
  };
}

function semanticClassification(
  intent: Extract<ReplyIntent, "intresserad" | "vill_boka" | "invandning" | "ovrigt">,
  confidence: number,
  positivePurchaseIntent: boolean,
  explicitMeetingIntent: boolean,
  safety: ReplyClassification,
): ReplyClassification {
  const guardedIntent = safety.escalate
    ? safety.intent
    : explicitMeetingIntent
      ? "vill_boka"
      : positivePurchaseIntent
        ? "intresserad"
        : intent === "invandning"
          ? "invandning"
          : "ovrigt";
  return {
    intent: explicitMeetingIntent ? "vill_boka" : guardedIntent,
    escalate: safety.escalate,
    escalationReason: safety.escalationReason,
    suggestedAction: safety.escalate
      ? "handoff_to_human"
      : explicitMeetingIntent
        ? "book_meeting"
        : positivePurchaseIntent
          ? "send_email"
          : intent === "invandning"
            ? "request_information"
            : "schedule_followup",
    confidence,
  };
}

/** Högst ett modellanrop. Opt-out/juridik/klagomål avgörs alltid av säkerhetsregler. */
export async function classifyReplySemantic(
  rawBody: string,
  deps: ReasoningDeps = {},
): Promise<{ currentReply: string; classification: SemanticReplyClassification }> {
  const currentReply = extractCurrentReply(rawBody);
  const safety = classifyReplyDeterministic(currentReply);

  if (["avbojer", "juridik", "klagomal", "pris_offert", "forhandling"].includes(safety.intent)) {
    return {
      currentReply,
      classification: withSignals(safety, "safety_rule", fallbackMeta("safety_rule", 0)),
    };
  }

  if (!currentReply) {
    return {
      currentReply,
      classification: withSignals(safety, "conservative_fallback", fallbackMeta("empty_current_reply", 0)),
    };
  }

  if (isClearlyNeutralReply(currentReply)) {
    return {
      currentReply,
      classification: withSignals(
        { ...safety, intent: "ovrigt", suggestedAction: "schedule_followup" },
        "safety_rule",
        fallbackMeta("clearly_neutral_reply", 0),
      ),
    };
  }

  const call = await callOpenAiStructured(
    SYSTEM,
    `Aktuell svarstext:\n${currentReply}`,
    "nurture_reply_classification",
    REPLY_JSON_SCHEMA,
    deps,
  );
  if (call.text === null) {
    return {
      currentReply,
      classification: withSignals(safety, "conservative_fallback", {
        ...call.meta,
        promptVersion: REPLY_REASONING_PROMPT_VERSION,
      }),
    };
  }

  try {
    const parsed = resultSchema.parse(JSON.parse(call.text));
    const explicitMeetingIntent = parsed.explicitMeetingIntent && parsed.positivePurchaseIntent;
    const positivePurchaseIntent = parsed.positivePurchaseIntent;
    const base = semanticClassification(
      parsed.intent,
      parsed.confidence,
      positivePurchaseIntent,
      explicitMeetingIntent,
      safety,
    );
    return {
      currentReply,
      classification: {
        ...base,
        positivePurchaseIntent,
        explicitMeetingIntent,
        generatedBy: "llm",
        llm: { ...call.meta, promptVersion: REPLY_REASONING_PROMPT_VERSION },
      },
    };
  } catch {
    return {
      currentReply,
      classification: withSignals(
        safety,
        "conservative_fallback",
        fallbackMeta("schema_error", 1, call.meta.latencyMs),
      ),
    };
  }
}