import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/register-reviewed-nurture-reply")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("register-reviewed-nurture-reply", request),
    },
  },
});
