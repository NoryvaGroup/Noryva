import { Reveal } from "./Reveal";

const problems = [
  {
    n: "01",
    title: "För få rätt affärsmöjligheter",
    text: "Marknadsföringen når inte alltid de företag eller personer som har ett verkligt behov.",
  },
  {
    n: "02",
    title: "Leads saknar sammanhang",
    text: "Utan rätt frågor och kvalificering blir det svårt att veta vilka kontakter som bör prioriteras.",
  },
  {
    n: "03",
    title: "Uppföljningen blir ojämn",
    text: "Manuella överlämningar och sena svar gör att relevanta affärsmöjligheter riskerar att svalna.",
  },
];

export function Problem() {
  return (
    <section id="problem" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Utmaningen</span>
          <h2 className="mt-5 max-w-3xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Ett värdefullt lead ska inte försvinna mellan annons, inkorg och uppföljning.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            För företag med högt kundvärde räcker det inte med fler klick. Hela vägen från första
            intresse till kvalificerad dialog behöver fungera som ett sammanhängande system.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {problems.map((p, i) => (
            <Reveal key={p.n} delay={i * 80}>
              <div className="h-full rounded-2xl border border-border bg-surface/60 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 sm:p-8">
                <span className="font-display text-sm tracking-widest text-primary">{p.n}</span>
                <h3 className="mt-4 text-lg font-semibold sm:text-xl">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <p className="mt-12 font-display text-lg font-semibold sm:text-2xl">
            Noryva kopplar ihop inflöde, kvalificering, CRM och uppföljning.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
