import { describe, expect, it } from "vitest";
import { buildAiSalesContext, redactText, serializeContext } from "./context";

const customer = { name: "Borås Varuautomater", industry: "varuautomater", serviceArea: "Borås" };

const payload = {
  payload_version: 2,
  answers: {
    foretag: "TEST Varuautomat AB",
    kontaktperson: "Anna Andersson",
    epost: "anna@example.com",
    telefonnummer: "0700000000",
    postnummer: "50330",
    ort: "Borås",
    onskad_automat: "Kombinerad dryck och snacks",
    antal_anstallda: "25–49",
    befintlig_automat: "Nej",
    tidsram: "Inom 1–3 månader",
    meddelande: "Ring Anna på 070-000 00 00 eller maila anna@example.com",
  },
  make: {
    behov: "Varuautomat: Kombinerad dryck och snacks.",
    fullstandigt_namn: "Anna Andersson",
    epost: "anna@example.com",
    telefonnummer: "0700000000",
  },
};

const lead = {
  leadId: "11111111-1111-4111-8111-111111111111",
  customerId: "22222222-2222-4222-8222-222222222222",
  industry: "varuautomater",
  createdAt: "2026-09-07T20:00:00.000Z",
  payload,
};

describe("PII får aldrig läcka in i AI-kontexten", () => {
  const context = buildAiSalesContext(lead, customer);
  const serialized = serializeContext(context).toLowerCase();

  it("innehåller inga namn, telefonnummer eller e-postadresser", () => {
    for (const secret of ["anna", "0700000000", "070-000", "anna@example.com"]) {
      expect(serialized).not.toContain(secret.toLowerCase());
    }
  });

  it("tar bort PII-fältnycklar helt", () => {
    expect(context.signals["kontaktperson"]).toBeUndefined();
    expect(context.signals["epost"]).toBeUndefined();
    expect(context.signals["telefonnummer"]).toBeUndefined();
    expect(context.signals["postnummer"]).toBeUndefined();
  });

  it("maskerar PII-mönster i fritext", () => {
    expect(redactText("Hör av dig på 070-000 00 00 / a@b.se")).toBe(
      "Hör av dig på [telefon borttaget] / [epost borttagen]",
    );
  });

  it("behåller affärsrelevant information och deterministisk scoring", () => {
    expect(context.signals["onskad_automat"]).toBe("Kombinerad dryck och snacks");
    expect(context.timeline).toBe("Inom 1–3 månader");
    expect(context.score).toBe(85);
    expect(context.priority).toBe("HÖG");
  });
});

describe("ofullständigt lead", () => {
  it("listar saknade uppgifter", () => {
    const context = buildAiSalesContext(
      { ...lead, payload: { payload_version: 2, answers: {}, make: null } },
      customer,
    );
    expect(context.missingInformation).toContain("behov");
    expect(context.missingInformation).toContain("tidsplan");
  });
});
