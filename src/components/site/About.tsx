import { Reveal } from "./Reveal";

const values = [
  { title: "Nytänkande", text: "Vi testar, mäter och förbättrar hellre än att göra som alla andra." },
  { title: "Transparent", text: "Du ska förstå vad som görs, varför – och vad det leder till." },
  { title: "Resultatinriktat", text: "Målet är affärer, inte enbart synlighet." },
  { title: "Tekniskt kompetent", text: "Annonsering, data, automatisering och konvertering i ett." },
];

export function About() {
  return (
    <section id="om" className="border-t border-border py-20 sm:py-28">
      <div className="container-x grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
        <Reveal>
          <div>
            <span className="eyebrow">Om Noryva</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.4rem]">
              Noryva – byggt för att göra kundanskaffning enklare.
            </h2>
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Noryva kombinerar digital annonsering, data, automatisering och konverteringsoptimering
              för att skapa en mer effektiv process för att få nya kunder. Istället för enskilda
              insatser bygger vi ett sammanhängande system – från annons till bokat möte.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Vi är ett ungt och ambitiöst företag. Vi lovar inga genvägar, men vi arbetar
              strukturerat, transparent och med tydligt fokus på vad marknadsföringen faktiskt ger.
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
            {values.map((v) => (
              <div key={v.title} className="bg-surface/60 p-6 transition-colors hover:bg-surface-2/70">
                <h3 className="text-base font-semibold">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{v.text}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
