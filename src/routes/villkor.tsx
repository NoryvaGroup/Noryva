import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

const title = "Villkor – Noryva";
const description = "Allmänna villkor för användning av Noryvas webbplats och för samarbeten.";

export const Route = createFileRoute("/villkor")({
  component: Page,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/villkor" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/villkor" }],
  }),
});

function Page() {
  return (
    <LegalPage
      title="Villkor"
      intro="Nedan följer allmänna villkor för webbplatsen. Villkoren för ett samarbete regleras alltid i ett separat skriftligt avtal."
    >
      <section>
        <h2>Innehåll på webbplatsen</h2>
        <p>
          Informationen på noryva.se är av allmän karaktär och utgör inte ett bindande erbjudande.
          Vi strävar efter att hålla innehållet korrekt och uppdaterat.
        </p>
      </section>
      <section>
        <h2>Samarbeten</h2>
        <p>
          Omfattning, pris, uppsägningstid och övriga villkor kommer vi överens om skriftligt innan
          ett samarbete inleds. Vi lämnar inga garantier om specifika resultat, eftersom utfall
          påverkas av faktorer som marknad, erbjudande och konkurrens.
        </p>
      </section>
      <section>
        <h2>Immateriella rättigheter</h2>
        <p>
          Innehåll, varumärke och material på webbplatsen tillhör Noryva och får inte användas utan
          tillstånd.
        </p>
      </section>
    </LegalPage>
  );
}
