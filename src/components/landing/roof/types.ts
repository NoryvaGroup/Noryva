import { z } from "zod";

export const leadSchema = z.object({
  behov: z.string().min(1, "Välj vad du behöver hjälp med."),
  takets_alder: z.string().min(1, "Välj takets ålder."),
  ager_fastigheten: z.string().min(1, "Ange om du äger fastigheten."),
  planerad_tidpunkt: z.string().min(1, "Välj när du vill genomföra projektet."),
  projektbeskrivning: z.string().trim().max(1000, "Max 1000 tecken.").optional().or(z.literal("")),
  postnummer: z
    .string()
    .trim()
    .regex(/^\d{3}\s?\d{2}$/, "Ange ett postnummer med fem siffror."),
  fullstandigt_namn: z.string().trim().min(2, "Ange för- och efternamn.").max(100),
  telefonnummer: z
    .string()
    .trim()
    .min(6, "Ange ett telefonnummer.")
    .max(30, "Telefonnumret är för långt.")
    .regex(/^[0-9+()\-\s]+$/, "Telefonnumret får bara innehålla siffror och + - ( )."),
  epost: z.string().trim().email("Ange en giltig e-postadress.").max(255),
  samtycke: z.literal(true, { message: "Du måste godkänna att vi kontaktar dig." }),
});

export type Lead = z.infer<typeof leadSchema>;
export type LeadErrors = Partial<Record<keyof Lead, string>>;

export const BEHOV = [
  "Takbyte",
  "Takrenovering",
  "Takreparation",
  "Takbesiktning",
  "Annat",
] as const;

export const TAKETS_ALDER = [
  "Under 10 år",
  "10–20 år",
  "20–30 år",
  "Över 30 år",
  "Vet inte",
] as const;

export const AGER_FASTIGHETEN = ["Ja", "Nej"] as const;

export const PLANERAD_TIDPUNKT = [
  "Så snart som möjligt",
  "Inom 1–3 månader",
  "Inom 3–6 månader",
  "Senare",
  "Vet inte",
] as const;
