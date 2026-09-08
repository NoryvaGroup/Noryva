import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { validateAnswers, type PublicLanding, type PublicQuestion } from "./landing/schema";
import { buildMakeFields, buildStoredPayload, readStoredPayload } from "./landing/make-adapter";
import { pickDeliveryFields, resolveClaim } from "./landing/delivery";
import { scoreVaruautomat } from "./landing/scoring";

const slugInput = z.object({ slug: z.string().trim().min(1).max(60) });

function serverPublicClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return { url, key };
}

async function rpcPublicLanding(slug: string): Promise<PublicLanding | null> {
  const { url, key } = serverPublicClient();
  const res = await fetch(`${url}/rest/v1/rpc/get_public_landing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as PublicLanding | null;
  if (!json || !json.slug) return null;
  return json;
}

export const getPublicLanding = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => slugInput.parse(input))
  .handler(async ({ data }) => {
    const landing = await rpcPublicLanding(data.slug);
    return { landing };
  });

/** UAT: endast test-routerna sätter test=true. Live-flödet är oförändrat. */
export const TEST_WEBHOOK_URL = "https://hook.eu1.make.com/h23e3fet88f3wq6jz22c6r4l3dat3xgc";

const submitInput = z.object({
  slug: z.string().trim().min(1).max(60),
  submission_id: z.string().uuid(),
  consent: z.boolean(),
  values: z.record(z.string(), z.string().max(1000)),
  company: z.string().max(200).optional().default(""), // honeypot
  test: z.boolean().optional().default(false),
});

async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`noryva:${ip}`));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export const submitPublicLead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => submitInput.parse(input))
  .handler(async ({ data }) => {
    // Honeypot: låtsas lyckas aldrig – returnera samma fel som vid ogiltig data.
    if (data.company.trim() !== "") {
      return { ok: false as const, message: "Förfrågan kunde inte tas emot." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: customer, error: cErr } = await supabaseAdmin
      .from("customers")
      .select("id, slug, name, industry, schema_version, status, recipient_email, delivery_webhook_url")
      .eq("slug", data.slug)
      .maybeSingle();

    if (cErr || !customer || customer.status !== "published") {
      return { ok: false as const, message: "Sidan tar inte emot förfrågningar just nu." };
    }
    if (!customer.delivery_webhook_url) {
      return {
        ok: false as const,
        message: "Formuläret är inte kopplat till någon mottagare ännu.",
      };
    }

    const { data: questionRows } = await supabaseAdmin
      .from("form_questions")
      .select("field_key, label, field_type, options, required")
      .eq("customer_id", customer.id)
      .order("sort_order", { ascending: true });

    const questions = (questionRows ?? []) as PublicQuestion[];
    const errors = validateAnswers(questions, data.values, data.consent);
    if (Object.keys(errors).length > 0) {
      return { ok: false as const, message: "Kontrollera fälten nedan.", errors };
    }

    // Endast fält som finns i kundens formulär sparas.
    const allowed = new Set(questions.map((q) => q.field_key));
    const answers: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.values)) {
      if (allowed.has(k)) answers[k] = v.trim();
    }

    const makeFields = buildMakeFields({
      industry: customer.industry,
      questions,
      values: answers,
    });

    const idempotencyKey = `${customer.id}:${data.submission_id}`;

    // Idempotensuppslaget sker FÖRE hastighetsspärren så att ett nytt
    // leveransförsök på en redan sparad förfrågan aldrig blockeras.
    const { data: existing } = await supabaseAdmin
      .from("leads")
      .select("id, created_at, payload, delivery_status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    let leadId = existing?.id as string | undefined;
    let createdAt = existing?.created_at as string | undefined;
    let rawPayload: unknown = existing?.payload ?? null;

    if (!leadId) {
      const ip =
        (getRequestHeader("cf-connecting-ip") ??
          getRequestHeader("x-forwarded-for")?.split(",")[0] ??
          "okand").trim();
      const ipHash = await hashIp(ip);

      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("source_ip_hash", ipHash)
        .gte("created_at", since);
      if ((count ?? 0) >= 5) {
        return { ok: false as const, message: "För många förfrågningar. Försök igen om en stund." };
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("leads")
        .insert({
          customer_id: customer.id,
          industry: customer.industry,
          schema_version: customer.schema_version,
          payload: buildStoredPayload(answers, makeFields) as unknown as never,
          idempotency_key: idempotencyKey,
          source_ip_hash: ipHash,
        })
        .select("id, created_at, payload")
        .maybeSingle();

      if (insErr || !inserted) {
        if (insErr?.code === "23505") {
          const { data: race } = await supabaseAdmin
            .from("leads")
            .select("id, created_at, payload")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          leadId = race?.id as string | undefined;
          createdAt = race?.created_at as string | undefined;
          rawPayload = race?.payload ?? null;
        }
        if (!leadId) {
          return { ok: false as const, message: "Förfrågan kunde inte sparas. Försök igen." };
        }
      } else {
        leadId = inserted.id as string;
        createdAt = inserted.created_at as string;
        rawPayload = inserted.payload ?? null;
      }
    }

    // Atomisk claim – parallella försök kan aldrig leverera samma lead två gånger.
    const { data: claim, error: claimErr } = await supabaseAdmin.rpc("claim_lead_delivery", {
      p_lead_id: leadId!,
    });

    const outcome = resolveClaim({
      claim: claim as string | null,
      claimError: Boolean(claimErr),
      existing: Boolean(existing),
    });
    if (outcome !== "proceed") return outcome;

    // Vid nytt försök återanvänds sparad payload; äldre leads utan råsvar
    // faller tillbaka på sina platta Make-fält.
    const fields = pickDeliveryFields({
      storedPayload: rawPayload,
      industry: customer.industry,
      questions,
      fallback: makeFields,
    });

    // Deterministisk scoring för varuautomats-leads, beräknad på samma
    // råsvar som levereras (sparade svar vid nytt försök).
    const scoring =
      customer.industry === "varuautomater"
        ? scoreVaruautomat(readStoredPayload(rawPayload).answers ?? answers)
        : null;

    // Servermetadata sist så att inga dynamiska fältnycklar kan skriva över dem.
    const body = {
      ...fields,
      ...(scoring ?? {}),
      kund_id: customer.id,
      kund_slug: customer.slug,
      lead_id: leadId,
      submission_id: data.submission_id,
      idempotency_key: idempotencyKey,
      bransch: customer.industry,
      schema_version: customer.schema_version,
      mottagare: customer.recipient_email,
      submitted_at: createdAt ?? new Date().toISOString(),
      source: `noryva_offert_${customer.industry}`,
    };

    try {
      const res = await fetch(customer.delivery_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        await supabaseAdmin
          .from("leads")
          .update({ delivery_status: "failed", delivery_error: `HTTP ${res.status}` })
          .eq("id", leadId!);
        return {
          ok: true as const,
          duplicate: Boolean(existing),
          delivered: false,
          status: "failed" as const,
        };
      }
      await supabaseAdmin
        .from("leads")
        .update({
          delivery_status: "delivered",
          delivery_error: "",
          delivered_at: new Date().toISOString(),
        })
        .eq("id", leadId!);
      return {
        ok: true as const,
        duplicate: Boolean(existing),
        delivered: true,
        status: "delivered" as const,
      };
    } catch {
      await supabaseAdmin
        .from("leads")
        .update({ delivery_status: "failed", delivery_error: "Nätverksfel eller timeout" })
        .eq("id", leadId!);
      return {
        ok: true as const,
        duplicate: Boolean(existing),
        delivered: false,
        status: "failed" as const,
      };
    }
  });
