import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/route-lead")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("route-lead", request),
    },
  },
});
