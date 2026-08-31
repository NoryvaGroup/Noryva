import { Reveal } from "./Reveal";

/**
 * PLACEHOLDER-SEKTION.
 * Korten nedan är avsiktliga platshållare och innehåller inga publicerade
 * eller verkliga resultat. Ersätt fälten med riktiga kundcase när de finns.
 */
const rows = ["Bransch", "Mål", "Strategi", "Resultat"];
const cases = ["Kundcase 01", "Kundcase 02", "Kundcase 03"];

export function Cases() {
  return (
    <section id="kundcase" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Kundcase</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Resultat som går att mäta.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Vi publicerar bara case med verkliga siffror. Platserna nedan fylls i när resultat finns
            att redovisa.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {cases.map((c, i) => (
            <Reveal as="article" key={c} delay={i * 80}>
              <div className="h-full rounded-2xl border border-dashed border-border bg-surface/40 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 sm:p-7">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold">{c}</h3>
                  <span className="rounded-full border border-border px-2.5 py-1 text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                    Kommer snart
                  </span>
                </div>
                <dl className="mt-6 space-y-4">
                  {rows.map((r) => (
                    <div key={r} className="border-t border-border/70 pt-3">
                      <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
                        {r}
                      </dt>
                      <dd className="mt-1.5 h-2 w-3/5 rounded-full bg-surface-2" />
                    </div>
                  ))}
                </dl>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
