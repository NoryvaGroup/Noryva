import { ArrowRight, Building2, BriefcaseBusiness, KeyRound, Wrench } from "lucide-react";
import { Reveal } from "./Reveal";
import { CtaTo } from "./Button";

const categories = [
  {
    icon: Wrench,
    title: "Hantverk & installation",
    text: "Installation, bygg, renovering och andra projektbaserade tjänster.",
  },
  {
    icon: Building2,
    title: "Fastighetsservice",
    text: "Service, underhåll och återkommande uppdrag för fastigheter.",
  },
  {
    icon: KeyRound,
    title: "Uthyrning",
    text: "Företag som behöver matcha rätt förfrågan med rätt objekt eller kapacitet.",
  },
  {
    icon: BriefcaseBusiness,
    title: "Företagsservice & lokal B2B",
    text: "Specialiserade tjänster där varje ny kundrelation har ett tydligt värde.",
  },
];

export function Audience() {
  return (
    <section id="malgrupp" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Vilka vi hjälper</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            För företag där varje rätt affärsmöjlighet räknas.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Vi fokuserar på svenska tjänste- och B2B-företag med högt kundvärde, en tydlig målgrupp
            och kapacitet att ta hand om fler relevanta förfrågningar.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((c, i) => {
            const Icon = c.icon;
            return (
              <Reveal key={c.title} delay={i * 70}>
                <div className="h-full rounded-2xl border border-border bg-surface/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30">
                  <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary">
                    <Icon size={20} />
                  </div>
                  <h3 className="mt-5 text-base font-semibold">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={200}>
          <div className="mt-12 flex flex-col items-start justify-between gap-6 rounded-2xl border border-border bg-surface/50 p-7 sm:flex-row sm:items-center sm:p-9">
            <div>
              <h3 className="text-lg font-semibold sm:text-xl">
                Osäker på om Noryva passar ditt företag?
              </h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Boka en kostnadsfri genomgång så tittar vi på din situation tillsammans.
              </p>
            </div>
            <CtaTo to="/kontakt" className="shrink-0 py-3.5">
              Boka kostnadsfri genomgång <ArrowRight size={16} />
            </CtaTo>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
