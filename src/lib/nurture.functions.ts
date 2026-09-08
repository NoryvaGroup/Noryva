/**
 * Nurture – adminserverfunktioner.
 *
 * SÄKERHET: kräver inloggad administratör. Ingen funktion här skickar mail,
 * SMS, notifieringar eller bokar möten. Statusen "sent" betyder markerad som
 * skickad i test/granskning.
 *
 * SCHEMAN:
 *   planNurture         { leadId } -> { ok, changed, intent, state }
 *   getNurtureQueue     { limit? } -> { items, due }
 *   setNurtureStatus    { leadId, status }
 *   registerNurtureReply{ leadId, body } -> { classification, effect, intent }
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { GrowthContext } from "./growth/service.server";
import { nurtureStatusSchema } from "./growth/nurture";
import {
  dueNurtureItemsCore,
  nurtureQueueCore,
  planNurtureCore,
  registerNurtureReplyCore,
  setNurtureStatusCore,
} from "./growth/nurture.server";

async function assertAdmin(context: GrowthContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Behörighet saknas.");
}

export const planNurture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string }) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return planNurtureCore(ctx, data.leadId);
  });

export const getNurtureQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    const [queue, due] = await Promise.all([nurtureQueueCore(ctx), dueNurtureItemsCore(ctx)]);
    return { items: queue.items, due: due.items, now: due.now };
  });

export const setNurtureStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string; status: string }) =>
    z.object({ leadId: z.string().uuid(), status: nurtureStatusSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return setNurtureStatusCore(ctx, { leadId: data.leadId, status: data.status });
  });

export const registerNurtureReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leadId: string; body: string }) =>
    z.object({ leadId: z.string().uuid(), body: z.string().min(1).max(4000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as GrowthContext;
    await assertAdmin(ctx);
    return registerNurtureReplyCore(ctx, { leadId: data.leadId, body: data.body, source: "admin_test" });
  });
