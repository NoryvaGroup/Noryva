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
      "Vi skapar och optimerar digital annonsering för att nå människor som faktiskt kan bli dina kunder.",
    points: ["Målgrupp", "Budskap", "Kreativt material", "Kampanjstruktur", "Löpande optimering"],
  },
  {
    icon: Filter,
    n: "02",
    title: "Leadgenerering",
    heading: "Gör intresse till konkreta förfrågningar.",
    summary:
      "Vi bygger landningssidor och leadflöden som gör det enkelt för potentiella kunder att ta nästa steg.",
    points: ["Landningssidor", "Kontaktformulär", "Lead funnels", "Bokningsflöden", "Konverteringsoptimering"],
  },
  {
    icon: Workflow,
    n: "03",
    title: "Automatisering",
    heading: "Följ upp innan kunden hinner försvinna.",
    summary:
      "Vi automatiserar delar av processen från första kontakt till uppföljning och bokning.",
    points: ["Automatiska svar", "Lead-notifieringar", "Uppföljningar", "Bokningsflöden", "CRM-integrationer"],
  },
  {
    icon: BarChart3,
    n: "04",
    title: "Konverteringsoptimering",
    heading: "Få mer ut av trafiken du redan betalar för.",
    summary:
      "Vi analyserar kundresan och förbättrar stegen från första klick till faktisk förfrågan.",
    points: [],
  },
];

const conversionFlow = ["Klick", "Besök", "Lead", "Bokning", "Kund"];

export function Services() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="tjanster" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Tjänster</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Vi bygger systemet bakom din kundanskaffning.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Från den första annonsen till den färdiga kunden – vi hjälper till att optimera hela
            vägen.
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

                  {s.title === "Konverteringsoptimering" && (
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
