import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { faq } from "../content";

export default defineTool({
  name: "search_faq",
  title: "Sök i vanliga frågor",
  description:
    "Sök bland Noryvas vanliga frågor och svar (pris, uppstart, branscher, annonsbudget, villkor). Utan sökord returneras alla frågor.",
  inputSchema: {
    query: z.string().trim().optional().describe("Valfritt sökord, t.ex. 'pris' eller 'avsluta'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ query }) => {
    const q = query?.toLowerCase();
    const items = q
      ? faq.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q))
      : faq;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }],
      structuredContent: { items },
    };
  },
});
