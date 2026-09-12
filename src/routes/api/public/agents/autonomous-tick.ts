import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgentCronRequest } from "@/lib/agents/cron-auth.server";

/**
 * Schemalagd intern tick för Agent HQ (autonomt läge).
 *
 * Autentiseras med LOVABLE_CRON_SECRET (Bearer). Fail closed: utan giltig
 * hemlighet görs ingenting. Ticken gör högst EN provider-körning, allt resultat
 * stannar i granskning och ingen extern effekt kan uppstå.
 *
 * Schemaläggning (pg_cron, en gång per dygn 06:15 UTC):
 *   select cron.schedule('noryva-agent-hq-tick', '15 6 * * *', $$
 *     select net.http_post(
 *       url:='https://noryva.se/api/public/agents/autonomous-tick',
 *       headers:='{"Content-Type":"application/json","Authorization":"Bearer <LOVABLE_CRON_SECRET>"}'::jsonb,
 *       body:='{}'::jsonb) $$);
 */
export const Route = createFileRoute("/api/public/agents/autonomous-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { autonomousTickCore } = await import("@/lib/agents/autonomous.server");
        const outcome = await autonomousTickCore({
          supabase: supabaseAdmin,
          harness: { request },
        });

        return new Response(JSON.stringify(outcome.body), {
          status: outcome.status,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
