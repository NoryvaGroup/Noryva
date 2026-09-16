import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/claim-lead-reminder")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("claim-lead-reminder", request),
    },
  },
});
