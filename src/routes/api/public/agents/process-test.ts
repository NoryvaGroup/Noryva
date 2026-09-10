import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

/**
 * TEST-endpoint för att köra + verifiera EN redan skapad agentuppgift.
 * Samma HMAC/replay/throttle-lager som övriga Growth-endpoints. Ingen extern
 * effekt: godkännande sker fortfarande manuellt i /admin/agents.
 */
export const Route = createFileRoute("/api/public/agents/process-test")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("agents-process-test", request),
    },
  },
});
