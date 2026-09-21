import { describe, expect, it, vi } from "vitest";
import { AGENTS_SESSIONS_URL, runHarnessSession } from "./openai-agents.server";

const ENABLED_ENV = {
  NORYVA_AGENTS_API_ENABLED: "true",
  OPENAI_API_KEY: "sk-test",
};

function createResponse(id: string) {
  return { ok: true, status: 200, json: async () => ({ id }) } as unknown as Response;
}

function itemsResponse() {
  return { ok: true, status: 200, json: async () => ({ data: [] }) } as unknown as Response;
}

describe("provider session state diagnostics", () => {
  it("stoppar på failed session i stället för att polla för alltid", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === AGENTS_SESSIONS_URL) return createResponse("sess_failed");
      if (url.includes("/items")) return itemsResponse();
      if (url === `${AGENTS_SESSIONS_URL}/sess_failed`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "failed", error: "provider boom", required_actions: [] }),
        } as unknown as Response;
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await runHarnessSession(
      { role: "noryva_manager", instructions: "", input: "mål" },
      { env: ENABLED_ENV, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 100 },
    );

    expect(result).toMatchObject({
      ok: false,
      providerRunId: "sess_failed",
      runStatus: "failed",
      phase: "poll",
    });
    expect(result.error).toContain("provider boom");
  });

  it("rapporterar requires_action utan att starta ny provider-run", async () => {
    let creates = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === AGENTS_SESSIONS_URL) {
        creates += 1;
        return createResponse("sess_action");
      }
      if (url.includes("/items")) return itemsResponse();
      if (url === `${AGENTS_SESSIONS_URL}/sess_action`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "requires_action",
            error: null,
            required_actions: [{ type: "function_call" }],
          }),
        } as unknown as Response;
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const first = await runHarnessSession(
      { role: "noryva_manager", instructions: "", input: "mål" },
      { env: ENABLED_ENV, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 100 },
    );

    expect(first).toMatchObject({
      ok: false,
      providerRunId: "sess_action",
      runStatus: "blocked",
      phase: "poll",
    });
    expect(first.error).toContain("function_call");
    expect(creates).toBe(1);
  });

  it("behandlar idle som icke-terminalt och behåller sessionen för resume", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === AGENTS_SESSIONS_URL) return createResponse("sess_idle");
      if (url.includes("/items")) return itemsResponse();
      if (url === `${AGENTS_SESSIONS_URL}/sess_idle`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "idle", error: null, required_actions: [] }),
        } as unknown as Response;
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await runHarnessSession(
      { role: "noryva_manager", instructions: "", input: "mål" },
      { env: ENABLED_ENV, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5 },
    );

    expect(result).toMatchObject({
      ok: false,
      providerRunId: "sess_idle",
      runStatus: "running",
      phase: "poll",
    });
    expect(result.error).toContain("phase=poll");
  });
});
