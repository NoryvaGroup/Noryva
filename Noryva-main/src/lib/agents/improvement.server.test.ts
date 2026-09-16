/**
 * Tester för CTO / Systems Improvement Agent (v1, TEST/REVIEW-only).
 * Ingen riktig databas och ingen riktig nätverkstrafik.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSignature } from "@/lib/ai-sales/webhook-security";
import { handleGrowthApi } from "@/lib/growth/api.server";
import {
  collectSystemTelemetry,
  createImprovementReviewCore,
  improvementIdempotencyKey,
} from "./improvement.server";
import { processAgentTaskCore } from "./run.server";
import { verifyTaskResult } from "./tasks";

const SECRET = "improvement-secret";
const NOW = new Date("2026-09-10T12:00:00.000Z");

type Row = Record<string, any>;

function makeSupabase(state: Record<string, Row[]>) {
  let seq = 0;
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = () => (state[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => {
          filters.push((r) => r[c] === v);
          return builder;
        },
        order: () => builder,
        limit: async (count: number) => ({ data: rows().slice(0, count), error: null }),
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
              filters.push((r) => r[c] === v);
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
    agent_tasks: [],
    agent_task_events: [{ event_type: "llm_call", detail: { usedFallback: true } }],
    ai_cost_events: [{ route: "sales", estimated_cost: 0.02 }],
    inbound_webhook_events: [{ signature_verified: true }, { signature_verified: false }],
    leads: [
      {
        delivery_status: "delivered",
        payload: { answers: { epost: "anna@example.com", telefon: "070-1234567" } },
      },
    ],
    customers: [],
    customer_profiles: [],
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
  return new Request("https://example.test/api/public/agents/improvement-review-test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-noryva-event-id": options.eventId ?? `evt-${Math.random().toString(36).slice(2)}`,
      "x-forwarded-for": `10.7.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      "x-noryva-timestamp": ts,
      "x-noryva-signature": options.signature ?? computeSignature(SECRET, ts, raw),
    },
    body: raw,
  });
}

const call = (body: unknown, state: Record<string, Row[]>, opts = {}) =>
  handleGrowthApi("agents-improvement-review-test", signed(body, opts), deps(state));

function llmResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => ({
      output_text: JSON.stringify(payload),
      usage: { input_tokens: 120, output_tokens: 60 },
    }),
  } as unknown as Response;
}

const GOOD_REVIEW = {
  summary: "Driften är stabil men uppgiftskön har flera väntande poster som behöver granskas.",
  healthScore: 82,
  findings: [{ area: "Uppgiftskö", observation: "Flera uppgifter väntar granskning.", severity: "normal" }],
  recommendations: [
    {
      title: "Sänk antalet väntande granskningar",
      priority: "normal",
      evidence: "awaiting_review=1",
      risk: "Låg, endast intern hantering.",
      suggestedAction: "Gå igenom kön dagligen i Agent HQ.",
    },
  ],
  implementationPrompt:
    "Föreslå EN liten backendändring som gör att väntande granskningar syns tydligare i Agent HQ. Ändra inget innan godkännande.",
};

beforeEach(() => {
  seen = new Set();
});

describe("CTO improvement review – skapa uppgift", () => {
  it("skapar en uppgift utan lead_id", async () => {
    const state = baseState();
    const res = await createImprovementReviewCore(
      { supabase: makeSupabase(state) },
      { executionMode: "test" },
      NOW,
    );
    expect(res.status).toBe(200);
    expect(res.body["duplicate"]).toBe(false);
    expect(res.body["externalEffect"]).toBe(false);

    const task = state["agent_tasks"]![0]!;
    expect(task["lead_id"]).toBeNull();
    expect(task["customer_id"]).toBeNull();
    expect(task["task_type"]).toBe("cto_improvement_review");
    expect(task["assigned_agent"]).toBe("systems_qa");
    expect(task["status"]).toBe("queued");
    expect(task["requires_approval"]).toBe(true);
    expect(task["approval_status"]).toBe("pending");
    expect(task["execution_mode"]).toBe("test");
    expect(task["idempotency_key"]).toBe(improvementIdempotencyKey(NOW));
  });

  it("är idempotent per dygn", async () => {
    const state = baseState();
    const ctx = { supabase: makeSupabase(state) };
    await createImprovementReviewCore(ctx, { executionMode: "test" }, NOW);
    const again = await createImprovementReviewCore(ctx, { executionMode: "test" }, NOW);
    expect(again.body["duplicate"]).toBe(true);
    expect(state["agent_tasks"]!.length).toBe(1);
  });

  it("nekar andra körlägen", async () => {
    const res = await createImprovementReviewCore(
      { supabase: makeSupabase(baseState()) },
      { executionMode: "review" as unknown as "test" },
      NOW,
    );
    expect(res.status).toBe(403);
  });
});

describe("CTO improvement review – endpoint", () => {
  it("kräver giltig signatur", async () => {
    const res = await call({ executionMode: "test" }, baseState(), { signature: "fel" });
    expect(res.status).toBe(401);
  });

  it("nekar replay av samma event-id", async () => {
    const state = baseState();
    const first = await call({ executionMode: "test" }, state, { eventId: "same-evt" });
    expect(first.status).toBe(200);
    const second = await call({ executionMode: "test" }, state, { eventId: "same-evt" });
    expect(second.status).toBe(409);
  });

  it("nekar felaktigt körläge", async () => {
    const res = await call({ executionMode: "live" }, baseState());
    expect(res.status).toBe(400);
  });
});

describe("CTO improvement review – telemetri", () => {
  it("innehåller ingen PII", async () => {
    const telemetry = await collectSystemTelemetry({ supabase: makeSupabase(baseState()) }, NOW);
    const raw = JSON.stringify(telemetry);
    expect(raw).not.toMatch(/@example\.com/);
    expect(raw).not.toMatch(/070-1234567/);
    expect(telemetry.inboundWebhooks.unverified).toBe(1);
    expect(telemetry.events.llmFallbacks).toBe(1);
    expect(telemetry.aiCost.estimatedCostTotal).toBeCloseTo(0.02, 6);
  });
});

describe("CTO improvement review – körning", () => {
  const savedKey = process.env["OPENAI_API_KEY"];
  beforeAll(() => {
    process.env["OPENAI_API_KEY"] = "test-key";
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = savedKey;
  });

  async function runReview(fetchImpl: any) {
    const state = baseState();
    const supabase = makeSupabase(state);
    const created = await createImprovementReviewCore({ supabase }, { executionMode: "test" }, NOW);
    const taskId = created.body["taskId"] as string;
    const out = await processAgentTaskCore(
      { supabase, reasoning: { fetchImpl, env: { OPENAI_API_KEY: "test-key" } } },
      { taskId },
    );
    return { state, out, taskId };
  }

  it("gör exakt ett modellanrop och stannar i granskning", async () => {
    const fetchImpl = vi.fn(async () => llmResponse(GOOD_REVIEW));
    const { state, out } = await runReview(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.status).toBe(200);
    expect(out.body["externalEffect"]).toBe(false);

    const task = state["agent_tasks"]![0]!;
    expect(task["status"]).toBe("awaiting_review");
    expect(task["approval_status"]).toBe("pending");
    expect(task["verification_status"]).toBe("passed");

    const result = task["result"] as Record<string, any>;
    expect(result["kind"]).toBe("cto_improvement_review");
    expect(result["healthScore"]).toBe(82);
    expect(result["generatedBy"]).toBe("llm");
    expect(String(result["implementationPrompt"]).length).toBeGreaterThan(30);
    expect(JSON.stringify(result)).not.toMatch(/@example\.com/);

    const types = state["agent_task_events"]!.map((e) => e["event_type"]);
    expect(types).toEqual(expect.arrayContaining(["task_started", "llm_call", "result_saved", "task_verified"]));
    expect(JSON.stringify(state["agent_task_events"])).not.toMatch(/@example\.com/);
  });

  it("faller tillbaka konservativt vid modellfel, utan retry", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    const { state, out } = await runReview(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.status).toBe(200);
    const task = state["agent_tasks"]![0]!;
    const result = task["result"] as Record<string, any>;
    expect(result["generatedBy"]).toBe("deterministic");
    expect(result["recommendations"].length).toBeGreaterThan(0);
    expect(task["status"]).toBe("awaiting_review");
    expect(task["verification_status"]).toBe("passed");
  });
});

describe("CTO improvement review – verifiering", () => {
  it("underkänner resultat utan rekommendationer eller prompt", () => {
    const verdict = verifyTaskResult({
      taskType: "cto_improvement_review",
      requiresApproval: true,
      result: { summary: "För tunt underlag här.", healthScore: 50, recommendations: [] },
    });
    expect(verdict.status).toBe("failed");
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });
});
