import { defineTool } from "@lovable.dev/mcp-js";
import { process as steps } from "../content";

export default defineTool({
  name: "get_process",
  title: "Noryvas process",
  description:
    "Hämta Noryvas fyrstegsprocess: analysera, bygga, optimera och skala det som fungerar.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [{ type: "text" as const, text: JSON.stringify(steps, null, 2) }],
    structuredContent: { steps },
  }),
});
