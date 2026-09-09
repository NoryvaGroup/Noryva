import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { Faq, faqItems } from "@/components/site/Faq";
import { BigCta } from "@/components/site/BigCta";

const title = "Vanliga frågor om Noryva | FAQ";
const description =
  "Svar på vanliga frågor om Noryva: pris, uppstart, vilka företag vi arbetar med, annonsbudget, AI-kvalificering och villkor.";

export const Route = createFileRoute("/faq")({
  component: Page,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.noryva.se/faq" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://www.noryva.se/faq" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqItems.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
});

function Page() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="pt-24">
        <section className="container-x pt-14 pb-2">
          <h1 className="text-3xl leading-tight font-semibold sm:text-5xl">Vanliga frågor</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Svar på det företag oftast undrar innan ett samarbete.
          </p>
        </section>
        <Faq />
        <BigCta />
      </main>
      <Footer />
    </div>
  );
}
