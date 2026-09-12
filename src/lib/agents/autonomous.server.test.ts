/**
 * Tester för Agent HQ:s autonoma läge. Ingen riktig databas och ingen riktig
 * nätverkstrafik: harnessen är alltid fail closed i testerna.
 */
import { describe, expect, it } from "vitest";
import { autonomousTickCore } from "./autonomous.server";

type Row = Record<string, any>;

function makeSupabase(
  state: Record<string, Row[]>,
  rpc: Record<string, (args: any) => any>,
) {
  let seq = 0;
  return {
    rpc: async (name: string, args: any) => ({ data: rpc[name]?.(args) ?? null, error: null }),
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = () => (state[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => {
          filters.push((r) => r[c] === v);
          return builder;
        },
        in: (c: string, v: any[]) => {
          filters.push((r) => v.includes(r[c]));
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

const snapshotRpc = (over: Record<string, unknown> = {}) => ({
  agent_budget_snapshot: () => ({
    ok: true,
    spentMonthSek: 0,
    spentTodaySek: 0,
    autonomousRunsToday: 0,
    autonomousRunsTodayByRole: {},
    autonomousRunsMonth: 0,
    ...over,
  }),
  reserve_agent_run: () => ({ ok: true, code: "reserved", state: "ok", runId: "run-1" }),
});

/** Ingen API-nyckel och ingen flagga: harnessen får aldrig göra nätverksanrop. */
const failClosedEnv = { OPENAI_API_KEY: "", NORYVA_AGENTS_API_ENABLED: "false" };

describe("autonomt läge", () => {
  it("no-op vid mjukt tak, utan felloop", async () => {
    const supabase = makeSupabase(
      { agent_tasks: [] },
      snapshotRpc({ spentMonthSek: 310 }),
    );
    const out = await autonomousTickCore({ supabase, harness: { env: failClosedEnv } });
    expect(out.status).toBe(200);
    expect(out.body["action"]).toBe("noop");
    expect(out.body["budgetState"]).toBe("soft_paused");
    expect(out.body["externalEffect"]).toBe(false);
    expect((supabase as any).from("agent_tasks").then).toBeTypeOf("function");
  });

  it("no-op vid hårt tak", async () => {
    const supabase = makeSupabase({ agent_tasks: [] }, snapshotRpc({ spentMonthSek: 501 }));
    const out = await autonomousTickCore({ supabase, harness: { env: failClosedEnv } });
    expect(out.body["action"]).toBe("noop");
    expect(out.body["budgetState"]).toBe("hard_blocked");
  });

  it("no-op när dygnstaket för autonoma körningar är nått", async () => {
    const supabase = makeSupabase({ agent_tasks: [] }, snapshotRpc({ autonomousRunsToday: 2 }));
    const out = await autonomousTickCore({ supabase, harness: { env: failClosedEnv } });
    expect(out.body["action"]).toBe("noop");
    expect(out.body["budgetState"]).toBe("run_capped");
  });

  it("skapar Manager-kickoff och kör den, utan extern effekt", async () => {
    const state: Record<string, Row[]> = { agent_tasks: [], agent_task_events: [] };
    const supabase = makeSupabase(state, snapshotRpc());
    const out = await autonomousTickCore({ supabase, harness: { env: failClosedEnv } });

    expect(out.body["action"]).toBe("manager_kickoff");
    expect(out.body["externalEffect"]).toBe(false);
    expect(out.body["delegatedStarted"]).toBe(false);
    const created = state["agent_tasks"] ?? [];
    expect(created).toHaveLength(1);
    expect(created[0]?.["assigned_agent"]).toBe("noryva_manager");
    // Fail closed: utan giltig harness-konfiguration blockeras körningen.
    expect(created[0]?.["run_status"]).toBe("blocked");
  });

  it("kör en redan delegerad specialistuppgift i ett separat tick", async () => {
    const state: Record<string, Row[]> = {
      agent_tasks: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          assigned_agent: "growth_sales",
          task_type: "growth_sales_review",
          status: "queued",
          execution_mode: "review",
          provider_type: "openai_agents",
          source_event: "growth_sales_goal",
          run_budget: 1,
          runs_used: 0,
          instructions: "test",
        },
      ],
      agent_task_events: [],
    };
    const supabase = makeSupabase(state, snapshotRpc());
    const out = await autonomousTickCore({ supabase, harness: { env: failClosedEnv } });

    expect(out.body["action"]).toBe("specialist_run");
    expect(out.body["role"]).toBe("growth_sales");
    // En specialist får aldrig kedja vidare till ytterligare agent-run.
    expect(out.body["chained"]).toBe(false);
    expect(out.body["externalEffect"]).toBe(false);
    // Ingen ny uppgift skapades av specialistkörningen.
    expect(state["agent_tasks"]).toHaveLength(1);
  });
});
