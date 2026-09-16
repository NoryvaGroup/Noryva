import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/due-nurture-reviews")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("due-nurture-reviews", request),
    },
  },
});
