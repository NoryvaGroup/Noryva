import { describe, expect, it } from "vitest";
import { downgradeRoute, routeLead } from "./router";

describe("cost-aware agent router", () => {
  it("låg prioritet med komplett underlag kräver noll AI-anrop", () => {
    const d = routeLead({ priority: "LÅG", missingInformation: [], text: "Vill veta mer om era automater" });
    expect(d.route).toBe("deterministic");
    expect(d.llmCalls).toBe(0);
  });

  it("hög prioritet går till full analys", () => {
    const d = routeLead({ priority: "HÖG", missingInformation: [] });
    expect(d.route).toBe("ai_full");
    expect(d.llmCalls).toBe(1);
  });

  it("normalprioritet använder den billiga nivån", () => {
    expect(routeLead({ priority: "NORMAL", missingInformation: [] }).route).toBe("ai_light");
  });

  it("tvetydigt underlag eskalerar till full analys", () => {
    const d = routeLead({ priority: "NORMAL", missingInformation: ["behov", "tidsplan"] });
    expect(d.route).toBe("ai_full");
  });

  it("låg confidence eskalerar även lågprioriterade leads", () => {
    const d = routeLead({ priority: "LÅG", confidence: 0.2 });
    expect(d.route).toBe("ai_full");
  });

  it("pris, offert och klagomål går till människa utan AI", () => {
    for (const text of ["Vad kostar det?", "Vill ha en offert", "Jag har ett klagomål"]) {
      const d = routeLead({ priority: "HÖG", text });
      expect(d.route).toBe("human");
      expect(d.llmCalls).toBe(0);
      expect(d.requiresHuman).toBe(true);
    }
  });

  it("överskriden budget degraderar till deterministisk", () => {
    const d = routeLead({
      priority: "HÖG",
      budgetUsage: { spentTodayUsd: 5, spentMonthUsd: 5 },
      budget: { dailyLimitUsd: 2, monthlyLimitUsd: 40 },
    });
    expect(d.requestedRoute).toBe("ai_full");
    expect(d.route).toBe("deterministic");
    expect(d.llmCalls).toBe(0);
  });

  it("nära budgettaket degraderas ai_full till ai_light", () => {
    expect(downgradeRoute("ai_full", "warn")).toBe("ai_light");
    expect(downgradeRoute("ai_light", "warn")).toBe("ai_light");
    expect(downgradeRoute("ai_full", "exceeded")).toBe("deterministic");
  });

  it("avstängd AI ger deterministisk rekommendation", () => {
    const d = routeLead({ priority: "HÖG", aiEnabled: false });
    expect(d.route).toBe("deterministic");
  });
});
