import { describe, expect, it, vi } from "vitest";
import { classifyReplySemantic, extractCurrentReply } from "./reply-reasoning.server";

function response(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output_text: JSON.stringify(payload),
      usage: { input_tokens: 42, output_tokens: 12 },
    }),
  } as unknown as Response;
}

function deps(payload: unknown) {
  const fetchImpl = vi.fn().mockResolvedValue(response(payload));
  return { fetchImpl, deps: { env: { OPENAI_API_KEY: "sk-test" }, fetchImpl } };
}

describe("semantisk nurture-reply", () => {
  it("ger neutral hej/test ingen uppgradering", async () => {
    const mock = deps({
      intent: "ovrigt",
      positivePurchaseIntent: false,
      explicitMeetingIntent: false,
      confidence: 0.98,
      reason: "Testmeddelande utan köpavsikt.",
    });
    const result = await classifyReplySemantic("hej! /test", mock.deps);
    expect(mock.fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.classification.positivePurchaseIntent).toBe(false);
    expect(result.classification.explicitMeetingIntent).toBe(false);
    expect(result.classification.intent).toBe("ovrigt");
  });

  it("kan uppgradera tydlig vilja att gå vidare", async () => {
    const mock = deps({
      intent: "intresserad",
      positivePurchaseIntent: true,
      explicitMeetingIntent: false,
      confidence: 0.94,
      reason: "Avsändaren vill gå vidare.",
    });
    const result = await classifyReplySemantic("Jag vill gå vidare.", mock.deps);
    expect(result.classification.positivePurchaseIntent).toBe(true);
    expect(result.classification.intent).toBe("intresserad");
  });

  it("identifierar uttrycklig bokningsvilja", async () => {
    const mock = deps({
      intent: "vill_boka",
      positivePurchaseIntent: true,
      explicitMeetingIntent: true,
      confidence: 0.96,
      reason: "Avsändaren ber om att boka.",
    });
    const result = await classifyReplySemantic("Kan vi boka ett möte nästa vecka?", mock.deps);
    expect(result.classification.intent).toBe("vill_boka");
    expect(result.classification.explicitMeetingIntent).toBe(true);
  });

  it("stoppar avböjande deterministiskt utan modellanrop", async () => {
    const fetchImpl = vi.fn();
    const result = await classifyReplySemantic("Nej tack, inte intresserad.", {
      env: { OPENAI_API_KEY: "sk-test" },
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.classification.intent).toBe("avbojer");
    expect(result.classification.positivePurchaseIntent).toBe(false);
  });

  it("ignorerar citerad gammal mötestext när den nya texten är neutral", async () => {
    const mock = deps({
      intent: "ovrigt",
      positivePurchaseIntent: false,
      explicitMeetingIntent: false,
      confidence: 0.99,
      reason: "Endast ett neutralt tack.",
    });
    const raw = "Tack!\n\nDen 9 sep. 2026 skrev Noryva:\n> Kan vi boka ett möte?";
    const result = await classifyReplySemantic(raw, mock.deps);
    expect(extractCurrentReply(raw)).toBe("Tack!");
    expect(String(mock.fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain("boka ett möte");
    expect(result.classification.positivePurchaseIntent).toBe(false);
    expect(result.classification.explicitMeetingIntent).toBe(false);
  });

  it("faller konservativt utan nyckel och gissar aldrig köpintresse", async () => {
    const fetchImpl = vi.fn();
    const result = await classifyReplySemantic("Jag vill gå vidare.", { env: {}, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.classification.positivePurchaseIntent).toBe(false);
    expect(result.classification.generatedBy).toBe("conservative_fallback");
  });
});