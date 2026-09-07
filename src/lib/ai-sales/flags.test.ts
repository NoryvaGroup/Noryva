import { describe, expect, it } from "vitest";
import { assertNoExternalSend, readAiSalesFlags } from "./flags";

describe("feature flags", () => {
  it("är säkra som standard när env saknas", () => {
    const f = readAiSalesFlags({});
    expect(f.enabled).toBe(false);
    expect(f.autoSend).toBe(false);
    expect(f.reviewRequired).toBe(true);
    expect(f.replyAgentEnabled).toBe(false);
    expect(f.bookingAgentEnabled).toBe(false);
  });

  it("auto-send kan inte aktiveras så länge granskning krävs", () => {
    const f = readAiSalesFlags({ AI_SALES_ASSISTANT_AUTO_SEND: "true" });
    expect(f.autoSend).toBe(false);
  });

  it("luddiga värden räknas inte som true", () => {
    for (const value of ["1", "yes", "TRUE ", "on", ""]) {
      const f = readAiSalesFlags({ AI_SALES_ASSISTANT_ENABLED: value });
      expect(f.enabled).toBe(value.trim().toLowerCase() === "true");
    }
  });

  it("v1 blockerar extern utskickning i kod även om flaggorna sätts", () => {
    const f = readAiSalesFlags({
      AI_SALES_ASSISTANT_AUTO_SEND: "true",
      AI_SALES_ASSISTANT_REVIEW_REQUIRED: "false",
    });
    expect(f.autoSend).toBe(true);
    expect(() => assertNoExternalSend(f)).toThrow();
  });
});
