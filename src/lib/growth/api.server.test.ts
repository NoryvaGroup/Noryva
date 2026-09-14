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
      const ltFilters: Array<[string, any]> = [];
      const inFilters: Array<[string, any[]]> = [];
      let rowLimit = Infinity;
      const rows = () =>
        (state[table] ?? [])
          .filter(
            (r) =>
              filters.every(([c, v]) => r[c] === v) &&
              ltFilters.every(([c, v]) => String(r[c]) < String(v)) &&
              inFilters.every(([c, v]) => v.includes(r[c])),
          )
          .slice(0, rowLimit);
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => {
          filters.push([c, v]);
          return builder;
        },
        in: (c: string, v: any[]) => {
          inFilters.push([c, v]);
          return builder;
        },
        lt: (c: string, v: any) => {
          ltFilters.push([c, v]);
          return builder;
        },
        gte: () => builder,
        order: () => builder,
        limit: (n: number) => {
          rowLimit = n;
          return builder;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (row: Row) => {
          (inserted[table] ??= []).push(row);
          (state[table] ??= []).push({ id: `${table}-${(state[table] ?? []).length + 1}`, ...row });
          const res: any = {
            select: () => res,
            maybeSingle: async () => ({ data: { id: `${table}-id` }, error: null }),
            single: async () => ({ data: { id: `${table}-id`, stage: "new" }, error: null }),
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
    // Unik IP per anrop så att den avsedda in-memory-throttlingen inte
    // stör testsviten (den testas separat).
    "x-forwarded-for": `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
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

  it("returnerar kundkonfiguration från leadets verkliga kund, utan hemligheter", async () => {
    const state = baseState(COMPLETE_ANSWERS);
    state["customers"] = [
      {
        id: CUSTOMER_ID,
        name: "Testkund",
        industry: "tak",
        service_area: "Borås",
        status: "published",
        recipient_email: "legacy@example.se",
        delivery_webhook_url: "https://hook.example.test/hemlig",
      },
    ];
    state["customer_profiles"] = [
      {
        customer_id: CUSTOMER_ID,
        tone: "professionell",
        language: "sv",
        lead_prefix: "NORYVA",
        qualification_profile: {},
        followup_rules: {},
        booking_rules: {},
        notify_recipients: ["kund@example.se"],
        ai_assistant_enabled: true,
        execution_mode: "test",
        local_postal_prefix: "50",
        regional_postal_prefix: "51",
      },
    ];
    const res = await handleGrowthApi(
      "analyze-lead",
      signedRequest("analyze-lead", { leadId: LEAD_ID }),
      deps(state),
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.customerConfigError).toBeNull();
    expect(body.customerConfig.customerId).toBe(CUSTOMER_ID);
    expect(body.customerConfig.notifyRecipients).toEqual(["kund@example.se"]);
    expect(body.customerConfig.executionMode).toBe("test");
    expect(body.customerConfig.localPostalPrefix).toBe("50");
    expect(body.customerConfig.mailChannel.verified).toBe(false);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("legacy@example.se");
    expect(raw).not.toContain("hook.example.test");
  });

  it("ger customerConfig=null med fel när kunden saknas – ingen fallback", async () => {
    const state = baseState(COMPLETE_ANSWERS);
    state["customers"] = [];
    const res = await handleGrowthApi(
      "analyze-lead",
      signedRequest("analyze-lead", { leadId: LEAD_ID }),
      deps(state),
    );
    const body = (await res.json()) as any;
    expect(body.customerConfig).toBeNull();
    expect(typeof body.customerConfigError).toBe("string");
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

const AI_ENV: Record<string, string> = {
  NORYVA_GROWTH_API_SECRET: SECRET,
  AI_SALES_ASSISTANT_ENABLED: "true",
  LOVABLE_API_KEY: "test-key",
  // Reply-tester får aldrig använda en verklig OpenAI-nyckel från testprocessen.
  OPENAI_API_KEY: "",
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
});

/* ------------------------------------------------------------------ *
 * Geografi från kundprofilen (utan makeContext)
 * ------------------------------------------------------------------ */

function profileGeoState(postnummer: string) {
  const state = baseState({ ...COMPLETE_ANSWERS, postnummer, ager_fastigheten: "Ja" });
  state["customer_profiles"] = [
    {
      customer_id: CUSTOMER_ID,
      ai_assistant_enabled: true,
      execution_mode: "test",
      local_postal_prefix: "50",
      regional_postal_prefix: "51",
    },
  ];
  return state;
}

async function geographyFor(postnummer: string) {
  const res = await handleGrowthApi(
    "route-lead",
    withEnv(signedRequest("route-lead", { leadId: LEAD_ID })),
    depsNoSecret(profileGeoState(postnummer)),
  );
  return ((await res.json()) as any).normalized.qualification.geography;
}

describe("postnummerstyrd geografi från kundprofilen", () => {
  it("50-prefix ger local och configured=true", async () => {
    expect(await geographyFor("503 30")).toMatchObject({ verdict: "local", configured: true });
  });

  it("51-prefix ger regional", async () => {
    expect(await geographyFor("51234")).toMatchObject({ verdict: "regional", configured: true });
  });

  it("Göteborgspostnummer ger outside – aldrig ortsnamnstolkning", async () => {
    expect(await geographyFor("41118")).toMatchObject({ verdict: "outside", configured: true });
  });

  it("saknat postnummer ger unknown", async () => {
    expect(await geographyFor("")).toMatchObject({ verdict: "unknown", configured: true });
  });
});

describe("makeContext-kontraktet (kundutkast och cache)", () => {


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

  it("hittar inte på frågor när underlaget är komplett, men håller leadet varmt", async () => {
    const { body } = await planNurture(nurtureState(COMPLETE_ANSWERS));
    expect(body.questions).toEqual([]);
    expect(body.eligible).toBe(true);
    expect(body.preview).not.toBeNull();
    expect(body.preview.subject).toBe("Uppföljning på din förfrågan");
    expect(body.preview.body).not.toContain("?");
    expect(body.notificationSent).toBe(false);
    expect(body.externalEffect).toBe(false);
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

/**
 * TEST/REVIEW-bryggan för inkommande svar (register-nurture-reply-test).
 * Ingen extern effekt får uppstå: inga mail, notiser eller bokningar.
 */
async function replyNurture(state: Record<string, Row[]>, body: unknown) {
  const res = await handleGrowthApi(
    "register-nurture-reply-test",
    withEnv(signedRequest("register-nurture-reply-test", body)),
    deps(state),
  );
  return { res, body: (await res.json()) as any };
}

describe("register-nurture-reply-test", () => {
  it("kräver giltig signatur och avvisar replay", async () => {
    const bad = await handleGrowthApi(
      "register-nurture-reply-test",
      signedRequest(
        "register-nurture-reply-test",
        { leadId: LEAD_ID, body: "Tack för mailet!" },
        { secret: "fel" },
      ),
      deps(nurtureState(INCOMPLETE_ANSWERS)),
    );
    expect(bad.status).toBe(401);

    const state = nurtureState(INCOMPLETE_ANSWERS);
    const eventId = "reply-dup";
    const first = await handleGrowthApi(
      "register-nurture-reply-test",
      withEnv(signedRequest("register-nurture-reply-test", { leadId: LEAD_ID, body: "Hej" }, { eventId })),
      deps(state),
    );
    expect(first.status).toBe(200);
    const second = await handleGrowthApi(
      "register-nurture-reply-test",
      withEnv(signedRequest("register-nurture-reply-test", { leadId: LEAD_ID, body: "Hej" }, { eventId })),
      deps(state),
    );
    expect(second.status).toBe(409);
  });

  it("avvisar ogiltig nyttolast och okända fält", async () => {
    const empty = await replyNurture(nurtureState(INCOMPLETE_ANSWERS), { leadId: LEAD_ID, body: "" });
    expect(empty.res.status).toBe(400);

    const injected = await replyNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      body: "Intresserad",
      route: "ai_full",
      score: 100,
    });
    expect(injected.res.status).toBe(400);
  });

  it("avvisar makeContext som pekar på fel kund", async () => {
    const { res } = await replyNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      body: "Berätta gärna mer",
      makeContext: { ...MAKE_CONTEXT, customerId: "33333333-3333-4333-8333-333333333333" },
    });
    expect(res.status).toBe(403);
  });

  it("nej tack stoppar uppföljningen utan extern effekt", async () => {
    const { body } = await replyNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      body: "Nej tack, vi är inte intresserade.",
      makeContext: MAKE_CONTEXT,
    });
    expect(body.ok).toBe(true);
    expect(body.classification.intent).toBe("avbojer");
    expect(body.effect.stop).toBe(true);
    expect(body.effect.humanTakeover).toBe(false);
    expect(body.nurtureStatus).toBe("cancelled");
    expect(body.outcome).toBeNull();
    expect(body.notificationSent).toBe(false);
    expect(body.externalEffect).toBe(false);
  });

  it("pris/offert ger mänsklig handläggning och stop", async () => {
    const { body } = await replyNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      body: "Vad kostar det? Skicka en offert.",
    });
    expect(body.classification.intent).toBe("pris_offert");
    expect(body.effect.humanTakeover).toBe(true);
    expect(body.effect.stop).toBe(true);
    expect(body.notificationSent).toBe(false);
    expect(body.externalEffect).toBe(false);
  });

  it("positiva keywords utan semantisk modellbedömning uppgraderar inte", async () => {
    const { body } = await replyNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      body: "Vi är intresserade, berätta mer.",
      makeContext: MAKE_CONTEXT,
    });
    expect(body.effect.upgradeSignal).toBe(false);
    expect(body.outcome).toBeNull();
    expect(body.newIntent.level).toBeDefined();
    expect(body.notificationSent).toBe(false);
    expect(body.externalEffect).toBe(false);
  });

  it("möteskeywords utan semantisk modellbedömning skapar inget meeting-utfall", async () => {
    const { body } = await replyNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      body: "Kan vi boka ett möte nästa vecka?",
    });
    expect(body.classification.intent).toBe("vill_boka");
    expect(body.effect.upgradeSignal).toBe(false);
    expect(body.outcome).toBeNull();
    expect(body.externalEffect).toBe(false);
  });

  it("neutralt svar ger ingen falsk uppgradering", async () => {
    const { body } = await replyNurture(nurtureState(INCOMPLETE_ANSWERS), {
      leadId: LEAD_ID,
      body: "Tack för informationen, vi återkommer.",
    });
    expect(body.effect.upgradeSignal).toBe(false);
    expect(body.effect.humanTakeover).toBe(false);
    expect(body.externalEffect).toBe(false);
  });

  it("kund som skulle vara live kan ändå inte utlösa någon extern effekt", async () => {
    const { body } = await replyNurture(nurtureState(INCOMPLETE_ANSWERS, [], "live"), {
      leadId: LEAD_ID,
      body: "Vi är intresserade.",
    });
    expect(body.notificationSent).toBe(false);
    expect(body.externalEffect).toBe(false);
  });
});

describe("customer-config (read-only)", () => {
  function configState(profiles: Row[], mailChannels: Row[] = []) {
    const state = baseState(COMPLETE_ANSWERS);
    state["customers"] = [
      {
        id: CUSTOMER_ID,
        name: "Testkund",
        industry: "varuautomater",
        service_area: "Borås",
        status: "aktiv",
        launch_approved: true,
        launch_approved_at: "2026-09-10T10:00:00.000Z",
      },
    ];
    state["customer_profiles"] = profiles;
    state["customer_mail_channels"] = mailChannels;
    return state;
  }

  const MAIL_CHANNEL: Row = {
    customer_id: CUSTOMER_ID,
    provider: "smtp",
    sender_email: "no-reply@kund.se",
    sender_name: "Kund AB",
    reply_to_email: "svar@kund.se",
    inbound_route_key: "route-abc",
    connection_alias: "kund-smtp",
    status: "verified",
    verified_at: "2026-09-01T10:00:00Z",
  };

  const PROFILE: Row = {
    customer_id: CUSTOMER_ID,
    tone: "professionell",
    language: "sv",
    lead_prefix: "BV",
    qualification_profile: { builtin: "varuautomater" },
    followup_rules: {},
    booking_rules: {},
    notify_recipients: ["info@noryva.se"],
    ai_assistant_enabled: true,
    execution_mode: "test",
    local_postal_prefix: "50",
    regional_postal_prefix: "51",
  };

  async function call(state: Record<string, Row[]>, body: unknown, opts = {}) {
    const res = await handleGrowthApi(
      "customer-config",
      signedRequest("customer-config", body, opts),
      deps(state),
    );
    return { res, body: (await res.json()) as any };
  }

  it("kräver giltig signatur", async () => {
    const { res } = await call(configState([PROFILE]), { customerId: CUSTOMER_ID }, {
      secret: "fel-hemlighet",
    });
    expect(res.status).toBe(401);
  });

  it("avvisar okänd nyttolast", async () => {
    const { res } = await call(configState([PROFILE]), { customerId: "inte-uuid" });
    expect(res.status).toBe(400);
    const extra = await call(configState([PROFILE]), { customerId: CUSTOMER_ID, secret: "x" });
    expect(extra.res.status).toBe(400);
  });

  it("returnerar kundens konfiguration utan hemligheter", async () => {
    const { res, body } = await call(configState([PROFILE]), { customerId: CUSTOMER_ID });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      customerId: CUSTOMER_ID,
      name: "Testkund",
      industry: "varuautomater",
      serviceArea: "Borås",
      notifyRecipients: ["info@noryva.se"],
      executionMode: "test",
      aiAssistantEnabled: true,
      localPostalPrefix: "50",
      regionalPostalPrefix: "51",
      tone: "professionell",
      language: "sv",
      profileExists: true,
      externalEffect: false,
      launchApproved: true,
      launchApprovedAt: "2026-09-10T10:00:00.000Z",
    });
    expect(body.followupRules.maxFollowups).toBeTypeOf("number");
    expect(body.bookingRules).toHaveProperty("enabled");
    // inboundRouteKey är en opak router-identifierare, inte en credential.
    expect(JSON.stringify(body)).not.toMatch(/secret|webhook|password|token|api[_-]?key/i);
  });

  it("saknad profil och saknad launch-markör ger defaults utan gissade mottagare", async () => {
    const state = configState([]);
    const customerRow: Row = state["customers"][0] ?? {};
    customerRow["launch_approved"] = false;
    customerRow["launch_approved_at"] = null;
    const { res, body } = await call(state, { customerId: CUSTOMER_ID });
    expect(res.status).toBe(200);
    expect(body.profileExists).toBe(false);
    expect(body.notifyRecipients).toEqual([]);
    expect(body.aiAssistantEnabled).toBe(false);
    expect(body.executionMode).toBe("test");
    expect(body.localPostalPrefix).toBe("");
    // Saknat/av-stängt godkännande exponeras alltid som false/null, aldrig gissat.
    expect(body.launchApproved).toBe(false);
    expect(body.launchApprovedAt).toBeNull();
  });

  it("okänd kund ger 404", async () => {
    const state = configState([PROFILE]);
    state["customers"] = [];
    const { res, body } = await call(state, { customerId: CUSTOMER_ID });
    expect(res.status).toBe(404);
    expect(body.error).toMatch(/hittades inte/i);
  });

  it("skriver inget till kundtabellerna", async () => {
    await call(configState([PROFILE], [MAIL_CHANNEL]), { customerId: CUSTOMER_ID });
    expect(fake.inserted["customers"]).toBeUndefined();
    expect(fake.inserted["customer_profiles"]).toBeUndefined();
    expect(fake.inserted["customer_mail_channels"]).toBeUndefined();
  });

  it("verifierad mailidentitet returneras som säker metadata", async () => {
    const { body } = await call(configState([PROFILE], [MAIL_CHANNEL]), {
      customerId: CUSTOMER_ID,
    });
    expect(body.mailChannel).toEqual({
      configured: true,
      verified: true,
      provider: "smtp",
      senderEmail: "no-reply@kund.se",
      senderName: "Kund AB",
      replyToEmail: "svar@kund.se",
      inboundRouteKey: "route-abc",
      connectionAlias: "kund-smtp",
      status: "verified",
      verifiedAt: "2026-09-01T10:00:00Z",
    });
    // Avsändaridentitet är separat från notify-mottagare.
    expect(body.notifyRecipients).toEqual(["info@noryva.se"]);
  });

  it("saknad mailidentitet är fail closed utan fallback till Noryva", async () => {
    const { body } = await call(configState([PROFILE], []), { customerId: CUSTOMER_ID });
    expect(body.mailChannel.configured).toBe(false);
    expect(body.mailChannel.verified).toBe(false);
    expect(body.mailChannel.senderEmail).toBe("");
    expect(body.mailChannel.replyToEmail).toBe("");
    expect(JSON.stringify(body.mailChannel)).not.toMatch(/noryva/i);
  });

  it("ej verifierad mailidentitet ger verified=false", async () => {
    const { body } = await call(
      configState([PROFILE], [{ ...MAIL_CHANNEL, status: "draft", verified_at: null }]),
      { customerId: CUSTOMER_ID },
    );
    expect(body.mailChannel.configured).toBe(true);
    expect(body.mailChannel.verified).toBe(false);
    expect(body.mailChannel.status).toBe("draft");
  });

  it("credential-liknande kolumner läcker aldrig ut", async () => {
    const { body } = await call(
      configState([PROFILE], [{ ...MAIL_CHANNEL, smtp_password: "hemligt", api_key: "nyckel" }]),
      { customerId: CUSTOMER_ID },
    );
    expect(JSON.stringify(body)).not.toMatch(/hemligt|nyckel|password|api_key/i);
  });
});

describe("due-lead-reminders (read-only)", () => {
  const OLD = "2026-09-01T08:00:00.000Z";
  // Relativ tid: ett färskt lead ska aldrig bli "gammalt" när kalendern går vidare.
  const NEW = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const NOW = new Date("2026-09-10T00:00:00.000Z");

  function reminderState(leads: Row[], profiles: Row[] = []) {
    return {
      leads,
      customers: [{ id: CUSTOMER_ID, name: "Testkund", industry: "varuautomater" }],
      customer_profiles: profiles,
      growth_lead_state: [] as Row[],
      inbound_webhook_events: [] as Row[],
    } as Record<string, Row[]>;
  }

  const OLD_NEW_LEAD: Row = {
    id: LEAD_ID,
    customer_id: CUSTOMER_ID,
    created_at: OLD,
    customer_status: "Ny",
    contacted_at: null,
  };

  async function call(state: Record<string, Row[]>, body: unknown = {}) {
    const res = await handleGrowthApi(
      "due-lead-reminders",
      signedRequest("due-lead-reminders", body, {
        timestamp: String(Math.floor(NOW.getTime() / 1000)),
      }),
      deps(state, NOW),
    );
    return { res, body: (await res.json()) as any };
  }

  it("kräver giltig signatur", async () => {
    const res = await handleGrowthApi(
      "due-lead-reminders",
      signedRequest("due-lead-reminders", {}, { secret: "fel" }),
      deps(reminderState([OLD_NEW_LEAD])),
    );
    expect(res.status).toBe(401);
  });

  it("avvisar ogiltiga eller okända fält", async () => {
    expect((await call(reminderState([]), { olderThanHours: 0 })).res.status).toBe(400);
    expect((await call(reminderState([]), { limit: 500 })).res.status).toBe(400);
    expect((await call(reminderState([]), { customerId: CUSTOMER_ID })).res.status).toBe(400);
  });

  it("returnerar leads äldre än cutoff med kundens sparade mottagare", async () => {
    const state = reminderState(
      [OLD_NEW_LEAD],
      [{ customer_id: CUSTOMER_ID, notify_recipients: ["info@noryva.se"] }],
    );
    state["growth_lead_state"] = [{ lead_id: LEAD_ID, intent_level: "HÖG" }];
    const { res, body } = await call(state);
    expect(res.status).toBe(200);
    expect(body.olderThanHours).toBe(24);
    expect(body.count).toBe(1);
    expect(body.externalEffect).toBe(false);
    expect(body.notificationSent).toBe(false);
    const item = body.reminders[0];
    expect(item).toMatchObject({
      leadId: LEAD_ID,
      customerId: CUSTOMER_ID,
      customerName: "Testkund",
      createdAt: OLD,
      customerStatus: "Ny",
      contactedAt: null,
      intentLevel: "HÖG",
      prioritySource: "growth_lead_state",
      reminderRecommended: true,
      notifyRecipients: ["info@noryva.se"],
      recipientsMissing: false,
    });
    expect(typeof item.reason).toBe("string");
    // Länken finns bara när action-hemligheten är konfigurerad server-side.
    expect(item.contactUrl === null || String(item.contactUrl).startsWith("https://")).toBe(true);
  });

  it("exkluderar leads som redan är Kontaktad och för nya leads", async () => {
    const { body } = await call(
      reminderState([
        { ...OLD_NEW_LEAD, id: "lead-kontaktad", customer_status: "Kontaktad", contacted_at: OLD },
        { ...OLD_NEW_LEAD, id: "lead-nytt", created_at: NEW },
      ]),
    );
    expect(body.count).toBe(0);
  });

  it("respekterar egen cutoff och limit", async () => {
    const state = reminderState([
      OLD_NEW_LEAD,
      { ...OLD_NEW_LEAD, id: "lead-2" },
      { ...OLD_NEW_LEAD, id: "lead-3" },
    ]);
    const { body } = await call(state, { olderThanHours: 1, limit: 2 });
    expect(body.olderThanHours).toBe(1);
    expect(body.count).toBe(2);
  });

  it("gissar aldrig mottagare när profilen saknas", async () => {
    const { body } = await call(reminderState([OLD_NEW_LEAD]));
    const item = body.reminders[0];
    expect(item.notifyRecipients).toEqual([]);
    expect(item.recipientsMissing).toBe(true);
    expect(item.reason).toMatch(/saknar sparade mottagare/i);
    expect(item.prioritySource).toBe("unknown");
    expect(item.reminderRecommended).toBeNull();
  });

  it("ändrar aldrig lead-status och skriver inget", async () => {
    const state = reminderState([OLD_NEW_LEAD]);
    await call(state);
    expect(state["leads"]![0]!["customer_status"]).toBe("Ny");
    expect(state["leads"]![0]!["contacted_at"]).toBeNull();
    expect(fake.inserted["leads"]).toBeUndefined();
    expect(fake.inserted["customer_profiles"]).toBeUndefined();
  });
});

describe("delivery-recovery (dry-run som standard)", () => {
  function recoveryState() {
    const state = baseState(COMPLETE_ANSWERS);
    state["leads"] = [
      {
        id: LEAD_ID,
        customer_id: CUSTOMER_ID,
        industry: "tak",
        payload: { answers: COMPLETE_ANSWERS },
        idempotency_key: `${CUSTOMER_ID}:sub`,
        delivery_status: "failed",
        delivery_attempts: 1,
        created_at: "2026-09-01T08:00:00.000Z",
        last_attempt_at: "2026-09-01T08:00:00.000Z",
      },
    ];
    state["inbound_webhook_events"] = [];
    return state;
  }

  it("kräver giltig signatur", async () => {
    const res = await handleGrowthApi(
      "delivery-recovery",
      signedRequest("delivery-recovery", {}, { secret: "fel" }),
      deps(recoveryState()),
    );
    expect(res.status).toBe(401);
  });

  it("returnerar kandidater utan att skriva något", async () => {
    const state = recoveryState();
    const res = await handleGrowthApi(
      "delivery-recovery",
      signedRequest("delivery-recovery", {}),
      deps(state),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.dryRun).toBe(true);
    expect(body.executed).toBe(false);
    expect(body.count).toBe(1);
    expect(state["leads"]![0]!["delivery_status"]).toBe("failed");
    expect(fake.rpcCalls.filter(([n]) => n === "claim_lead_delivery")).toHaveLength(0);
  });

  it("blockerar execute när runtime-flaggan saknas", async () => {
    const res = await handleGrowthApi(
      "delivery-recovery",
      signedRequest("delivery-recovery", { execute: true }),
      deps(recoveryState()),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.blocked).toBe(true);
  });
});

describe("review-reconciliation", () => {
  function reviewState() {
    const staleClaimed = new Date(Date.now() - 60 * 60_000).toISOString();
    const freshClaimed = new Date(Date.now() - 5 * 60_000).toISOString();
    const oldApproved = new Date(Date.now() - 25 * 3600_000).toISOString();
    return {
      nurture_reviews: [
        { id: "rv-stale", lead_id: LEAD_ID, customer_id: CUSTOMER_ID, status: "claimed", approved_at: oldApproved, claimed_at: staleClaimed, sent_at: null, attempt_id: "a1", transport_message_id: null, recipient_email: "hemlig@example.se", subject: "Hemligt", body: "Hemlig brödtext" },
        { id: "rv-fresh", lead_id: LEAD_ID, customer_id: CUSTOMER_ID, status: "claimed", approved_at: oldApproved, claimed_at: freshClaimed, sent_at: null, attempt_id: "a2", transport_message_id: null, recipient_email: "x@example.se", subject: "S", body: "B" },
        { id: "rv-unknown", lead_id: LEAD_ID, customer_id: CUSTOMER_ID, status: "unknown", approved_at: oldApproved, claimed_at: staleClaimed, sent_at: null, attempt_id: "a3", transport_message_id: null, recipient_email: "y@example.se", subject: "S", body: "B" },
        { id: "rv-failed", lead_id: LEAD_ID, customer_id: CUSTOMER_ID, status: "failed", approved_at: oldApproved, claimed_at: staleClaimed, sent_at: null, attempt_id: "a4", transport_message_id: null, recipient_email: "z@example.se", subject: "S", body: "B" },
        { id: "rv-approved-old", lead_id: LEAD_ID, customer_id: CUSTOMER_ID, status: "approved", approved_at: oldApproved, claimed_at: null, sent_at: null, attempt_id: null, transport_message_id: null, recipient_email: "w@example.se", subject: "S", body: "B" },
        { id: "rv-sent", lead_id: LEAD_ID, customer_id: CUSTOMER_ID, status: "sent", approved_at: oldApproved, claimed_at: staleClaimed, sent_at: staleClaimed, attempt_id: "a5", transport_message_id: "tm1", recipient_email: "v@example.se", subject: "S", body: "B" },
      ] as Row[],
    };
  }

  it("kräver giltig HMAC-signatur", async () => {
    const res = await handleGrowthApi(
      "review-reconciliation",
      signedRequest("review-reconciliation", {}, { secret: "fel-hemlighet" }),
      deps(reviewState()),
    );
    expect(res.status).toBe(401);
  });

  it("avvisar extra fält i schemat", async () => {
    const res = await handleGrowthApi(
      "review-reconciliation",
      signedRequest("review-reconciliation", { execute: true }),
      deps(reviewState()),
    );
    expect(res.status).toBe(400);
  });

  it("returnerar endast korrekta fynd utan känsliga fält och utan writes", async () => {
    const state = reviewState();
    const res = await handleGrowthApi(
      "review-reconciliation",
      signedRequest("review-reconciliation", {}),
      deps(state),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.externalEffect).toBe(false);
    expect(body.notificationSent).toBe(false);
    const ids = body.findings.map((f: any) => f.reviewId).sort();
    expect(ids).toEqual(["rv-approved-old", "rv-failed", "rv-stale", "rv-unknown"]);
    const stale = body.findings.find((f: any) => f.reviewId === "rv-stale");
    expect(stale).toMatchObject({
      severity: "HIGH",
      reason: "stale_claim_without_transport",
      needsManualReview: true,
      autoRetryAllowed: false,
      attemptIdExists: true,
      transportMessageIdExists: false,
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("hemlig@example.se");
    expect(raw).not.toContain("Hemlig brödtext");
    expect(raw).not.toContain('"a1"');
    expect(raw).not.toContain("transportMessageId\":");
    // Inga mutationsanrop mot RPC gjordes.
    expect(fake.rpcCalls).toHaveLength(0);
    // Radstatus ändrades aldrig.
    expect(state.nurture_reviews!.find((r) => r["id"] === "rv-stale")!["status"]).toBe("claimed");
  });

  it("respekterar claimedOlderThanMinutes", async () => {
    const res = await handleGrowthApi(
      "review-reconciliation",
      signedRequest("review-reconciliation", { claimedOlderThanMinutes: 120 }),
      deps(reviewState()),
    );
    const body = (await res.json()) as any;
    const ids = body.findings.map((f: any) => f.reviewId);
    expect(ids).not.toContain("rv-stale");
    expect(body.claimedOlderThanMinutes).toBe(120);
  });
});
