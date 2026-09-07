import { describe, expect, it } from "vitest";
import {
  assertTransition,
  buildActionKey,
  canTransition,
  executeActionInTestMode,
  followupAt,
} from "./actions";
import { readAiSalesFlags } from "./flags";

const flags = readAiSalesFlags({ AI_SALES_ASSISTANT_ENABLED: "true" });

describe("statusmaskin", () => {
  it("tillåter draft -> approved -> executed", () => {
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("approved", "executed")).toBe(true);
  });

  it("blockerar hopp direkt från draft till executed", () => {
    expect(canTransition("draft", "executed")).toBe(false);
    expect(() => assertTransition("draft", "executed")).toThrow();
  });

  it("gör utförda åtgärder slutgiltiga (ingen dubblering)", () => {
    expect(canTransition("executed", "executed")).toBe(false);
    expect(canTransition("executed", "approved")).toBe(false);
  });
});

describe("idempotens", () => {
  it("ger samma nyckel för samma lead och åtgärd", () => {
    const a = buildActionKey({ leadId: "lead-1", actionType: "send_email" });
    const b = buildActionKey({ leadId: "lead-1", actionType: "send_email" });
    expect(a).toBe(b);
  });

  it("skiljer på åtgärdstyp och försök", () => {
    expect(buildActionKey({ leadId: "l", actionType: "send_email" })).not.toBe(
      buildActionKey({ leadId: "l", actionType: "book_meeting" }),
    );
    expect(buildActionKey({ leadId: "l", actionType: "send_email", attempt: "2" })).toBe(
      "l:send_email:2",
    );
  });
});

describe("utförande i testläge", () => {
  it("kräver godkänd status", () => {
    expect(() =>
      executeActionInTestMode(
        { actionType: "send_email", status: "draft", executionMode: "test" },
        flags,
      ),
    ).toThrow();
  });

  it("skickar aldrig något externt", () => {
    const out = executeActionInTestMode(
      { actionType: "send_email", status: "approved", executionMode: "test" },
      flags,
    );
    expect(out.performed).toBe(false);
    expect(out.mode).toBe("test");
    expect(out.externalEffectBlocked).toBe(true);
  });

  it("vägrar skarpt läge", () => {
    expect(() =>
      executeActionInTestMode(
        { actionType: "send_email", status: "approved", executionMode: "live" },
        flags,
      ),
    ).toThrow(/Skarpt läge/);
  });
});

describe("uppföljningstid", () => {
  it("följer kundens regler per prioritet", () => {
    const at = followupAt("HÖG", { HÖG: 4, NORMAL: 24, LÅG: 72 }, new Date("2026-01-01T00:00:00Z"));
    expect(at).toBe("2026-01-01T04:00:00.000Z");
  });
});
