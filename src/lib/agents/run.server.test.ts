/**
 * Tester för det HMAC-skyddade TEST-endpointet som kör + verifierar en uppgift.
 * Ingen riktig databas, inga externa anrop.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { computeSignature } from "@/lib/ai-sales/webhook-security";
import { handleGrowthApi } from "@/lib/growth/api.server";

const SECRET = "agents-test-secret";
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SALES_TASK = "44444444-4444-4444-8444-444444444444";
const QA_TASK = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, any>;

function makeSupabase(state: Record<string, Row[]>) {
  let seq = 0;
  return {
    from(table: string) {
      const filters: Array<[string, any]> = [];
      const rows = () => (state[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => {
          filters.push([c, v]);
          return builder;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (row: Row) => {
          const created = { id: `${table}-${++seq}`, ...row };
          (state[table] ??= []).push(created);
          const res: any = {
            select: () => res,
            single: async () => ({ data: created, error: null }),
            maybeSingle: async () => ({ data: created, error: null }),
            then: (resolve: any) => resolve({ data: null, error: null }),
          };
          return res;
        },
        update: (patch: Row) => {
          const res: any = {
            eq: (c: string, v: any) => {
              filters.push([c, v]);
              return res;
            },
            select: () => res,
            then: (resolve: any) => {
              const hit = rows();
              hit.forEach((r) => Object.assign(r, patch));
              return resolve({ data: hit, error: null });
            },
          };
          return res;
        },
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
  };
}

function baseState(): Record<string, Row[]> {
  return {
    leads: [
      {
        id: LEAD_ID,
        customer_id: CUSTOMER_ID,
        industry: "tak",
        payload: { answers: { namn: "Anna Andersson", epost: "anna@example.com" } },
        delivery_status: "failed",
        delivery_error: "timeout",
        delivery_attempts: 2,
      },
    ],
    customers: [{ id: CUSTOMER_ID, name: "Testkund" }],
    customer_profiles: [],
    agent_tasks: [
      {
        id: SALES_TASK,
        customer_id: CUSTOMER_ID,
        lead_id: LEAD_ID,
        assigned_agent: "sales",
        task_type: "sales_draft",
        priority: "high",
        status: "queued",
        requires_approval: true,
        approval_status: "pending",
        execution_mode: "test",
        result: null,
        verification_status: "not_started",
      },
      {
        id: QA_TASK,
        customer_id: CUSTOMER_ID,
        lead_id: LEAD_ID,
        assigned_agent: "systems_qa",
        task_type: "delivery_check",
        priority: "high",
        status: "queued",
        requires_approval: false,
        approval_status: "not_required",
        execution_mode: "test",
        result: null,
        verification_status: "not_started",
      },
    ],
    agent_task_events: [],
  };
}

let seen: Set<string>;

function deps(state: Record<string, Row[]>) {
  const supabase = makeSupabase(state);
  return {
    secret: SECRET,
    getClient: async () => ({ supabase, userId: null }) as any,
    markEvent: async (_ctx: any, eventId: string) => {
      if (seen.has(eventId)) return false;
      seen.add(eventId);
      return true;
    },
  };
}

function signed(body: unknown, options: { eventId?: string; signature?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request("https://example.test/api/public/agents/process-test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-noryva-event-id": options.eventId ?? `evt-${Math.random().toString(36).slice(2)}`,
      "x-forwarded-for": `10.2.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      "x-noryva-timestamp": ts,
      "x-noryva-signature": options.signature ?? computeSignature(SECRET, ts, raw),
    },
    body: raw,
  });
}

const call = (body: unknown, state: Record<string, Row[]>, opts = {}) =>
  handleGrowthApi("agents-process-test", signed(body, opts), deps(state));

beforeEach(() => {
  seen = new Set();
});

describe("agents-process-test", () => {
  // Testerna ska aldrig göra riktiga OpenAI-anrop, oavsett runtime-secret.
  const savedKey = process.env["OPENAI_API_KEY"];
  beforeAll(() => {
    delete process.env["OPENAI_API_KEY"];
  });
  afterAll(() => {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey;
  });

  it("kräver giltig signatur", async () => {
    const res = await call({ taskId: SALES_TASK }, baseState(), { signature: "0".repeat(64) });
    expect(res.status).toBe(401);
  });

  it("avvisar replay av samma event-id", async () => {
    const state = baseState();
    expect((await call({ taskId: SALES_TASK }, state, { eventId: "fix" })).status).toBe(200);
    expect((await call({ taskId: QA_TASK }, state, { eventId: "fix" })).status).toBe(409);
  });

  it("avvisar extra fält och okänt task-id", async () => {
    expect((await call({ taskId: SALES_TASK, force: true }, baseState())).status).toBe(400);
    expect((await call({ taskId: "66666666-6666-4666-8666-666666666666" }, baseState())).status).toBe(404);
  });

  it("vägrar uppgifter som inte är i testläge", async () => {
    const state = baseState();
    state["agent_tasks"]![0]!["execution_mode"] = "live";
    expect((await call({ taskId: SALES_TASK }, state)).status).toBe(403);
  });

  it("Sales hamnar i awaiting_review med godkänd verifiering", async () => {
    const state = baseState();
    const body = await (await call({ taskId: SALES_TASK }, state)).json();
    expect(body.status).toBe("awaiting_review");
    expect(body.verificationStatus).toBe("passed");
    expect(body.requiresApproval).toBe(true);
    expect(body.approvalStatus).toBe("pending");
    expect(body.executionMode).toBe("test");
    expect(body.externalEffect).toBe(false);
    expect(body.alreadyProcessed).toBe(false);

    const task = state["agent_tasks"]![0]!;
    expect(task["status"]).toBe("awaiting_review");
    expect((task["result"] as any).kind).toBe("sales_analysis");
    // Utan OPENAI_API_KEY i testmiljön: noll LLM-anrop och deterministiskt utkast.
    expect((task["result"] as any).llm).toMatchObject({
      used: false,
      attempts: 0,
      usedFallback: true,
      fallbackReason: "missing_api_key",
    });
    expect((task["result"] as any).generatedBy).toBe("deterministic");

    const llmEvent = state["agent_task_events"]!.find((e) => e["event_type"] === "llm_call")!;
    expect(llmEvent["actor"]).toBe("agent");
    expect(Object.keys(llmEvent["detail"] as object)).not.toContain("prompt");
    expect((llmEvent["detail"] as any).externalEffect).toBe(false);
  });

  it("Systems & QA gör read-only leveranskontroll", async () => {
    const state = baseState();
    const body = await (await call({ taskId: QA_TASK }, state)).json();
    expect(body.assignedAgent).toBe("systems_qa");
    expect(body.status).toBe("done");
    expect(body.verificationStatus).toBe("passed");
    // Leadet är oförändrat: ingen omsändning, ingen extern effekt.
    expect(state["leads"]![0]!["delivery_status"]).toBe("failed");
    expect(state["leads"]![0]!["delivery_attempts"]).toBe(2);
  });

  it("är idempotent: andra körningen ger alreadyProcessed", async () => {
    const state = baseState();
    await call({ taskId: SALES_TASK }, state);
    const eventsAfterFirst = state["agent_task_events"]!.length;
    const second = await (await call({ taskId: SALES_TASK }, state)).json();
    expect(second.alreadyProcessed).toBe(true);
    expect(second.status).toBe("awaiting_review");
    expect(state["agent_task_events"]!.length).toBe(eventsAfterFirst);
  });

  it("auto-retryar aldrig från farlig status", async () => {
    const state = baseState();
    state["agent_tasks"]![0]!["status"] = "failed";
    expect((await call({ taskId: SALES_TASK }, state)).status).toBe(409);
    state["agent_tasks"]![0]!["status"] = "in_progress";
    expect((await call({ taskId: SALES_TASK }, state)).status).toBe(409);
  });

  it("audit och svar saknar lead-PII", async () => {
    const state = baseState();
    const body = await (await call({ taskId: SALES_TASK }, state)).json();
    expect(JSON.stringify(body)).not.toMatch(/@|Anna/);

    const types = state["agent_task_events"]!.map((e) => e["event_type"]);
    expect(types).toEqual(["task_started", "llm_call", "result_saved", "task_verified"]);
    for (const e of state["agent_task_events"]!) {
      expect(["agent", "system"]).toContain(e["actor"]);
      expect(JSON.stringify(e)).not.toMatch(/@|Anna/);
    }
  });
});
