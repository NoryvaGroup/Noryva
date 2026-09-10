/**
 * Tester för OpenAI-resonemangslagret i TEST-läge.
 * Ingen riktig nätverkstrafik: fetch mockas alltid.
 */
import { describe, expect, it, vi } from "vitest";
import {
  classifyUnclearEvent,
  enrichSalesResult,
  safeContextLines,
  type ReasoningDeps,
} from "./reasoning.server";
import { runSalesWorker } from "./tasks";
import { defaultProfile } from "@/lib/ai-sales/profile";

const profile = defaultProfile("22222222-2222-4222-8222-222222222222", "tak");

const values = {
  namn: "Anna Andersson",
  epost: "anna@example.com",
  telefon: "070-123 45 67",
  behov: "Behöver byta yttertak på lagerbyggnad",
  tidsplan: "Inom en månad",
};

const deterministic = () =>
  runSalesWorker({
    taskType: "sales_draft",
    industry: "tak",
    values,
    profile,
    companyName: "Testkund",
  });

const input = {
  taskType: "sales_draft" as const,
  industry: "tak",
  companyName: "Testkund",
  priority: "HÖG",
  values,
};

function okResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output_text: JSON.stringify(payload),
      usage: { input_tokens: 120, output_tokens: 60 },
    }),
  } as unknown as Response;
}

const goodPayload = {
  subject: "Tack för din förfrågan",
  body: "Hej!\n\nTack för din förfrågan om taket. Vi går igenom uppgifterna och återkommer med nästa steg.\n\nVänliga hälsningar\nTestkund",
  nextStep: "Kontakta omgående",
  internalNotes: ["Tydligt behov och kort tidsplan."],
  confidence: 0.8,
};

function deps(fetchImpl: any, extra: Partial<ReasoningDeps> = {}): ReasoningDeps {
  return { env: { OPENAI_API_KEY: "sk-test" }, fetchImpl, ...extra };
}

describe("reasoning: kontext utan PII", () => {
  it("tar bort namn, e-post och telefon", () => {
    const lines = safeContextLines(values).join("\n");
    expect(lines).not.toMatch(/Anna|@|070/);
    expect(lines).toMatch(/behov/);
  });
});

describe("reasoning: Sales", () => {
  it("gör exakt ett anrop och använder modellens utkast", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(goodPayload));
    const result = await enrichSalesResult(deterministic(), input, deps(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.openai.com/v1/responses");
    expect(result.generatedBy).toBe("llm");
    expect(result.draft.subject).toBe(goodPayload.subject);
    expect(result.llm).toMatchObject({
      used: true,
      attempts: 1,
      usedFallback: false,
      inputTokens: 120,
      outputTokens: 60,
    });
  });

  it("skickar aldrig PII i prompten", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(goodPayload));
    await enrichSalesResult(deterministic(), input, deps(fetchImpl));
    const body = String(fetchImpl.mock.calls[0]![1].body);
    expect(body).not.toMatch(/Anna|anna@example\.com|070/);
  });

  it("faller tillbaka deterministiskt utan API-nyckel och gör noll anrop", async () => {
    const fetchImpl = vi.fn();
    const result = await enrichSalesResult(deterministic(), input, {
      env: {},
      fetchImpl: fetchImpl as any,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.generatedBy).toBe("deterministic");
    expect(result.llm).toMatchObject({ used: false, attempts: 0, fallbackReason: "missing_api_key" });
    expect(result.draft.body).toMatch(/^Hej!/);
  });

  it("faller tillbaka vid HTTP-fel, utan retry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as unknown as Response);
    const result = await enrichSalesResult(deterministic(), input, deps(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.generatedBy).toBe("deterministic");
    expect(result.llm.fallbackReason).toBe("http_429");
  });

  it("faller tillbaka vid schemafel", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ subject: "x" }));
    const result = await enrichSalesResult(deterministic(), input, deps(fetchImpl));
    expect(result.generatedBy).toBe("deterministic");
    expect(result.llm.fallbackReason).toBe("schema_error");
    expect(result.llm.attempts).toBe(1);
  });

  it("faller tillbaka vid timeout", async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const result = await enrichSalesResult(
      deterministic(),
      input,
      deps(fetchImpl, { timeoutMs: 5 }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.llm.fallbackReason).toBe("timeout");
    expect(result.generatedBy).toBe("deterministic");
  });
});

describe("reasoning: oklart event", () => {
  it("använder modellens val när det är giltigt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({ assignedAgent: "sales", taskType: "sales_draft", reason: "Kundfråga." }),
    );
    const routing = await classifyUnclearEvent("okänt internt event", deps(fetchImpl));
    expect(routing.assignedAgent).toBe("sales");
    expect(routing.llm.attempts).toBe(1);
  });

  it("faller tillbaka till teknisk kontroll utan nyckel", async () => {
    const fetchImpl = vi.fn();
    const routing = await classifyUnclearEvent("okänt internt event", {
      env: {},
      fetchImpl: fetchImpl as any,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(routing.assignedAgent).toBe("systems_qa");
    expect(routing.llm.attempts).toBe(0);
  });
});
