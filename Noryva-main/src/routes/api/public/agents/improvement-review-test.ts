import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

/**
 * TEST-endpoint: skapar EN intern systemgranskning (CTO-agenten) per dygn.
 * Samma HMAC/replay/throttle-lager som övriga Agent Core-endpoints. Ingen
 * worker körs här, ingen kod ändras och ingen extern effekt kan uppstå.
 */
export const Route = createFileRoute("/api/public/agents/improvement-review-test")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("agents-improvement-review-test", request),
    },
  },
});
