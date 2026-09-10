import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/delivery-recovery")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("delivery-recovery", request),
    },
  },
});
