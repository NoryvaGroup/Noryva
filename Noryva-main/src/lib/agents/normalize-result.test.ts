import { describe, expect, it } from "vitest";
import { normalizeTaskResult } from "./normalize-result";
import { verifyTaskResult } from "./tasks";

describe("normalizeTaskResult", () => {
  it("mappar nästlade och alias-fält till kanoniskt schema", () => {
    const { result, addedKeys } = normalizeTaskResult("product_tech_review", {
      output: {
        sammanfattning: "Arkitekturen är stabil men saknar idempotens i leveranslagret.",
        rekommendationer: [
          { title: "Inför dubblettnyckel", description: "Per lead och kanal" },
          "Logga leveransstatus",
        ],
        implementation_prompt:
          "Implementera en gemensam idempotensnyckel för leveranser och logga status per försök.",
      },
    });
    expect(addedKeys).toContain("summary");
    expect(addedKeys).toContain("recommendations");
    expect(addedKeys).toContain("implementationPrompt");
    expect((result as any).recommendations[0]).toBe("Inför dubblettnyckel – Per lead och kanal");
    expect(
      verifyTaskResult({ taskType: "product_tech_review", requiresApproval: true, result }).status,
    ).toBe("passed");
  });

  it("skriver aldrig över befintliga kanoniska fält", () => {
    const original = {
      summary: "Original sammanfattning som redan finns i resultatet.",
      priorities: ["Ett"],
      externalEffect: false,
    };
    const { result, addedKeys } = normalizeTaskResult("manager_directive", original);
    expect(addedKeys).toEqual([]);
    expect(result).toBe(original);
  });

  it("fabricerar inget när innehåll saknas", () => {
    const { result } = normalizeTaskResult("qa_risk_review", { note: "tomt" });
    const v = verifyTaskResult({ taskType: "qa_risk_review", requiresApproval: true, result });
    expect(v.status).toBe("failed");
    expect((result as any).summary).toBeUndefined();
    expect((result as any).risks).toBeUndefined();
  });

  it("gör aldrig externalEffect true till false", () => {
    const { result } = normalizeTaskResult("manager_directive", {
      summary: "En sammanfattning med tillräcklig längd.",
      priorities: ["Ett"],
      externalEffect: true,
    });
    expect((result as any).externalEffect).toBe(true);
    expect(
      verifyTaskResult({ taskType: "manager_directive", requiresApproval: true, result }).status,
    ).toBe("failed");
  });

  it("lämnar okända uppgiftstyper orörda", () => {
    const original = { draft: { subject: "Hej", body: "x" } };
    expect(normalizeTaskResult("sales_draft", original).result).toBe(original);
  });
});
