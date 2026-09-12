import { createClient } from "@supabase/supabase-js";
import { createV2TaskCore, runV2TaskCore } from "./src/lib/agents/v2.server";

const supabase = createClient(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const ctx = { supabase, harness: { env: process.env as Record<string, string | undefined> } };

const occurrence = `e2e:${Date.now()}`;
const created = await createV2TaskCore(ctx, {
  role: "noryva_manager",
  executionMode: "review",
  goal:
    "Utvärdera aggregerad drifttelemetri och delegera exakt EN uppgift till den specialist som bäst kan minska teknisk risk och driftfel.",
  occurrence,
});
console.log("MANAGER TASK", created.status, created.body);
const taskId = String(created.body["taskId"]);

const managerRun = await runV2TaskCore(ctx, { taskId, runKind: "manual" });
console.log("MANAGER RUN", managerRun.status, JSON.stringify(managerRun.body, null, 2));

const delegated = String(managerRun.body["delegatedTaskId"] ?? "");
if (!delegated) {
  console.log("INGEN DELEGERING");
  process.exit(0);
}

const { data: before } = await supabase
  .from("agent_tasks")
  .select("id, assigned_agent, status, run_status, runs_used")
  .eq("id", delegated)
  .maybeSingle();
console.log("SPECIALIST FÖRE SEPARAT KÖRNING", before);

const specialistRun = await runV2TaskCore(ctx, { taskId: delegated, runKind: "manual" });
console.log("SPECIALIST RUN", specialistRun.status, JSON.stringify(specialistRun.body, null, 2));

const { data: ledger } = await supabase
  .from("agent_run_ledger")
  .select("id, role, run_kind, status, model, input_tokens, output_tokens, estimated_cost_sek")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("LEDGER", ledger);
