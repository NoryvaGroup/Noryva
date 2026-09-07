import { useState } from "react";
import { ArrowRight, BarChart3, Filter, Plus, Target, Workflow } from "lucide-react";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

const services = [
  {
    icon: Target,
    n: "01",
    title: "Digital annonsering",
    heading: "Få rätt personer att upptäcka ditt företag.",
    summary:
      "Vi skapar och optimerar kampanjer för att nå rätt beslutsfattare eller köpare när behovet finns.",
    points: ["Målgrupper", "Budskap", "Kreativt material", "Kampanjstruktur", "Löpande optimering"],
  },
  {
    icon: Filter,
    n: "02",
    title: "Leadgenerering & AI-kvalificering",
    heading: "Gör intresse till prioriterade affärsmöjligheter.",
    summary:
      "Vi bygger leadflöden som fångar rätt information och hjälper till att strukturera vilka kontakter som bör följas upp först.",
    points: ["Landningssidor", "Dynamiska formulär", "AI-baserad kvalificering", "Lead routing", "Bokningsflöden"],
  },
  {
    icon: Workflow,
    n: "03",
    title: "Automatiserad uppföljning",
    heading: "Följ upp medan intresset är aktuellt.",
    summary:
      "Vi automatiserar bekräftelser, påminnelser och nästa steg utan att ta bort den personliga dialogen.",
    points: ["Automatiska svar", "Lead-notifieringar", "Påminnelser", "Bokningsflöden", "Personliga överlämningar"],
  },
  {
    icon: BarChart3,
    n: "04",
    title: "CRM & processflöden",
    heading: "Skapa struktur från nytt lead till nästa steg.",
    summary:
      "Vi kopplar ihop kanaler, formulär och CRM så att rätt information når rätt person och går att följa upp.",
    points: [],
  },
];

const conversionFlow = ["Klick", "Lead", "Kvalificering", "Dialog", "Affär"];

export function Services() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="tjanster" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Tjänster</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            En sammanhängande motor för fler kvalificerade affärsmöjligheter.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Vi kombinerar annonsering, leadgenerering, AI-baserad kvalificering, automatiserad
            uppföljning och CRM-flöden.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {services.map((s, i) => {
            const isOpen = open === i;
            const Icon = s.icon;
            const hasDetails = s.points.length > 0;
            return (
              <Reveal as="article" key={s.title} delay={i * 70}>
                <div
                  className={cn(
                    "h-full rounded-2xl border border-border bg-surface/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 sm:p-8",
                    isOpen && "border-primary/30",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary">
                      <Icon size={20} />
                    </div>
                    <span className="font-display text-sm tracking-widest text-muted-foreground/60">
                      {s.n}
                    </span>
                  </div>
                  <h3 className="mt-5 text-xl font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm font-semibold text-primary">{s.heading}</p>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.summary}</p>

                  {s.title === "CRM & processflöden" && (
                    <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
                      {conversionFlow.map((s2, j, arr) => (
                        <span key={s2} className="inline-flex items-center gap-2">
                          <span className="rounded-full border border-border bg-surface-2/70 px-2.5 py-1">
                            {s2}
                          </span>
                          {j < arr.length - 1 && (
                            <ArrowRight size={12} className="text-primary" aria-hidden="true" />
                          )}
                        </span>
                      ))}
                    </p>
                  )}

                  {hasDetails && (
                    <>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : i)}
                        className="mt-5 inline-flex items-center gap-2 rounded-full text-sm text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Plus
                          size={14}
                          className={cn(
                            "text-primary transition-transform duration-300",
                            isOpen && "rotate-45",
                          )}
                        />
                        {isOpen ? "Dölj detaljer" : "Visa detaljer"}
                      </button>

                      <div
                        className={cn(
                          "grid transition-all duration-300",
                          isOpen ? "mt-5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                        )}
                      >
                        <ul className="overflow-hidden">
                          {s.points.map((p) => (
                            <li
                              key={p}
                              className="flex items-center gap-3 border-t border-border/70 py-2.5 text-sm text-muted-foreground first:border-t-0"
                            >
                              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                              {p}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
