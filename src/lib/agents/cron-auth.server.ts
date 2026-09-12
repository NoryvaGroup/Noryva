/**
 * Auth för Agent HQ:s schemalagda tick.
 *
 * Hemligheten genereras och lagras i databasens valv (Vault) och skickas av
 * pg_cron som Bearer-token. Servern jämför endast SHA-256-avtrycket som ligger
 * i `public.agent_cron_auth`. Värdet finns aldrig i kod, loggar eller svar.
 *
 * Fail closed: saknas token, avtryck eller matchning returneras 401.
 * Plattformens `LOVABLE_CRON_SECRET` accepteras fortfarande som alternativ.
 */
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

const CRON_AUTH_LABEL = "agent_autonomous_tick";

function bearerToken(request: Request): string | null {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

export async function authenticateAgentCronRequest(
  request: Request,
): Promise<Response | null> {
  const token = bearerToken(request);
  if (!token) return new Response("Unauthorized", { status: 401 });

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("agent_cron_auth")
      .select("secret_sha256")
      .eq("label", CRON_AUTH_LABEL)
      .maybeSingle();

    const expected = data?.secret_sha256 ?? "";
    if (expected) {
      const { createHash, timingSafeEqual } = await import("node:crypto");
      const provided = createHash("sha256").update(token, "utf8").digest("hex");
      const a = Buffer.from(provided, "utf8");
      const b = Buffer.from(expected, "utf8");
      if (a.length === b.length && timingSafeEqual(a, b)) return null;
    }
  } catch {
    // Fail closed: faller vidare till plattformens cron-auth.
  }

  if (process.env["LOVABLE_CRON_SECRET"]) {
    return authenticateCronRequest(request);
  }
  return new Response("Unauthorized", { status: 401 });
}
