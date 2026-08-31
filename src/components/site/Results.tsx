import { Reveal } from "./Reveal";

const kpis = [
  { label: "Fler kvalificerade leads", hint: "Volym av relevanta förfrågningar" },
  { label: "Lägre kostnad per lead", hint: "Kostnadseffektivitet i annonseringen" },
  { label: "Högre konverteringsgrad", hint: "Andel besökare som blir leads" },
  { label: "Snabbare uppföljning", hint: "Tid från lead till första kontakt" },
  { label: "Mer effektiv kundanskaffning", hint: "Kostnad per ny kund" },
  { label: "Bättre kontroll", hint: "Överblick och uppföljning av insatser" },
];

export function Results() {
  return (
    <section id="resultat" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Resultat &amp; värde</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Marknadsföring ska inte bara synas. Den ska skapa affärer.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Det här är de nyckeltal vi arbetar mot. Siffrorna nedan fylls i med verkliga resultat
            från respektive samarbete – vi redovisar inga påhittade värden.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kpis.map((k, i) => (
            <Reveal key={k.label} delay={i * 60}>
              <div className="h-full rounded-2xl border border-border bg-surface/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl font-semibold text-muted-foreground/50">
                    —
                  </span>
                  <span className="text-xs tracking-[0.16em] text-muted-foreground/70 uppercase">
                    mäts per kund
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold">{k.label}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{k.hint}</p>
                <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary/40"
                    style={{ width: `${34 + i * 8}%` }}
                  />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
