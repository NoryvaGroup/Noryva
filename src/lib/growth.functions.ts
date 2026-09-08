/**
 * Noryva 2.0 – Growth Engine, serverfunktioner (adminanvändning).
 *
 * SÄKERHET: samtliga funktioner kräver inloggad administratör. Ingenting här
 * skickar e-post, bokar möten eller kontaktar kunder. Analys ger endast interna
 * utkast; optimizern ger endast rekommendationer.
 *
 * Själva logiken ligger i `growth/service.server.ts` och delas med de
 * HMAC-verifierade maskinendpointerna under /api/public/growth/*.
 *
 * SCHEMAN (bakåtkompatibla med nuvarande landing/Make-data):
 *
 *   routeLead            { leadId }
 *     -> { decision, qualification, budget, usage }
 *   analyzeLead          { leadId, forceTier? }   (forceTier endast för admin)
 *     -> { ok, decision, tier, model, usedFallback, cost, runId, research }
 *   assignLeadVariant    { leadId, experimentId? }
 *   registerOutcome      { leadId, outcomeType, outcomeValue?, revenueValue?, source? }
 *   getGrowthRecommendation { experimentId, persist? }
 *   getGrowthDashboard   { }
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { growthOutcomeTypeSchema } from "./growth/outcomes";
import {
  analyzeLeadCore,
  assignLeadVariantCore,
  growthDashboardCore,
  growthRecommendationCore,
  registerOutcomeCore,
  routeLeadCore,
  type GrowthContext,
} from "./growth/service.server";

async function assertAdmin(context: GrowthContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Behörighet saknas.");
}

export const routeLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string }) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return routeLeadCore(ctx, data.leadId);
  });

export const analyzeLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string; forceTier?: "ai_light" | "ai_full" }) =>
    z
      .object({
        leadId: z.string().uuid(),
        forceTier: z.enum(["ai_light", "ai_full"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return analyzeLeadCore(ctx, data.leadId, { forceTier: data.forceTier ?? null });
  });

export const assignLeadVariant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string; experimentId?: string }) =>
    z.object({ leadId: z.string().uuid(), experimentId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return assignLeadVariantCore(ctx, data.leadId, data.experimentId ?? null);
  });

export const registerOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      leadId: string;
      outcomeType: string;
      outcomeValue?: number;
      revenueValue?: number;
      source?: string;
    }) =>
      z
        .object({
          leadId: z.string().uuid(),
          outcomeType: growthOutcomeTypeSchema,
          outcomeValue: z.number().optional(),
          revenueValue: z.number().optional(),
          source: z.string().max(40).default("admin"),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return registerOutcomeCore(ctx, {
      leadId: data.leadId,
      outcomeType: data.outcomeType,
      outcomeValue: data.outcomeValue,
      revenueValue: data.revenueValue,
      source: data.source,
    });
  });

export const getGrowthRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { experimentId: string; persist?: boolean }) =>
    z.object({ experimentId: z.string().uuid(), persist: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return growthRecommendationCore(ctx, data.experimentId, data.persist);
  });

export const getGrowthDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return growthDashboardCore(ctx);
  });
