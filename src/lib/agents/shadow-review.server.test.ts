import { beforeEach, describe, expect, it } from "vitest";
import { computeSignature } from "@/lib/ai-sales/webhook-security";
import { handleGrowthApi } from "@/lib/growth/api.server";

const SECRET = "shadow-review-secret";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-10T19:30:00.000Z");
type Row = Record<string, any>;

function lead(index: number, overrides: Row = {}): Row {
  const suffix = String(index).padStart(12, "0");
  return {
    id: `11111111-1111-4111-8111-${suffix}`,
    customer_id: CUSTOMER_ID,
    customer_status: "Ny",
    created_at: new Date(NOW.getTime() - index * 60_000).toISOString(),
    payload: { email: `person${index}@example.test`, phone: "0701234567" },
    ...overrides,
  };
}

function makeSupabase(state: Record<string, Row[]>) {
  let seq = 0;
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let ascending = true;
      let orderColumn: string | null = null;
      const rows = () => {
        const selected = (state[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (orderColumn) {
          selected.sort((a, b) => String(a[orderColumn ?? ""]).localeCompare(String(b[orderColumn ?? ""])));
          if (!ascending) selected.reverse();
        }
        return selected;
      };
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return builder;
        },
        gte: (column: string, value: unknown) => {
          filters.push((row) => String(row[column]) >= String(value));
          return builder;
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          orderColumn = column;
          ascending = options?.ascending ?? true;
          return builder;
        },
        limit: async (count: number) => ({ data: rows().slice(0, count), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (row: Row) => {
          if (
            table === "agent_tasks" &&
            (state[table] ?? []).some((existing) => existing["idempotency_key"] === row["idempotency_key"])
          ) {
            const failed: any = {
              select: () => failed,
              single: async () => ({ data: null, error: { message: "duplicate key", code: "23505" } }),
            };
            return failed;
          }
          const created = { id: `${table}-${++seq}`, ...row };
          (state[table] ??= []).push(created);
          const result: any = {
            select: () => result,
            single: async () => ({ data: created, error: null }),
            then: (resolve: any) => resolve({ data: null, error: null }),
          };
          return result;
        },
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
  };
}

function baseState(leads: Row[] = [lead(1)]): Record<string, Row[]> {
  return {
    leads,
    customers: [{ id: CUSTOMER_ID }],
    growth_lead_state: leads.map((item) => ({ lead_id: item.id, intent_level: "NORMAL" })),
    agent_tasks: [],
    agent_task_events: [],
  };
}

let seen: Set<string>;
function deps(state: Record<string, Row[]>) {
  const supabase = makeSupabase(state);
  return {
    secret: SECRET,
    now: NOW,
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
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  return new Request("https://example.test/api/public/agents/shadow-review-test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-noryva-event-id": options.eventId ?? `shadow-${Math.random().toString(36).slice(2)}`,
      "x-forwarded-for": `10.2.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      "x-noryva-timestamp": timestamp,
      "x-noryva-signature": options.signature ?? computeSignature(SECRET, timestamp, raw),
    },
    body: raw,
  });
}

const call = (body: unknown, state: Record<string, Row[]>, options = {}) =>
  handleGrowthApi("agents-shadow-review-test", signed(body, options), deps(state));

beforeEach(() => {
  seen = new Set();
});

describe("agents-shadow-review-test", () => {
  it("kräver giltig HMAC och avvisar replay", async () => {
    expect((await call({ executionMode: "test" }, baseState(), { signature: "0".repeat(64) })).status).toBe(401);

    const state = baseState();
    expect((await call({ executionMode: "test" }, state, { eventId: "same-shadow-event" })).status).toBe(200);
    expect((await call({ executionMode: "test" }, state, { eventId: "same-shadow-event" })).status).toBe(409);
  });

  it("nekar andra körlägen och batchar över tio", async () => {
    expect((await call({ executionMode: "review" }, baseState())).status).toBe(400);
    expect((await call({ executionMode: "test", limit: 11 }, baseState())).status).toBe(400);
  });

  it("skapar högst tio köade Sales-uppgifter utan worker eller extern effekt", async () => {
    const state = baseState(Array.from({ length: 12 }, (_, index) => lead(index + 1)));
    const response = await call({ executionMode: "test", limit: 10 }, state);
    const body = (await response.json()) as any;

    expect(body).toMatchObject({ scanned: 10, created: 10, duplicate: 0, skipped: 0, externalEffect: false });
    expect(body.taskIds).toHaveLength(10);
    expect(state["agent_tasks"]).toHaveLength(10);
    for (const task of state["agent_tasks"] ?? []) {
      expect(task).toMatchObject({
        assigned_agent: "sales",
        task_type: "sales_draft",
        status: "queued",
        execution_mode: "test",
        requires_approval: true,
        approval_status: "pending",
      });
      expect(task["result"]).toBeUndefined();
    }
  });

  it("är idempotent per lead vid polling", async () => {
    const state = baseState();
    const first = (await (await call({ executionMode: "test" }, state)).json()) as any;
    const second = (await (await call({ executionMode: "test" }, state)).json()) as any;

    expect(first).toMatchObject({ created: 1, duplicate: 0 });
    expect(second).toMatchObject({ created: 0, duplicate: 1 });
    expect(second.taskIds).toEqual(first.taskIds);
    expect(state["agent_tasks"]).toHaveLength(1);
  });

  it("hoppar över saknad lead- eller kundbindning utan att gissa", async () => {
    const missingCustomerId = "33333333-3333-4333-8333-333333333333";
    const state = baseState([
      lead(1, { id: null }),
      lead(2, { customer_id: null }),
      lead(3, { customer_id: missingCustomerId }),
    ]);
    const body = (await (await call({ executionMode: "test" }, state)).json()) as any;

    expect(body).toMatchObject({ scanned: 3, created: 0, duplicate: 0, skipped: 3, externalEffect: false });
    expect(body.taskIds).toEqual([]);
    expect(state["agent_tasks"]).toHaveLength(0);
  });

  it("returnerar och loggar endast PII-fri metadata", async () => {
    const state = baseState();
    const body = (await (await call({ executionMode: "test" }, state)).json()) as any;
    const serialized = JSON.stringify({ body, events: state["agent_task_events"] });

    expect(body.externalEffect).toBe(false);
    expect(serialized).not.toMatch(/person1@example\.test|0701234567|payload|email|phone/i);
    expect(state["agent_task_events"]?.[0]?.["detail"]).toMatchObject({
      source: "shadow_review",
      externalEffect: false,
    });
  });
});