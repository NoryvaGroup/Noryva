import { Reveal } from "./Reveal";

export function About() {
  return (
    <section id="om" className="border-t border-border py-20 sm:py-28">
      <div className="container-x grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <Reveal>
          <div>
            <span className="eyebrow">Om Noryva</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.6rem]">
              Noryva är byggt med en enkel idé.
            </h2>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="space-y-5 lg:pt-16">
            <p className="font-display text-xl leading-snug font-semibold sm:text-2xl">
              Företag ska inte behöva kasta pengar på marknadsföring och hoppas att det fungerar.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Noryva kombinerar annonsering, leadgenerering, automatisering och
              konverteringsoptimering för att skapa en tydligare väg från första klick till ny kund.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Vi är ett ungt och ambitiöst företag. Därför bygger vi långsiktigt, arbetar
              transparent och låter resultaten tala för sig själva.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
