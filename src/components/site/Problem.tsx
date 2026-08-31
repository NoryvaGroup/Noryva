import { Reveal } from "./Reveal";

const problems = [
  {
    n: "01",
    title: "För få förfrågningar",
    text: "Bra företag kan fortfarande ha svårt att nå tillräckligt många potentiella kunder.",
  },
  {
    n: "02",
    title: "Fel typ av leads",
    text: "Mer trafik betyder inte automatiskt fler relevanta kunder.",
  },
  {
    n: "03",
    title: "Kunder tappas på vägen",
    text: "Långsam uppföljning och ineffektiva processer gör att potentiella affärer försvinner.",
  },
];

export function Problem() {
  return (
    <section id="problem" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Utmaningen</span>
          <h2 className="mt-5 max-w-3xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Bra företag ska inte behöva förlita sig på tur för att få nya kunder.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Många företag gör rätt i sin verksamhet men har fortfarande svårt att skapa ett stabilt
            inflöde av nya kunder.
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
            Noryva bygger systemet som kopplar ihop allt.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
