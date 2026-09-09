import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/fail-nurture-review")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("fail-nurture-review", request),
    },
  },
});
