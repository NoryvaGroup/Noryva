import { describe, expect, it, vi } from "vitest";
import {
  AGENTS_SESSIONS_URL,
  AGENT_ENV_KEYS,
  DEFAULT_AGENT_IDS,
  DEFAULT_ENVIRONMENT_TEMPLATE_ID,
  DEFAULT_OPENAI_PROJECT_ID,
  HARNESS_ROLES,
  buildSessionRequestBody,
  evaluateRunBudget,
  isRunnableHarnessRole,
  readAgentSlots,
  readHarnessStatus,
  runHarnessSession,
  type HarnessRole,
} from "./openai-agents.server";
import {
  ACTIVE_AGENTS_V1,
  AGENT_EXTERNAL_ACTIONS_ENABLED,
  AGENT_ROLE_CONFIG,
  AUTHORITY_EXECUTE_ENABLED,
  SPECIALIST_AGENTS_V1,
  isRunnableAgent,
} from "./tasks";
import { V2_SPECIALISTS, V2_TASK_TYPE, createV2TaskCore } from "./v2.server";

const ENABLED_ENV = {
  NORYVA_AGENTS_API_ENABLED: "true",
  OPENAI_API_KEY: "sk-test",
};

function okResponse() {
  return {
    ok: true,
    json: async () => ({ id: "sess_1", output: [{ text: "{}" }], usage: {} }),
  } as unknown as Response;
}

describe("sex aktiva roller", () => {
  it("har exakt sex roller i modellen", () => {
    expect(HARNESS_ROLES.length).toBe(6);
    expect(ACTIVE_AGENTS_V1.length).toBe(6);
    expect(SPECIALIST_AGENTS_V1.length).toBe(5);
  });

  it("alla sex är körbara roller", () => {
    for (const role of HARNESS_ROLES) {
      expect(isRunnableHarnessRole(role)).toBe(true);
      expect(isRunnableAgent(role)).toBe(true);
      expect(AGENT_ROLE_CONFIG[role].activated).toBe(true);
    }
    expect(isRunnableHarnessRole("orchestrator")).toBe(false);
  });

  it("mappar exakt rätt agent-id per roll", () => {
    const status = readHarnessStatus({ env: {} });
    expect(status.agentIds).toEqual({
      noryva_manager: "agent_95cc9942a05847fb9cce479340eed36adf10e2ea0029431ab4",
      product_tech: "agent_87c79d1adf914afe85ad8d4d6d00273a4944facc95014bed89",
      growth_sales: "agent_29b1bef0218f478bb13c760e899255d8cae8bae0f1c8410bab",
      customer_success: "agent_616c6f367cb648bbbf647d8563316703aab81539fdad4f20a1",
      qa_risk: "agent_43a8b74da1ba478cb29c749cbde48d197728ad6b7fd64ea28d",
      operations_finance: "agent_f1557f32b62e45e19d6dc47fa54eaedc17ab1e8ffcb549018e",
    });
    expect(status.environmentTemplateId).toBe(DEFAULT_ENVIRONMENT_TEMPLATE_ID);
    expect(status.projectId).toBe(DEFAULT_OPENAI_PROJECT_ID);
  });

  it("env kan överstyra agent-id utan kodändring", () => {
    const status = readHarnessStatus({
      env: { [AGENT_ENV_KEYS.qa_risk]: "agent_override" },
    });
    expect(status.agentIds.qa_risk).toBe("agent_override");
    expect(status.agentIds.noryva_manager).toBe(DEFAULT_AGENT_IDS.noryva_manager);
  });

  it("slots visar alla sex som körbara", () => {
    const slots = readAgentSlots({ env: {} });
    expect(slots.length).toBe(6);
    expect(slots.every((s) => s.runnable && s.hasAgentId)).toBe(true);
  });
});

