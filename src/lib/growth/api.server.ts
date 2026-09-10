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
import { runtimeEnvFromRequest, type RuntimeEnv } from "./runtime-env";
import { LeadBindingError } from "./make-contract";


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

/** Read the Growth API secret from the Cloudflare Worker env binding attached
 *  to the request by src/server.ts, falling back to process.env for local dev/tests. */
function getGrowthApiSecret(request?: Request): string | undefined {
  const fromBinding = (request as Request & { env?: Record<string, unknown> })?.env?.[
    "NORYVA_GROWTH_API_SECRET"
  ];
  if (typeof fromBinding === "string") return fromBinding;
  return process.env["NORYVA_GROWTH_API_SECRET"];
}

async function defaultDeps(request?: Request): Promise<GrowthApiDeps> {
  return {
    secret: getGrowthApiSecret(request),
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

/** Operationer som styr sin egen HTTP-status. */
type OperationOutcome = { __status: number; body: unknown };
function withStatus(status: number, body: unknown): OperationOutcome {
  return { __status: status, body };
}
function isOutcome(value: unknown): value is OperationOutcome {
  return typeof value === "object" && value !== null && "__status" in value;
}

/**
 * Läser kundkonfiguration för ett lead från samma read-only källa som
 * `customer-config`. Fail closed: hittas ingen kund blir `customerConfig` null
 * med tydligt fel – aldrig en gissad mottagare eller legacy recipient_email.
 */
async function analyzeCustomerConfig(
  ctx: GrowthContext,
  customerId: string,
): Promise<{ customerConfig: Record<string, unknown> | null; customerConfigError: string | null }> {
  if (!customerId) {
    return { customerConfig: null, customerConfigError: "Kundbindning saknas för förfrågan." };
  }
  const { customerConfigCore } = await import("./customer-config.server");
  const result = await customerConfigCore(ctx, customerId);
  if (result.status !== 200) {
    return {
      customerConfig: null,
      customerConfigError: String((result.body as Record<string, unknown>)["error"] ?? "Kunden hittades inte."),
    };
  }
  return { customerConfig: result.body, customerConfigError: null };
}

async function runOperation(
  operation: GrowthOperation,
  ctx: GrowthContext,
  data: any,
  env: RuntimeEnv,
): Promise<unknown> {
  switch (operation) {
    case "route-lead": {
      const { decision, qualification, intent, normalized } = await routeLeadCore(ctx, data.leadId, {
        env,
        makeContext: data.makeContext ?? null,
      });
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
        intent: { score: intent.score, level: intent.level, reason: intent.reason },
        normalized,
      };
    }

    case "analyze-lead": {
      // Ingen forceTier: routern avgör ensam om AI får köras.
      const result = await analyzeLeadCore(ctx, data.leadId, {
        forceTier: null,
        actor: "system",
        env,
        makeContext: data.makeContext ?? null,
      });
      return {
        ok: true,
        leadId: data.leadId,
        route: result.decision.route,
        tier: result.tier,
        model: result.model === "deterministic" ? null : result.model,
        // Faktiska försök, inte härlett ur tier: ett misslyckat AI-anrop
        // rapporteras som 1 även när svaret föll tillbaka på deterministik.
        llmCalls: result.llmAttempts,
        attemptedTier: result.attemptedTier,
        attemptedModel: result.attemptedModel,
        reused: result.reused,
        estimatedCost: result.cost.estimatedCost,
        usedFallback: result.usedFallback,
        runId: result.runId,
        requiresHuman: result.decision.requiresHuman,
        normalized: result.normalized,
        // Kundkonfiguration härleds ENDAST från leadets verkliga customer_id i
        // Supabase (makeContext kan aldrig byta kund – fel bindning ger 403).
        // Ingen fallback till kalkylark eller customers.recipient_email.
        ...(await analyzeCustomerConfig(ctx, result.normalized.customer_id)),
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

    case "plan-nurture-test": {
      // Ren test/granskningsoperation: inget mail, ingen bokning, ingen notis.
      const { previewNurtureTestCore } = await import("./nurture.server");
      return previewNurtureTestCore(ctx, data.leadId, {
        makeContext: data.makeContext ?? null,
      });
    }

    case "register-nurture-reply-test": {
      // Ren test/granskningsoperation: registrerar ett svar PII-maskerat och
      // kör befintlig deterministisk klassificering. Ingen extern effekt.
      const { registerNurtureReplyCore } = await import("./nurture.server");
      const result = await registerNurtureReplyCore(ctx, {
        leadId: data.leadId,
        body: data.body,
        source: GROWTH_API_SOURCE,
        sourceRef: data.sourceRef,
        makeContext: data.makeContext ?? null,
      });
      return {
        ok: true,
        classification: result.classification,
        effect: {
          stop: result.effect.stop,
          humanTakeover: result.effect.humanTakeover,
          upgradeSignal: result.effect.upgradeSignal,
          reason: result.effect.reason,
        },
        previousIntent: result.previousIntent,
        newIntent: result.intent,
        nurtureStatus: result.state.status,
        outcome: result.effect.outcome,
        conversationId: result.conversationId,
        sourceRef: result.sourceRef,
        stored: result.inboundStored,
        duplicate: result.inboundDuplicate,
        notificationSent: false,
        externalEffect: false,
      };
    }

    case "due-nurture-reviews": {
      const { refreshDueNurtureReviewsCore } = await import("./nurture-review.server");
      return refreshDueNurtureReviewsCore(ctx, { limit: data.limit ?? 10 });
    }

    case "claim-nurture-review": {
      const { claimNurtureReviewCore } = await import("./nurture-review.server");
      const result = await claimNurtureReviewCore(ctx, { reviewId: data.reviewId }, env);
      const { status, ...body } = result as { status: number } & Record<string, unknown>;
      return withStatus(status, body);
    }

    case "complete-nurture-review": {
      const { completeNurtureReviewCore } = await import("./nurture-review.server");
      const result = await completeNurtureReviewCore(ctx, {
        reviewId: data.reviewId,
        attemptId: data.attemptId,
        transportMessageId: data.transportMessageId,
      });
      const { status, ...body } = result as { status: number } & Record<string, unknown>;
      return withStatus(status, { ...body, externalEffect: false, notificationSent: false });
    }

    case "fail-nurture-review": {
      const { failNurtureReviewCore } = await import("./nurture-review.server");
      const result = await failNurtureReviewCore(ctx, {
        reviewId: data.reviewId,
        attemptId: data.attemptId,
        outcome: data.outcome,
        reason: data.reason,
      });
      const { status, ...body } = result as { status: number } & Record<string, unknown>;
      return withStatus(status, body);
    }

    case "due-lead-reminders": {
      const { dueLeadRemindersCore } = await import("./lead-reminders.server");
      return dueLeadRemindersCore(
        ctx,
        { olderThanHours: data.olderThanHours, limit: data.limit },
        env,
      );
    }

    case "claim-lead-reminder": {
      const { claimLeadReminderCore } = await import("./lead-reminders.server");
      const result = await claimLeadReminderCore(
        ctx,
        { leadId: data.leadId, olderThanHours: data.olderThanHours },
        env,
      );
      const { status, ...body } = result as { status: number } & Record<string, unknown>;
      return withStatus(status, body);
    }

    case "complete-lead-reminder": {
      const { completeLeadReminderCore } = await import("./lead-reminders.server");
      const result = await completeLeadReminderCore(ctx, {
        reminderId: data.reminderId,
        attemptId: data.attemptId,
        transportMessageId: data.transportMessageId,
      });
      const { status, ...body } = result as { status: number } & Record<string, unknown>;
      return withStatus(status, { ...body, externalEffect: false, notificationSent: false });
    }

    case "fail-lead-reminder": {
      const { failLeadReminderCore } = await import("./lead-reminders.server");
      const result = await failLeadReminderCore(ctx, {
        reminderId: data.reminderId,
        attemptId: data.attemptId,
        outcome: data.outcome,
        reason: data.reason,
      });
      const { status, ...body } = result as { status: number } & Record<string, unknown>;
      return withStatus(status, body);
    }

    case "delivery-recovery": {
      const { deliveryRecoveryCore } = await import("./delivery-recovery.server");
      const result = await deliveryRecoveryCore(
        ctx,
        { limit: data.limit, execute: data.execute },
        env,
      );
      return withStatus(result.status, result.body);
    }

    case "review-reconciliation": {
      const { reviewReconciliationCore } = await import("./review-reconciliation.server");
      return reviewReconciliationCore(ctx, {
        claimedOlderThanMinutes: data.claimedOlderThanMinutes,
        limit: data.limit,
      });
    }

    case "customer-config": {
      const { customerConfigCore } = await import("./customer-config.server");
      const result = await customerConfigCore(ctx, data.customerId);
      return withStatus(result.status, result.body);
    }

    case "agents-dispatch-test": {
      const { dispatchAgentEventCore } = await import("@/lib/agents/dispatch.server");
      const result = await dispatchAgentEventCore(ctx, {
        type: data.type,
        leadId: data.leadId,
        occurrence: data.occurrence,
      });
      return withStatus(result.status, result.body);
    }

    case "register-reviewed-nurture-reply": {
      const { registerReviewedNurtureReplyCore } = await import("./nurture-review.server");
      const result = await registerReviewedNurtureReplyCore(ctx, {
        inReplyTo: data.inReplyTo,
        fromEmail: data.fromEmail,
        body: data.body,
        messageId: data.messageId,
      });
      const { status, ...body } = result as { status: number } & Record<string, unknown>;
      return withStatus(status, body);
    }
  }
}

export async function handleGrowthApi(
  operation: GrowthOperation,
  request: Request,
  overrides?: Partial<GrowthApiDeps>,
): Promise<Response> {
  const deps = { ...(await defaultDeps(request)), ...(overrides ?? {}) };

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
    const result = await runOperation(operation, ctx, parsed.data, runtimeEnvFromRequest(request));
    if (isOutcome(result)) return json(result.__status, result.body);
    return json(200, result);
  } catch (error) {
    // Fel kundbindning är ett klientfel, inte ett serverfel – och inträffar
    // alltid innan något modellanrop kan göras.
    if (error instanceof LeadBindingError) return json(403, { error: error.message });
    console.error(`[growth-api:${operation}]`, error);
    return json(500, { error: "Operationen kunde inte slutföras." });
  }
}

export { EVENT_ID_HEADER };
