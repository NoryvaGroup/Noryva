import { defineTool } from "@lovable.dev/mcp-js";
import { services } from "../content";

export default defineTool({
  name: "list_services",
  title: "Lista tjänster",
  description:
    "Lista Noryvas tjänster (digital annonsering, leadgenerering, automatisering, konverteringsoptimering) med beskrivning och vad som ingår.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [{ type: "text" as const, text: JSON.stringify(services, null, 2) }],
    structuredContent: { services },
  }),
});
