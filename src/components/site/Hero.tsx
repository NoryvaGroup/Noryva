import { ArrowRight } from "lucide-react";
import { CtaLink } from "./Button";
import { Reveal } from "./Reveal";

function FlowVisual() {
  const steps = [
    { label: "Trafik", value: "Annons" },
    { label: "Leads", value: "Formulär" },
    { label: "Kunder", value: "Bokning" },
  ];
  return (
    <div className="relative rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm sm:p-7">
      <div className="flex items-center justify-between text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Kundflöde</span>
        <span className="text-primary">Live-princip</span>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div
            key={s.label}
            className="relative rounded-xl border border-border bg-surface-2/70 p-4 transition-transform duration-300 hover:-translate-y-0.5"
          >
            <div className="text-xs text-muted-foreground">{s.value}</div>
            <div className="mt-1 font-display text-base font-semibold">{s.label}</div>
            <div
              className="mt-3 h-1 rounded-full bg-primary/70"
              style={{ width: `${100 - i * 28}%` }}
            />
          </div>
        ))}
      </div>

      <svg viewBox="0 0 600 90" className="mt-6 w-full" aria-hidden="true">
        <defs>
          <linearGradient id="heroLine" x1="0" x2="1">
            <stop offset="0%" stopColor="oklch(0.82 0.15 168)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="oklch(0.82 0.15 168)" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <path
          d="M0 80 C 140 78, 200 50, 300 42 C 400 34, 470 22, 600 8"
          fill="none"
          stroke="url(#heroLine)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line
            key={i}
            x1={i * 120}
            y1="0"
            x2={i * 120}
            y2="90"
            stroke="oklch(1 0 0 / 0.05)"
            strokeWidth="1"
          />
        ))}
      </svg>
      <p className="mt-2 text-xs text-muted-foreground">
        Illustrationen visar principen bakom arbetssättet – inte faktiska kunddata.
      </p>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div
        className="pointer-events-none absolute inset-0 grid-veil opacity-60"
        style={{ maskImage: "radial-gradient(70% 60% at 50% 0%, black, transparent)" }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-veil)" }}
        aria-hidden="true"
      />

      <div className="container-x relative grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <Reveal>
            <span className="eyebrow">
              <span className="size-1.5 rounded-full bg-primary" />
              Digital tillväxtbyrå
            </span>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="mt-5 text-[2.6rem] leading-[1.05] font-semibold sm:text-6xl lg:text-[4.1rem]">
              Fler rätt kunder.
              <br />
              <span className="text-primary">Mindre krångel.</span>
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Noryva hjälper företag att få fler kvalificerade kunder genom smart digital
              annonsering, effektiv leadgenerering och automatiserade processer.
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <CtaLink href="/#kontakt" className="py-4 sm:py-3.5">
                Boka ett kostnadsfritt möte <ArrowRight size={17} />
              </CtaLink>
              <CtaLink href="/#process" variant="ghost" className="py-4 sm:py-3.5">
                Se hur det fungerar
              </CtaLink>
            </div>
          </Reveal>

          <Reveal delay={240}>
            <p className="mt-6 text-sm text-muted-foreground">
              Ingen bindningstid <span className="mx-1.5 text-primary">•</span> Kostnadsfri genomgång
              <span className="mx-1.5 text-primary">•</span> Fokus på faktiska resultat
            </p>
          </Reveal>
        </div>

        <Reveal delay={200}>
          <FlowVisual />
        </Reveal>
      </div>
    </section>
  );
}
