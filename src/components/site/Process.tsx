import { ArrowRight } from "lucide-react";
import { CtaLink } from "./Button";
import { Reveal } from "./Reveal";

const steps = [
  {
    n: "01",
    title: "Vi analyserar",
    text: "Vi kartlägger erbjudandet, kundvärdet, målgruppen och hur en affär går från första kontakt till beslut.",
  },
  {
    n: "02",
    title: "Vi bygger",
    text: "Vi bygger annonser, landningssidor, kvalificeringsfrågor och kopplingar till era befintliga arbetssätt.",
  },
  {
    n: "03",
    title: "Vi optimerar",
    text: "Vi följer upp kvalitet, svarstider och konvertering för att förbättra både inflöde och hantering.",
  },
  {
    n: "04",
    title: "Vi utvecklar flödet",
    text: "När data visar vad som fungerar prioriterar vi rätt kanaler, kriterier och uppföljningssteg.",
  },
];

export function Process() {
  return (
    <section id="process" className="border-t border-border py-20 sm:py-28">
      <div className="container-x">
        <Reveal>
          <span className="eyebrow">Så fungerar det</span>
          <h2 className="mt-5 max-w-2xl text-3xl leading-tight font-semibold sm:text-[2.6rem]">
            Från första intresse till kvalificerad dialog.
          </h2>
        </Reveal>

        <ol className="relative mt-14 grid gap-8 lg:grid-cols-4 lg:gap-6">
          <div
            className="pointer-events-none absolute top-[13px] left-0 hidden h-px w-full bg-gradient-to-r from-primary/60 via-border to-transparent lg:block"
            aria-hidden="true"
          />
          {steps.map((s, i) => (
            <Reveal as="li" key={s.n} delay={i * 90} className="relative lg:pr-6">
              <div className="flex items-center gap-3 lg:block">
                <span className="relative z-10 block size-[26px] shrink-0 rounded-full border border-primary/40 bg-background p-[7px]">
                  <span className="block size-full rounded-full bg-primary" />
                </span>
                <span className="font-display text-sm tracking-widest text-primary lg:mt-5 lg:block">
                  {s.n}
                </span>
              </div>
              <h3 className="mt-3 text-lg font-semibold lg:mt-2">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </Reveal>
          ))}
        </ol>

        <Reveal delay={200}>
          <div className="mt-14">
            <CtaLink href="/#kontakt" className="py-4 sm:py-3.5">
              Boka kostnadsfri genomgång <ArrowRight size={17} />
            </CtaLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
