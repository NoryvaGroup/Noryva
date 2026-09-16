import { defineTool } from "@lovable.dev/mcp-js";
import { company } from "../content";

export default defineTool({
  name: "get_company_info",
  title: "Om Noryva",
  description:
    "Hämta grundläggande information om Noryva: vad byrån gör, kontaktmejl, webbplats och länk för att boka en kostnadsfri genomgång.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [{ type: "text" as const, text: JSON.stringify(company, null, 2) }],
    structuredContent: { company },
  }),
});
