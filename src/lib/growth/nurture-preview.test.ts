import { describe, expect, it } from "vitest";
import { buildNurturePreview } from "./nurture-preview";

describe("nurture-preview", () => {
  it("bygger ett kort kundriktat mail med frågorna", () => {
    const preview = buildNurturePreview({
      questions: ["Kan du berätta lite mer om tidsplan?", "Hur stor är ytan?"],
      companyName: "Testkund",
    });
    expect(preview).not.toBeNull();
    expect(preview!.body.startsWith("Hej!")).toBe(true);
    expect(preview!.body.trimEnd().endsWith("Testkund")).toBe(true);
    expect(preview!.body).toContain("Hur stor är ytan?");
    expect(preview!.body.split(/\s+/).length).toBeLessThan(80);
  });

  it("bygger ett neutralt håll varmt-mail när inga frågor saknas", () => {
    const preview = buildNurturePreview({ questions: [], companyName: "Testkund" });
    expect(preview).not.toBeNull();
    expect(preview!.subject).toBe("Uppföljning på din förfrågan");
    expect(preview!.body).toContain("fortfarande är aktuellt");
    expect(preview!.body).not.toContain("?");
    expect(preview!.body.trimEnd().endsWith("Testkund")).toBe(true);
    expect(preview!.body.split(/\s+/).length).toBeLessThan(80);
  });

  it("returnerar null utan företagsnamn eller när leadet är blockerat", () => {
    expect(buildNurturePreview({ questions: ["Fråga?"], companyName: " " })).toBeNull();
    expect(buildNurturePreview({ questions: [], companyName: " " })).toBeNull();
    expect(
      buildNurturePreview({ questions: ["Fråga?"], companyName: "Testkund", blocked: true }),
    ).toBeNull();
    expect(buildNurturePreview({ questions: [], companyName: "Testkund", blocked: true })).toBeNull();
  });

  it("tar aldrig med fler än tre frågor", () => {
    const preview = buildNurturePreview({
      questions: ["A?", "B?", "C?", "D?"],
      companyName: "Testkund",
    });
    expect(preview!.body).not.toContain("D?");
  });
});
