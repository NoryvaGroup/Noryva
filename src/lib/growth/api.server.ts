/**
 * HTTP-lager för Noryva Growth API (maskin-till-maskin).
 *
 * Ordning: throttle -> HMAC/timestamp -> replayskydd (event-id) -> schema ->
 * operation med service-roll. Service-rollen används ALDRIG innan signaturen
 * är verifierad. Ingen operation här kan skicka mail, boka möten, aktivera
 * live/auto-send eller ändra experimentvikter.
 */
import {
  EVENT_ID_HEADER,
  GROWTH_API_SOURCE,
  createThrottle,
  headerRecord,
  parseGrowthBody,
  verifyGrowthRequest,
  type GrowthOperation,
} from "./api-security";
import {
  analyzeLeadCore,
  assignLeadVariantCore,
  growthRecommendationCore,
  registerOutcomeCore,
  routeLeadCore,
  type GrowthContext,
} from "./service.server";

const throttle = createThrottle(60, 60_000);

export type GrowthApiDeps = {
  secret?: string | undefined;
  /** Färdig Supabase-klient med service-roll. Laddas först efter verifiering. */
  getClient: () => Promise<GrowthContext>;
  /** Registrerar event-id. Returnerar false om anropet redan behandlats. */
  markEvent: (ctx: GrowthContext, eventId: string, payloadHash: string) => Promise<boolean>;
  now?: Date;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function defaultDeps(): Promise<GrowthApiDeps> {
  return {
    secret: process.env["NORYVA_GROWTH_API_SECRET"],
    getClient: async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return { supabase: supabaseAdmin, userId: null };
    },
    markEvent: async (ctx, eventId, payloadHash) => {
      const { error } = await ctx.supabase.from("inbound_webhook_events").insert({
        source: GROWTH_API_SOURCE,
        external_id: eventId,
        signature_verified: true,
        payload_hash: payloadHash,
      });
      if (error) {
        if (/duplicate key|23505/i.test(error.message)) return false;
        throw new Error(error.message);
      }
      return true;
    },
  };
}

async function runOperation(
  operation: GrowthOperation,
  ctx: GrowthContext,
  data: any,
): Promise<unknown> {
  switch (operation) {
    case "route-lead": {
      const { decision, qualification } = await routeLeadCore(ctx, data.leadId);
      return {
        leadId: data.leadId,
        route: decision.route,
        requestedRoute: decision.requestedRoute,
        reason: decision.reason,
        requiresHuman: decision.requiresHuman,
        llmCalls: decision.llmCalls,
        budgetState: decision.budgetState,
        qualification: {
          score: qualification.score,
          qualification: qualification.qualification,
          priority: qualification.priority,
        },
      };
    }
    case "analyze-lead": {
      // Ingen forceTier: routern avgör ensam om AI får köras.
      const result = await analyzeLeadCore(ctx, data.leadId, { forceTier: null, actor: "system" });
      return {
        ok: true,
        leadId: data.leadId,
        route: result.decision.route,
        tier: result.tier,
        model: result.model === "deterministic" ? null : result.model,
        llmCalls: result.tier === "ai_light" || result.tier === "ai_full" ? 1 : 0,
        estimatedCost: result.cost.estimatedCost,
        usedFallback: result.usedFallback,
        runId: result.runId,
        requiresHuman: result.decision.requiresHuman,
      };
    }
    case "assign-variant":
      return assignLeadVariantCore(ctx, data.leadId, data.experimentId ?? null);
    case "register-outcome":
      return registerOutcomeCore(ctx, {
        leadId: data.leadId,
        outcomeType: data.outcomeType,
        outcomeValue: data.outcomeValue,
        revenueValue: data.revenueValue,
        source: GROWTH_API_SOURCE,
      });
    case "growth-recommendation": {
      const report = await growthRecommendationCore(ctx, data.experimentId, false);
      return {
        experimentId: report.experiment.id,
        status: report.experiment.status,
        metrics: report.metrics,
        recommendation: report.recommendation,
      };
    }
  }
}

export async function handleGrowthApi(
  operation: GrowthOperation,
  request: Request,
  overrides?: Partial<GrowthApiDeps>,
): Promise<Response> {
  const deps = { ...(await defaultDeps()), ...(overrides ?? {}) };

  if (request.method !== "POST") return json(405, { error: "Endast POST." });

  const rawBody = await request.text();
  if (rawBody.length > 20_000) return json(413, { error: "För stor nyttolast." });

  const headers = headerRecord(request.headers);
  const ip = headers["cf-connecting-ip"] ?? headers["x-forwarded-for"] ?? "unknown";
  const gate = throttle.check(`${GROWTH_API_SOURCE}:${ip}`);
  if (!gate.allowed) {
    return new Response(JSON.stringify({ error: "För många anrop." }), {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(gate.retryAfterSeconds),
      },
    });
  }

  const verified = verifyGrowthRequest({
    secret: deps.secret,
    rawBody,
    headers,
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!verified.ok) return json(verified.status, { error: verified.error });

  const parsed = parseGrowthBody(operation, rawBody);
  if (!parsed.ok) return json(parsed.status, { error: parsed.error });

  try {
    const ctx = await deps.getClient();
    const fresh = await deps.markEvent(ctx, verified.eventId, await sha256Hex(rawBody));
    if (!fresh) {
      return json(409, { error: "Anropet har redan behandlats.", duplicate: true, eventId: verified.eventId });
    }
    const result = await runOperation(operation, ctx, parsed.data);
    return json(200, result);
  } catch (error) {
    console.error(`[growth-api:${operation}]`, error);
    return json(500, { error: "Operationen kunde inte slutföras." });
  }
}

export { EVENT_ID_HEADER };
