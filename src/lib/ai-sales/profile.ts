/**
 * Kundprofil = den branschoberoende konfigurationen av säljmotorn.
 * Samma motor ska fungera för tak, varuautomater och framtida branscher;
 * allt kundspecifikt bor i data, inte i kod.
 */
import { z } from "zod";

export const qualificationRuleSchema = z.object({
  /** Fältnyckel i formulärsvaren. */
  field: z.string().min(1),
  /** Värde (gemener, trimmat) -> poäng. */
  points: z.record(z.string(), z.number()),
  /** Poäng när fältet saknas eller inte matchar. */
  fallback: z.number().default(0),
});
export type QualificationRule = z.infer<typeof qualificationRuleSchema>;

export const qualificationProfileSchema = z.object({
  /** Om satt används den inbyggda deterministiska modellen för branschen. */
  builtin: z.enum(["varuautomater", "generic"]).default("generic"),
  rules: z.array(qualificationRuleSchema).default([]),
  highThreshold: z.number().default(70),
  mediumThreshold: z.number().default(40),
});
export type QualificationProfile = z.infer<typeof qualificationProfileSchema>;

export const followupRulesSchema = z.object({
  /** Timmar till första uppföljning per prioritet. */
  firstFollowupHours: z.object({
    HÖG: z.number().default(4),
    NORMAL: z.number().default(24),
    LÅG: z.number().default(72),
  }).default({ HÖG: 4, NORMAL: 24, LÅG: 72 }),
  maxFollowups: z.number().int().min(0).max(10).default(2),
});
export type FollowupRules = z.infer<typeof followupRulesSchema>;

export const bookingRulesSchema = z.object({
  enabled: z.boolean().default(false),
  meetingLengthMinutes: z.number().int().default(30),
  bookingUrl: z.string().default(""),
});

export const customerProfileSchema = z.object({
  customerId: z.string().uuid(),
  tone: z.string().min(1).default("professionell"),
  language: z.string().min(2).default("sv"),
  leadPrefix: z.string().default(""),
  qualificationProfile: qualificationProfileSchema.default({
    builtin: "generic",
    rules: [],
    highThreshold: 70,
    mediumThreshold: 40,
  }),
  followupRules: followupRulesSchema.default({
    firstFollowupHours: { HÖG: 4, NORMAL: 24, LÅG: 72 },
    maxFollowups: 2,
  }),
  bookingRules: bookingRulesSchema.default({
    enabled: false,
    meetingLengthMinutes: 30,
    bookingUrl: "",
  }),
  notifyRecipients: z.array(z.string()).default([]),
  aiAssistantEnabled: z.boolean().default(false),
});
export type CustomerProfile = z.infer<typeof customerProfileSchema>;

/** Branschstandard som används när ingen profil sparats för kunden. */
export function defaultProfile(customerId: string, industry: string): CustomerProfile {
  return customerProfileSchema.parse({
    customerId,
    qualificationProfile: {
      builtin: industry === "varuautomater" ? "varuautomater" : "generic",
      rules: [],
      highThreshold: 70,
      mediumThreshold: 40,
    },
  });
}

export function rowToProfile(row: Record<string, unknown>): CustomerProfile {
  return customerProfileSchema.parse({
    customerId: row["customer_id"],
    tone: row["tone"] ?? undefined,
    language: row["language"] ?? undefined,
    leadPrefix: row["lead_prefix"] ?? "",
    qualificationProfile: emptyToUndefined(row["qualification_profile"]),
    followupRules: emptyToUndefined(row["followup_rules"]),
    bookingRules: emptyToUndefined(row["booking_rules"]),
    notifyRecipients: (row["notify_recipients"] as string[] | null) ?? [],
    aiAssistantEnabled: row["ai_assistant_enabled"] ?? false,
  });
}

export function profileToRow(profile: CustomerProfile): Record<string, unknown> {
  return {
    customer_id: profile.customerId,
    tone: profile.tone,
    language: profile.language,
    lead_prefix: profile.leadPrefix,
    qualification_profile: profile.qualificationProfile,
    followup_rules: profile.followupRules,
    booking_rules: profile.bookingRules,
    notify_recipients: profile.notifyRecipients,
    ai_assistant_enabled: profile.aiAssistantEnabled,
  };
}

function emptyToUndefined(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (Object.keys(value as object).length === 0) return undefined;
  return value;
}
