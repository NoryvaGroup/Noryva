/**
 * Säkerhetslager för Noryva Growth API (maskin-till-maskin, t.ex. Make).
 *
 * Rena funktioner utan sidoeffekter så att allt kan testas. Verifieringen
 * återanvänder projektets befintliga HMAC-mönster i
 * `@/lib/ai-sales/webhook-security`.
 *
 * Headers som krävs på varje anrop:
 *   x-noryva-timestamp : unix-sekunder
 *   x-noryva-signature : hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
 *   x-noryva-event-id  : unikt id per anrop (replayskydd)
 */
import { z } from "zod";
import { createHmacVerifier } from "@/lib/ai-sales/webhook-security";
import { growthOutcomeTypeSchema } from "./outcomes";
import { makeContextSchema } from "./make-contract";

export const GROWTH_API_SOURCE = "make_growth";
export const SIGNATURE_HEADER = "x-noryva-signature";
export const TIMESTAMP_HEADER = "x-noryva-timestamp";
export const EVENT_ID_HEADER = "x-noryva-event-id";
/** Maximal ålder på ett anrop innan det räknas som replay. */
export const TOLERANCE_SECONDS = 300;

export type GrowthOperation =
  | "route-lead"
  | "analyze-lead"
  | "assign-variant"
  | "register-outcome"
  | "growth-recommendation"
  | "plan-nurture-test"
  | "register-nurture-reply-test"
  | "due-nurture-reviews"
  | "claim-nurture-review"
  | "complete-nurture-review"
  | "fail-nurture-review"
  | "register-reviewed-nurture-reply"
  | "customer-config"
  | "due-lead-reminders"
  | "delivery-recovery";

/**
 * `makeContext` är frivilligt. Utan det är beteendet identiskt med tidigare
 * versioner – befintliga anropare påverkas inte.
 */
const leadWithMakeContext = z
  .object({ leadId: z.string().uuid(), makeContext: makeContextSchema.optional() })
  .strict();

/**
 * Smala scheman. Notera att `analyze-lead` medvetet INTE tar emot någon
 * tier/modell – routern avgör ensam om AI får köras.
 */
