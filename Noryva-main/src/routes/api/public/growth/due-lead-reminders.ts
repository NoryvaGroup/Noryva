import { createFileRoute } from "@tanstack/react-router";
import { handleGrowthApi } from "@/lib/growth/api.server";

export const Route = createFileRoute("/api/public/growth/due-lead-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGrowthApi("due-lead-reminders", request),
    },
  },
});
