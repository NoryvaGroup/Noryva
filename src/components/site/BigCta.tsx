import { ArrowRight } from "lucide-react";
import { CtaLink } from "./Button";
import { Reveal } from "./Reveal";

export function BigCta() {
  return (
    <section className="relative overflow-hidden border-t border-border py-24 sm:py-36">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-veil)" }}
        aria-hidden="true"
      />
      <div className="container-x relative">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl leading-[1.08] font-semibold sm:text-6xl">
              Är det dags att få ordning på <span className="text-primary">leadflödet?</span>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Boka en kostnadsfri genomgång. Vi tittar på hur ni fångar, kvalificerar och följer upp
              affärsmöjligheter i dag – och var flödet kan förbättras.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <CtaLink href="/#formular" className="px-8 py-4 text-base">
                Boka kostnadsfri genomgång <ArrowRight size={17} />
              </CtaLink>
              <CtaLink href="/#formular" variant="ghost" className="px-8 py-4 text-base">
                Skicka en förfrågan
              </CtaLink>
            </div>
            <p className="mt-9 text-sm text-muted-foreground">
              Ingen bindningstid <span className="mx-1.5 text-primary">•</span> Kostnadsfri
              genomgång <span className="mx-1.5 text-primary">•</span> Fokus på faktiska resultat
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
