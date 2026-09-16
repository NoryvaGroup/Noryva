import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const input = z.object({
  namn: z.string().trim().min(2).max(100),
  foretag: z.string().trim().min(1).max(120),
  epost: z.string().trim().email().max(255),
  telefon: z.string().trim().min(6).max(30),
  hemsida: z.string().trim().max(200).optional().or(z.literal("")),
  forbattra: z.string().trim().min(1).max(200),
  meddelande: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** Samma spärr som offertformuläret: max 5 inskick per 10 minuter och IP. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`noryva:${ip}`));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export const submitContactRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ip = (
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0] ??
      "okand"
    ).trim();
    const ipHash = await hashIp(ip);

    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count } = await supabaseAdmin
      .from("contact_requests")
      .select("id", { count: "exact", head: true })
      .eq("source_ip_hash", ipHash)
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT) {
      return { ok: false as const, rateLimited: true as const };
    }

    const { error } = await supabaseAdmin.from("contact_requests").insert({
      namn: data.namn,
      foretag: data.foretag,
      epost: data.epost,
      telefon: data.telefon,
      hemsida: data.hemsida || null,
      forbattra: data.forbattra,
      meddelande: data.meddelande || null,
      source_ip_hash: ipHash,
    });
    if (error) {
      console.error("[contact] kunde inte spara förfrågan", error.message);
      return { ok: false as const };
    }
    return { ok: true as const };
  });
