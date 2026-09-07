import { Eye, FlaskConical, Layers, TrendingUp } from "lucide-react";
import { Reveal } from "./Reveal";

const usps = [
  {
    icon: Eye,
    title: "Vi visar vad som händer",
    text: "Du ska kunna se vad du betalar för och vad det leder till.",
  },
  {
    icon: FlaskConical,
    title: "Vi testar istället för att gissa",
    text: "Målgrupper, budskap, kvalificering och uppföljning förbättras utifrån faktisk data.",
  },
  {
    icon: Layers,
    title: "Vi tar ansvar för helheten",
    text: "Inte bara annonserna – utan vägen från första intresse till kvalificerad dialog.",
  },
  {
    icon: TrendingUp,
    title: "Vi anpassar efter affären",
    text: "Kriterier, uppföljning och CRM-flöden formas efter er bransch och kundresa.",
  },
];

export function Why() {
  return (
    <section id="varfor" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Varför Noryva</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Inte mer marknadsföring. Bättre marknadsföring.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {usps.map((u, i) => {
            const Icon = u.icon;
            return (
              <Reveal key={u.title} delay={i * 70} className="bg-background">
                <div className="h-full bg-surface/50 p-7 transition-colors duration-300 hover:bg-surface-2/70">
                  <Icon size={20} className="text-primary" />
                  <h3 className="mt-5 text-base font-semibold">{u.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{u.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
