import { ArrowDown, ArrowRight } from "lucide-react";
import { CtaLink, CtaTo } from "./Button";
import { Reveal } from "./Reveal";

const flowSteps = ["Annons", "Lead", "Kvalificering", "Uppföljning", "Affär"];

/**
 * Abstrakt visualisering av kundflödet ANNONS → LEAD → KVALIFICERING → UPPFÖLJNING → AFFÄR.
 * Illustrerar principen bakom arbetssättet – inte faktiska kunddata.
 */
function FlowVisual() {
  const nodes: Array<{ x: number; y: number; label: string }> = [
    { x: 40, y: 78, label: "Annons" },
    { x: 175, y: 62, label: "Lead" },
    { x: 310, y: 48, label: "Kvalificering" },
    { x: 445, y: 34, label: "Uppföljning" },
    { x: 580, y: 20, label: "Affär" },
  ];
  const path = "M40 78 C 100 74, 120 66, 175 62 C 230 58, 255 52, 310 48 C 365 44, 390 38, 445 34 C 500 30, 525 24, 580 20";

  return (
    <div className="relative rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm sm:p-7">
      <div className="flex items-center justify-between text-[0.7rem] tracking-[0.16em] text-muted-foreground uppercase">
        <span>Kundflöde</span>
        <span className="text-primary">Live-princip</span>
      </div>

      <svg viewBox="0 0 620 130" className="mt-8 w-full" role="img" aria-label="Illustration av flödet från annons till affärsmöjlighet">
        <defs>
          <linearGradient id="flowLine" x1="0" x2="1">
            <stop offset="0%" stopColor="oklch(0.74 0.16 268)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="oklch(0.74 0.16 268)" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* rutnätslinjer */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={110 + i * 130}
            y1="4"
            x2={110 + i * 130}
            y2="96"
            stroke="oklch(1 0 0 / 0.05)"
            strokeWidth="1"
          />
        ))}

        <path d={path} fill="none" stroke="url(#flowLine)" strokeWidth="2" strokeLinecap="round" />

        {/* noder */}
        {nodes.map((node) => (
          <g key={node.label}>
            <circle cx={node.x} cy={node.y} r="10" fill="oklch(0.74 0.16 268 / 0.12)" />
            <circle cx={node.x} cy={node.y} r="4" fill="oklch(0.74 0.16 268)" />
            <text
              x={node.x}
              y={node.y + 34}
              textAnchor="middle"
              fill="oklch(0.74 0.012 260)"
              fontSize="11"
              fontFamily="inherit"
            >
              {node.label}
            </text>
          </g>
        ))}

        {/* ljuspunkt som rör sig genom flödet */}
        <circle r="5" fill="oklch(0.9 0.1 268)" className="motion-dot">
          <animateMotion dur="5s" repeatCount="indefinite" path={path} />
        </circle>
        <circle r="10" fill="oklch(0.74 0.16 268 / 0.25)" className="motion-dot">
          <animateMotion dur="5s" repeatCount="indefinite" path={path} />
        </circle>
      </svg>

      <div className="mt-4 grid grid-cols-5 gap-2">
        {flowSteps.map((s, i) => (
          <div
            key={s}
            className="rounded-lg border border-border bg-surface-2/70 px-2 py-2.5 text-center transition-transform duration-300 hover:-translate-y-0.5"
          >
            <div className="h-1 rounded-full bg-primary/60" style={{ width: `${38 + i * 14}%`, marginInline: "auto" }} />
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Illustrationen visar principen bakom arbetssättet – inte faktiska kunddata.
      </p>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-20 sm:pt-44 sm:pb-28">
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
              Tillväxtsystem för företag med högt kundvärde
            </span>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="mt-5 text-[2.75rem] leading-[1.04] font-semibold sm:text-6xl lg:text-[4.4rem]">
              Fler rätt kunder.
              <br />
              <span className="text-primary">Mindre krångel.</span>
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Noryva hjälper företag med högt kundvärde att fånga, kvalificera och följa upp fler
              affärsmöjligheter automatiskt.
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <CtaTo to="/kontakt" className="py-4 sm:py-3.5">
                Boka kostnadsfri genomgång <ArrowRight size={17} />
              </CtaTo>
              <CtaLink href="/#sa-fungerar" variant="ghost" className="py-4 sm:py-3.5">
                Se hur det fungerar <ArrowDown size={16} />
              </CtaLink>
            </div>
          </Reveal>

          <Reveal delay={240}>
            <p className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {["Annonsering", "Leadgenerering", "AI-kvalificering", "CRM & uppföljning"].map((s, i, arr) => (
                <span key={s} className="inline-flex items-center gap-2">
                  {s}
                  {i < arr.length - 1 && <ArrowRight size={13} className="text-primary" aria-hidden="true" />}
                </span>
              ))}
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
