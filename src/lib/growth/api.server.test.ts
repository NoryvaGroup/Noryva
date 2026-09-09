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
  const rpcCalls: Array<[string, any]> = [];
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
        upsert: async () => ({ data: null, error: null }),
        update: (patch: Row) => {
          const res: any = {
            eq: (c: string, v: any) => {
              filters.push([c, v]);
              return res;
            },
            then: (resolve: any) => {
              for (const row of rows()) Object.assign(row, patch);
              return resolve({ data: null, error: null });
            },
          };
          return res;
        },
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
    async rpc(name: string, args: any) {
      rpcCalls.push([name, args]);
      if (name === "claim_growth_analysis") {
        const existing = (state["growth_analysis_claims"] ??= []).find(
          (r) => r["lead_id"] === args.p_lead_id && r["analysis_version"] === args.p_analysis_version,
        );
        if (existing) return { data: existing["status"], error: null };
        state["growth_analysis_claims"]!.push({
          lead_id: args.p_lead_id,
          analysis_version: args.p_analysis_version,
          status: "in_progress",
          result: {},
        });
        return { data: "claimed", error: null };
      }
      return { data: true, error: null };
    },
  };
  return { supabase, inserted, rpcCalls };
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

function depsNoSecret(state: Record<string, Row[]>, now?: Date) {
  fake = makeSupabase(state);
  return {
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

  it("route-lead innehåller aktuell intent-data", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      signedRequest("route-lead", { leadId: LEAD_ID }),
      deps(baseState(COMPLETE_ANSWERS)),
    );
    const body = (await res.json()) as any;
    expect(typeof body.intent.score).toBe("number");
    expect(["LÅG", "NORMAL", "HÖG", "AKUT"]).toContain(body.intent.level);
    expect(typeof body.intent.reason).toBe("string");
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

describe("Cloudflare Worker env-binding", () => {
  it("läser NORYVA_GROWTH_API_SECRET från request.env när override saknas", async () => {
    const state = baseState(COMPLETE_ANSWERS);
    const d = depsNoSecret(state);
    const req = signedRequest("route-lead", { leadId: LEAD_ID });
    (req as Request & { env?: Record<string, unknown> }).env = {
      NORYVA_GROWTH_API_SECRET: SECRET,
    };
    const res = await handleGrowthApi("route-lead", req, d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.leadId).toBe(LEAD_ID);
  });
});

/* ------------------------------------------------------------------ *
 * Normaliserat kontrakt, faktiska modellförsök och claim-återanvändning
 * ------------------------------------------------------------------ */

const AI_ENV = {
  NORYVA_GROWTH_API_SECRET: SECRET,
  AI_SALES_ASSISTANT_ENABLED: "true",
  LOVABLE_API_KEY: "test-key",
};

function withEnv(req: Request, env: Record<string, string> = AI_ENV) {
  (req as Request & { env?: Record<string, unknown> }).env = env;
  return req;
}

/** Utfall som lyfter intent till NORMAL (ai_light) respektive HÖG (ai_full). */
function stateWithOutcomes(outcomes: string[], extra: Record<string, Row[]> = {}) {
  const state = baseState(COMPLETE_ANSWERS);
  state["customer_profiles"] = [
    { customer_id: CUSTOMER_ID, ai_assistant_enabled: true, execution_mode: "test" },
  ];
  state["growth_outcomes"] = outcomes.map((t, i) => ({
    id: `o-${i}`,
    lead_id: LEAD_ID,
    customer_id: CUSTOMER_ID,
    outcome_type: t,
    outcome_value: null,
    revenue_value: null,
  }));
  return { ...state, ...extra };
}

const MODEL_JSON = JSON.stringify({
  action: "Följ upp",
  contactSpeed: "Inom 24 timmar",
  subject: "Din takförfrågan",
  emailDraft: "Hej!\n\nTack för din förfrågan, vi återkommer med nästa steg inom kort.",
  followupQuestions: ["Kan du beskriva takets skick närmare?"],
  humanTakeover: false,
  strategyReason: "Tydligt behov och rimlig tidsram.",
  confidence: 0.7,
  safetyFlags: [],
  research: {
    needSummary: "Takbyte på lagerbyggnad.",
    buyingSignals: ["Tidsram 3-6 månader"],
    risks: [],
    qualificationNote: "Normalt kvalificerat.",
  },
});

function stubFetch(impl: () => any) {
  const calls = { count: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls.count += 1;
    return impl();
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function okResponse() {
  return new Response(JSON.stringify({ output_text: MODEL_JSON, usage: { input_tokens: 800, output_tokens: 300 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function analyze(state: Record<string, Row[]>, env = AI_ENV) {
  const res = await handleGrowthApi(
    "analyze-lead",
    withEnv(signedRequest("analyze-lead", { leadId: LEAD_ID }), env),
    depsNoSecret(state),
  );
  return { res, body: (await res.json()) as any };
}

describe("normaliserat svarsformat", () => {
  it("route-lead och analyze-lead returnerar identiskt schema utan kontakt-PII", async () => {
    const routeRes = await handleGrowthApi(
      "route-lead",
      withEnv(signedRequest("route-lead", { leadId: LEAD_ID })),
      depsNoSecret(baseState(COMPLETE_ANSWERS)),
    );
    const routeBody = (await routeRes.json()) as any;
    const { body: analyzeBody } = await analyze(baseState(COMPLETE_ANSWERS));

    const n = routeBody.normalized;
    expect(Object.keys(n).sort()).toEqual(Object.keys(analyzeBody.normalized).sort());
    expect(n.schema_version).toBe("noryva.growth.normalized.v1");
    expect(n.review_required).toBe(true);
    expect(n.review_status).toBe("draft");

    // Alla sju CRM-fält är alltid ifyllda, även deterministiskt/human.
    for (const key of [
      "action",
      "contact_speed",
      "subject",
      "email_draft",
      "strategy_reason",
    ]) {
      expect(typeof n.sales[key]).toBe("string");
      expect(n.sales[key].length).toBeGreaterThan(0);
    }
    expect(Array.isArray(n.sales.followup_questions)).toBe(true);
    expect(typeof n.sales.human_takeover).toBe("boolean");

    // Kvalificering och kontext följer med, men ingen kontakt-PII.
    expect(typeof n.qualification.score).toBe("number");
    expect(typeof n.context.need).toBe("string");
    expect(n.context).toHaveProperty("roof");
    const serialized = JSON.stringify(n).toLowerCase();
    for (const forbidden of ["epost", "telefon", "@", "kontaktperson"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});

describe("faktiska modellförsök", () => {
  it("deterministiskt lead ger 0 försök och inget nätverksanrop", async () => {
    const stub = stubFetch(okResponse);
    try {
      const { body } = await analyze(baseState(COMPLETE_ANSWERS));
      expect(body.llmCalls).toBe(0);
      expect(stub.calls.count).toBe(0);
    } finally {
      stub.restore();
    }
  });

  it("prisfråga går till människa med 0 försök", async () => {
    const stub = stubFetch(okResponse);
    try {
      const state = baseState({
        ...COMPLETE_ANSWERS,
        projektbeskrivning: "Vad kostar ett nytt tak? Vi vill ha en offert.",
      });
      const { body } = await analyze(state);
      expect(body.route).toBe("human");
      expect(body.llmCalls).toBe(0);
      expect(stub.calls.count).toBe(0);
      expect(body.normalized.requires_human).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it("ai_light ger exakt 1 försök", async () => {
    const stub = stubFetch(okResponse);
    try {
      const { body } = await analyze(stateWithOutcomes(["replied", "meeting_booked"]));
      expect(body.route).toBe("ai_light");
      expect(body.llmCalls).toBe(1);
      expect(stub.calls.count).toBe(1);
      expect(body.normalized.llm_attempts).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it("ai_full ger exakt 1 försök", async () => {
    const stub = stubFetch(okResponse);
    try {
      const { body } = await analyze(stateWithOutcomes(["won"]));
      expect(body.route).toBe("ai_full");
      expect(body.llmCalls).toBe(1);
      expect(stub.calls.count).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it("leverantörsfel behåller försök, försökt nivå och konservativ kostnad", async () => {
    const stub = stubFetch(() => new Response("upstream down", { status: 503 }));
    try {
      const { body } = await analyze(stateWithOutcomes(["replied", "meeting_booked"]));
      expect(stub.calls.count).toBe(1);
      expect(body.llmCalls).toBe(1);
      expect(body.usedFallback).toBe(true);
      expect(body.attemptedTier).toBe("ai_light");
      expect(body.attemptedModel).toBeTruthy();
      expect(body.normalized.cost.estimated_usd).toBeGreaterThan(0);
      expect(body.normalized.cost.assumed).toBe(true);
      expect(body.normalized.sales.subject.length).toBeGreaterThan(0);
    } finally {
      stub.restore();
    }
  });

  it("ogiltig JSON från modellen ger fallback men räknat försök", async () => {
    const stub = stubFetch(
      () => new Response(JSON.stringify({ output_text: "inte json alls" }), { status: 200 }),
    );
    try {
      const { body } = await analyze(stateWithOutcomes(["replied", "meeting_booked"]));
      expect(stub.calls.count).toBe(1);
      expect(body.llmCalls).toBe(1);
      expect(body.usedFallback).toBe(true);
      expect(body.normalized.attempted_tier).toBe("ai_light");
    } finally {
      stub.restore();
    }
  });

  it("budgettak nedgraderar till deterministisk utan modellanrop", async () => {
    const stub = stubFetch(okResponse);
    try {
      const state = stateWithOutcomes(["replied", "meeting_booked"]);
      state["ai_cost_events"] = [
        { id: "c1", customer_id: CUSTOMER_ID, estimated_cost: 99, created_at: new Date().toISOString() },
      ];
      const { body } = await analyze(state);
      expect(body.route).toBe("deterministic");
      expect(body.llmCalls).toBe(0);
      expect(stub.calls.count).toBe(0);
      expect(body.normalized.budget_state).toBe("exceeded");
    } finally {
      stub.restore();
    }
  });
});

describe("claim: högst ett modellanrop per lead", () => {
  it("upprepade anrop med nya event-id ger bara ett modellanrop", async () => {
    const stub = stubFetch(okResponse);
    try {
      const state = stateWithOutcomes(["replied", "meeting_booked"]);
      const d = depsNoSecret(state);
      const first = await handleGrowthApi(
        "analyze-lead",
        withEnv(signedRequest("analyze-lead", { leadId: LEAD_ID })),
        d,
      );
      const second = await handleGrowthApi(
        "analyze-lead",
        withEnv(signedRequest("analyze-lead", { leadId: LEAD_ID })),
        d,
      );
      const b1 = (await first.json()) as any;
      const b2 = (await second.json()) as any;
      expect(stub.calls.count).toBe(1);
      expect(b1.llmCalls).toBe(1);
      expect(b2.llmCalls).toBe(0);
      expect(b2.reused).toBe(true);
      expect(b2.normalized.sales.subject).toBe(b1.normalized.sales.subject);
    } finally {
      stub.restore();
    }
  });

  it("samtidiga anrop ger bara ett modellanrop", async () => {
    const stub = stubFetch(okResponse);
    try {
      const state = stateWithOutcomes(["replied", "meeting_booked"]);
      const d = depsNoSecret(state);
      const [a, b] = await Promise.all([
        handleGrowthApi("analyze-lead", withEnv(signedRequest("analyze-lead", { leadId: LEAD_ID })), d),
        handleGrowthApi("analyze-lead", withEnv(signedRequest("analyze-lead", { leadId: LEAD_ID })), d),
      ]);
      const bodies = [(await a.json()) as any, (await b.json()) as any];
      expect(stub.calls.count).toBe(1);
      expect(bodies.filter((x) => x.llmCalls === 1).length).toBe(1);
      expect(bodies.filter((x) => x.reused === true).length).toBe(1);
    } finally {
      stub.restore();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Kill switch: route-lead och analyze-lead måste alltid vara överens
 * ------------------------------------------------------------------ */

const AI_OFF_ENV = {
  NORYVA_GROWTH_API_SECRET: SECRET,
  AI_SALES_ASSISTANT_ENABLED: "false",
  LOVABLE_API_KEY: "test-key",
};

async function routeOf(state: Record<string, Row[]>, env: Record<string, string>) {
  const res = await handleGrowthApi(
    "route-lead",
    withEnv(signedRequest("route-lead", { leadId: LEAD_ID }), env),
    depsNoSecret(state),
  );
  return (await res.json()) as any;
}

describe("global AI-kill switch", () => {
  it("global AI av: både route och analyze blir deterministic utan modellanrop", async () => {
    const stub = stubFetch(okResponse);
    try {
      // Lead som annars skulle bli ai_light (kundens AI är påslagen).
      const routeBody = await routeOf(stateWithOutcomes(["replied", "meeting_booked"]), AI_OFF_ENV);
      const { body: analyzeBody } = await analyze(
        stateWithOutcomes(["replied", "meeting_booked"]),
        AI_OFF_ENV,
      );

      expect(routeBody.route).toBe("deterministic");
      expect(routeBody.llmCalls).toBe(0);
      expect(analyzeBody.route).toBe("deterministic");
      expect(analyzeBody.llmCalls).toBe(0);
      expect(routeBody.route).toBe(analyzeBody.route);
      expect(stub.calls.count).toBe(0);
      // Riskfyllda funktioner förblir avstängda.
      expect(analyzeBody.normalized.review_required).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it("global AI på + kundens AI på: samma route i båda, exakt ett AI-anrop", async () => {
    const stub = stubFetch(okResponse);
    try {
      const routeBody = await routeOf(stateWithOutcomes(["replied", "meeting_booked"]), AI_ENV);
      const { body: analyzeBody } = await analyze(stateWithOutcomes(["replied", "meeting_booked"]));

      expect(routeBody.route).toBe("ai_light");
      expect(analyzeBody.route).toBe("ai_light");
      expect(routeBody.route).toBe(analyzeBody.route);
      expect(routeBody.llmCalls).toBe(1);
      expect(analyzeBody.llmCalls).toBe(1);
      // route-lead gör aldrig ett eget anrop – endast analyze-lead anropar modellen.
      expect(stub.calls.count).toBe(1);
    } finally {
      stub.restore();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Opt-in Make-migrationskontrakt (makeContext)
 * ------------------------------------------------------------------ */

const MAKE_CONTEXT = {
  customerId: CUSTOMER_ID,
  serviceArea: "Skaraborg",
  localPostalPrefix: "50",
  regionalPostalPrefix: "51",
};

function migrationState() {
  const state = baseState({ ...COMPLETE_ANSWERS, postnummer: "503 30", ager_fastigheten: "Ja" });
  state["customer_profiles"] = [
    { customer_id: CUSTOMER_ID, ai_assistant_enabled: true, execution_mode: "test" },
  ];
  return state;
}

describe("makeContext-kontraktet", () => {
  it("avvisar fel kundbindning med 403 innan något modellanrop", async () => {
    const stub = stubFetch(okResponse);
    try {
      const res = await handleGrowthApi(
        "analyze-lead",
        withEnv(
          signedRequest("analyze-lead", {
            leadId: LEAD_ID,
            makeContext: { ...MAKE_CONTEXT, customerId: "33333333-3333-4333-8333-333333333333" },
          }),
        ),
        depsNoSecret(migrationState()),
      );
      expect(res.status).toBe(403);
      expect(stub.calls.count).toBe(0);
    } finally {
      stub.restore();
    }
  });

  it("avvisar okända fält och klientstyrd scoring", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      withEnv(
        signedRequest("route-lead", {
          leadId: LEAD_ID,
          makeContext: { ...MAKE_CONTEXT, score: 99 },
        }),
      ),
      depsNoSecret(migrationState()),
    );
    expect(res.status).toBe(400);
  });

  it("ger migrationsscoring, geografi och manuell granskning utan postnummer i svaret", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      withEnv(signedRequest("route-lead", { leadId: LEAD_ID, makeContext: MAKE_CONTEXT })),
      depsNoSecret(migrationState()),
    );
    const n = ((await res.json()) as any).normalized;
    expect(n.migration_contract).toBe("noryva.make.migration.v1");
    expect(n.qualification.source).toBe("make-migration-tak");
    expect(n.qualification.geography.verdict).toBe("local");
    expect(n.qualification.geography.service_area).toBe("Skaraborg");
    expect(typeof n.qualification.manual_review).toBe("boolean");
    // Exakt postnummer får aldrig lämna servern.
    expect(JSON.stringify(n)).not.toContain("50330");
    expect(JSON.stringify(n)).not.toContain("503 30");
  });

  it("befintliga anropare utan makeContext påverkas inte", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      withEnv(signedRequest("route-lead", { leadId: LEAD_ID })),
      depsNoSecret(migrationState()),
    );
    const n = ((await res.json()) as any).normalized;
    expect(n.migration_contract).toBe(null);
    expect(n.qualification.source).not.toContain("make-migration");
  });

  it("kundutkastet riktar sig till kunden och signeras med företagsnamnet", async () => {
    const res = await handleGrowthApi(
      "route-lead",
      withEnv(signedRequest("route-lead", { leadId: LEAD_ID, makeContext: MAKE_CONTEXT })),
      depsNoSecret(migrationState()),
    );
    const n = ((await res.json()) as any).normalized;
    expect(n.draft_contract).toBe("noryva.customer-draft.v1");
    expect(n.sales.email_draft.startsWith("Hej")).toBe(true);
    expect(n.sales.email_draft).toContain("Testkund");
    expect(n.sales.email_draft.split(/\s+/).length).toBeLessThanOrEqual(80);
    expect(n.sales.followup_questions.length).toBeLessThanOrEqual(2);
    // Inga tekniska fält i kundtexten.
    for (const word of ["ai_light", "ai_full", "deterministic", "tier", "LLM"]) {
      expect(n.sales.email_draft).not.toContain(word);
    }
  });

  it("cachat äldre svar transformeras utan nytt modellanrop", async () => {
    const stub = stubFetch(okResponse);
    try {
      const state = stateWithOutcomes(["replied", "meeting_booked"]);
      state["growth_analysis_claims"] = [
        {
          lead_id: LEAD_ID,
          analysis_version: "growth-analysis-v1",
          status: "done",
          result: {
            schema_version: "noryva.growth.normalized.v1",
            analysis_version: "growth-analysis-v1",
            sales: {
              action: "Ring",
              contact_speed: "Idag",
              subject: "Internt",
              email_draft: "Säljare: ring leadet och pusha på offert.",
              followup_questions: [],
              human_takeover: false,
              strategy_reason: "gammalt",
            },
            qualification: { score: 1, qualification: "Låg", priority: "LÅG", source: "legacy" },
            safety_flags: [],
          },
        },
      ];
      const res = await handleGrowthApi(
        "analyze-lead",
        withEnv(
          signedRequest("analyze-lead", { leadId: LEAD_ID, makeContext: MAKE_CONTEXT }),
        ),
        depsNoSecret(state),
      );
      const body = (await res.json()) as any;
      expect(stub.calls.count).toBe(0);
      expect(body.llmCalls).toBe(0);
      expect(body.normalized.reused).toBe(true);
      expect(body.normalized.draft_contract).toBe("noryva.customer-draft.v1");
      // Det interna utkastet ersätts av ett säkert kundutkast.
      expect(body.normalized.sales.email_draft.startsWith("Hej")).toBe(true);
      expect(body.normalized.safety_flags).toContain("migration:stale_draft_replaced");
      expect(body.normalized.qualification.source).toBe("make-migration-tak");
    } finally {
      stub.restore();
    }
  });
});

/**
 * TEST/REVIEW-bryggan för nurture (plan-nurture-test).
 * Ingen extern effekt får uppstå: inga mail, notiser eller bokningar.
 */
const INCOMPLETE_ANSWERS = { behov: "Takrenovering", postnummer: "503 30", ager_fastigheten: "Ja" };

function nurtureState(answers: Record<string, string>, outcomes: string[] = [], mode = "test") {
  const state = baseState(answers);
  state["customer_profiles"] = [
    { customer_id: CUSTOMER_ID, ai_assistant_enabled: true, execution_mode: mode },
  ];
  state["growth_outcomes"] = outcomes.map((t, i) => ({
    id: `n-${i}`,
    lead_id: LEAD_ID,
    customer_id: CUSTOMER_ID,
    outcome_type: t,
    outcome_value: null,
    revenue_value: null,
  }));
  state["growth_nurture_state"] = [];
  return state;
}

async function planNurture(state: Record<string, Row[]>, body: unknown = { leadId: LEAD_ID }) {
  const res = await handleGrowthApi(
    "plan-nurture-test",
    withEnv(signedRequest("plan-nurture-test", body)),
    deps(state),
  );
  return { res, body: (await res.json()) as any };
}

describe("plan-nurture-test", () => {
  it("kräver giltig signatur och avvisar replay", async () => {
    const bad = await handleGrowthApi(
      "plan-nurture-test",
      signedRequest("plan-nurture-test", { leadId: LEAD_ID }, { secret: "fel" }),
      deps(nurtureState(INCOMPLETE_ANSWERS)),
    );
    expect(bad.status).toBe(401);

    const state = nurtureState(INCOMPLETE_ANSWERS);
    const eventId = "nurture-dup";
    const first = await handleGrowthApi(
      "plan-nurture-test",
      withEnv(signedRequest("plan-nurture-test", { leadId: LEAD_ID }, { eventId })),
      deps(state),
    );
    expect(first.status).toBe(200);
    const second = await handleGrowthApi(
      "plan-nurture-test",
      withEnv(signedRequest("plan-nurture-test", { leadId: LEAD_ID }, { eventId })),
      deps(state),
    );
    expect(second.status).toBe(409);
  });

  it("avvisar okända fält i nyttolasten", async () => {
    const { res } = await planNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      route: "ai_full",
      score: 100,
    });
    expect(res.status).toBe(400);
  });

  it("avvisar makeContext som pekar på fel kund", async () => {
    const { res } = await planNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      makeContext: { ...MAKE_CONTEXT, customerId: "33333333-3333-4333-8333-333333333333" },
    });
    expect(res.status).toBe(403);
  });

  it("LÅG/NORMAL får kundriktad preview utan extern effekt", async () => {
    const { body } = await planNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      makeContext: MAKE_CONTEXT,
    });
    expect(["LÅG", "NORMAL"]).toContain(body.intent.level);
    expect(body.eligible).toBe(true);
    expect(body.questions.length).toBeGreaterThan(0);
    expect(body.questions.length).toBeLessThanOrEqual(3);
    expect(body.preview.body.startsWith("Hej!")).toBe(true);
    expect(body.preview.body).toContain("Testkund");
    for (const word of ["ai_light", "ai_full", "tier", "score", "route", "offert", "pris"]) {
      expect(body.preview.body.toLowerCase()).not.toContain(word.toLowerCase());
    }
    expect(body.notificationSent).toBe(false);
    expect(body.externalEffect).toBe(false);
  });

  it("hittar inte på frågor när underlaget är komplett", async () => {
    const { body } = await planNurture(nurtureState(COMPLETE_ANSWERS));
    expect(body.questions).toEqual([]);
    expect(body.eligible).toBe(false);
    expect(body.preview).toBeNull();
  });

  it("HÖG/AKUT får aldrig nurture-preview", async () => {
    const { body } = await planNurture(
      nurtureState(
        { behov: "Takbyte", tidsram: "Snarast", ager_fastigheten: "Ja", postnummer: "503 30" },
        ["contacted", "replied", "meeting_booked", "revenue"],
      ),
      { leadId: LEAD_ID, makeContext: MAKE_CONTEXT },
    );
    expect(["HÖG", "AKUT"]).toContain(body.intent.level);
    expect(body.eligible).toBe(false);
    expect(body.preview).toBeNull();
    expect(body.externalEffect).toBe(false);
  });

  it("pris/offert ger mänsklig handläggning i stället för kundutkast", async () => {
    const { body } = await planNurture(
      nurtureState({ ...INCOMPLETE_ANSWERS, projektbeskrivning: "Vad kostar det? Vi vill ha offert och avtal." }),
    );
    expect(body.humanTakeover).toBe(true);
    expect(body.eligible).toBe(false);
    expect(body.preview).toBeNull();
  });

  it("kund som skulle vara live kan ändå inte utlösa något utskick", async () => {
    const { body } = await planNurture(nurtureState(INCOMPLETE_ANSWERS, [], "live"));
    expect(["test", "review"]).toContain(body.executionMode);
    expect(body.notificationSent).toBe(false);
    expect(body.externalEffect).toBe(false);
  });
});
