import { describe, expect, it } from "vitest";
import { buildMakeFields } from "./make-adapter";
import { INDUSTRY_TEMPLATES } from "./templates";
import type { PublicQuestion } from "./schema";

const questions = (industry: "tak" | "varuautomater"): PublicQuestion[] =>
  INDUSTRY_TEMPLATES[industry].questions.map((q) => ({
    field_key: q.field_key,
    label: q.label,
    field_type: q.field_type,
    options: q.options,
    required: q.required,
  }));

describe("buildMakeFields", () => {
  it("behåller ursprungliga fältnycklar för tak", () => {
    const out = buildMakeFields({
      industry: "tak",
      questions: questions("tak"),
      values: {
        behov: "Takbyte",
        takets_alder: "20–30 år",
        planerad_tidpunkt: "Inom 1–3 månader",
        postnummer: "12345",
        fullstandigt_namn: "Anna Andersson",
        telefonnummer: "0701234567",
        epost: "anna@example.com",
        projektbeskrivning: "Läckage vid skorsten",
      },
    });
    expect(out.behov).toBe("Takbyte");
    expect(out.takets_alder).toBe("20–30 år");
    expect(out.fullstandigt_namn).toBe("Anna Andersson");
    expect(out.samtycke).toBe(true);
  });

  it("mappar varuautomater till Make-fälten", () => {
    const out = buildMakeFields({
      industry: "varuautomater",
      questions: questions("varuautomater"),
      values: {
        foretagsnamn: "Exempel AB",
        kontaktperson: "Bo Berg",
        epost: "bo@example.com",
        telefonnummer: "0702223344",
        ort: "Malmö",
        postnummer: "21100",
        antal_anstallda: "25–49",
        onskad_automat: "Kaffe",
        befintlig_automat: "Vet inte",
        tidsram: "Inom 1–3 månader",
        meddelande: "Två våningar",
      },
    });

    expect(out.fullstandigt_namn).toBe("Bo Berg");
    expect(out.planerad_tidpunkt).toBe("Inom 1–3 månader");
    expect(out.behov).toBe(
      "Varuautomat: Kaffe. Antal anställda: 25–49. Befintlig automat: Vet inte.",
    );
    expect(out.takets_alder).toBe("");
    expect(out.ager_fastigheten).toBe("");
    // Inga kontaktuppgifter i behov-fältet (går till AI).
    expect(out.behov).not.toContain("Bo Berg");
    expect(out.behov).not.toContain("bo@example.com");
    expect(out.behov).not.toContain("0702223344");
    // Projektbeskrivningen innehåller företag, ort och samtliga etiketterade svar.
    expect(out.projektbeskrivning).toContain("Företagsnamn: Exempel AB");
    expect(out.projektbeskrivning).toContain("Ort: Malmö");
    expect(out.projektbeskrivning).toContain("Kontaktperson: Bo Berg");
    expect(out.projektbeskrivning).toContain("Har ni redan en varuautomat?: Vet inte");
  });

  it("mappar även live-formulärets namn-fält för varuautomater", () => {
    const out = buildMakeFields({
      industry: "varuautomater",
      questions: questions("varuautomater"),
      values: { namn: "Test Person" },
    });
    expect(out.fullstandigt_namn).toBe("Test Person");
  });

  it("använder Okänt när befintlig_automat saknas", () => {
    const out = buildMakeFields({
      industry: "varuautomater",
      questions: questions("varuautomater"),
      values: { onskad_automat: "Dryck", antal_anstallda: "1–9" },
    });
    expect(out.behov).toBe("Varuautomat: Dryck. Antal anställda: 1–9. Befintlig automat: Okänt.");
  });

  it("innehåller aldrig servermetadata", () => {
    const out = buildMakeFields({
      industry: "varuautomater",
      questions: questions("varuautomater"),
      values: { kund_id: "hack", source: "hack", submitted_at: "hack" } as Record<string, string>,
    });
    expect(Object.keys(out).sort()).toEqual(
      [
        "ager_fastigheten",
        "behov",
        "epost",
        "fullstandigt_namn",
        "planerad_tidpunkt",
        "postnummer",
        "projektbeskrivning",
        "samtycke",
        "takets_alder",
        "telefonnummer",
      ].sort(),
    );
  });
});
