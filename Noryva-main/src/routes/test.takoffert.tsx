import { createFileRoute } from "@tanstack/react-router";
import { RoofLanding } from "@/components/landing/roof/RoofLanding";
import { clientConfig } from "@/components/landing/roof/config";
import { TEST_WEBHOOK_URL } from "@/lib/public-landing.functions";

const TITLE = "Testversion – takoffert";

export const Route = createFileRoute("/test/takoffert")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: "Intern testversion av takoffertformuläret." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: "Intern testversion av takoffertformuläret." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <RoofLanding config={{ ...clientConfig, webhookUrl: TEST_WEBHOOK_URL }} />,
});
