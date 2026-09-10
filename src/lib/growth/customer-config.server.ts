/**
 * Read-only kundkonfiguration för Growth API (`customer-config`).
 *
 * Syfte: Supabase ska vara enda source of truth för kundkonfiguration så att
 * Make kan hämta aktuella värden i stället för ett externt kalkylark.
 *
 * Säkerhet: ingen skrivning, ingen extern effekt, inga hemligheter i svaret.
 * Endast fält som redan är kundkonfiguration lämnas ut – aldrig webhook-URL:er,
 * nycklar eller andra credentials.
 */
import { defaultProfile, rowToProfile } from "@/lib/ai-sales/profile";
import { rowToMailChannel } from "./mail-channel";
import type { GrowthContext } from "./service.server";

export type CustomerConfigResult =
  | { status: 404; body: { error: string; customerId: string } }
  | { status: 200; body: Record<string, unknown> };

export async function customerConfigCore(
  ctx: GrowthContext,
  customerId: string,
): Promise<CustomerConfigResult> {
  const { data: customer, error } = await ctx.supabase
    .from("customers")
    .select("id, name, industry, service_area, status")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!customer) {
    return { status: 404, body: { error: "Kunden hittades inte.", customerId } };
  }

  const { data: profileRow, error: profileError } = await ctx.supabase
    .from("customer_profiles")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  // Saknad profil ger dokumenterade branschdefaults – aldrig gissade mottagare.
  const profile = profileRow
    ? rowToProfile(profileRow)
    : defaultProfile(customerId, String(customer["industry"] ?? ""));

  // Avsändaridentitet är helt separat från notify-mottagare och fail closed:
  // saknas raden eller är den inte verifierad blir verified=false, utan fallback.
  const { data: mailRow, error: mailError } = await ctx.supabase
    .from("customer_mail_channels")
    .select("provider, sender_email, sender_name, reply_to_email, inbound_route_key, connection_alias, status, verified_at")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (mailError) throw new Error(mailError.message);
  const mailChannel = rowToMailChannel(mailRow);

  return {
    status: 200,
    body: {
      customerId,
      name: String(customer["name"] ?? ""),
      industry: String(customer["industry"] ?? ""),
      serviceArea: String(customer["service_area"] ?? ""),
      status: String(customer["status"] ?? ""),
      profileExists: Boolean(profileRow),
      notifyRecipients: profile.notifyRecipients,
      executionMode: profile.executionMode,
      aiAssistantEnabled: profile.aiAssistantEnabled,
      localPostalPrefix: String(profileRow?.["local_postal_prefix"] ?? ""),
      regionalPostalPrefix: String(profileRow?.["regional_postal_prefix"] ?? ""),
      tone: profile.tone,
      language: profile.language,
      leadPrefix: profile.leadPrefix,
      followupRules: profile.followupRules,
      bookingRules: profile.bookingRules,
      mailChannel,
      externalEffect: false,
    },
  };
}
