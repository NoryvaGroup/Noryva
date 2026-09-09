import { Reveal } from "./Reveal";

const columns = [
  {
    title: "AI där det sparar tid",
    points: [
      "Analys av förfrågan",
      "Prioritering av leads",
      "Struktur och sammanställning",
      "Förslag på nästa steg",
    ],
  },
  {
    title: "Människor där det spelar roll",
    points: [
      "Viktiga eller osäkra situationer",
      "Kundkontakt och dialog",
      "Offert, pris och villkor",
      "Beslut om affären",
    ],
  },
];

export function HumanControl() {
  return (
    <section className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">AI och kontroll</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            AI där det sparar tid. Människor där det spelar roll.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Noryva hjälper till med analys, prioritering, struktur och nästa steg. Viktiga eller
            osäkra situationer lämnas vidare för mänsklig bedömning – ni behåller kontrollen över
            kundkontakten.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
          {columns.map((c, i) => (
            <Reveal key={c.title} delay={i * 80} className="bg-background">
              <div className="h-full bg-surface/50 p-8">
                <h3 className="text-base font-semibold">{c.title}</h3>
                <ul className="mt-5 space-y-3">
                  {c.points.map((p) => (
                    <li
                      key={p}
                      className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"
                    >
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
