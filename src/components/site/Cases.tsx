import { ArrowRight } from "lucide-react";
import { CtaLink } from "./Button";
import { Reveal } from "./Reveal";

/**
 * Inga publicerade kundcase ännu. Sektionen är medvetet minimalistisk –
 * bygg ut med riktiga case (bransch, mål, strategi, resultat) när det finns
 * verklig data att visa. Hitta aldrig på siffror eller kunder.
 */
export function Cases() {
  return (
    <section id="kundcase" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow justify-center">Kundcase</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.6rem]">
              Resultat som går att mäta.
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Vi fyller på med riktiga kundcase när vi har data att visa.
            </p>
            <p className="mt-8 font-display text-lg font-semibold sm:text-xl">
              Ditt företag kan bli vårt nästa case.
            </p>
            <div className="mt-7">
              <CtaLink href="/#kontakt" className="py-4 sm:py-3.5">
                Boka kostnadsfri genomgång <ArrowRight size={17} />
              </CtaLink>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
