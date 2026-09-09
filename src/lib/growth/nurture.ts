/**
 * Nurture-policy för LÅG/NORMAL-leads.
 *
 * Principen är densamma som i Intent Engine: "Low-cost nurture, never discard
 * relevant leads". Ett lead med låg intent kastas aldrig, det får i stället en
 * billig, deterministisk kompletteringsfråga vid ett planerat tillfälle.
 *
 * SÄKERHET:
 *  - HÖG/AKUT går ALDRIG genom nurture – de ska hanteras personligen direkt.
 *  - Ingen funktion här skickar något. Allt är rena funktioner.
 *  - Pris/offert/förhandling/klagomål/juridik ger alltid mänsklig handläggning.
 *  - `avbojer` stoppar all vidare uppföljning.
 *  - Frågor hittas aldrig på: saknas inget underlag genereras inga frågor.
 */
import { z } from "zod";
import type { IntentLevel } from "./intent";
import { ESCALATION_INTENTS, type ReplyClassification, type ReplyIntent } from "@/lib/ai-sales/reply";
import type { GrowthOutcomeType } from "./outcomes";

export const nurtureStatusSchema = z.enum([
  "pending",
  "review",
  "approved",
  "sent",
  "replied",
  "cancelled",
]);
export type NurtureStatus = z.infer<typeof nurtureStatusSchema>;

export const NURTURE_STATUS_LABEL: Record<NurtureStatus, string> = {
  pending: "Planerad",
  review: "Väntar på granskning",
  approved: "Godkänd (ej skickad)",
  sent: "Markerad som skickad (test)",
  replied: "Svar mottaget",
  cancelled: "Avslutad",
};

/** Tillåtna statusövergångar. Allt annat avvisas. */
const TRANSITIONS: Record<NurtureStatus, NurtureStatus[]> = {
  pending: ["review", "approved", "cancelled"],
  review: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["replied", "cancelled"],
  replied: ["review", "cancelled"],
  cancelled: [],
};

export function canTransitionNurture(from: NurtureStatus, to: NurtureStatus): boolean {
  return from === to || (TRANSITIONS[from] ?? []).includes(to);
}

/** Nivåer som får ligga i nurture-kön. */
export const NURTURE_LEVELS: IntentLevel[] = ["LÅG", "NORMAL"];

/** Väntetid till nästa steg, per intent-nivå. */
export const NURTURE_DELAY_HOURS: Record<"LÅG" | "NORMAL", number> = { LÅG: 72, NORMAL: 24 };

export type NurtureEligibility = {
  eligible: boolean;
  reason: string;
};

export type NurtureEligibilityInput = {
  intentLevel: IntentLevel;
  /** true när utfallet är avgjort (won/lost). */
  terminal: boolean;
  /** Policy/guardrails har redan eskalerat leadet. */
  humanTakeover: boolean;
  /** Leadet har tackat nej tidigare. */
  optedOut?: boolean;
};

export function evaluateNurtureEligibility(input: NurtureEligibilityInput): NurtureEligibility {
  if (input.optedOut) {
    return { eligible: false, reason: "Leadet har tackat nej – ingen vidare uppföljning." };
  }
  if (input.terminal) {
    return { eligible: false, reason: "Utfallet är avgjort – leadet lämnar nurture-kön." };
  }
  if (input.humanTakeover) {
    return {
      eligible: false,
      reason: "Kräver mänsklig handläggning (pris, avtal eller annan känslig fråga).",
    };
  }
  if (!NURTURE_LEVELS.includes(input.intentLevel)) {
    return {
      eligible: false,
      reason: `Intent ${input.intentLevel} hanteras personligen och går inte via nurture-kön.`,
    };
  }
  return {
    eligible: true,
    reason: `Intent ${input.intentLevel} – billig uppföljning i stället för att släppa leadet.`,
  };
}

/** Formulerar en fråga av en saknad uppgift. Ingen AI, ingen fantasi. */
function questionFor(missing: string): string {
  const m = missing.trim();
  if (!m) return "";
  return `Kan du berätta lite mer om ${m.toLowerCase()}?`;
}

export type NurtureQuestionInput = {
  missingInformation: string[];
  /** Redan formulerade följdfrågor från sälj-/analyssteget. */
  existingQuestions?: string[];
  /** true när servern redan verifierat geografin – fråga inte om plats. */
  geographyVerified?: boolean;
};

/**
 * 1–3 korta frågor, i första hand återanvända från analysen.
 * Saknas inget underlag returneras en tom lista – systemet hittar inte på.
 */
export function buildNurtureQuestions(input: NurtureQuestionInput): string[] {
  const isLocation = (text: string) => /plats|ort|omr[åa]de|postnummer|adress/i.test(text);
  const drop = (text: string) => !text.trim() || (input.geographyVerified === true && isLocation(text));

  const missing = (input.missingInformation ?? []).filter((m) => !drop(m));
  if (missing.length === 0) return [];

  const fromAnalysis = (input.existingQuestions ?? []).map((q) => q.trim()).filter((q) => !drop(q));
  const generated = missing.map(questionFor).filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [...fromAnalysis, ...generated]) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === 3) break;
  }
  return out;
}

