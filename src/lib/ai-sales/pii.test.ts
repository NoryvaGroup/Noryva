import { describe, expect, it } from "vitest";
import { buildAiSalesContext, serializeContext } from "./context";

const LEAD = {
  leadId: "0ba1ba8e-7adf-4283-b6e7-702f28537626",
  customerId: "802728cd-acc5-49df-ad8b-3ec473006086",
  industry: "varuautomater",
  createdAt: "2026-09-08T10:00:00.000Z",
  payload: {
    answers: {
      foretagsnamn: "TEST Varuautomat AB",
      ort: "Borås",
      postnummer: "50330",
      kontaktperson: "Anna Andersson",
      epost: "anna.andersson@example.com",
      telefonnummer: "0700000000",
      adress: "Storgatan 5",
      antal_anstallda: "25–49",
      onskad_automat: "Kombinerad dryck och snacks",
      tidsram: "Inom 1–3 månader",
      meddelande:
        "Hej, jag heter Anna Andersson och nås på 0700000000 eller anna.andersson@example.com. Storgatan 5, 50330 Borås.",
    },
  },
};

const CUSTOMER = { name: "Borås Varuautomater", industry: "varuautomater", serviceArea: "Borås" };

describe("PII-minimering", () => {
  const context = buildAiSalesContext(LEAD, CUSTOMER);
  const serialized = serializeContext(context);

  it("behåller affärskontext", () => {
    expect(serialized).toContain("TEST Varuautomat AB");
    expect(serialized).toContain("Kombinerad dryck och snacks");
    expect(serialized).toContain("25–49");
    expect(context.timeline).toContain("1–3 månader");
  });

  for (const secret of [
    "Anna",
    "Andersson",
    "anna.andersson@example.com",
    "0700000000",
    "Storgatan 5",
    "50330",
  ]) {
    it(`läcker inte ${secret}`, () => {
      expect(serialized).not.toContain(secret);
    });
  }

  it("skickar inte med identifierare för lead/kund i modellinput", () => {
    expect(serialized).not.toContain(LEAD.leadId);
    expect(serialized).not.toContain(LEAD.customerId);
  });

  it("är deterministisk", () => {
    expect(serializeContext(buildAiSalesContext(LEAD, CUSTOMER))).toBe(serialized);
  });
});
