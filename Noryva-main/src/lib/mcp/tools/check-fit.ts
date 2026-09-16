import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { audience, company } from "../content";

export default defineTool({
  name: "check_fit",
  title: "Passar Noryva?",
  description:
    "Beskriv en bransch eller ett företag och få veta om det tillhör Noryvas typiska målgrupp, samt hur man tar kontakt.",
  inputSchema: {
    bransch: z
      .string()
      .trim()
      .optional()
      .describe("Bransch eller kort beskrivning av företaget, t.ex. 'takläggare i Göteborg'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ bransch }) => {
    const result = {
      bransch: bransch ?? null,
      malgrupp: audience.summary,
      segment: audience.segments,
      passarBra: audience.goodFit,
      kontakt: { epost: company.email, boka: company.bookingUrl },
      notis:
        "Noryva publicerar inga siffror eller resultat innan de går att mäta. Boka en kostnadsfri genomgång för en bedömning.",
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
