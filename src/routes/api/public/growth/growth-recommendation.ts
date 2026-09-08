import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/growth-recommendation")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("growth-recommendation", request),
    },
  },
});
