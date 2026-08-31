import { useState } from "react";
import { Plus } from "lucide-react";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

export const faqItems = [
  {
    q: "Vad kostar det att anlita Noryva?",
    a: "Priset anpassas efter företagets behov, mål och omfattning. Du får alltid en tydlig genomgång av upplägg och kostnad innan ett eventuellt samarbete inleds – inga dolda avgifter.",
  },
  {
    q: "Behöver jag redan annonsera?",
    a: "Nej. Vi hjälper både företag som redan annonserar och företag som ska börja från noll.",
  },
  {
    q: "Hur snabbt kan vi komma igång?",
    a: "Det beror på omfattning och vilket material som finns på plats. Vi börjar med en genomgång, går sedan vidare till uppsättning av annonser, landningssida och leadflöden. Vi sätter en realistisk tidsplan tillsammans istället för att lova ett fast datum.",
  },
  {
    q: "Vilka företag arbetar ni med?",
    a: "Främst företag som vill öka inflödet av nya kunder, med extra fokus på tjänsteföretag och lokala verksamheter. Arbetssättet fungerar dock i de flesta branscher.",
  },
  {
    q: "Sköter ni annonseringen åt oss?",
    a: "Ja. Målet är att du ska kunna lämna den digitala kundanskaffningen till oss och istället fokusera på din verksamhet.",
  },
  {
    q: "Kan jag avsluta samarbetet?",
    a: "Vi arbetar utan lång bindningstid. Exakta villkor, uppsägningstid och omfattning kommer vi överens om skriftligt innan start så att allt är tydligt för båda parter.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="border-t border-border py-20 sm:py-28">
      <div className="container-x grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <Reveal>
          <div>
            <span className="eyebrow">FAQ</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.4rem]">
              Vanliga frågor
            </h2>
            <p className="mt-5 text-sm text-muted-foreground">
              Hittar du inte svaret? Boka ett kostnadsfritt möte så går vi igenom det tillsammans.
            </p>
          </div>
        </Reveal>

        <div className="divide-y divide-border border-y border-border">
          {faqItems.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left text-base font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-lg"
                  >
                    {item.q}
                    <Plus
                      size={18}
                      className={cn(
                        "shrink-0 text-primary transition-transform duration-300",
                        isOpen && "rotate-45",
                      )}
                    />
                  </button>
                </h3>
                <div
                  className={cn(
                    "grid transition-all duration-300",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="pb-6 text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
