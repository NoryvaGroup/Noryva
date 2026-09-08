import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/assign-variant")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("assign-variant", request),
    },
  },
});
