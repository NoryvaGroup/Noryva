import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { customerInputSchema, type CustomerInput } from "./landing/schema";
import { z } from "zod";

type AdminContext = { supabase: any; userId: string };

async function assertAdmin(context: AdminContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Behörighet saknas.");
}

const CUSTOMER_COLUMNS =
  "id, slug, name, industry, schema_version, status, headline, description, cta_label, contact_email, contact_phone, service_area, recipient_email, delivery_webhook_url, created_at, updated_at";

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as AdminContext);
    const { data, error } = await (context as AdminContext).supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { customers: data ?? [] };
  });

export const getCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AdminContext);
    const supabase = (context as AdminContext).supabase;
    const { data: customer, error } = await supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!customer) throw new Error("Kunden hittades inte.");
    const { data: questions, error: qErr } = await supabase
      .from("form_questions")
      .select("field_key, label, field_type, options, required, sort_order")
      .eq("customer_id", data.id)
      .order("sort_order", { ascending: true });
    if (qErr) throw new Error(qErr.message);
    return { customer, questions: questions ?? [] };
  });

export const saveCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CustomerInput) => customerInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AdminContext);
    const supabase = (context as AdminContext).supabase;
    const { questions, id, ...fields } = data;

    let customerId = id;
    if (customerId) {
      const { error } = await supabase.from("customers").update(fields).eq("id", customerId);
      if (error) throw new Error(translate(error.message));
    } else {
      const { data: created, error } = await supabase
        .from("customers")
        .insert(fields)
        .select("id")
        .single();
      if (error) throw new Error(translate(error.message));
      customerId = created.id as string;
    }

    const { error: delErr } = await supabase
      .from("form_questions")
      .delete()
      .eq("customer_id", customerId);
    if (delErr) throw new Error(delErr.message);

    if (questions.length > 0) {
      const rows = questions.map((q, i) => ({ ...q, customer_id: customerId, sort_order: i }));
      const { error: insErr } = await supabase.from("form_questions").insert(rows);
      if (insErr) throw new Error(translate(insErr.message));
    }

    return { id: customerId };
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AdminContext);
    const { error } = await (context as AdminContext).supabase
      .from("customers")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { customerId: string }) =>
    z.object({ customerId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AdminContext);
    const { data: leads, error } = await (context as AdminContext).supabase
      .from("leads")
      .select("id, created_at, payload, delivery_status, delivery_error, schema_version")
      .eq("customer_id", data.customerId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { leads: leads ?? [] };
  });

function translate(message: string): string {
  if (message.includes("customers_slug_key")) return "Adressen används redan av en annan kund.";
  if (message.includes("form_questions_customer_id_field_key_key"))
    return "Två frågor har samma fältnyckel.";
  return message;
}
