import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  routeEvent,
  runSalesWorker,
  verifyTaskResult,
} from "./tasks";
import { defaultProfile } from "@/lib/ai-sales/profile";

const profile = defaultProfile("11111111-1111-1111-1111-111111111111", "varuautomater");

describe("orchestrator-routing", () => {
  it("skickar nytt lead till Sales med godkännandekrav", () => {
    const spec = routeEvent({ type: "new_lead", leadId: "lead-1", customerId: "c1", leadPriority: "HÖG" });
    expect(spec.assignedAgent).toBe("sales");
    expect(spec.taskType).toBe("sales_draft");
    expect(spec.priority).toBe("high");
    expect(spec.requiresApproval).toBe(true);
  });

  it("skickar leveransfel till Systems & QA", () => {
    const spec = routeEvent({ type: "delivery_error", leadId: "lead-1", customerId: "c1" });
    expect(spec.assignedAgent).toBe("systems_qa");
    expect(spec.requiresApproval).toBe(false);
  });

  it("ger samma idempotensnyckel för samma event", () => {
    const a = routeEvent({ type: "new_lead", leadId: "lead-1", customerId: "c1" });
    const b = routeEvent({ type: "new_lead", leadId: "lead-1", customerId: "c1" });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });
});

describe("statusmaskin", () => {
  it("tillåter kö → pågår men inte kö → klar", () => {
    expect(canTransition("queued", "in_progress")).toBe(true);
    expect(canTransition("queued", "done")).toBe(false);
    expect(() => assertTransition("done", "in_progress")).toThrow();
  });
});

describe("Sales-worker", () => {
  it("är deterministisk och skickar ingenting", () => {
    const out = runSalesWorker({
      taskType: "sales_draft",
      industry: "varuautomater",
      values: { antal_personer: "120" },
      profile,
      companyName: "Testbolaget",
    });
    expect(out.generatedBy).toBe("deterministic");
    expect(out.draft.body.startsWith("Hej!")).toBe(true);
    expect(out.draft.body).toContain("Testbolaget");
  });
});

describe("QA-worker", () => {
  const ok = runSalesWorker({
    taskType: "sales_draft",
    industry: "varuautomater",
    values: {},
    profile,
    companyName: "Testbolaget",
  });

  it("godkänner ett rent utkast", () => {
    const v = verifyTaskResult({ taskType: "sales_draft", requiresApproval: true, result: { ...ok } });
    expect(v.status).toBe("passed");
  });

  it("underkänner utkast med e-postadress och prisprat", () => {
    const v = verifyTaskResult({
      taskType: "sales_draft",
      requiresApproval: true,
      result: { draft: { subject: "Hej", body: "Hej! Vårt pris är bra, maila info@noryva.se." } },
    });
    expect(v.status).toBe("failed");
    expect(v.reasons.length).toBeGreaterThan(1);
  });

  it("underkänner tomt resultat", () => {
    expect(verifyTaskResult({ taskType: "delivery_check", requiresApproval: false, result: null }).status).toBe(
      "failed",
    );
  });
});
