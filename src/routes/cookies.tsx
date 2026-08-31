import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

const title = "Cookies – Noryva";
const description = "Information om hur Noryva använder cookies och liknande tekniker på webbplatsen.";

export const Route = createFileRoute("/cookies")({
  component: Page,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/cookies" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/cookies" }],
  }),
});

function Page() {
  return (
    <LegalPage
      title="Cookies"
      intro="Cookies är små textfiler som sparas i din webbläsare. Här beskriver vi hur de kan användas på noryva.se."
    >
      <section>
        <h2>Nödvändiga cookies</h2>
        <p>
          Vissa cookies krävs för att webbplatsen ska fungera tekniskt, exempelvis för att komma ihåg
          val du gjort under besöket.
        </p>
      </section>
      <section>
        <h2>Analys och statistik</h2>
        <p>
          Om analysverktyg används sker det för att förstå hur webbplatsen används och för att kunna
          förbättra innehåll och användarupplevelse. Sådana cookies sätts endast med ditt samtycke.
        </p>
      </section>
      <section>
        <h2>Hantera cookies</h2>
        <p>
          Du kan när som helst blockera eller radera cookies i din webbläsares inställningar. Vissa
          delar av webbplatsen kan då fungera sämre.
        </p>
      </section>
    </LegalPage>
  );
}
