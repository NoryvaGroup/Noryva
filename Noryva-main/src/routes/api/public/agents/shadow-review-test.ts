import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

/**
 * HMAC-skyddad Shadow Review-köfyllare. Skapar endast interna TEST-uppgifter;
 * kör inga workers, AI-anrop, mail eller andra externa actions.
 */
export const Route = createFileRoute("/api/public/agents/shadow-review-test")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("agents-shadow-review-test", request),
    },
  },
});