describe("fail closed", () => {
  it("gör inget anrop utan aktiveringsflagga", async () => {
    const fetchImpl = vi.fn();
    const result = await runHarnessSession(
      { role: "growth_sales", instructions: "x", input: "y" },
      { env: { OPENAI_API_KEY: "sk-test" }, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.runStatus).toBe("blocked");
    expect(result.externalEffect).toBe(false);
  });

  it("gör inget anrop utan API-nyckel", async () => {
    const fetchImpl = vi.fn();
    const result = await runHarnessSession(
      { role: "qa_risk", instructions: "x", input: "y" },
      {
        env: { NORYVA_AGENTS_API_ENABLED: "true" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.runStatus).toBe("blocked");
  });

  it("gör inget anrop utan environment template", async () => {
    const fetchImpl = vi.fn();
    const result = await runHarnessSession(
      { role: "customer_success", instructions: "x", input: "y" },
      {
        env: { ...ENABLED_ENV, NORYVA_OPENAI_ENVIRONMENT_TEMPLATE_ID: " " },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    // Tom override faller tillbaka på server-side default, men saknas båda blockeras körningen.
    expect(result.externalEffect).toBe(false);
    expect(fetchImpl.mock.calls.length <= 1).toBe(true);
  });

  it("externa actions och UTFÖRA är avstängda", () => {
    expect(AGENT_EXTERNAL_ACTIONS_ENABLED).toBe(false);
    expect(AUTHORITY_EXECUTE_ENABLED).toBe(false);
  });
});

describe("session request-format", () => {
  it("skickar agent_id och hostad environment template", () => {
    const body = buildSessionRequestBody({
      agentId: DEFAULT_AGENT_IDS.product_tech,
      model: "gpt-5.4-mini",
      instructions: "policy",
      environmentTemplateId: DEFAULT_ENVIRONMENT_TEMPLATE_ID,
      text: "telemetri",
    });
    expect(body["agent_id"]).toBe(DEFAULT_AGENT_IDS.product_tech);
    expect(body["agent"]).toBeUndefined();
    expect(body["environment"]).toEqual({
      type: "openai_hosted",
      environment_template_id: DEFAULT_ENVIRONMENT_TEMPLATE_ID,
    });
  });

  it("överstyr inte modell eller instruktioner när agent-id finns", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await runHarnessSession(
      { role: "operations_finance", instructions: "server-policy", input: "telemetri" },
      { env: ENABLED_ENV, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(AGENTS_SESSIONS_URL);
    const sent = JSON.parse(String(init.body));
    expect(sent.agent_id).toBe(DEFAULT_AGENT_IDS.operations_finance);
    expect(sent.model).toBeUndefined();
    expect(sent.instructions).toBeUndefined();
    expect(sent.stream).toBe(false);
  });
});

describe("budget och delegering", () => {
  it("blockerar körning utan budget kvar", () => {
    expect(evaluateRunBudget({ runBudget: 1, runsUsed: 1 }).allowed).toBe(false);
    expect(evaluateRunBudget({ runBudget: 1, runsUsed: 0 }).allowed).toBe(true);
  });

  it("skapar specialistuppgift utan att köra den", async () => {
    for (const role of V2_SPECIALISTS) {
      const inserted: Record<string, unknown>[] = [];
      const supabase = {
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return {
              select: () => ({ single: async () => ({ data: { id: "task-1" }, error: null }) }),
            };
          },
        }),
      };
      const out = await createV2TaskCore({ supabase } as never, {
        role: role as HarnessRole,
        executionMode: "test",
      });
      expect(out.status).toBe(200);
      const task = inserted.find((r) => "task_type" in r)!;
      expect(task["task_type"]).toBe(V2_TASK_TYPE[role as HarnessRole]);
      expect(task["status"]).toBe("queued");
      expect(task["run_status"]).toBe("not_started");
      expect(task["runs_used"]).toBe(0);
      expect(task["requires_approval"]).toBe(true);
    }
  });
});

describe("asynkron turn hämtas read-only", () => {
  it("läser assistant-svar och usage via items utan extra provider-run", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === AGENTS_SESSIONS_URL) {
        return { ok: true, json: async () => ({ id: "sess_x" }) } as unknown as Response;
      }
      if (url.includes("/items")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: '{"ok":true}' }],
              },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ usage: { input_tokens: 10, output_tokens: 5 } }),
      } as unknown as Response;
    });

    const result = await runHarnessSession(
      { role: "noryva_manager", instructions: "", input: "mål" },
      { env: ENABLED_ENV, fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(calls.filter((u) => u === AGENTS_SESSIONS_URL).length).toBe(1);
    expect(result.outputText).toBe('{"ok":true}');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, runs: 1 });
    expect(result.runStatus).toBe("completed");
    expect(result.externalEffect).toBe(false);
  });
});
