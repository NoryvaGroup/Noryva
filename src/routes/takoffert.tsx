import { createFileRoute } from "@tanstack/react-router";
import { RoofLanding } from "@/components/landing/roof/RoofLanding";

const TITLE = "Offert på takarbete – kostnadsfri förfrågan";
const DESCRIPTION =
  "Beskriv ditt tak på under en minut och få en kostnadsfri första bedömning från ett takföretag. Inga förpliktelser.";
const URL = "https://noryva.se/takoffert";

export const Route = createFileRoute("/takoffert")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#f7f7f5" },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: RoofLanding,
});
