import { Check } from "lucide-react";
import { Reveal } from "./Reveal";
import { CtaLink } from "./Button";

const industries = [
  "Takläggare",
  "Byggföretag",
  "Måleriföretag",
  "Elektriker",
  "VVS-företag",
  "Bilverkstäder",
  "Flyttfirmor",
  "Städ- och serviceföretag",
  "Andra lokala tjänsteföretag",
];

const fit = [
  "Har en fungerande produkt eller tjänst",
  "Vill växa",
  "Vill ha fler kvalificerade leads",
  "Är beredda att investera i kundanskaffning",
  "Vill kunna mäta vad marknadsföringen faktiskt ger",
];

export function Audience() {
  return (
    <section id="malgrupp" className="border-t border-border py-20 sm:py-28">
      <div className="container-x grid gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <div>
            <span className="eyebrow">Vilka vi hjälper</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.4rem]">
              Vi hjälper företag som vill ha ett stabilare inflöde av nya kunder.
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Vi arbetar särskilt ofta med tjänste- och lokala företag, men arbetssättet fungerar
              för de flesta verksamheter som är beroende av nya kunder för att växa.
            </p>
            <ul className="mt-7 flex flex-wrap gap-2">
              {industries.map((i) => (
                <li
                  key={i}
                  className="rounded-full border border-border bg-surface/60 px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  {i}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="rounded-2xl border border-border bg-surface/70 p-7 sm:p-9">
            <h3 className="text-xl font-semibold sm:text-2xl">Passar Noryva för ditt företag?</h3>
            <p className="mt-3 text-sm text-muted-foreground">Noryva passar bäst för företag som:</p>
            <ul className="mt-6 space-y-3.5">
              {fit.map((f) => (
                <li key={f} className="flex gap-3 text-sm sm:text-base">
                  <Check size={18} className="mt-0.5 shrink-0 text-primary" />
                  <span className="text-muted-foreground">{f}</span>
                </li>
              ))}
            </ul>
            <CtaLink href="/#kontakt" className="mt-8 w-full py-4 sm:w-auto sm:py-3.5">
              Se om Noryva passar ditt företag
            </CtaLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
