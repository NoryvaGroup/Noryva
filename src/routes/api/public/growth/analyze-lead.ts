import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/analyze-lead")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("analyze-lead", request),
    },
  },
});
