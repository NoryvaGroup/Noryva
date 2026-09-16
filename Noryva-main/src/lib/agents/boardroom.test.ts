import { describe, expect, it } from "vitest";
import { buildContextPack, MAX_CONTEXT_PACK_CHARS } from "./context-pack";
import { ACTIVE_MEETING_STATUSES, MAX_ROUNDS, MEETING_STATUSES, budgetPause, hasLikelyPii, isActiveMeetingStatus, meetingPrompt, parseMeetingOutput, planNextTurn, validateMeetingInput, type MeetingLike, type MeetingMessage } from "./boardroom";


const meeting = (patch: Partial<MeetingLike> = {}): MeetingLike => ({
  agenda: "Bedöm nästa säkra produktprioritering",
  meeting_type: "product",
  status: "draft",
  selected_roles: [],
  max_specialists: 3,
  needs_cross_review: null,
  ...patch,
});
const msg = (role: MeetingMessage["role"], message_type: MeetingMessage["message_type"], sequence: number): MeetingMessage => ({ role, message_type, sequence, round: message_type === "kickoff" ? 0 : 1, content: "Tillräckligt innehåll" });

describe("Boardroom state machine", () => {
  it("följer normalflödet med högst två rundor", () => {
    expect(MAX_ROUNDS).toBe(2);
    expect(planNextTurn(meeting(), [])?.messageType).toBe("kickoff");
    const active = meeting({ status: "round_1", selected_roles: ["product_tech", "growth_sales"], needs_cross_review: true });
    expect(planNextTurn(active, [msg("noryva_manager", "kickoff", 1)])?.role).toBe("product_tech");
    const analyses = [msg("noryva_manager", "kickoff", 1), msg("product_tech", "analysis", 2), msg("growth_sales", "analysis", 3)];
    expect(planNextTurn(meeting({ ...active, status: "cross_review" }), analyses)?.messageType).toBe("critique");
  });

  it("hoppar över cross-review när Manager inte begär den", () => {
    const m = meeting({ status: "round_1", selected_roles: ["product_tech", "growth_sales"], needs_cross_review: false });
    const messages = [msg("product_tech", "analysis", 1)];
    expect(planNextTurn(m, messages)).toMatchObject({ role: "growth_sales", nextStatus: "qa_review" });
  });

  it("kräver QA före syntes och har inget execute-state", () => {
    expect(planNextTurn(meeting({ status: "manager_synthesis", selected_roles: ["product_tech", "growth_sales"] }), [])).toBeNull();
    expect(planNextTurn(meeting({ status: "manager_synthesis", selected_roles: ["product_tech", "growth_sales"] }), [msg("qa_risk", "qa_review", 1)])?.nextStatus).toBe("awaiting_approval");
    expect(MEETING_STATUSES).not.toContain("execute");
    expect(MEETING_STATUSES).not.toContain("published");
  });

  it("tillåter upp till fem specialister men stoppar fler och PII", () => {
    expect(validateMeetingInput({ agenda: "Säker intern strategi utan persondata", maxSpecialists: 5 })).toBeTruthy();
    expect(() => validateMeetingInput({ agenda: "Säker intern strategi utan persondata", maxSpecialists: 6 })).toThrow();
    expect(hasLikelyPii("Kontakta anna@example.se")).toBe(true);
  });

  it("är idempotent när stegets meddelande redan finns", () => {
    expect(planNextTurn(meeting({ status: "draft" }), [msg("noryva_manager", "kickoff", 1)])).toBeNull();
  });

  it("pausar fail-safe när budgetspärren stoppar och behåller ett aktivt möte", () => {
    expect(budgetPause("Hårt kostnadstak")).toEqual({ status: "paused_budget", error: "Hårt kostnadstak" });
    expect(isActiveMeetingStatus("paused_budget")).toBe(true);
  });

  it("definierar exakt de statusar som omfattas av ett-aktivt-möte-spärren", () => {
    expect(ACTIVE_MEETING_STATUSES).toEqual([
      "draft", "manager_kickoff", "round_1", "cross_review", "qa_review", "manager_synthesis", "paused_budget",
    ]);
    expect(isActiveMeetingStatus("awaiting_approval")).toBe(false);
  });

  it("avvisar duplicerade specialistroller i kickoff", () => {
    expect(() => parseMeetingOutput("kickoff", JSON.stringify({
      summary: "En tillräckligt tydlig kickoff",
      selectedRoles: ["product_tech", "product_tech"],
      needsCrossReview: false,
    }))).toThrow();
  });
});
describe("Kritikrundans omfattning", () => {
  it("kör högst två reviewers även med fem specialister", () => {
    const roles = ["product_tech", "growth_sales", "customer_success", "qa_risk", "operations_finance"];
    const active = meeting({ status: "cross_review", selected_roles: roles, needs_cross_review: true });
    const base = [msg("noryva_manager", "kickoff", 1), ...roles.map((r, i) => msg(r as any, "analysis", i + 2))];
    const first = planNextTurn(active, base);
    expect(first?.messageType).toBe("critique");
    const second = planNextTurn(active, [...base, msg(first!.role as any, "critique", 10)]);
    expect(second?.messageType).toBe("critique");
    const third = planNextTurn(active, [
      ...base,
      msg(first!.role as any, "critique", 10),
      msg(second!.role as any, "critique", 11),
    ]);
    expect(third).toBeNull();
  });
});

describe("Robust JSON-tolkning och kontextpaket", () => {
  const ok = { summary: "En tillräckligt tydlig analys", findings: ["Alfa"], recommendations: ["Beta"] };

  it("tolkar JSON i code fence och med text runtom", () => {
    expect(parseMeetingOutput("analysis", "```json\n" + JSON.stringify(ok) + "\n```")).toMatchObject(ok);
    expect(parseMeetingOutput("analysis", `Här kommer svaret:\n${JSON.stringify(ok)}\nTack!`)).toMatchObject(ok);
  });

  it("reparerar avslutande kommatecken utan nytt provider-anrop", () => {
    const almost = '{"summary":"En tillräckligt tydlig analys","findings":["Alfa",],"recommendations":["Beta"],}';
    expect(parseMeetingOutput("analysis", almost)).toMatchObject(ok);
  });

  it("skiljer tomt svar, text utan JSON och schemafel åt", () => {
    expect(() => parseMeetingOutput("analysis", "")).toThrow(/tomt svar/);
    expect(() => parseMeetingOutput("analysis", "Jag hittade inget i workspace.")).toThrow(/endast text utan JSON/);
    expect(() => parseMeetingOutput("analysis", JSON.stringify({ summary: "kort" }))).toThrow(/summary/);
  });

  it("ger varje roll ett kompakt kontextpaket som säger att sandboxen är tom", () => {
    for (const role of ["noryva_manager", "product_tech", "qa_risk", "operations_finance"]) {
      const pack = buildContextPack(role);
      expect(pack).toContain("NORYVA KONTEXTPAKET");
      expect(pack).toMatch(/TOM by design/);
      expect(pack.length).toBeLessThanOrEqual(MAX_CONTEXT_PACK_CHARS);
    }
    expect(buildContextPack("product_tech")).toContain("router.ts");
  });

  it("skickar kontextpaketet med i varje mötessteg", () => {
    const prompt = meetingPrompt(
      meeting({ status: "round_1", selected_roles: ["product_tech"] }),
      { role: "product_tech", messageType: "analysis", round: 1, nextStatus: "qa_review" },
      [],
    );
    expect(prompt).toContain("NORYVA KONTEXTPAKET");
    expect(prompt).toContain("Ingen markdown");
  });
});

