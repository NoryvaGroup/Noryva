import { Reveal } from "./Reveal";

const kpis = [
  {
    title: "Fler kvalificerade leads",
    text: "Fler relevanta förfrågningar från rätt målgrupp.",
  },
  {
    title: "Lägre kostnad per lead",
    text: "Mer effekt av varje krona i annonsbudgeten.",
  },
  {
    title: "Högre konvertering",
    text: "Fler besökare som faktiskt tar nästa steg.",
  },
  {
    title: "Kortare väg till kund",
    text: "Snabbare uppföljning från första kontakt till bokning.",
  },
];

export function Results() {
  return (
    <section id="resultat" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Det vi optimerar</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Målet är inte fler klick. Målet är fler relevanta möjligheter till affärer.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k, i) => (
            <Reveal key={k.title} delay={i * 70}>
              <div className="h-full rounded-2xl border border-border bg-surface/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 sm:p-7">
                <span className="font-display text-sm tracking-widest text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 text-base font-semibold sm:text-lg">{k.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{k.text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <p className="mt-10 inline-flex items-center gap-2.5 rounded-full border border-border bg-surface/50 px-4 py-2 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            När vi har data visar vi den. Inga påhittade siffror.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
