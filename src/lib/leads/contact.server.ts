/**
 * Serverlager för kundens statusmarkering "Kontaktad".
 *
 * Regler:
 * - GET får aldrig ändra state. Endast `loadLeadContactView` används av sidan.
 * - Statusändring sker bara via `markLeadContactedCore` (POST/server action)
 *   och kräver en giltig signerad token för exakt det leadet.
 * - Uppdateringen är idempotent: ett redan kontaktat lead ändras inte igen.
 * - Sync till Make är fail-safe. Ett misslyckat webhook-anrop får aldrig ångra
 *   databasstatusen och kundens sida visar fortfarande att det lyckades.
 */
import { verifyContactToken } from "./contact-token";

export type LeadWriter = {
  from: (table: string) => any;
};

export type ContactEnv = Record<string, string | undefined>;

export const CUSTOMER_STATUS_NEW = "Ny";
export const CUSTOMER_STATUS_CONTACTED = "Kontaktad";

export type LeadContactView =
  | { ok: false; reason: string }
  | { ok: true; leadId: string; status: string; contactedAt: string | null; label: string };

function leadLabel(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const answers = (p["answers"] ?? p) as Record<string, unknown>;
  const name = answers["foretagsnamn"] ?? answers["namn"] ?? "";
  return typeof name === "string" ? name.trim() : "";
}

/** Läser leadets status. Ingen skrivning – säkert för mailskannrar. */
export async function loadLeadContactView(args: {
  supabase: LeadWriter;
  env: ContactEnv;
  leadId: string;
  token: string;
  now?: Date;
}): Promise<LeadContactView> {
  const check = verifyContactToken({
    secret: args.env["NORYVA_LEAD_ACTION_SECRET"],
    leadId: args.leadId,
    token: args.token,
    now: args.now,
  });
  if (!check.valid) return { ok: false, reason: check.reason };

  const { data, error } = await args.supabase
    .from("leads")
    .select("id, customer_status, contacted_at, payload")
    .eq("id", args.leadId)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "Förfrågan hittades inte." };

  return {
    ok: true,
    leadId: data.id as string,
    status: (data.customer_status as string) ?? CUSTOMER_STATUS_NEW,
    contactedAt: (data.contacted_at as string | null) ?? null,
    label: leadLabel(data.payload),
  };
}

export type MarkResult =
  | { ok: false; reason: string }
  | { ok: true; status: string; alreadyDone: boolean; synced: boolean };

async function syncStatus(args: {
  env: ContactEnv;
  leadId: string;
  status: string;
}): Promise<boolean> {
  const url = args.env["NORYVA_LEAD_STATUS_WEBHOOK_URL"];
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId: args.leadId, status: args.status }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    // Fail-safe: synkfel loggas internt men påverkar aldrig databasstatusen.
    console.warn("[lead-status] sync misslyckades", { leadId: args.leadId });
    return false;
  }
}

export async function markLeadContactedCore(args: {
  supabase: LeadWriter;
  env: ContactEnv;
  leadId: string;
  token: string;
  now?: Date;
}): Promise<MarkResult> {
  const check = verifyContactToken({
    secret: args.env["NORYVA_LEAD_ACTION_SECRET"],
    leadId: args.leadId,
    token: args.token,
    now: args.now,
  });
  if (!check.valid) return { ok: false, reason: check.reason };

  const { data: lead, error: readErr } = await args.supabase
    .from("leads")
    .select("id, customer_status")
    .eq("id", args.leadId)
    .maybeSingle();
  if (readErr || !lead) return { ok: false, reason: "Förfrågan hittades inte." };

  if ((lead.customer_status as string) === CUSTOMER_STATUS_CONTACTED) {
    return { ok: true, status: CUSTOMER_STATUS_CONTACTED, alreadyDone: true, synced: false };
  }

  const { error: updErr } = await args.supabase
    .from("leads")
    .update({
      customer_status: CUSTOMER_STATUS_CONTACTED,
      contacted_at: (args.now ?? new Date()).toISOString(),
    })
    .eq("id", args.leadId)
    .neq("customer_status", CUSTOMER_STATUS_CONTACTED);

  if (updErr) return { ok: false, reason: "Statusen kunde inte sparas. Försök igen." };

  const synced = await syncStatus({
    env: args.env,
    leadId: args.leadId,
    status: CUSTOMER_STATUS_CONTACTED,
  });

  return { ok: true, status: CUSTOMER_STATUS_CONTACTED, alreadyDone: false, synced };
}
