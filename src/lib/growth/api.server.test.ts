/**
 * Tester för de HMAC-verifierade Growth-endpointerna.
 * Ingen riktig databas och inga externa anrop – Supabase ersätts av en stub.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { computeSignature } from "@/lib/ai-sales/webhook-security";
import { handleGrowthApi } from "./api.server";
import type { GrowthOperation } from "./api-security";

const SECRET = "growth-test-secret";
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;

function makeSupabase(state: Record<string, Row[]>) {
  const inserted: Record<string, Row[]> = {};
  const supabase = {
    from(table: string) {
      const filters: Array<[string, any]> = [];
      const rows = () =>
        (state[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => {
          filters.push([c, v]);
          return builder;
        },
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (row: Row) => {
          (inserted[table] ??= []).push(row);
          (state[table] ??= []).push({ id: `${table}-${(state[table] ?? []).length + 1}`, ...row });
          const res: any = {
            select: () => res,
            maybeSingle: async () => ({ data: { id: `${table}-id` }, error: null }),
            then: (resolve: any) => resolve({ data: null, error: null }),
          };
          return res;
        },
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
    rpc: async () => ({ data: true, error: null }),
  };
  return { supabase, inserted };
}

function baseState(answers: Record<string, string>) {
  return {
    leads: [
      {
        id: LEAD_ID,
        customer_id: CUSTOMER_ID,
        industry: "tak",
        payload: { answers },
        created_at: "2026-09-08T10:00:00.000Z",
      },
    ],
    customers: [{ id: CUSTOMER_ID, name: "Testkund", industry: "tak" }],
    customer_profiles: [] as Row[],
    ai_cost_events: [] as Row[],
    growth_assignments: [] as Row[],
    growth_outcomes: [] as Row[],
    ai_sales_assistant_runs: [] as Row[],
    ai_sales_events: [] as Row[],
  } as Record<string, Row[]>;
}

const COMPLETE_ANSWERS = {
  behov: "Byte av tak på lagerbyggnad",
  tidsram: "3-6 månader",
  projektbeskrivning: "Ytan är cirka 400 kvadratmeter och taket läcker vid takfoten.",
};

let seenEvents: Set<string>;
let fake: ReturnType<typeof makeSupabase>;

function deps(state: Record<string, Row[]>, now?: Date) {
  fake = makeSupabase(state);
  return {
    secret: SECRET,
    getClient: async () => ({ supabase: fake.supabase, userId: null }),
    markEvent: async (_ctx: any, eventId: string) => {
      if (seenEvents.has(eventId)) return false;
      seenEvents.add(eventId);
      return true;
    },
    ...(now ? { now } : {}),
  };
}

function signedRequest(
  operation: GrowthOperation,
  body: unknown,
  options: { secret?: string; eventId?: string; timestamp?: string; signature?: string; omit?: boolean } = {},
) {
  const raw = JSON.stringify(body);
  const ts = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-noryva-event-id": options.eventId ?? `evt-${Math.random().toString(36).slice(2)}`,
  };
  if (!options.omit) {
    headers["x-noryva-timestamp"] = ts;
    headers["x-noryva-signature"] =
      options.signature ?? computeSignature(options.secret ?? SECRET, ts, raw);
  }
  return new Request(`https://example.test/api/public/growth/${operation}`, {
    method: "POST",
    headers,
    body: raw,
  });
}

beforeEach(() => {
  seenEvents = new Set();
});

describe("HMAC-verifiering", () => {
  it("godkänner korrekt signerat anrop", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: LEAD_ID }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.leadId).toBe(LEAD_ID);
    expect(["deterministic", "ai_light", "ai_full", "human"]).toContain(body.route);
  });

  it("avvisar saknad signatur", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: LEAD_ID }, { omit: true }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    expect(res.status).toBe(401);
  });

  it("avvisar felaktig signatur", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: LEAD_ID }, { signature: "0".repeat(64) }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    expect(res.status).toBe(401);
  });

  it("avvisar signatur från fel hemlighet", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: LEAD_ID }, { secret: "fel-hemlighet" }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    expect(res.status).toBe(401);
  });

  it("avvisar för gammal tidsstämpel", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: LEAD_ID }, { timestamp: stale }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/replay/i);
  });

  it("avvisar anrop utan event-id", async () => {
    const raw = JSON.stringify({ leadId: LEAD_ID });
    const ts = String(Math.floor(Date.now() / 1000));
    const req = new Request("https://example.test/api/public/growth/route-lead", {
      method: "POST",
      headers: {
        "x-noryva-timestamp": ts,
        "x-noryva-signature": computeSignature(SECRET, ts, raw),
      },
      body: raw,
    });
    const res = await handleGrowthApi("route-lead", req, deps(baseState(COMPLETE_ANSWERS)));
    expect(res.status).toBe(400);
  });
});

describe("replayskydd", () => {
  it("avvisar samma event-id två gånger", async () => {
    const state = baseState(COMPLETE_ANSWERS);
    const d = deps(state);
    const first = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: LEAD_ID }, { eventId: "evt-fast" }),
      d,
    );
    const second = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: LEAD_ID }, { eventId: "evt-fast" }),
      d,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).duplicate).toBe(true);
  });
});

describe("schemavalidering", () => {
  it("avvisar ogiltigt leadId", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: "inte-uuid" }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    expect(res.status).toBe(400);
  });

  it("avvisar försök att tvinga fram ai_full", async () => {
    const res = await handleGrowthApi(
      "analyze-lead",
      signedRequest("analyze-lead", { leadId: LEAD_ID, forceTier: "ai_full" }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    expect(res.status).toBe(400);
  });

  it("avvisar annan metod än POST", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      new Request("https://example.test/api/public/growth/route-lead", { method: "GET" }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    expect(res.status).toBe(405);
  });
});

describe("analyze-lead utan AI", () => {
  it("kör 0 AI-anrop när routern säger deterministic", async () => {
    const res = await handleGrowthApi(
      "analyze-lead",
      signedRequest("analyze-lead", { leadId: LEAD_ID }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.route).toBe("deterministic");
    expect(body.tier).toBe("deterministic");
    expect(body.llmCalls).toBe(0);
    expect(body.model).toBeNull();
  });

  it("kör 0 AI-anrop och kräver människa vid prisfrågor", async () => {
    const res = await handleGrowthApi(
      "analyze-lead",
      signedRequest("analyze-lead", { leadId: LEAD_ID }),
      deps(
        baseState({
          ...COMPLETE_ANSWERS,
          projektbeskrivning: "Vad kostar ett nytt tak? Vi vill ha en offert.",
        }),
      ),
    );
    const body = (await res.json()) as any;
    expect(body.route).toBe("human");
    expect(body.llmCalls).toBe(0);
    expect(body.requiresHuman).toBe(true);
  });
});

describe("register-outcome", () => {
  it("registrerar ett utfall och är idempotent", async () => {
    const state = baseState(COMPLETE_ANSWERS);
    const d = deps(state);
    const first = await handleGrowthApi(
      "register-outcome",
      signedRequest("register-outcome", { leadId: LEAD_ID, outcomeType: "meeting_booked" }),
      d,
    );
    const firstBody = (await first.json()) as any;
    expect(first.status).toBe(200);
    expect(firstBody.created).toBe(true);

    const second = await handleGrowthApi(
      "register-outcome",
      signedRequest("register-outcome", { leadId: LEAD_ID, outcomeType: "meeting_booked" }),
      d,
    );
    const secondBody = (await second.json()) as any;
    expect(secondBody.created).toBe(false);
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
    expect(state["growth_outcomes"]!.length).toBe(1);
  });
});
