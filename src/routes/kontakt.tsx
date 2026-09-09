import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { Contact } from "@/components/site/Contact";

const title = "Kontakta Noryva | Boka en kostnadsfri genomgång";
const description =
  "Hör av dig till Noryva. Berätta kort om er verksamhet så återkommer vi med förslag på upplägg och nästa steg.";

export const Route = createFileRoute("/kontakt")({
  component: Page,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.noryva.se/kontakt" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://www.noryva.se/kontakt" }],
  }),
});

function Page() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="pt-24">
        <section className="container-x pt-14 pb-2">
          <h1 className="text-3xl leading-tight font-semibold sm:text-5xl">Kontakta oss</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Berätta kort om er verksamhet så återkommer vi med förslag på nästa steg.
          </p>
        </section>
        <Contact />
      </main>
      <Footer />
    </div>
  );
}
