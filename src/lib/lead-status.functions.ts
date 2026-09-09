/**
 * Publika (oinloggade) serverfunktioner för kundens statusmarkering.
 * Behörigheten kommer från den signerade token i länken, inte från inloggning.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { runtimeEnvFromRequest } from "@/lib/growth/runtime-env";
import { loadLeadContactView, markLeadContactedCore } from "@/lib/leads/contact.server";

const input = z.object({
  leadId: z.string().uuid(),
  token: z.string().trim().min(10).max(300),
});

function serverEnv() {
  return runtimeEnvFromRequest(getRequest());
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { from: (table: string) => any };
}

/** Endast läsning – anropas av bekräftelsesidan. Ändrar aldrig något. */
export const getLeadContactView = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data }) => {
    return loadLeadContactView({
      supabase: await adminClient(),
      env: serverEnv(),
      leadId: data.leadId,
      token: data.token,
    });
  });

/** Utför statusändringen. Kräver ett aktivt klick från kunden. */
export const markLeadContacted = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data }) => {
    return markLeadContactedCore({
      supabase: await adminClient(),
      env: serverEnv(),
      leadId: data.leadId,
      token: data.token,
    });
  });
