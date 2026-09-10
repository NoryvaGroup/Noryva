import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

/**
 * TEST-endpoint: processar ett litet batchantal Shadow Review-uppgifter via
 * befintlig Sales-worker + QA. Samma HMAC/replay/throttle-lager som övriga
 * Growth-endpoints. Ingen auto-approval och ingen extern effekt.
 */
export const Route = createFileRoute("/api/public/agents/process-shadow-batch-test")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("agents-process-shadow-batch-test", request),
    },
  },
});
