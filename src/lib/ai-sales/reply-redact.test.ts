import { describe, expect, it } from "vitest";
import { redactReplyBody } from "./reply-redact";
import { classifyReplyDeterministic } from "./reply";

const payload = {
  answers: {
    foretagsnamn: "TEST Varuautomat AB",
    kontaktperson: "Anna Andersson",
    epost: "anna@example.se",
    telefonnummer: "0700000000",
  },
};

describe("svar: maskering och klassificering", () => {
  it("tar bort namn, e-post och telefon men behåller företagsnamn", () => {
    const out = redactReplyBody(
      "Hej, det är Anna Andersson på TEST Varuautomat AB. Ring 0700000000 eller anna@example.se.",
      payload,
    );
    expect(out).not.toContain("Anna");
    expect(out).not.toContain("anna@example.se");
    expect(out).not.toContain("0700000000");
    expect(out).toContain("TEST Varuautomat AB");
  });

  it("eskalerar prisfrågor till människa efter maskering", () => {
    const redacted = redactReplyBody("Anna undrar vad det kostar per månad?", payload);
    const c = classifyReplyDeterministic(redacted);
    expect(c.intent).toBe("pris_offert");
    expect(c.escalate).toBe(true);
    expect(c.suggestedAction).toBe("handoff_to_human");
  });

  it("föreslår bokning utan eskalering vid mötesförfrågan", () => {
    const c = classifyReplyDeterministic(redactReplyBody("Vi vill boka ett möte.", payload));
    expect(c.intent).toBe("vill_boka");
    expect(c.escalate).toBe(false);
    expect(c.suggestedAction).toBe("book_meeting");
  });
});
