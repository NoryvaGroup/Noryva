import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/complete-lead-reminder")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("complete-lead-reminder", request),
    },
  },
});
