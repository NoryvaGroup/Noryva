import { z } from "zod";

/** Rekommenderad åtgärd för säljaren. */
export const salesActionSchema = z.enum([
  "Kontakta nu",
  "Följ upp",
  "Be om komplettering",
  "Mänsklig handläggning",
]);
export type SalesAction = z.infer<typeof salesActionSchema>;

/** Rekommenderad kontakthastighet. */
export const contactSpeedSchema = z.enum([
  "Omgående",
  "Inom 24 timmar",
  "Inom 2 arbetsdagar",
  "Avvakta",
]);
export type ContactSpeed = z.infer<typeof contactSpeedSchema>;

/** Review-status. "sent" kan aldrig sättas automatiskt i v1. */
export const reviewStatusSchema = z.enum(["draft", "approved", "rejected", "sent"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/** Statusar som en människa får sätta i v1 (aldrig "sent"). */
export const reviewStatusV1Schema = z.enum(["draft", "approved", "rejected"]);
export type ReviewStatusV1 = z.infer<typeof reviewStatusV1Schema>;

/** Strukturen som modellen måste returnera. Ingen PII får förekomma. */
export const assistantOutputSchema = z.object({
  action: salesActionSchema,
  contactSpeed: contactSpeedSchema,
  subject: z.string().trim().min(3).max(120),
  emailDraft: z.string().trim().min(20).max(4000),
  followupQuestions: z.array(z.string().trim().min(3).max(300)).max(6).default([]),
  humanTakeover: z.boolean(),
  strategyReason: z.string().trim().min(5).max(1200),
  confidence: z.number().min(0).max(1),
  safetyFlags: z.array(z.string().trim().max(120)).max(12).default([]),
});
export type AssistantOutput = z.infer<typeof assistantOutputSchema>;

/** En sparad körning av assistenten, med metadata och review-tillstånd. */
export const assistantRunSchema = assistantOutputSchema.extend({
  id: z.string().uuid().optional(),
  leadId: z.string().uuid(),
  customerId: z.string().uuid(),
  reviewStatus: reviewStatusSchema.default("draft"),
  reviewerNotes: z.string().max(4000).default(""),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type AssistantRun = z.infer<typeof assistantRunSchema>;

/** Databasrad -> domänobjekt. */
export function rowToRun(row: Record<string, unknown>): AssistantRun {
  return assistantRunSchema.parse({
    id: row["id"],
    leadId: row["lead_id"],
    customerId: row["customer_id"],
    action: row["action"],
    contactSpeed: row["contact_speed"],
    subject: row["subject"],
    emailDraft: row["email_draft"],
    followupQuestions: (row["followup_questions"] as string[] | null) ?? [],
    humanTakeover: row["human_takeover"],
    strategyReason: row["strategy_reason"],
    confidence: Number(row["confidence"] ?? 0),
    safetyFlags: (row["safety_flags"] as string[] | null) ?? [],
    reviewStatus: row["review_status"],
    reviewerNotes: (row["reviewer_notes"] as string | null) ?? "",
    promptVersion: row["prompt_version"],
    model: row["model"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  });
}

/** Domänobjekt -> databasrad. */
export function runToRow(run: AssistantRun): Record<string, unknown> {
  return {
    lead_id: run.leadId,
    customer_id: run.customerId,
    action: run.action,
    contact_speed: run.contactSpeed,
    subject: run.subject,
    email_draft: run.emailDraft,
    followup_questions: run.followupQuestions,
    human_takeover: run.humanTakeover,
    strategy_reason: run.strategyReason,
    confidence: run.confidence,
    safety_flags: run.safetyFlags,
    review_status: run.reviewStatus,
    reviewer_notes: run.reviewerNotes,
    prompt_version: run.promptVersion,
    model: run.model,
  };
}
