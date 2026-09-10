import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

/**
 * TEST-endpoint för Agent HQ. Samma HMAC/replay/throttle-lager som Growth API.
 * Skapar endast en uppgift – kör aldrig någon worker och har ingen extern effekt.
 */
export const Route = createFileRoute("/api/public/agents/dispatch-test")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("agents-dispatch-test", request),
    },
  },
});
