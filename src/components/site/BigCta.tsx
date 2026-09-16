import { ArrowRight } from "lucide-react";
import { CtaTo } from "./Button";
import { Reveal } from "./Reveal";

export function BigCta() {
  return (
    <section className="relative overflow-hidden border-t border-border py-24 sm:py-36">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-veil)" }}
        aria-hidden="true"
      />
      <div className="container-x relative">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl leading-[1.08] font-semibold sm:text-6xl">
              Testa Noryva i <span className="text-primary">30 dagar</span> â€“ kostnadsfritt.
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Se hur era fÃ¶rfrÃ¥gningar analyseras, prioriteras och fÃ¶rbereds fÃ¶r uppfÃ¶ljning. Ingen
              bindningstid.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <CtaTo to="/kontakt" className="px-8 py-4 text-base">
                Testa 30 dagar kostnadsfritt <ArrowRight size={17} />
              </CtaTo>
              <CtaTo to="/kontakt" variant="ghost" className="px-8 py-4 text-base">
                Boka en genomgÃ¥ng
              </CtaTo>
            </div>
            <p className="mt-9 text-sm text-muted-foreground">
              30 dagars testperiod <span className="mx-1.5 text-primary">â€¢</span> Ingen bindningstid{" "}
              <span className="mx-1.5 text-primary">â€¢</span> UppsÃ¤gning nÃ¤r som helst
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

