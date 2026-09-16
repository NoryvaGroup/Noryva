import { describe, expect, it } from "vitest";
import { pickDeliveryFields, resolveClaim } from "./delivery";
import { buildMakeFields, buildStoredPayload, readStoredPayload } from "./make-adapter";
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

describe("resolveClaim", () => {
  it("rapporterar levererat endast vid verkligt delivered", () => {
    expect(resolveClaim({ claim: "delivered", claimError: false, existing: true })).toEqual({
      ok: true,
      duplicate: true,
      delivered: true,
      status: "delivered",
    });
  });

  it("pågående leverans (sending) räknas inte som levererad", () => {
    const r = resolveClaim({ claim: "sending", claimError: false, existing: true });
    expect(r).toEqual({ ok: true, duplicate: true, delivered: false, status: "sending" });
  });

  it("okänt svar behandlas som pågående, aldrig som levererat", () => {
    const r = resolveClaim({ claim: "nagot_annat", claimError: false, existing: true });
    expect(r).toMatchObject({ delivered: false, status: "sending" });
  });

  it("fel från claim ger delivered:false", () => {
    expect(resolveClaim({ claim: null, claimError: true, existing: false })).toEqual({
      ok: true,
      duplicate: false,
      delivered: false,
      status: "failed",
    });
  });

  it("missing ger ett tydligt fel", () => {
    const r = resolveClaim({ claim: "missing", claimError: false, existing: true });
    expect(r).toMatchObject({ ok: false });
  });

  it("claimed går vidare till leverans", () => {
    expect(resolveClaim({ claim: "claimed", claimError: false, existing: false })).toBe("proceed");
  });
});

describe("failed -> nytt försök", () => {
  const qs = questions("varuautomater");
  const answers = {
    foretagsnamn: "Exempel AB",
    kontaktperson: "Bo Berg",
    epost: "bo@example.com",
    telefonnummer: "0702223344",
    ort: "Malmö",
    postnummer: "21100",
    antal_anstallda: "25–49",
    onskad_automat: "Kaffe",
    befintlig_automat: "Nej",
    tidsram: "Inom 1–3 månader",
    meddelande: "Två våningar",
  };

  it("sparad payload innehåller råsvar separat från Make-fälten", () => {
    const stored = buildStoredPayload(
      answers,
      buildMakeFields({ industry: "varuautomater", questions: qs, values: answers }),
    );
    expect(stored.answers["befintlig_automat"]).toBe("Nej");
    expect(stored.make.fullstandigt_namn).toBe("Bo Berg");
    expect(readStoredPayload(stored).answers).toEqual(answers);
  });

  it("återanvänder sparade svar vid nytt försök i stället för nya indata", () => {
    const stored = buildStoredPayload(
      answers,
      buildMakeFields({ industry: "varuautomater", questions: qs, values: answers }),
    );
    const fields = pickDeliveryFields({
      storedPayload: stored,
      industry: "varuautomater",
      questions: qs,
      fallback: buildMakeFields({ industry: "varuautomater", questions: qs, values: {} }),
    });
    expect(fields.epost).toBe("bo@example.com");
    expect(fields.behov).toContain("Kaffe");
  });

  it("hanterar äldre leads som bara har platta Make-fält", () => {
    const legacy = {
      behov: "Takbyte",
      takets_alder: "20–30 år",
      ager_fastigheten: "",
      planerad_tidpunkt: "Inom 1–3 månader",
      projektbeskrivning: "Läckage",
      postnummer: "12345",
      fullstandigt_namn: "Anna Andersson",
      telefonnummer: "0701234567",
      epost: "anna@example.com",
      samtycke: true,
    };
    const fields = pickDeliveryFields({
      storedPayload: legacy,
      industry: "tak",
      questions: questions("tak"),
      fallback: buildMakeFields({ industry: "tak", questions: questions("tak"), values: {} }),
    });
    expect(fields).toEqual(legacy);
  });
});
