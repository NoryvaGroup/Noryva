import { Reveal } from "./Reveal";

export function LeadContext() {
  return (
    <section className="border-t border-border py-20 sm:py-28">
      <div className="container-x grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <Reveal>
          <div>
            <span className="eyebrow">Sammanhang</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.6rem]">
              Sammanhanget följer med leadet.
            </h2>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="space-y-5 lg:pt-16">
            <p className="font-display text-xl leading-snug font-semibold sm:text-2xl">
              Noryva behåller sammanhanget kring varje lead – vad kunden efterfrågat, hur leadet
              bedömts och vad nästa steg är.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Det skapar grunden för smartare och mer personlig uppföljning utan att säljaren behöver
              börja från noll.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Vi utvecklar löpande hur mycket av uppföljningen som kan förberedas automatiskt. Nya
              delar aktiveras först när de är genomtestade tillsammans med kunden.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
