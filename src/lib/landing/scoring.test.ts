import { describe, expect, it } from "vitest";
import { scoreVaruautomat } from "./scoring";

describe("scoreVaruautomat", () => {
  it("kombinerad dryck och snacks + 25–49 + 1–3 månader = 85/Hög/HÖG", () => {
    const result = scoreVaruautomat({
      onskad_automat: "Kombinerad dryck och snacks",
      antal_anstallda: "25–49",
      tidsram: "Inom 1–3 månader",
    });
    expect(result).toEqual({
      deterministic_score: 85,
      deterministic_kvalificering: "Hög",
      deterministic_prioritet: "HÖG",
    });
  });

  it("ospecificerad automattyp ger lägre poäng (15 + 5 intention)", () => {
    const result = scoreVaruautomat({
      onskad_automat: "Vet inte ännu",
      antal_anstallda: "25–49",
      tidsram: "Inom 1–3 månader",
    });
    expect(result.deterministic_score).toBe(15 + 20 + 25 + 5);
    expect(result.deterministic_kvalificering).toBe("Medel");
    expect(result.deterministic_prioritet).toBe("NORMAL");
  });

  it("alla anställdaintervall poängsätts enligt tabellen", () => {
    const base = { onskad_automat: "Dryck", tidsram: "Senare" };
    expect(scoreVaruautomat({ ...base, antal_anstallda: "1–9" }).deterministic_score).toBe(30 + 10 + 5 + 10);
    expect(scoreVaruautomat({ ...base, antal_anstallda: "10–24" }).deterministic_score).toBe(30 + 15 + 5 + 10);
    expect(scoreVaruautomat({ ...base, antal_anstallda: "50–99" }).deterministic_score).toBe(30 + 25 + 5 + 10);
    expect(scoreVaruautomat({ ...base, antal_anstallda: "100+" }).deterministic_score).toBe(30 + 30 + 5 + 10);
  });

  it("alla tidsramar poängsätts enligt tabellen", () => {
    const base = { onskad_automat: "Kaffe", antal_anstallda: "1–9" };
    expect(scoreVaruautomat({ ...base, tidsram: "Så snart som möjligt" }).deterministic_score).toBe(30 + 10 + 30 + 10);
    expect(scoreVaruautomat({ ...base, tidsram: "Inom 3–6 månader" }).deterministic_score).toBe(30 + 10 + 15 + 10);
    expect(scoreVaruautomat({ ...base, tidsram: "Senare" }).deterministic_score).toBe(30 + 10 + 5 + 10);
  });

  it("okända/saknade värden ger 0 poäng för den delen och Låg/LÅG", () => {
    const result = scoreVaruautomat({});
    expect(result.deterministic_score).toBe(15 + 0 + 0 + 5);
    expect(result.deterministic_kvalificering).toBe("Låg");
    expect(result.deterministic_prioritet).toBe("LÅG");
  });

  it("tröskelvärden: 70 = Hög/HÖG, 40 = Medel/NORMAL", () => {
    expect(scoreVaruautomat({ onskad_automat: "Dryck", antal_anstallda: "50–99", tidsram: "Senare" })).toMatchObject({
      deterministic_score: 70,
      deterministic_kvalificering: "Hög",
      deterministic_prioritet: "HÖG",
    });
    expect(scoreVaruautomat({ onskad_automat: "Vet inte ännu", antal_anstallda: "50–99", tidsram: "Vet inte" })).toMatchObject({
      deterministic_score: 45,
      deterministic_kvalificering: "Medel",
      deterministic_prioritet: "NORMAL",
    });
  });

  it("är deterministisk – samma input ger alltid samma output", () => {
    const values = {
      onskad_automat: "Snacks",
      antal_anstallda: "100+",
      tidsram: "Så snart som möjligt",
    };
    expect(scoreVaruautomat(values)).toEqual(scoreVaruautomat({ ...values }));
  });
});
