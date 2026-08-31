import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Problem } from "@/components/site/Problem";
import { Services } from "@/components/site/Services";
import { Process } from "@/components/site/Process";
import { Results } from "@/components/site/Results";
import { Why } from "@/components/site/Why";
import { Audience } from "@/components/site/Audience";
import { About } from "@/components/site/About";
import { Cases } from "@/components/site/Cases";
import { Faq, faqItems } from "@/components/site/Faq";
import { Contact } from "@/components/site/Contact";
import { Footer } from "@/components/site/Footer";

const title = "Noryva – Fler rätt kunder genom digital annonsering";
const description =
  "Noryva hjälper företag att få fler kvalificerade kunder genom digital annonsering, leadgenerering, automatisering och konverteringsoptimering.";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { property: "og:locale", content: "sv_SE" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: "/" }],
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
              url: "/",
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
        <h1 className="sr-only">
          Noryva – digital tillväxtbyrå för fler kvalificerade kunder
        </h1>
        <Hero />
        <Problem />
        <Services />
        <Process />
        <Results />
        <Why />
        <Audience />
        <About />
        <Cases />
        <Faq />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}
