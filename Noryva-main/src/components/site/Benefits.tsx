import { Bell, ClipboardList, Compass, LayoutGrid, Settings2, Sparkles } from "lucide-react";
import { Reveal } from "./Reveal";

const benefits = [
  {
    icon: ClipboardList,
    title: "Prioriterade leads",
    text: "Se vilka förfrågningar som bör hanteras först.",
  },
  {
    icon: Sparkles,
    title: "AI-bedömning",
    text: "Förstå varför ett lead är intressant och vad kunden faktiskt efterfrågar.",
  },
  {
    icon: Compass,
    title: "Rekommenderat nästa steg",
    text: "Få vägledning kring vad som bör göras härnäst och hur snabbt leadet bör hanteras.",
  },
  {
    icon: LayoutGrid,
    title: "Strukturerad leadöversikt",
    text: "Samla leads, status och relevant information på ett ställe.",
  },
  {
    icon: Bell,
    title: "Smart uppföljning",
    text: "Minska risken att potentiella affärer faller mellan stolarna.",
  },
  {
    icon: Settings2,
    title: "Anpassat efter företaget",
    text: "Kvalificeringen anpassas efter bransch, tjänster, målgrupp och geografiskt område.",
  },
];

export function Benefits() {
  return (
    <section id="vad-ni-far" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Vad företaget får</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Överblick, prioritet och nästa steg.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((b, i) => {
            const Icon = b.icon;
            return (
              <Reveal key={b.title} delay={i * 60} className="bg-background">
                <div className="h-full bg-surface/50 p-7 transition-colors duration-300 hover:bg-surface-2/70">
                  <Icon size={20} className="text-primary" />
                  <h3 className="mt-5 text-base font-semibold">{b.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