export const GROWTH_API_SCHEMAS = {
  "route-lead": leadWithMakeContext,
  "analyze-lead": leadWithMakeContext,
  "assign-variant": z
    .object({ leadId: z.string().uuid(), experimentId: z.string().uuid().optional() })
    .strict(),
  "register-outcome": z
    .object({
      leadId: z.string().uuid(),
      outcomeType: growthOutcomeTypeSchema,
      outcomeValue: z.number().finite().optional(),
      revenueValue: z.number().finite().nonnegative().optional(),
    })
    .strict(),
  "growth-recommendation": z.object({ experimentId: z.string().uuid() }).strict(),
  // Endast test/granskning: planerar nurture och returnerar ett utkast som
  // aldrig skickas. Inga klientstyrda score/route/modellfält.
  "plan-nurture-test": leadWithMakeContext,
  // Endast test/granskning: registrerar ett inkommande svar PII-maskerat och
  // kör deterministisk klassificering. Ingen extern effekt möjlig.
  "register-nurture-reply-test": z
    .object({
      leadId: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
      /** Valfritt id från Make för idempotens. Bakåtkompatibelt. */
      sourceRef: z.string().trim().min(1).max(120).optional(),
      makeContext: makeContextSchema.optional(),
    })
    .strict(),

  // --- Granskad uppföljning (review outbox). Ingen av dessa kan aktivera
  // live-läge; utskicket görs av Make efter att en administratör godkänt. ---

  /** Bygger/uppdaterar granskningsposter för förfallna uppföljningar. */
  "due-nurture-reviews": z
    .object({ limit: z.number().int().min(1).max(25).optional() })
    .strict(),
  /** Hämtar ETT godkänt utskick. Sändbart innehåll lämnas ut exakt en gång. */
  "claim-nurture-review": z.object({ reviewId: z.string().uuid() }).strict(),
  /** Bokför ett bekräftat utskick. Kräver transportens meddelande-id. */
  "complete-nurture-review": z
    .object({
      reviewId: z.string().uuid(),
      attemptId: z.string().uuid(),
      transportMessageId: z.string().trim().min(1).max(400),
    })
    .strict(),
  /** Bokför ett misslyckat försök. Släpper aldrig posten för nytt försök. */
  "fail-nurture-review": z
    .object({
      reviewId: z.string().uuid(),
      attemptId: z.string().uuid(),
      outcome: z.enum(["not_sent", "unknown"]).optional(),
      reason: z.string().trim().max(400).optional(),
    })
    .strict(),
  /** Inkommande svar på ett verkligt skickat mail. Tråd via meddelande-id. */
  "register-reviewed-nurture-reply": z
    .object({
      inReplyTo: z.string().trim().min(1).max(400),
      fromEmail: z.string().trim().email().max(254),
      body: z.string().trim().min(1).max(8000),
      // Stabilt transport-id krävs: en texthash räcker inte som dedupe-nyckel.
      messageId: z.string().trim().min(1).max(400),
    })
    .strict(),
  /** Read-only kundkonfiguration. Ingen skrivning, inga hemligheter i svaret. */
  "customer-config": z.object({ customerId: z.string().uuid() }).strict(),
  /** Dry-run som standard. `execute` kräver dessutom runtime-flaggan. */
  "delivery-recovery": z
    .object({
      limit: z.number().int().min(1).max(100).optional(),
      execute: z.boolean().optional(),
    })
    .strict(),
  /** Read-only underlag för 24h-påminnelser. Ändrar aldrig status. */
  "due-lead-reminders": z
    .object({
      olderThanHours: z.number().int().min(1).max(720).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
} as const satisfies Record<GrowthOperation, z.ZodTypeAny>;

export type VerifyResult =
  | { ok: true; eventId: string }
  | { ok: false; status: number; error: string };

export function headerRecord(headers: Headers): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Verifierar signatur, tidsstämpel och att ett event-id finns. */
export function verifyGrowthRequest(args: {
  secret: string | undefined;
  rawBody: string;
  headers: Record<string, string | undefined>;
  now?: Date;
}): VerifyResult {
  if (!args.secret) {
    return { ok: false, status: 500, error: "NORYVA_GROWTH_API_SECRET saknas." };
  }
  const eventId = (args.headers[EVENT_ID_HEADER] ?? "").trim();
  if (!eventId || eventId.length > 200) {
    return { ok: false, status: 400, error: "Event-id saknas eller är ogiltigt." };
  }

  const verifier = createHmacVerifier({
    source: GROWTH_API_SOURCE,
    secret: args.secret,
    signatureHeader: SIGNATURE_HEADER,
    timestampHeader: TIMESTAMP_HEADER,
    toleranceSeconds: TOLERANCE_SECONDS,
  });
  const check = verifier.verify(args.rawBody, args.headers, args.now ?? new Date());
  if (!check.valid) return { ok: false, status: 401, error: check.reason };

  return { ok: true, eventId };
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export function parseGrowthBody(operation: GrowthOperation, rawBody: string): ParseResult<any> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody || "null");
  } catch {
    return { ok: false, status: 400, error: "Ogiltig JSON." };
  }
  const parsed = GROWTH_API_SCHEMAS[operation].safeParse(json);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Ogiltig nyttolast." };
  }
  return { ok: true, data: parsed.data };
}

export type ThrottleDecision = { allowed: boolean; retryAfterSeconds: number };

/**
 * Enkel in-memory-throttling per nyckel (signaturkälla + IP). Best effort:
 * räknaren är per serverinstans, så den är ett skydd mot skenande anrop –
 * inte en distribuerad rate limit. Nästa hårdningssteg finns dokumenterat i
 * NORYVA_2_ARCHITECTURE.md.
 */
export function createThrottle(limit = 60, windowMs = 60_000) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string, now = Date.now()): ThrottleDecision {
      const cutoff = now - windowMs;
      const list = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (list.length >= limit) {
        const oldest = list[0] ?? now;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
      }
      list.push(now);
      hits.set(key, list);
      if (hits.size > 5000) hits.clear();
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
