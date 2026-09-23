import { z } from "zod";
import type { Industry, QuestionType } from "./templates";

export type PublicQuestion = {
  field_key: string;
  label: string;
  field_type: QuestionType;
  options: string[];
  required: boolean;
};

export type PublicLanding = {
  slug: string;
  name: string;
  industry: Industry;
  schema_version: number;
  headline: string;
  description: string;
  cta_label: string;
  contact_email: string;
  contact_phone: string;
  service_area: string;
  questions: PublicQuestion[];
  /** Sant först när sidan är publicerad OCH en leveransintegration är konfigurerad. */
  accepts_leads: boolean;
};

export const slugSchema = z
  .string()
  .trim()
  .min(2, "Adressen måste ha minst 2 tecken.")
  .max(60, "Adressen är för lång.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Använd endast små bokstäver, siffror och bindestreck.");

export const questionInputSchema = z.object({
  field_key: z
    .string()
    .trim()
    .min(1, "Fältnyckel krävs.")
    .max(60)
    .regex(/^[a-z0-9_]+$/, "Fältnyckel: små bokstäver, siffror och understreck."),
  label: z.string().trim().min(1, "Frågetext krävs.").max(200),
  field_type: z.enum(["text", "textarea", "select", "email", "tel"]),
  options: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  required: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(999),
});

export const customerInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Namn krävs.").max(120),
  slug: slugSchema,
  industry: z.enum(["tak", "varuautomater"]),
  status: z.enum(["draft", "published"]),
  headline: z.string().trim().max(200).default(""),
  description: z.string().trim().max(600).default(""),
  cta_label: z.string().trim().max(60).default("Skicka förfrågan"),
  contact_email: z.string().trim().max(255).default(""),
  contact_phone: z.string().trim().max(40).default(""),
  service_area: z.string().trim().max(120).default(""),
  recipient_email: z.string().trim().max(255).default(""),
  delivery_webhook_url: z
    .string()
    .trim()
    .max(500)
    .default("")
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "Integrationsadressen måste börja med https://"),
  questions: z.array(questionInputSchema).max(40).default([]),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phoneRe = /^[0-9+()\-\s]{6,30}$/;

/** Delas av klient och server så att validering alltid är identisk. */
export function validateAnswers(
  questions: PublicQuestion[],
  values: Record<string, string>,
  consent: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const raw = (values[q.field_key] ?? "").toString().trim();
    if (!raw) {
      if (q.required) errors[q.field_key] = "Fältet är obligatoriskt.";
      continue;
    }
    if (raw.length > 1000) errors[q.field_key] = "Max 1000 tecken.";
    else if (q.field_key === "postnummer" && !/^\d{3} ?\d{2}$/.test(raw))
      errors[q.field_key] = "Ange ett giltigt postnummer med fem siffror.";
    else if (q.field_type === "email" && !emailRe.test(raw))
      errors[q.field_key] = "Ange en giltig e-postadress.";
    else if (q.field_type === "tel" && !phoneRe.test(raw))
      errors[q.field_key] = "Ange ett giltigt telefonnummer.";
    else if (q.field_type === "select" && q.options.length > 0 && !q.options.includes(raw))
      errors[q.field_key] = "Välj ett av alternativen.";
  }
  if (!consent) errors["samtycke"] = "Du måste godkänna att vi kontaktar dig.";
  return errors;
}
