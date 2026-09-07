import { describe, expect, it } from "vitest";
import { classifyReplyDeterministic } from "./reply";

describe("svarsklassificering", () => {
  it("eskalerar prisfrågor till människa", () => {
    const r = classifyReplyDeterministic("Vad kostar en sådan automat?");
    expect(r.intent).toBe("pris_offert");
    expect(r.escalate).toBe(true);
    expect(r.suggestedAction).toBe("handoff_to_human");
  });

  it("eskalerar förhandling, klagomål och juridik", () => {
    expect(classifyReplyDeterministic("Kan ni ge rabatt?").escalate).toBe(true);
    expect(classifyReplyDeterministic("Jag är mycket missnöjd").escalate).toBe(true);
    expect(classifyReplyDeterministic("Min advokat hör av sig").escalate).toBe(true);
  });

  it("föreslår bokning vid mötesförfrågan", () => {
    const r = classifyReplyDeterministic("Kan vi boka ett möte nästa vecka?");
    expect(r.intent).toBe("vill_boka");
    expect(r.escalate).toBe(false);
    expect(r.suggestedAction).toBe("book_meeting");
  });

  it("faller tillbaka till uppföljning vid okänt innehåll", () => {
    const r = classifyReplyDeterministic("Hej!");
    expect(r.intent).toBe("ovrigt");
    expect(r.suggestedAction).toBe("schedule_followup");
    expect(r.confidence).toBeLessThan(0.5);
  });
});
