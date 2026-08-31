import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

const title = "Integritetspolicy – Noryva";
const description =
  "Så behandlar Noryva personuppgifter som lämnas via kontaktformulär och e-post.";

export const Route = createFileRoute("/integritetspolicy")({
  component: Page,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/integritetspolicy" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/integritetspolicy" }],
  }),
});

function Page() {
  return (
    <LegalPage
      title="Integritetspolicy"
      intro="Vi värnar om din integritet. Här beskriver vi vilka uppgifter Noryva samlar in, varför och hur du kan påverka behandlingen."
    >
      <section>
        <h2>Vilka uppgifter vi samlar in</h2>
        <p>
          När du fyller i vårt kontaktformulär eller mejlar oss behandlar vi de uppgifter du själv
          lämnar, exempelvis namn, företag, e-postadress, telefonnummer, hemsida, bransch och ditt
          meddelande.
        </p>
      </section>
      <section>
        <h2>Varför vi behandlar uppgifterna</h2>
        <p>
          Uppgifterna används endast för att kunna besvara din förfrågan, boka ett möte och
          kommunicera kring ett eventuellt samarbete. Vi säljer aldrig dina uppgifter vidare.
        </p>
      </section>
      <section>
        <h2>Lagringstid</h2>
        <p>
          Vi sparar uppgifterna så länge det behövs för dialogen och eventuellt samarbete, samt så
          länge lagen kräver det. Därefter raderas de.
        </p>
      </section>
      <section>
        <h2>Dina rättigheter</h2>
        <ul>
          <li>Begära ett registerutdrag över de uppgifter vi har om dig</li>
          <li>Begära rättelse eller radering</li>
          <li>Invända mot eller begränsa behandlingen</li>
        </ul>
        <p>
          Kontakta oss på <a className="text-primary" href="mailto:hej@noryva.se">hej@noryva.se</a>{" "}
          så hjälper vi dig.
        </p>
      </section>
    </LegalPage>
  );
}
