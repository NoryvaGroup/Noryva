/**
 * Tester för Auto Process Review Mode (Shadow Review-batch, TEST-only).
 * Ingen riktig databas och ingen riktig nätverkstrafik.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSignature } from "@/lib/ai-sales/webhook-security";
import { handleGrowthApi } from "@/lib/growth/api.server";
import { processShadowBatchCore } from "./process-shadow-batch.server";
import { SHADOW_REVIEW_OCCURRENCE } from "./shadow-review.server";

const SECRET = "shadow-batch-secret";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

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
        like: (c: string, pattern: string) => {
          const rx = new RegExp(`^${pattern.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
          filters.push((r) => rx.test(String(r[c] ?? "")));
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

function shadowTask(index: number, overrides: Row = {}): Row {
  const leadId = `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
  return {
    id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    customer_id: CUSTOMER_ID,
    lead_id: leadId,
    assigned_agent: "sales",
    task_type: "sales_draft",
    priority: "normal",
    status: "queued",
    requires_approval: true,
    approval_status: "pending",
    execution_mode: "test",
    source_event: "new_lead",
    idempotency_key: `new_lead:${leadId}:${SHADOW_REVIEW_OCCURRENCE}`,
    result: null,
    verification_status: "not_started",
    created_at: `2026-09-10T10:00:${String(index).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

function leadRow(index: number): Row {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    customer_id: CUSTOMER_ID,
    industry: "tak",
    payload: { answers: { namn: "Anna Andersson", epost: "anna@example.com" } },
    delivery_status: "delivered",
    delivery_error: "",
    delivery_attempts: 1,
  };
}

function baseState(count = 1, taskOverrides: Row[] = []): Record<string, Row[]> {
  return {
    leads: Array.from({ length: Math.max(count, taskOverrides.length) }, (_, i) => leadRow(i + 1)),
    customers: [{ id: CUSTOMER_ID, name: "Testkund" }],
    customer_profiles: [],
    agent_tasks:
      taskOverrides.length > 0
        ? taskOverrides
        : Array.from({ length: count }, (_, i) => shadowTask(i + 1)),
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
  return new Request("https://example.test/api/public/agents/process-shadow-batch-test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-noryva-event-id": options.eventId ?? `evt-${Math.random().toString(36).slice(2)}`,
      "x-forwarded-for": `10.3.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      "x-noryva-timestamp": ts,
      "x-noryva-signature": options.signature ?? computeSignature(SECRET, ts, raw),
    },
    body: raw,
  });
}

const call = (body: unknown, state: Record<string, Row[]>, opts = {}) =>
  handleGrowthApi("agents-process-shadow-batch-test", signed(body, opts), deps(state));

beforeEach(() => {
  seen = new Set();
});

describe("agents-process-shadow-batch-test", () => {
  const savedKey = process.env["OPENAI_API_KEY"];
  beforeAll(() => {
    delete process.env["OPENAI_API_KEY"];
  });
  afterAll(() => {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey;
  });

  it("kräver giltig HMAC och avvisar replay", async () => {
    expect((await call({ executionMode: "test" }, baseState(), { signature: "0".repeat(64) })).status).toBe(401);

    const state = baseState(2);
    expect((await call({ executionMode: "test" }, state, { eventId: "same" })).status).toBe(200);
    expect((await call({ executionMode: "test" }, state, { eventId: "same" })).status).toBe(409);
  });

  it("nekar fel körläge, extra fält och limit över tre", async () => {
    expect((await call({ executionMode: "live" }, baseState())).status).toBe(400);
    expect((await call({ executionMode: "test", limit: 4 }, baseState())).status).toBe(400);
    expect((await call({ executionMode: "test", force: true }, baseState())).status).toBe(400);
  });

  it("processar högst tre uppgifter per körning", async () => {
    const state = baseState(5);
    const body = (await (await call({ executionMode: "test" }, state)).json()) as any;
    expect(body).toMatchObject({ scanned: 3, processed: 3, awaitingReview: 3, failed: 0, skipped: 0 });
    expect(body.taskIds).toHaveLength(3);
    expect((state["agent_tasks"] ?? []).filter((t) => t["status"] === "queued")).toHaveLength(2);
  });

  it("plockar endast köade Shadow Review-Sales-uppgifter i testläge", async () => {
    const state = baseState(0, [
      shadowTask(1, { idempotency_key: "new_lead:x:1" }),
      shadowTask(2, { assigned_agent: "systems_qa", task_type: "delivery_check" }),
      shadowTask(3, { status: "awaiting_review" }),
      shadowTask(4, { execution_mode: "live" }),
      shadowTask(5),
    ]);
    const body = (await (await call({ executionMode: "test" }, state)).json()) as any;
    expect(body).toMatchObject({ scanned: 1, processed: 1 });
    expect(body.taskIds).toEqual([shadowTask(5)["id"]]);
  });

  it("lyckad körning ger awaiting_review, QA passed och ingen auto-approval", async () => {
    const state = baseState(1);
    const body = (await (await call({ executionMode: "test" }, state)).json()) as any;
    expect(body).toMatchObject({ processed: 1, awaitingReview: 1, externalEffect: false });

    const task = state["agent_tasks"]![0]!;
    expect(task["status"]).toBe("awaiting_review");
    expect(task["verification_status"]).toBe("passed");
    expect(task["approval_status"]).toBe("pending");
    expect(task["requires_approval"]).toBe(true);
  });

  it("fallback utan API-nyckel körs utan LLM-anrop men verifieras ändå", async () => {
    const state = baseState(1);
    await call({ executionMode: "test" }, state);
    const task = state["agent_tasks"]![0]!;
    expect(task["result"].llm).toMatchObject({ used: false, attempts: 0, usedFallback: true });
    expect(task["verification_status"]).toBe("passed");
  });

  it("gör högst ett OpenAI-anrop per uppgift", async () => {
    const state = baseState(2);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output_text: JSON.stringify({
          subject: "Tack för din förfrågan",
          body: "Hej!\n\nTack för din förfrågan. Vi återkommer med nästa steg.\n\nVänliga hälsningar\nTestkund",
          nextStep: "Kontakta omgående",
          internalNotes: ["Tydligt behov."],
          confidence: 0.8,
        }),
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    const result = await processShadowBatchCore(
      { supabase: makeSupabase(state), reasoning: { env: { OPENAI_API_KEY: "sk-test" }, fetchImpl: fetchImpl as any } },
      { executionMode: "test" },
    );
    expect(result.processed).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(state["agent_tasks"]!.every((t) => t["status"] === "awaiting_review")).toBe(true);
  });

  it("två samtidiga körningar processar inte samma uppgift dubbelt", async () => {
    const state = baseState(1);
    const supabase = makeSupabase(state);
    const [a, b] = await Promise.all([
      processShadowBatchCore({ supabase }, { executionMode: "test" }),
      processShadowBatchCore({ supabase }, { executionMode: "test" }),
    ]);
    expect(a.processed + b.processed).toBe(1);
    const started = state["agent_task_events"]!.filter((e) => e["event_type"] === "task_started");
    expect(started).toHaveLength(1);
  });

  it("fel i körningen markeras som failed utan retry", async () => {
    const state = baseState(1);
    state["leads"] = []; // Sales-worker kastar när leadet saknas.
    const body = (await (await call({ executionMode: "test" }, state)).json()) as any;
    expect(body).toMatchObject({ processed: 0, failed: 1, awaitingReview: 0, externalEffect: false });
    expect(state["agent_tasks"]![0]!["status"]).toBe("failed");
  });

  it("svar och audit saknar PII och mailtext", async () => {
    const state = baseState(1);
    const body = (await (await call({ executionMode: "test" }, state)).json()) as any;
    expect(JSON.stringify(body)).not.toMatch(/@|Anna|Hej/);
    for (const event of state["agent_task_events"]!) {
      expect(JSON.stringify(event)).not.toMatch(/@|Anna/);
      expect((event["detail"] as any).externalEffect).toBe(false);
    }
    expect(body.externalEffect).toBe(false);
  });
});
