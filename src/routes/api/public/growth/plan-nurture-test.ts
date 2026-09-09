import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/plan-nurture-test")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("plan-nurture-test", request),
    },
  },
});
