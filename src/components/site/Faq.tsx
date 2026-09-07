import { useState } from "react";
import { Plus } from "lucide-react";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

export const faqItems = [
  {
    q: "Vad kostar det att anlita Noryva?",
    a: "Priset anpassas efter företagets behov, mål och omfattning. Vi går igenom upplägget innan ett eventuellt samarbete.",
  },
  {
    q: "Behöver jag redan annonsera?",
    a: "Nej. Vi kan bygga ett nytt inflöde eller förbättra ett befintligt upplägg, beroende på företagets förutsättningar och mål.",
  },
  {
    q: "Hur snabbt kan vi komma igång?",
    a: "Efter en första genomgång tar vi fram ett upplägg och går igenom nästa steg tillsammans.",
  },
  {
    q: "Vilka företag arbetar ni med?",
    a: "Svenska tjänste- och B2B-företag med högt kundvärde och behov av fler kvalificerade affärsmöjligheter. Det kan vara hantverk och installation, fastighetsservice, uthyrning, företagsservice eller andra specialiserade tjänster.",
  },
  {
    q: "Sköter ni annonseringen åt oss?",
    a: "Ja. Vi kan hantera strategi, skapande, testning och löpande optimering samt koppla inflödet till kvalificering och uppföljning.",
  },
  {
    q: "Hur fungerar AI-baserad leadkvalificering?",
    a: "Vi sätter upp kriterier utifrån er affär, till exempel behov, område, tidplan eller företagsstorlek. AI kan sedan hjälpa till att strukturera och prioritera informationen, medan ni behåller kontrollen över beslut och kundkontakt.",
  },
  {
    q: "Kan ni koppla flödet till vårt CRM?",
    a: "Det beror på vilka system och arbetssätt ni använder. Under genomgången kartlägger vi vilka kopplingar, notifieringar och uppföljningssteg som är lämpliga.",
  },
  {
    q: "Betalar jag annonskostnaden till Noryva?",
    a: "Nej. Annonsbudgeten är separat från Noryvas arvode. Du har full kontroll över vad som spenderas på annonsering.",
  },
  {
    q: "Kan jag avsluta samarbetet?",
    a: "Det beror på det avtalade upplägget. Alla villkor ska vara tydliga innan ett samarbete börjar.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="border-t border-border py-20 sm:py-28">
      <div className="container-x grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <Reveal>
          <div>
            <span className="eyebrow">FAQ</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.4rem]">
              Vanliga frågor
            </h2>
            <p className="mt-5 text-sm text-muted-foreground">
              Hittar du inte svaret? Boka en kostnadsfri genomgång så går vi igenom det tillsammans.
            </p>
          </div>
        </Reveal>

        <div className="divide-y divide-border border-y border-border">
          {faqItems.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left text-base font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-lg"
                  >
                    {item.q}
                    <Plus
                      size={18}
                      className={cn(
                        "shrink-0 text-primary transition-transform duration-300",
                        isOpen && "rotate-45",
                      )}
                    />
                  </button>
                </h3>
                <div
                  className={cn(
                    "grid transition-all duration-300",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="pb-6 text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
