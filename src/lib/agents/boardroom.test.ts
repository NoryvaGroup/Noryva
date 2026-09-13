import { describe, expect, it } from "vitest";
import { MAX_ROUNDS, hasLikelyPii, planNextTurn, validateMeetingInput, type MeetingLike, type MeetingMessage } from "./boardroom";

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
  });

  it("stoppar över fyra specialister och PII", () => {
    expect(() => validateMeetingInput({ agenda: "Säker intern strategi utan persondata", maxSpecialists: 5 })).toThrow();
    expect(hasLikelyPii("Kontakta anna@example.se")).toBe(true);
  });

  it("är idempotent när stegets meddelande redan finns", () => {
    expect(planNextTurn(meeting({ status: "draft" }), [msg("noryva_manager", "kickoff", 1)])).toBeNull();
  });
});