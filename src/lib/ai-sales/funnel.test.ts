import { describe, expect, it } from "vitest";
import { canAdvance, assertAdvance, scoreBandFor, summarizeFunnel } from "./funnel";

describe("utfallstrappa", () => {
  it("tillåter bara steg framåt", () => {
    expect(canAdvance("lead", "contacted")).toBe(true);
    expect(canAdvance("replied", "meeting")).toBe(true);
    expect(canAdvance("meeting", "contacted")).toBe(false);
    expect(() => assertAdvance("won", "lost")).toThrow();
  });

  it("mappar kvalificering till poängband", () => {
    expect(scoreBandFor("Hög")).toBe("hog");
    expect(scoreBandFor("Medel")).toBe("medel");
    expect(scoreBandFor(null)).toBe("unknown");
  });
});

describe("funnelsammanfattning", () => {
  it("hittar inte på siffror utan data", () => {
    const s = summarizeFunnel([]);
    expect(s.counts.lead).toBe(0);
    expect(s.conversion.won).toBeNull();
    expect(s.dataComplete).toBe(false);
  });

  it("räknar leads i alla passerade steg", () => {
    const s = summarizeFunnel([
      { leadId: "a", stage: "lead", scoreBand: "hog", channel: "mock" },
      { leadId: "a", stage: "contacted", scoreBand: "hog", channel: "mock" },
      { leadId: "a", stage: "replied", scoreBand: "hog", channel: "mock" },
      { leadId: "b", stage: "lead", scoreBand: "lag", channel: "mock" },
    ]);
    expect(s.counts.lead).toBe(2);
    expect(s.counts.contacted).toBe(1);
    expect(s.counts.replied).toBe(1);
    expect(s.counts.meeting).toBe(0);
    expect(s.conversion.replied).toBe(0.5);
    expect(s.byScoreBand.hog.leads).toBe(1);
  });

  it("räknar förlorade leads separat", () => {
    const s = summarizeFunnel([
      { leadId: "a", stage: "lost", scoreBand: "medel", channel: "mock" },
    ]);
    expect(s.counts.lost).toBe(1);
    expect(s.counts.contacted).toBe(0);
  });
});
