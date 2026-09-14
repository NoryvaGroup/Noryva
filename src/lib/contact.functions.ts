import { createServerFn } from "@tanstack/react-start";
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

export const submitContactRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("contact_requests").insert({
      namn: data.namn,
      foretag: data.foretag,
      epost: data.epost,
      telefon: data.telefon,
      hemsida: data.hemsida || null,
      forbattra: data.forbattra,
      meddelande: data.meddelande || null,
    });
    if (error) {
      console.error("[contact] kunde inte spara förfrågan", error.message);
      return { ok: false as const };
    }
    return { ok: true as const };
  });
