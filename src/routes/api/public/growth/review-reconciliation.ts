import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/review-reconciliation")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("review-reconciliation", request),
    },
  },
});
