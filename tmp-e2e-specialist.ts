import { createClient } from "@supabase/supabase-js";
import { createV2TaskCore, runV2TaskCore } from "./src/lib/agents/v2.server";

const supabase = createClient(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const ctx = { supabase, harness: { env: process.env as Record<string, string | undefined> } };

const created = await createV2TaskCore(ctx, {
  role: "qa_risk",
  executionMode: "review",
  goal: "Granska aggregerad drifttelemetri och lista de viktigaste riskerna.",
  occurrence: `e2e-specialist:${Date.now()}`,
});
console.log("SPECIALIST TASK", created.status, created.body);
const run = await runV2TaskCore(ctx, { taskId: String(created.body["taskId"]), runKind: "manual" });
console.log("SPECIALIST RUN", run.status, JSON.stringify(run.body, null, 2));

const { data: ledger } = await supabase
  .from("agent_run_ledger")
  .select("role, run_kind, status, model, input_tokens, output_tokens, estimated_cost_sek")
  .order("created_at", { ascending: false })
  .limit(3);
console.log("LEDGER", ledger);
const { data: snap } = await supabase.rpc("agent_budget_snapshot");
console.log("SNAPSHOT", snap);
