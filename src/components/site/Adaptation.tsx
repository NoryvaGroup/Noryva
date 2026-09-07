import { Building2, BriefcaseBusiness, KeyRound, Wrench } from "lucide-react";
import { Reveal } from "./Reveal";

const examples = [
  {
    icon: Wrench,
    title: "Hantverk & installation",
    text: "Kvalificera på tjänst, område, projektets omfattning och önskad start.",
  },
  {
    icon: Building2,
    title: "Fastighetsservice",
    text: "Sortera efter fastighetstyp, behov, plats och hur brådskande ärendet är.",
  },
  {
    icon: KeyRound,
    title: "Uthyrning",
    text: "Fånga önskemål, tidsperiod, kapacitet och andra villkor före uppföljning.",
  },
  {
    icon: BriefcaseBusiness,
    title: "Företagsservice & lokal B2B",
    text: "Bedöm företagsstorlek, beslutsbehov, tidplan och affärens potential.",
  },
];

export function Adaptation() {
  return (
    <section id="anpassning" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Anpassat leadflöde</span>
          <h2 className="mt-5 max-w-3xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Samma motor. Anpassad efter din affär.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Kundresan ser olika ut i olika branscher. Därför anpassar vi frågor, kvalificering,
            uppföljning och nästa steg efter hur just dina affärer skapas.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {examples.map((example, index) => {
            const Icon = example.icon;
            return (
              <Reveal key={example.title} delay={index * 70}>
                <div className="h-full rounded-2xl border border-border bg-surface/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30">
                  <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary">
                    <Icon size={20} />
                  </div>
                  <h3 className="mt-5 text-base font-semibold">{example.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{example.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={180}>
          <p className="mt-9 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            AI-baserad kvalificering används för att strukturera och prioritera inkommande leads
            utifrån överenskomna kriterier. Beslut och personlig kontakt ligger alltid hos ditt företag.
          </p>
        </Reveal>
      </div>
    </section>
  );
}