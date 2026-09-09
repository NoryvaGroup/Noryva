import { Reveal } from "./Reveal";

export function Positioning() {
  return (
    <section className="relative overflow-hidden border-t border-border py-20 sm:py-28">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-veil)" }}
        aria-hidden="true"
      />
      <div className="container-x relative grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-20">
        <Reveal>
          <h2 className="text-3xl leading-tight font-semibold sm:text-[2.8rem]">
            Ett lead är bara värdefullt om <span className="text-primary">något händer med det.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <div className="space-y-5 lg:pt-3">
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Noryva är byggt för hela vägen efter att en potentiell kund har visat intresse.
              Istället för att alla förfrågningar hamnar i samma inkorg analyseras, struktureras och
              prioriteras varje lead.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Företaget vet därmed vem som bör kontaktas först – och varför.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
