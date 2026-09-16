/**
 * Rena tester för Make-migrationens deterministiska scoring och geografi.
 * Inga nätverksanrop, ingen databas, ingen AI.
 */
import { describe, expect, it } from "vitest";
import { resolveGeography } from "./geography";
import {
  detectAcuteRoof,
  scoreTakMigration,
  scoreVaruautomatMigration,
} from "./migration-scoring";

const CONFIG = { serviceArea: "Skaraborg", localPostalPrefix: "50", regionalPostalPrefix: "51" };

const geo = (postal: string) => resolveGeography(postal, CONFIG);

describe("geografi", () => {
  it("50330 är lokal, 51154 regional och 41876 utanför", () => {
    expect(geo("50330").verdict).toBe("local");
    expect(geo("50330").points).toBe(20);
    expect(geo("51154").verdict).toBe("regional");
    expect(geo("51154").points).toBe(10);
    // 41876 innehåller varken "50" eller "51" som prefix – startsWith, inte includes.
    expect(geo("41876").verdict).toBe("outside");
    expect(geo("41876").points).toBe(0);
  });

  it("normaliserar mellanslag i postnummer", () => {
    expect(geo("503 30").verdict).toBe("local");
  });

  it("saknat postnummer ger unknown, saknad konfiguration ger not_configured", () => {
    expect(geo("").verdict).toBe("unknown");
    expect(resolveGeography("50330", { serviceArea: "Skaraborg" }).verdict).toBe("not_configured");
    expect(resolveGeography("50330", { serviceArea: "Skaraborg" }).points).toBe(0);
  });
});

describe("varuautomater enligt Make-kontraktet", () => {
  it("räknar typ, anställda, tidsram, geografi och intent", () => {
    const s = scoreVaruautomatMigration({
      answers: {
        onskad_automat: "Kombinerad dryck och snacks",
        antal_anstallda: "25–49",
        tidsram: "Inom 1–3 månader",
      },
      make: null,
      geography: geo("50330"),
    });
    // 25 + 15 + 20 + 20 + 10 = 90
    expect(s.score).toBe(90);
    expect(s.qualification).toBe("Hög");
    expect(s.priority).toBe("HÖG");
    expect(s.manualReview).toBe(false);
  });

  it("ospecificerad typ, utanför området och okänd tidsram ger lågt utan att gissa", () => {
    const s = scoreVaruautomatMigration({
      answers: { onskad_automat: "Vet inte ännu", antal_anstallda: "1–9" },
      make: null,
      geography: geo("41876"),
    });
    // 15 + 5 + 0 + 0 + 5 = 25
    expect(s.score).toBe(25);
    expect(s.qualification).toBe("Låg");
    expect(s.manualReview).toBe(true);
    expect(s.manualReviewReasons.join(" ")).toMatch(/tidsram/);
  });

  it("tröskeln Medel går vid 45", () => {
    const s = scoreVaruautomatMigration({
      answers: { onskad_automat: "Kaffe", antal_anstallda: "10–24", tidsram: "Senare" },
      make: null,
      geography: geo("41876"),
    });
    // 25 + 10 + 5 + 0 + 10 = 50
    expect(s.score).toBe(50);
    expect(s.qualification).toBe("Medel");
    expect(s.priority).toBe("NORMAL");
  });
});

describe("tak enligt Make-kontraktet", () => {
  it("takbyte med ägare, gammalt tak och snar tidsram blir Hög", () => {
    const s = scoreTakMigration({
      answers: {
        behov: "Takbyte",
        ager_fastigheten: "Ja",
        takets_alder: "Över 30 år",
        planerad_tidpunkt: "Så snart som möjligt",
      },
      make: null,
      geography: geo("50330"),
    });
    // 30 + 20 + 25 + 20 + 5 = 100
    expect(s.score).toBe(100);
    expect(s.qualification).toBe("Hög");
    expect(s.priority).toBe("HÖG");
  });

  it("nollar behovs- och ägarpoäng när fastigheten inte ägs", () => {
    const s = scoreTakMigration({
      answers: {
        behov: "Takbyte",
        ager_fastigheten: "Nej",
        takets_alder: "20–30 år",
        planerad_tidpunkt: "Inom 1–3 månader",
      },
      make: null,
      geography: geo("50330"),
    });
    // 0 + 0 + 20 + 15 + 5 = 40
    expect(s.score).toBe(40);
    expect(s.breakdown["need"]).toBe(0);
    expect(s.breakdown["owner"]).toBe(0);
    expect(s.qualification).toBe("Medel");
  });

  it("läser legacy Make-fält när answers saknas", () => {
    const s = scoreTakMigration({
      answers: {},
      make: {
        behov: "Takrenovering",
        ager_fastigheten: "Ja",
        takets_alder: "10–20 år",
        planerad_tidpunkt: "Inom 3–6 månader",
      } as any,
      geography: geo("51154"),
    });
    // 25 + 20 + 15 + 10 + 5 = 75
    expect(s.score).toBe(75);
    expect(s.qualification).toBe("Hög");
  });

  it("saknat underlag markeras för manuell granskning, inte som noll", () => {
    const s = scoreTakMigration({ answers: {}, make: null, geography: geo("") });
    expect(s.manualReview).toBe(true);
    expect(s.manualReviewReasons.length).toBeGreaterThan(2);
  });
});

describe("akutbedömning för tak", () => {
  it("känner igen genuint pågående skada", () => {
    expect(detectAcuteRoof("Det läcker nu genom taket i lagret")).toBe(true);
    expect(detectAcuteRoof("Stormskada, takplåt har blåst av")).toBe(true);
    expect(detectAcuteRoof("Akut läckage efter i går kväll")).toBe(true);
  });

  it("behandlar 'snart' och liknande som INTE akut", () => {
    expect(detectAcuteRoof("Vi vill byta tak så snart som möjligt")).toBe(false);
    expect(detectAcuteRoof("Behöver åtgärdas snarast")).toBe(false);
    expect(detectAcuteRoof("")).toBe(false);
  });

  it("negerade och historiska beskrivningar blir inte akut", () => {
    expect(detectAcuteRoof("Det är ingen läcka just nu, bara slitet tak")).toBe(false);
    expect(detectAcuteRoof("Taket läckte förra året men är lagat")).toBe(false);
  });

  it("akut sätter prioritet AKUT oavsett poäng", () => {
    const s = scoreTakMigration({
      answers: {
        behov: "Takläcka",
        ager_fastigheten: "Ja",
        projektbeskrivning: "Vatten rinner in i hallen sedan i natt.",
      },
      make: null,
      geography: geo("50330"),
    });
    expect(s.acute).toBe(true);
    expect(s.priority).toBe("AKUT");
  });
});
