import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { About } from "@/components/site/About";
import { Why } from "@/components/site/Why";
import { Results } from "@/components/site/Results";
import { BigCta } from "@/components/site/BigCta";

const title = "Om Noryva | Vilka vi är och hur vi arbetar";
const description =
  "Noryva hjälper svenska tjänste- och B2B-företag att fånga, kvalificera och prioritera fler affärsmöjligheter. Så tänker vi och så arbetar vi.";

export const Route = createFileRoute("/om")({
  component: Page,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.noryva.se/om" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://www.noryva.se/om" }],
  }),
});

function Page() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="pt-24">
        <section className="container-x pt-14 pb-2">
          <h1 className="text-3xl leading-tight font-semibold sm:text-5xl">Om Noryva</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Vilka vi är, hur vi arbetar och varför vi byggt Noryva.
          </p>
        </section>
        <About />
        <Why />
        <Results />
        <BigCta />
      </main>
      <Footer />
    </div>
  );
}
