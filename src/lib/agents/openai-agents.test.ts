import { describe, expect, it, vi } from "vitest";
import {
  evaluateRunBudget,
  readHarnessStatus,
  runHarnessSession,
} from "./openai-agents.server";
import { parseHarnessOutput, runV2TaskCore, createV2TaskCore } from "./v2.server";
import { buildTaskResult } from "./run.server";
import { verifyTaskResult } from "./tasks";

const configuredEnv = {
  NORYVA_AGENTS_API_ENABLED: "true",
  OPENAI_API_KEY: "sk-test",
};

describe("harness-konfiguration", () => {
  it("är fail closed utan flagga", () => {
    const status = readHarnessStatus({ env: { OPENAI_API_KEY: "sk-test" } });
    expect(status.configured).toBe(false);
    expect(status.reason).toContain("NORYVA_AGENTS_API_ENABLED");
  });

  it("är fail closed utan nyckel", () => {
    const status = readHarnessStatus({ env: { NORYVA_AGENTS_API_ENABLED: "true" } });
    expect(status.configured).toBe(false);
  });

  it("läcker aldrig nyckelvärden", () => {
    const status = readHarnessStatus({ env: configuredEnv });
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("sk-test");
  });

  it("gör inget nätverksanrop när konfiguration saknas", async () => {
    const fetchImpl = vi.fn();
    const run = await runHarnessSession(
      { role: "noryva_manager", instructions: "i", input: "x" },
      { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run.ok).toBe(false);
    expect(run.runStatus).toBe("blocked");
    expect(run.externalEffect).toBe(false);
  });
});

describe("budgetspärr", () => {
  it("stoppar när budgeten är förbrukad", () => {
    expect(evaluateRunBudget({ runBudget: 1, runsUsed: 1 }).allowed).toBe(false);
    expect(evaluateRunBudget({ runBudget: 0, runsUsed: 0 }).allowed).toBe(false);
    expect(evaluateRunBudget({ runBudget: 1, runsUsed: 0 }).allowed).toBe(true);
  });
});

describe("tolkning av harness-svar", () => {
  it("kräver rätt format", () => {
    expect(parseHarnessOutput("noryva_manager", "hej").ok).toBe(false);
    expect(parseHarnessOutput("noryva_manager", '{"summary":"kort"}').ok).toBe(false);
  });

  it("godtar giltigt managersvar", () => {
    const parsed = parseHarnessOutput(
      "noryva_manager",
      '{"summary":"Läget är stabilt just nu.","priorities":["Följ upp leveransfel"]}',
    );
    expect(parsed.ok).toBe(true);
  });
});

/* -------------------------------------------------------- fake supabase */

function fakeSupabase(task: Record<string, unknown> | null) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const builder = (table: string): any => ({
    select: () => builder(table),
    eq: () => builder(table),
    limit: () => Promise.resolve({ data: [] }),
    maybeSingle: () => Promise.resolve({ data: task, error: null }),
    single: () => Promise.resolve({ data: { id: "new-task" }, error: null }),
    insert: (row: Record<string, unknown>) => {
      inserted.push({ table, ...row });
      return builder(table);
    },
    update: (row: Record<string, unknown>) => {
      updates.push({ table, ...row });
      return builder(table);
    },
  });
  return { supabase: { from: (t: string) => builder(t) }, inserted, updates };
}

const queuedTask = {
  id: "11111111-1111-4111-8111-111111111111",
  assigned_agent: "noryva_manager",
  task_type: "manager_directive",
  status: "queued",
  instructions: "instruktion",
  requires_approval: true,
  approval_status: "pending",
  execution_mode: "test",
  provider_type: "openai_agents",
  run_status: "not_started",
  run_budget: 1,
  runs_used: 0,
};

describe("körning av v1-roller", () => {
  it("blockerar körning när harnessen inte är konfigurerad", async () => {
    const db = fakeSupabase(queuedTask);
    const fetchImpl = vi.fn();
    const out = await runV2TaskCore({
      supabase: db.supabase,
      harness: { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch },
    }, { taskId: queuedTask.id });
    expect(out.status).toBe(409);
    expect(out.body["configured"]).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.updates.some((u) => u["run_status"] === "blocked")).toBe(true);
  });

  it("blockerar körning när budgeten är slut", async () => {
    const db = fakeSupabase({ ...queuedTask, runs_used: 1 });
    const out = await runV2TaskCore(
      { supabase: db.supabase, harness: { env: configuredEnv } },
      { taskId: queuedTask.id },
    );
    expect(out.status).toBe(409);
    expect(out.body["runStatus"]).toBe("blocked");
  });

  it("avvisar roller som inte är aktiva i v1", async () => {
    const db = fakeSupabase({ ...queuedTask, assigned_agent: "sales" });
    const out = await runV2TaskCore(
      { supabase: db.supabase, harness: { env: configuredEnv } },
      { taskId: queuedTask.id },
    );
    expect(out.status).toBe(403);
  });

  it("är idempotent: skapad uppgift återanvänds", async () => {
    const db = fakeSupabase({ id: "existing" });
    const out = await createV2TaskCore(
      { supabase: db.supabase },
      { role: "product_tech", executionMode: "test" },
    );
    expect(out.body["duplicate"]).toBe(true);
    expect(out.body["taskId"]).toBe("existing");
    expect(out.body["externalEffect"]).toBe(false);
  });
});

describe("legacy-lagret", () => {
  it("kör aldrig v1-rollernas uppgifter", async () => {
    await expect(
      buildTaskResult({ supabase: fakeSupabase(null).supabase }, queuedTask),
    ).rejects.toThrow(/harness/i);
  });
});

describe("verifiering av v1-resultat", () => {
  it("kräver godkännande och nollad extern effekt", () => {
    const verdict = verifyTaskResult({
      taskType: "manager_directive",
      requiresApproval: false,
      result: { summary: "En sammanfattning här.", priorities: ["A"], externalEffect: true },
    });
    expect(verdict.status).toBe("failed");
    expect(verdict.reasons.join(" ")).toContain("extern effekt");
  });

  it("godkänner ett komplett produkt- och teknikresultat", () => {
    const verdict = verifyTaskResult({
      taskType: "product_tech_review",
      requiresApproval: true,
      result: {
        summary: "Systemet är stabilt men har kösvans.",
        recommendations: ["Lägg till avstämningsvy"],
        implementationPrompt: "Bygg en avstämningsvy för uppgifter som fastnat i pågående status.",
        externalEffect: false,
      },
    });
    expect(verdict.status).toBe("passed");
  });
});