/** Tidpunkt för nästa steg. Deterministisk utifrån intent-nivån. */
export function nextNurtureStepAt(level: IntentLevel, from: Date = new Date()): string | null {
  if (level !== "LÅG" && level !== "NORMAL") return null;
  return new Date(from.getTime() + NURTURE_DELAY_HOURS[level] * 3600_000).toISOString();
}

export type NurturePlan = {
  eligible: boolean;
  status: NurtureStatus;
  reason: string;
  questions: string[];
  nextStepAt: string | null;
  /** Alltid "review" eller "test" – live är blockerat i kod. */
  executionMode: "test" | "review";
};

export type NurturePlanInput = NurtureEligibilityInput & NurtureQuestionInput & {
  now?: Date;
  executionMode?: "test" | "review";
};

/**
 * Bygger en komplett plan. Utan verkliga luckor i underlaget hamnar leadet i
 * kön utan frågor – då finns inget att fråga om och inget skickas.
 */
export function buildNurturePlan(input: NurturePlanInput): NurturePlan {
  const eligibility = evaluateNurtureEligibility(input);
  const mode = input.executionMode === "test" ? "test" : "review";

  if (!eligibility.eligible) {
    return {
      eligible: false,
      status: "cancelled",
      reason: eligibility.reason,
      questions: [],
      nextStepAt: null,
      executionMode: mode,
    };
  }

  const questions = buildNurtureQuestions(input);
  // Ett komplett men svagt lead kastas inte: det får en mjuk "håll varmt"-uppföljning.
  const nextStepAt = nextNurtureStepAt(input.intentLevel, input.now);

  return {
    eligible: true,
    status: "pending",
    reason:
      questions.length > 0
        ? eligibility.reason
        : "Underlaget är komplett – mjuk uppföljning för att hålla leadet varmt.",
    questions,
    nextStepAt,
    executionMode: mode,
  };
}

export type NurtureReplyEffect = {
  status: NurtureStatus;
  /** true = ingen mer automatisk uppföljning. */
  stop: boolean;
  humanTakeover: boolean;
  /** Signal som senare kan trigga kundnotifiering. Ingen notis skickas nu. */
  upgradeSignal: boolean;
  /** Utfall som ska registreras i Growth-motorn, om något. */
  outcome: GrowthOutcomeType | null;
  reason: string;
};

/** Intents som räknas som tydligt köpintresse. */
export const UPGRADE_INTENTS: ReplyIntent[] = ["intresserad", "vill_boka"];

/**
 * Effekten av ett inkommande svar. Ren funktion – ingen persistens,
 * inga externa anrop, ingen notifiering.
 */
export function applyReplyToNurture(classification: ReplyClassification): NurtureReplyEffect {
  const intent = classification.intent;

  if (intent === "avbojer") {
    return {
      status: "cancelled",
      stop: true,
      humanTakeover: false,
      upgradeSignal: false,
      outcome: "replied",
      reason: "Leadet tackade nej – uppföljningen stoppas.",
    };
  }

  if (ESCALATION_INTENTS.includes(intent) || classification.escalate) {
    return {
      status: "review",
      stop: true,
      humanTakeover: true,
      upgradeSignal: intent === "pris_offert" || intent === "forhandling",
      outcome: "replied",
      reason: "Pris, förhandling, klagomål och juridik hanteras alltid av en människa.",
    };
  }

  if (UPGRADE_INTENTS.includes(intent)) {
    return {
      status: "review",
      stop: true,
      humanTakeover: false,
      upgradeSignal: true,
      outcome: intent === "vill_boka" ? "meeting_booked" : "replied",
      reason:
        intent === "vill_boka"
          ? "Leadet vill boka – uppgraderingssignal för kundnotifiering (skickas inte här)."
          : "Positivt svar – uppgraderingssignal för kundnotifiering (skickas inte här).",
    };
  }

  return {
    status: "replied",
    stop: false,
    humanTakeover: false,
    upgradeSignal: false,
    outcome: "replied",
    reason: "Svar mottaget – fortsatt billig uppföljning.",
  };
}

/**
 * Exakt text som den GAMLA regeln skrev när ett komplett lead avbröts.
 * Används enbart för att kunna omplanera dessa rader efter policyändringen.
 */
export const LEGACY_COMPLETE_CANCEL_REASON =
  "Underlaget är komplett – ingen kompletteringsfråga behövs.";

export type LegacyCancelRow = {
  status: NurtureStatus;
  reason?: string | null;
  stopped_reason?: string | null;
  human_takeover?: boolean | null;
  upgrade_signal?: boolean | null;
  last_reply_intent?: string | null;
  steps_taken?: number | null;
};

/**
 * true ENDAST för en cancelled-rad som skapades av gamla "komplett underlag"-regeln
 * och aldrig rörts av något svar, eskalering eller manuellt avslut.
 * Alla andra avslut förblir terminala.
 */
export function isLegacyCompleteCancelled(row: LegacyCancelRow): boolean {
  if (row.status !== "cancelled") return false;
  if (row.human_takeover === true || row.upgrade_signal === true) return false;
  if ((row.last_reply_intent ?? "").trim() !== "") return false;
  if ((row.steps_taken ?? 0) > 0) return false;

  const reason = (row.reason ?? "").trim();
  const stopped = (row.stopped_reason ?? "").trim();
  if (reason !== LEGACY_COMPLETE_CANCEL_REASON) return false;
  return stopped === "" || stopped === LEGACY_COMPLETE_CANCEL_REASON;
}
