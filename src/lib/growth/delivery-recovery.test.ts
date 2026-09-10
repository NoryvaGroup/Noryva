/**
 * Tester för delivery recovery. Ingen riktig databas och inga riktiga
 * nätverksanrop – Supabase och fetch är stubbar.
 */
import { describe, expect, it } from "vitest";
import { deliveryRecoveryCore, evaluateCandidate, MAX_ATTEMPTS } from "./delivery-recovery.server";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;

function iso(minutesAgo: number) {
  return new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
}

function lead(over: Row = {}): Row {
  return {
    id: over["id"] ?? "lead-1",
    customer_id: CUSTOMER_ID,
    industry: "varuautomater",
    payload: { answers: { foretagsnamn: "Test AB" } },
    idempotency_key: `${CUSTOMER_ID}:sub-1`,
    delivery_status: "failed",
    delivery_attempts: 1,
    created_at: iso(600),
    last_attempt_at: iso(600),
    ...over,
  };
}

function makeSupabase(state: Record<string, Row[]>) {
  const writes: Array<{ table: string; patch: Row }> = [];
  const rpcCalls: Array<[string, any]> = [];
  let claimResult = "claimed";
  const supabase: any = {
    from(table: string) {
      const eqs: Array<[string, any]> = [];
      let inFilter: [string, any[]] | null = null;
      const rows = () =>
        (state[table] ?? []).filter(
          (r) =>
            eqs.every(([c, v]) => r[c] === v) && (!inFilter || inFilter[1].includes(r[inFilter[0]])),
        );
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => {
          eqs.push([c, v]);
          return builder;
        },
        in: (c: string, v: any[]) => {
          inFilter = [c, v];
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        update: (patch: Row) => {
          const res: any = {
            eq: (c: string, v: any) => {
              eqs.push([c, v]);
              return res;
            },
            then: (resolve: any) => {
              writes.push({ table, patch });
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
      return { data: claimResult, error: null };
    },
  };
  return {
    supabase,
    writes,
    rpcCalls,
    setClaim(v: string) {
      claimResult = v;
    },
  };
}

function state(leads: Row[], customer: Row = {}) {
  return {
    leads,
    customers: [
      {
        id: CUSTOMER_ID,
        slug: "boras",
        name: "Kund",
        industry: "varuautomater",
        schema_version: 1,
        status: "published",
        recipient_email: "kund@example.com",
        delivery_webhook_url: "https://hook.example.test/abc",
        ...customer,
      },
    ],
    form_questions: [] as Row[],
  } as Record<string, Row[]>;
}

const ctxOf = (fake: ReturnType<typeof makeSupabase>) =>
  ({ supabase: fake.supabase, userId: null }) as any;

describe("evaluateCandidate", () => {
  it("väljer pending och failed men aldrig delivered", () => {
    expect(evaluateCandidate(lead({ delivery_status: "pending" }) as any, NOW)).not.toBeNull();
    expect(evaluateCandidate(lead({ delivery_status: "failed" }) as any, NOW)).not.toBeNull();
    expect(evaluateCandidate(lead({ delivery_status: "delivered" }) as any, NOW)).toBeNull();
  });

  it("tar bara med sending när det fastnat", () => {
    const fresh = evaluateCandidate(
      lead({ delivery_status: "sending", last_attempt_at: iso(2) }) as any,
      NOW,
    );
    expect(fresh).toBeNull();
    const stale = evaluateCandidate(
      lead({ delivery_status: "sending", last_attempt_at: iso(60) }) as any,
      NOW,
    );
    expect(stale?.alertReasons).toContain("stale_sending");
  });

  it("respekterar backoff", () => {
    const tooSoon = evaluateCandidate(
      lead({ delivery_attempts: 1, last_attempt_at: iso(2) }) as any,
      NOW,
    )!;
    expect(tooSoon.retryable).toBe(false);
    expect(tooSoon.nextRetryAt).toBeTruthy();
    const ready = evaluateCandidate(
      lead({ delivery_attempts: 1, last_attempt_at: iso(60) }) as any,
      NOW,
    )!;
    expect(ready.retryable).toBe(true);
  });

  it("larmar och stoppar vid max antal försök", () => {
    const maxed = evaluateCandidate(lead({ delivery_attempts: MAX_ATTEMPTS }) as any, NOW)!;
    expect(maxed.retryable).toBe(false);
    expect(maxed.needsAlert).toBe(true);
    expect(maxed.alertReasons).toContain("max_attempts");
  });

  it("larmar för gamla odelivererade leads", () => {
    const old = evaluateCandidate(lead({ created_at: iso(60 * 48) }) as any, NOW)!;
    expect(old.alertReasons).toContain("undelivered_too_long");
  });
});

describe("deliveryRecoveryCore – dry-run", () => {
  it("är helt read-only och gör inga nätverksanrop", async () => {
    const fake = makeSupabase(state([lead()]));
    let fetched = 0;
    const res = await deliveryRecoveryCore(
      ctxOf(fake),
      {},
      { NORYVA_DELIVERY_RETRY_ENABLED: "true" },
      NOW,
      {
        fetchImpl: (async () => {
          fetched += 1;
          return new Response("ok");
        }) as any,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body["dryRun"]).toBe(true);
    expect(res.body["executed"]).toBe(false);
    expect(res.body["count"]).toBe(1);
    expect(res.body["externalEffect"]).toBe(false);
    expect(fetched).toBe(0);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });
});

describe("deliveryRecoveryCore – execute", () => {
  it("blockeras när runtime-flaggan saknas", async () => {
    const fake = makeSupabase(state([lead()]));
    const res = await deliveryRecoveryCore(ctxOf(fake), { execute: true }, {}, NOW, {
      fetchImpl: (async () => new Response("ok")) as any,
    });
    expect(res.status).toBe(403);
    expect(res.body["blocked"]).toBe(true);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("levererar om via claim och markerar delivered", async () => {
    const fake = makeSupabase(state([lead()]));
    const calls: string[] = [];
    const res = await deliveryRecoveryCore(
      ctxOf(fake),
      { execute: true },
      { NORYVA_DELIVERY_RETRY_ENABLED: "true" },
      NOW,
      {
        fetchImpl: (async (url: string) => {
          calls.push(String(url));
          return new Response("ok", { status: 200 });
        }) as any,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body["delivered"]).toBe(1);
    expect(calls).toEqual(["https://hook.example.test/abc"]);
    expect(fake.rpcCalls[0]?.[0]).toBe("claim_lead_delivery");
    expect(state.length).toBeGreaterThan(0);
    expect(fake.writes.at(-1)?.patch["delivery_status"]).toBe("delivered");
  });

  it("markerar failed vid HTTP-fel utan att skapa nytt lead", async () => {
    const fake = makeSupabase(state([lead()]));
    const res = await deliveryRecoveryCore(
      ctxOf(fake),
      { execute: true },
      { NORYVA_DELIVERY_RETRY_ENABLED: "true" },
      NOW,
      { fetchImpl: (async () => new Response("nope", { status: 500 })) as any },
    );
    expect(res.body["failed"]).toBe(1);
    expect(fake.writes.at(-1)?.patch["delivery_status"]).toBe("failed");
    expect(fake.writes.at(-1)?.patch["delivery_error"]).toBe("HTTP 500");
  });

  it("hoppar över när claim inte ger claimed – ingen dubbel leverans", async () => {
    const fake = makeSupabase(state([lead()]));
    fake.setClaim("delivered");
    let fetched = 0;
    const res = await deliveryRecoveryCore(
      ctxOf(fake),
      { execute: true },
      { NORYVA_DELIVERY_RETRY_ENABLED: "true" },
      NOW,
      {
        fetchImpl: (async () => {
          fetched += 1;
          return new Response("ok");
        }) as any,
      },
    );
    expect(fetched).toBe(0);
    expect((res.body["candidates"] as any[])[0].result).toBe("skipped");
    expect(fake.writes).toHaveLength(0);
  });

  it("larmar och hoppar över opublicerad kund eller saknad webhook", async () => {
    const unpublished = makeSupabase(state([lead()], { status: "draft" }));
    const a = await deliveryRecoveryCore(
      ctxOf(unpublished),
      { execute: true },
      { NORYVA_DELIVERY_RETRY_ENABLED: "true" },
      NOW,
      { fetchImpl: (async () => new Response("ok")) as any },
    );
    expect((a.body["candidates"] as any[])[0].alertReasons).toContain("customer_not_published");

    const noHook = makeSupabase(state([lead()], { delivery_webhook_url: "" }));
    const b = await deliveryRecoveryCore(
      ctxOf(noHook),
      { execute: true },
      { NORYVA_DELIVERY_RETRY_ENABLED: "true" },
      NOW,
      { fetchImpl: (async () => new Response("ok")) as any },
    );
    expect((b.body["candidates"] as any[])[0].alertReasons).toContain("missing_webhook");
    expect(noHook.writes).toHaveLength(0);
  });

  it("försöker aldrig igen efter max antal försök", async () => {
    const fake = makeSupabase(state([lead({ delivery_attempts: MAX_ATTEMPTS })]));
    let fetched = 0;
    await deliveryRecoveryCore(
      ctxOf(fake),
      { execute: true },
      { NORYVA_DELIVERY_RETRY_ENABLED: "true" },
      NOW,
      {
        fetchImpl: (async () => {
          fetched += 1;
          return new Response("ok");
        }) as any,
      },
    );
    expect(fetched).toBe(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
