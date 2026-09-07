/**
 * Branschoberoende kvalificering. Deterministisk: ingen AI räknar poäng.
 * Varuautomater använder den befintliga, testade scoringmodellen oförändrad.
 */
import { scoreVaruautomat } from "@/lib/landing/scoring";
import type { CustomerProfile } from "./profile";

export type Qualification = {
  score: number;
  qualification: "Hög" | "Medel" | "Låg";
  priority: "HÖG" | "NORMAL" | "LÅG";
  source: "varuautomater" | "profile-rules" | "unscored";
};

export function qualifyLead(
  industry: string,
  values: Record<string, string>,
  profile: CustomerProfile,
): Qualification {
  const qp = profile.qualificationProfile;

  if (qp.builtin === "varuautomater" || industry === "varuautomater") {
    const s = scoreVaruautomat(values);
    return {
      score: s.deterministic_score,
      qualification: s.deterministic_kvalificering,
      priority: s.deterministic_prioritet,
      source: "varuautomater",
    };
  }

  if (qp.rules.length === 0) {
    return { score: 0, qualification: "Låg", priority: "LÅG", source: "unscored" };
  }

  let score = 0;
  for (const rule of qp.rules) {
    const raw = (values[rule.field] ?? "").trim().toLowerCase();
    const points = rule.points[raw];
    score += typeof points === "number" ? points : rule.fallback;
  }
  score = Math.round(score);

  const high = qp.highThreshold;
  const medium = qp.mediumThreshold;
  return {
    score,
    qualification: score >= high ? "Hög" : score >= medium ? "Medel" : "Låg",
    priority: score >= high ? "HÖG" : score >= medium ? "NORMAL" : "LÅG",
    source: "profile-rules",
  };
}
