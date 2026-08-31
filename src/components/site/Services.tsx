import { useState } from "react";
import { BarChart3, Filter, Plus, Target, Workflow } from "lucide-react";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

const services = [
  {
    icon: Target,
    title: "Digital annonsering",
    summary:
      "Vi skapar och optimerar annonser på relevanta plattformar för att nå rätt potentiella kunder.",
    points: [
      "Rätt målgrupp",
      "Rätt budskap",
      "Rätt erbjudande",
      "Kontinuerlig optimering",
      "Mätbara resultat",
    ],
  },
  {
    icon: Filter,
    title: "Leadgenerering",
    summary:
      "System som gör det enkelt för potentiella kunder att lämna sina uppgifter och ta nästa steg.",
    points: [
      "Landningssidor",
      "Kontaktformulär",
      "Lead funnels",
      "Bokningssystem",
      "Konverteringsoptimering",
    ],
  },
  {
    icon: Workflow,
    title: "Automatisering",
    summary:
      "Vi automatiserar repetitiva delar av processen – från första kontakt till uppföljning.",
    points: [
      "Automatiska svar",
      "Lead-notifieringar",
      "Uppföljningar",
      "Bokningsflöden",
      "CRM-integrationer",
    ],
  },
  {
    icon: BarChart3,
    title: "Konverteringsoptimering",
    summary:
      "Vi analyserar vad som händer efter klicket och förbättrar hela kundresan steg för steg.",
    points: ["Annons", "Landningssida", "Lead", "Uppföljning", "Kund"],
  },
];

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
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {services.map((s, i) => {
            const isOpen = open === i;
            const Icon = s.icon;
            return (
              <Reveal as="article" key={s.title} delay={i * 70}>
                <div
                  className={cn(
                    "group h-full rounded-2xl border border-border bg-surface/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 sm:p-8",
                    isOpen && "border-primary/30",
                  )}
                >
                  <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary">
                    <Icon size={20} />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold">{s.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.summary}</p>

                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="mt-5 inline-flex items-center gap-2 rounded-full text-sm font-semibold text-primary transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus
                      size={15}
                      className={cn("transition-transform duration-300", isOpen && "rotate-45")}
                    />
                    {isOpen ? "Visa mindre" : "Läs mer"}
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
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
