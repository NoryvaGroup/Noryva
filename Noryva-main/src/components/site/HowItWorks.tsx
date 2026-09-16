import { ArrowRight, Brain, Inbox, ListOrdered, Route as RouteIcon, UserCheck } from "lucide-react";
import { Reveal } from "./Reveal";

const steps = [
  {
    icon: Inbox,
    label: "Lead",
    title: "Leadet kommer in",
    text: "Potentiella kunder kommer in via företagets kampanj eller offertformulär.",
  },
  {
    icon: Brain,
    label: "Analys",
    title: "Noryva analyserar",
    text: "Systemet analyserar behov, köpintention, tidsram, geografisk matchning och andra relevanta signaler.",
  },
  {
    icon: ListOrdered,
    label: "Prioritering",
    title: "Rätt leads prioriteras",
    text: "Varje lead struktureras och prioriteras så företaget snabbt ser vilka möjligheter som bör hanteras först.",
  },
  {
    icon: RouteIcon,
    label: "Nästa steg",
    title: "Nästa steg förbereds",
    text: "Noryva hjälper till att avgöra vad som bör hända härnäst och förbereder relevant information och uppföljning.",
  },
  {
    icon: UserCheck,
    label: "Säljare",
    title: "Säljaren tar över",
    text: "När leadet kräver mänsklig kontakt har säljaren redan sammanhanget och kan fokusera på själva affären.",
  },
];

export function HowItWorks() {
  return (
    <section id="sa-fungerar" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Så fungerar Noryva</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Från förfrågan till rätt prioriterad affärsmöjlighet.
          </h2>
        </Reveal>

        <Reveal delay={80}>
          <ol className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-3">
                <span className="rounded-full border border-border bg-surface/60 px-4 py-1.5 font-medium">
                  {s.label}
                </span>
                {i < steps.length - 1 && (
                  <ArrowRight size={15} className="text-primary" aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2 lg:grid-cols-5">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.title} delay={i * 70} className="bg-background">
                <div className="h-full bg-surface/50 p-7 transition-colors duration-300 hover:bg-surface-2/70">
                  <div className="flex items-center justify-between">
                    <Icon size={20} className="text-primary" />
                    <span className="font-display text-sm text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="mt-5 text-base font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
