import { Reveal } from "./Reveal";

const checkpoints = [
  "Vilka kanaler som skapar relevanta leads",
  "Vilka kriterier som signalerar hög potential",
  "Hur snabbt och konsekvent varje lead följs upp",
  "Var i kundresan möjligheter går vidare eller stannar",
];

export function Cases() {
  return (
    <section id="kundcase" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow justify-center">Transparens före löften</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.6rem]">
              Vi mäter det som går att förbättra.
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Utan verifierade kundcase visar vi inga påhittade resultat. I stället följer vi
              mätpunkter genom hela flödet och använder dem som underlag för nästa förbättring.
            </p>
            <ul className="mt-9 grid gap-3 text-left sm:grid-cols-2">
              {checkpoints.map((checkpoint) => (
                <li key={checkpoint} className="rounded-xl border border-border bg-surface/60 p-4 text-sm leading-relaxed text-muted-foreground">
                  <span className="mr-2 text-primary">•</span>{checkpoint}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
