import { Reveal } from "./Reveal";

const problems = [
  "Pengar läggs på annonser utan att man vet vad som faktiskt fungerar.",
  "Många leads kommer in – men få är relevanta.",
  "Potentiella kunder tappas på grund av långsam uppföljning.",
  "Det saknas en tydlig och förutsägbar process för kundanskaffning.",
  "Försäljningen är svår att skala upp på ett kontrollerat sätt.",
];

export function Problem() {
  return (
    <section id="problem" className="border-t border-border py-20 sm:py-28">
      <div className="container-x grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal>
          <div>
            <span className="eyebrow">Utmaningen</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.6rem]">
              Bra företag ska inte behöva förlita sig på tur för att få nya kunder.
            </h2>
          </div>
        </Reveal>

        <ul className="space-y-3">
          {problems.map((p, i) => (
            <Reveal as="li" key={p} delay={i * 70}>
              <div className="flex gap-4 rounded-xl border border-border bg-surface/60 p-5 transition-colors hover:border-primary/30">
                <span className="font-display text-sm text-primary tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">{p}</p>
              </div>
            </Reveal>
          ))}
          <Reveal as="li" delay={400}>
            <p className="pt-4 font-display text-lg font-semibold sm:text-xl">
              Det är där Noryva kommer in.
            </p>
          </Reveal>
        </ul>
      </div>
    </section>
  );
}
