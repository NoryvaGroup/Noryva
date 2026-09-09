import { CalendarClock, FileText, Layers, MapPin, Target, TrendingUp } from "lucide-react";
import { Reveal } from "./Reveal";

const signals = [
  { icon: Target, title: "Kundens behov", text: "Vad förfrågan faktiskt handlar om." },
  { icon: TrendingUp, title: "Köpintention", text: "Hur nära ett beslut kunden verkar vara." },
  { icon: CalendarClock, title: "Tidsram", text: "När kunden vill ha hjälp." },
  { icon: MapPin, title: "Geografisk matchning", text: "Om kunden finns inom ert område." },
  { icon: Layers, title: "Relevans", text: "Hur väl behovet passar era tjänster." },
  {
    icon: FileText,
    title: "Information och kontext",
    text: "Detaljerna kunden lämnat i sin förfrågan.",
  },
];

export function Signals() {
  return (
    <section id="analys" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Vad Noryva analyserar</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Mer än namn och telefonnummer.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Noryva väger samman flera signaler i varje förfrågan och skapar en strukturerad
            bedömning av leadet – inte bara en kontaktuppgift i inkorgen.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {signals.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.title} delay={i * 60} className="bg-background">
                <div className="h-full bg-surface/50 p-7 transition-colors duration-300 hover:bg-surface-2/70">
                  <Icon size={20} className="text-primary" />
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
