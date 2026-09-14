import { describe, expect, it } from "vitest";
import {
  CODE_CHANGE_ALWAYS_PROPOSAL,
  classifyExecutionTask,
  executionBatchStatus,
  executionTaskKey,
  nextExecutionTask,
  normalizeExecutionPlan,
  REPO_EXECUTOR_AVAILABLE,
  SAFE_INTERNAL_CONFIG_WRITES,
  type ExecutionItem,
} from "./execution";

const item = (over: Partial<ExecutionItem>): ExecutionItem => ({
  index: 0,
  role: "product_tech",
  actionType: "internal_analysis",
  goal: "mål",
  successCriteria: "",
  dependencies: [],
  executionStatus: "queued",
  blockedReason: "",
  ...over,
});

describe("execution action policy", () => {
  it("kör intern analys och QA automatiskt", () => {
    expect(classifyExecutionTask({ actionType: "internal_analysis" })).toEqual({
      providerRun: true,
      finalStatus: "done",
      blockedReason: "",
    });
    expect(classifyExecutionTask({ actionType: "qa_verification" }).finalStatus).toBe("done");
  });

  it("stoppar alltid kundkontakt för mänskligt godkännande", () => {
    for (const actionType of ["customer_contact", "internal_analysis", "code_change"] as const) {
      const policy = classifyExecutionTask({ actionType, requiresCustomerContact: true });
      expect(policy.providerRun).toBe(false);
      expect(policy.finalStatus).toBe("awaiting_human_approval");
    }
  });

  it("markerar kodändring som READY_FOR_REPO_EXECUTOR – alltid proposal-only", () => {
    expect(REPO_EXECUTOR_AVAILABLE).toBe(false);
    expect(CODE_CHANGE_ALWAYS_PROPOSAL).toBe(true);
    expect(classifyExecutionTask({ actionType: "code_change" }).finalStatus).toBe("ready_for_repo_executor");
    expect(
      classifyExecutionTask({ actionType: "code_change", configWriteKey: "vad_som_helst" }).finalStatus,
    ).toBe("ready_for_repo_executor");
  });

  it("gör intern konfiguration till förslag utan whitelistad write-path", () => {
    expect(SAFE_INTERNAL_CONFIG_WRITES).toHaveLength(0);
    expect(classifyExecutionTask({ actionType: "internal_config" }).finalStatus).toBe("proposal_only");
    expect(classifyExecutionTask({ actionType: "internal_config", configWriteKey: "okänd" }).finalStatus).toBe(
      "proposal_only",
    );
  });

  it("fail-closar övriga externa åtgärder", () => {
    const policy = classifyExecutionTask({ actionType: "external_other" });
    expect(policy.providerRun).toBe(false);
    expect(policy.finalStatus).toBe("blocked");
  });
});

describe("execution plan", () => {
  it("normaliserar roller, actionType och beroenden", () => {
    const plan = normalizeExecutionPlan([
      { role: "Product & Tech", actionType: "kodändring", goal: "Patcha budgetgrind" },
      { role: "okänd roll", actionType: "mail till kund", goal: "Följ upp", dependencies: [0, 5] },
    ]);
    expect(plan[0]!.role).toBe("product_tech");
    expect(plan[0]!.actionType).toBe("code_change");
    expect(plan[1]!.role).toBe("noryva_manager");
    expect(plan[1]!.actionType).toBe("customer_contact");
    expect(plan[1]!.requiresCustomerContact).toBe(true);
    expect(plan[1]!.dependencies).toEqual([0]);
  });

  it("ger tom plan för trasig input", () => {
    expect(normalizeExecutionPlan(null)).toEqual([]);
    expect(normalizeExecutionPlan([{ role: "x" }])).toEqual([]);
  });

  it("ger stabila idempotensnycklar", () => {
    expect(executionTaskKey("m1", 2)).toBe("boardroom_execution:m1:2");
  });
});

describe("execution sekvens", () => {
  it("respekterar beroenden", () => {
    const items = [
      item({ index: 0, executionStatus: "done" }),
      item({ index: 1, dependencies: [0] }),
      item({ index: 2, dependencies: [1] }),
    ];
    expect(nextExecutionTask(items)?.index).toBe(1);
  });

  it("sammanfattar batchstatus", () => {
    expect(executionBatchStatus([])).toBe("not_started");
    expect(executionBatchStatus([item({})])).toBe("running");
    expect(executionBatchStatus([item({ executionStatus: "done" })])).toBe("completed");
    expect(executionBatchStatus([item({ executionStatus: "ready_for_repo_executor" })])).toBe(
      "ready_for_repo_executor",
    );
    expect(
      executionBatchStatus([
        item({ executionStatus: "ready_for_repo_executor" }),
        item({ index: 1, executionStatus: "awaiting_human_approval" }),
      ]),
    ).toBe("awaiting_human_approval");
  });
});
