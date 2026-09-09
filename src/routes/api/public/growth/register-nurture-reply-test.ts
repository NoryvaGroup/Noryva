import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/register-nurture-reply-test")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("register-nurture-reply-test", request),
    },
  },
});
