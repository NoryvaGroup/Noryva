import { Reveal } from "./Reveal";

/**
 * Illustrativ dashboard. Siffrorna är EXEMPELDATA för att visa hur Noryva
 * arbetar datadrivet – de är inte Noryvas eller någon kunds faktiska resultat.
 */
const stats = [
  { label: "Nya leads", value: "128", delta: "+18%" },
  { label: "Kvalificerade", value: "46", delta: "+9" },
  { label: "Svarstid", value: "8 min", delta: "-11 min" },
  { label: "Bokade dialoger", value: "23", delta: "+7" },
];

const bars = [34, 42, 38, 55, 48, 66, 60, 74, 70, 86, 80, 96];
const linePoints = "M0 84 C 40 80, 60 70, 100 66 C 140 62, 160 54, 200 50 C 240 46, 260 40, 300 34 C 340 28, 360 22, 400 16";

export function Dashboard() {
  return (
    <section id="data" className="border-t border-border py-20 sm:py-28">
      <div className="container-x grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <Reveal>
          <div>
            <span className="eyebrow">Datadrivet</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.6rem]">
              Vi gissar inte. Vi mäter.
            </h2>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
              Vi följer hela flödet för att förbättra målgrupper, kvalificering, svarstider,
              uppföljning och vägen vidare till dialog.
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="rounded-2xl border border-border bg-surface/70 p-5 shadow-[var(--shadow-elevated)] sm:p-7">
            <div className="flex items-center justify-between">
              <span className="text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase">
                Översikt över leadflödet
              </span>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[0.65rem] tracking-wider text-primary uppercase">
                Exempeldata
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-border bg-surface-2/70 p-3.5">
                  <div className="text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                    {s.label}
                  </div>
                  <div className="mt-1.5 font-display text-lg font-semibold sm:text-xl">
                    {s.value}
                  </div>
                  <div className="mt-0.5 text-[0.7rem] text-primary">{s.delta}</div>
                </div>
              ))}
            </div>

            <svg viewBox="0 0 400 100" className="mt-6 w-full" aria-hidden="true">
              <defs>
                <linearGradient id="dashLine" x1="0" x2="1">
                  <stop offset="0%" stopColor="oklch(0.5 0.11 255)" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="oklch(0.5 0.11 255)" stopOpacity="0.9" />
                </linearGradient>
              </defs>
              <path d={linePoints} fill="none" stroke="url(#dashLine)" strokeWidth="2" strokeLinecap="round" />
            </svg>

            <div className="mt-4 flex h-24 items-end gap-1.5" aria-hidden="true">
              {bars.map((h, i) => (
                <div
                  key={i}
                  className="bar-animate flex-1 rounded-t-sm bg-primary/50"
                  style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }}
                />
              ))}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              Siffrorna ovan är exempeldata som illustrerar uppföljningen – inte faktiska resultat.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
