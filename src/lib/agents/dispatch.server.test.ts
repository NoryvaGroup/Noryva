/**
 * Tester för det HMAC-skyddade Agent HQ TEST-endpointet.
 * Ingen riktig databas, inga externa anrop, ingen worker.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { computeSignature } from "@/lib/ai-sales/webhook-security";
import { handleGrowthApi } from "@/lib/growth/api.server";

const SECRET = "agents-test-secret";
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;

function makeSupabase(state: Record<string, Row[]>) {
  let seq = 0;
  const supabase = {
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
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
  };
  return supabase;
}

function baseState(): Record<string, Row[]> {
  return {
    leads: [{ id: LEAD_ID, customer_id: CUSTOMER_ID }],
    growth_lead_state: [{ lead_id: LEAD_ID, intent_level: "HÖG" }],
    agent_tasks: [],
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
  return new Request("https://example.test/api/public/agents/dispatch-test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-noryva-event-id": options.eventId ?? `evt-${Math.random().toString(36).slice(2)}`,
      "x-forwarded-for": `10.1.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      "x-noryva-timestamp": ts,
      "x-noryva-signature": options.signature ?? computeSignature(SECRET, ts, raw),
    },
    body: raw,
  });
}

const call = (body: unknown, state: Record<string, Row[]>, opts = {}) =>
  handleGrowthApi("agents-dispatch-test", signed(body, opts), deps(state));

beforeEach(() => {
  seen = new Set();
});

describe("agents-dispatch-test", () => {
  it("kräver giltig signatur", async () => {
    const res = await call({ type: "new_lead", leadId: LEAD_ID }, baseState(), {
      signature: "0".repeat(64),
    });
    expect(res.status).toBe(401);
  });

  it("avvisar replay av samma event-id", async () => {
    const state = baseState();
    expect((await call({ type: "new_lead", leadId: LEAD_ID }, state, { eventId: "fast" })).status).toBe(200);
    expect((await call({ type: "new_lead", leadId: LEAD_ID }, state, { eventId: "fast" })).status).toBe(409);
  });

  it("avvisar okänd eventtyp och extra fält", async () => {
    expect((await call({ type: "send_email", leadId: LEAD_ID }, baseState())).status).toBe(400);
    expect(
      (await call({ type: "new_lead", leadId: LEAD_ID, runWorker: true }, baseState())).status,
    ).toBe(400);
  });

  it("ger 404 för okänt lead", async () => {
    const res = await call(
      { type: "new_lead", leadId: "33333333-3333-4333-8333-333333333333" },
      baseState(),
    );
    expect(res.status).toBe(404);
  });

  it("new_lead går till sales och delivery_error till systems_qa", async () => {
    const a = await (await call({ type: "new_lead", leadId: LEAD_ID }, baseState())).json();
    expect(a.assignedAgent).toBe("sales");
    expect(a.taskType).toBe("sales_draft");
    expect(a.priority).toBe("high");

    const b = await (await call({ type: "delivery_error", leadId: LEAD_ID }, baseState())).json();
    expect(b.assignedAgent).toBe("systems_qa");
    expect(b.taskType).toBe("delivery_check");
    expect(b.requiresApproval).toBe(false);
  });

  it("är idempotent per event + lead + occurrence", async () => {
    const state = baseState();
    const first = await (await call({ type: "new_lead", leadId: LEAD_ID }, state)).json();
    const second = await (await call({ type: "new_lead", leadId: LEAD_ID }, state)).json();
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.taskId).toBe(first.taskId);
    expect(state["agent_tasks"]!.length).toBe(1);
  });

  it("loggar audit med actor=system och utan PII, och kör ingen worker", async () => {
    const state = baseState();
    const body = await (await call({ type: "new_lead", leadId: LEAD_ID }, state)).json();
    expect(body.executionMode).toBe("test");
    expect(body.externalEffect).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/@|payload|answers/);

    const event = state["agent_task_events"]![0]!;
    expect(event["actor"]).toBe("system");
    expect(event["detail"].externalEffect).toBe(false);
    expect(JSON.stringify(event)).not.toMatch(/@/);

    // Ingen worker: uppgiften ligger kvar i kö utan resultat.
    expect(state["agent_tasks"]![0]!["status"]).toBe("queued");
    expect(state["agent_tasks"]![0]!["result"]).toBeUndefined();
  });
});
