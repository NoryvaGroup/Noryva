/**
 * Experimentmotor: stabil variantfördelning per lead.
 * Ingen slump vid körning – samma lead får alltid samma variant, vilket gör
 * tilldelningen idempotent och testbar.
 */
import { z } from "zod";

export const experimentTypeSchema = z.enum([
  "email_subject",
  "email_body",
  "contact_speed",
  "followup_cadence",
  "qualification_threshold",
]);
export type ExperimentType = z.infer<typeof experimentTypeSchema>;

export const EXPERIMENT_TYPE_LABEL: Record<ExperimentType, string> = {
  email_subject: "Ämnesrad",
  email_body: "Mailtext",
  contact_speed: "Kontakthastighet",
  followup_cadence: "Uppföljningstakt",
  qualification_threshold: "Kvalificeringströskel",
};

export const experimentStatusSchema = z.enum(["draft", "running", "paused", "completed"]);
export type ExperimentStatus = z.infer<typeof experimentStatusSchema>;

export type Variant = {
  id: string;
  name: string;
  /** Relativ vikt, > 0. */
  weight: number;
  isControl: boolean;
};

/** FNV-1a: liten, deterministisk och plattformsoberoende. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Väljer variant deterministiskt utifrån experiment + lead.
 * Returnerar null om det inte finns någon variant med vikt.
 */
export function assignVariant(
  experimentId: string,
  leadId: string,
  variants: Variant[],
): Variant | null {
  const usable = variants.filter((v) => v.weight > 0);
  if (usable.length === 0) return null;
  const total = usable.reduce((acc, v) => acc + v.weight, 0);
  const bucket = (stableHash(`${experimentId}:${leadId}`) % 10_000) / 10_000;
  let cursor = 0;
  for (const variant of usable) {
    cursor += variant.weight / total;
    if (bucket < cursor) return variant;
  }
  return usable[usable.length - 1]!;
}
