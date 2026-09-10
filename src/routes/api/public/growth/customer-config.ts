import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/customer-config")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("customer-config", request),
    },
  },
});
