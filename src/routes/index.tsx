import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Problem } from "@/components/site/Problem";
import { Process } from "@/components/site/Process";
import { Services } from "@/components/site/Services";
import { Dashboard } from "@/components/site/Dashboard";
import { Results } from "@/components/site/Results";
import { Why } from "@/components/site/Why";
import { Audience } from "@/components/site/Audience";
import { About } from "@/components/site/About";
import { Cases } from "@/components/site/Cases";
import { Faq, faqItems } from "@/components/site/Faq";
import { BigCta } from "@/components/site/BigCta";
import { Contact } from "@/components/site/Contact";
import { Footer } from "@/components/site/Footer";

const title = "Noryva | Digital annonsering som ger fler kunder";
const description =
  "Noryva hjälper svenska tjänsteföretag att få fler kvalificerade kunder genom digital annonsering, leadgenerering och automatiserad uppföljning.";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://noryva.se" },
      { property: "og:locale", content: "sv_SE" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: "https://noryva.se" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "ProfessionalService",
              name: "Noryva",
              description,
              areaServed: "SE",
              email: "hej@noryva.se",
              url: "https://noryva.se",
              serviceType: [
                "Digital annonsering",
                "Leadgenerering",
                "Automatisering",
                "Konverteringsoptimering",
              ],
            },
            {
              "@type": "FAQPage",
              mainEntity: faqItems.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
          ],
        }),
      },
    ],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Process />
        <Services />
        <Dashboard />
        <Results />
        <Why />
        <Audience />
        <About />
        <Cases />
        <Faq />
        <BigCta />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}
