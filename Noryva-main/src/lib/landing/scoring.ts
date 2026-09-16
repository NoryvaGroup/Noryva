/**
 * Deterministisk poängsättning för varuautomats-leads. Ren funktion utan
 * AI eller nätverksanrop – samma svar ger alltid samma poäng.
 */
export type VaruautomatScoring = {
  deterministic_score: number;
  deterministic_kvalificering: "Hög" | "Medel" | "Låg";
  deterministic_prioritet: "HÖG" | "NORMAL" | "LÅG";
};

const AUTOMAT_UNSPECIFIED = new Set(["", "vet inte ännu"]);

const ANSTALLDA_POANG: Record<string, number> = {
  "1–9": 10,
  "10–24": 15,
  "25–49": 20,
  "50–99": 25,
  "100+": 30,
};

const TIDSRAM_POANG: Record<string, number> = {
  "så snart som möjligt": 30,
  "inom 1–3 månader": 25,
  "inom 3–6 månader": 15,
  senare: 5,
};

export function scoreVaruautomat(values: Record<string, string>): VaruautomatScoring {
  const automat = (values["onskad_automat"] ?? "").trim().toLowerCase();
  const antal = (values["antal_anstallda"] ?? "").trim();
  const tidsram = (values["tidsram"] ?? "").trim().toLowerCase();

  const specificerad = !AUTOMAT_UNSPECIFIED.has(automat);

  const score =
    (specificerad ? 30 : 15) +
    (ANSTALLDA_POANG[antal] ?? 0) +
    (TIDSRAM_POANG[tidsram] ?? 0) +
    (specificerad ? 10 : 5);

  const kvalificering = score >= 70 ? "Hög" : score >= 40 ? "Medel" : "Låg";
  const prioritet = score >= 70 ? "HÖG" : score >= 40 ? "NORMAL" : "LÅG";

  return {
    deterministic_score: score,
    deterministic_kvalificering: kvalificering,
    deterministic_prioritet: prioritet,
  };
}
