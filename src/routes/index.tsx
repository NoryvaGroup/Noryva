import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Problem } from "@/components/site/Problem";
import { HowItWorks } from "@/components/site/HowItWorks";
import { Signals } from "@/components/site/Signals";
import { Positioning } from "@/components/site/Positioning";
import { Benefits } from "@/components/site/Benefits";
import { Dashboard } from "@/components/site/Dashboard";
import { HumanControl } from "@/components/site/HumanControl";
import { LeadContext } from "@/components/site/LeadContext";
import { Audience } from "@/components/site/Audience";
import { Cases } from "@/components/site/Cases";
import { BigCta } from "@/components/site/BigCta";
import { Footer } from "@/components/site/Footer";

const title = "Noryva | Prioriterade leads och smartare uppföljning";
const description =
  "Noryva analyserar, prioriterar och förbereder nästa steg för varje inkommande lead – så att säljaren vet vem som bör kontaktas först och varför.";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.noryva.se" },
      { property: "og:locale", content: "sv_SE" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: "https://www.noryva.se" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          name: "Noryva",
          description,
          areaServed: "SE",
          email: "info@noryva.se",
          url: "https://www.noryva.se",
          serviceType: [
            "Digital annonsering",
            "Leadgenerering",
            "AI-baserad leadkvalificering",
            "Automatiserad uppföljning",
            "CRM- och processflöden",
          ],
        }),
      },
    ],
  }),
});

/** Gamla ankarlänkar (#om, #faq, #kontakt) pekar nu på egna sidor. */
const legacyHash: Record<string, string> = {
  "#om": "/om",
  "#faq": "/faq",
  "#kontakt": "/kontakt",
  "#formular": "/kontakt",
};

function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    const target = legacyHash[window.location.hash];
    if (target) navigate({ to: target, replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Signals />
        <Positioning />
        <Benefits />
        <Dashboard />
        <HumanControl />
        <LeadContext />
        <Audience />
        <Cases />
        <BigCta />
      </main>
      <Footer />
    </div>
  );
}
