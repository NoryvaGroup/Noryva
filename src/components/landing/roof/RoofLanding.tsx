import { ArrowRight, ClipboardList, Phone, PhoneCall, ShieldCheck, Wrench } from "lucide-react";
import { clientConfig, isDemoMode } from "./config";
import { QuoteWizard } from "./QuoteWizard";

const trustPoints = [
  {
    icon: ClipboardList,
    title: "Kostnadsfri förfrågan",
    text: "Att skicka in uppgifter om ditt tak kostar ingenting.",
  },
  {
    icon: PhoneCall,
    title: "Återkoppling från takföretaget",
    text: "Ett takföretag hör av sig och går igenom vad du behöver.",
  },
  {
    icon: ShieldCheck,
    title: "Inga förpliktelser",
    text: "Du binder dig inte till något genom att skicka en förfrågan.",
  },
];

const steps = [
  {
    n: "1",
    title: "Du beskriver ditt tak",
    text: "Svara på några korta frågor om taket och ditt projekt.",
  },
  {
    n: "2",
    title: "Takföretaget hör av sig",
    text: "Ni går igenom behovet och bokar in en tid som passar.",
  },
  {
    n: "3",
    title: "Du får en bedömning",
    text: "En första bedömning av vad arbetet innebär och nästa steg.",
  },
];

export function RoofLanding() {
  const config = clientConfig;
  const demo = isDemoMode(config);
  const accentStyle = config.accent ? ({ ["--primary" as string]: config.accent } as React.CSSProperties) : undefined;

  return (
    <div className="lp-light min-h-screen" style={accentStyle}>
      {config.showDemoBadge && (
        <div className="border-b border-border bg-surface-2">
          <div className="container-x py-2">
            <p className="text-center text-xs font-medium tracking-wide text-muted-foreground">
              Demoversion för takföretag
            </p>
          </div>
        </div>
      )}

      <header className="border-b border-border bg-surface">
        <div className="container-x flex flex-wrap items-center justify-between gap-3 py-4">
          <span className="font-display text-lg font-semibold">{config.companyName}</span>
          {config.phone ? (
            <a
              href={`tel:${config.phone.replace(/\s/g, "")}`}
              className="inline-flex items-center gap-2 text-sm font-semibold hover:text-primary"
            >
              <Phone size={15} aria-hidden="true" /> {config.phone}
            </a>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Phone size={15} aria-hidden="true" /> Telefonnummer läggs till
            </span>
          )}
        </div>
        <div className="border-t border-border bg-background">
          <div className="container-x py-2.5">
            <p className="text-xs text-muted-foreground sm:text-sm">
              Kostnadsfri förfrågan · Inga förpliktelser
              {config.serviceArea ? ` · ${config.serviceArea}` : ""}
            </p>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "var(--gradient-veil)" }}
            aria-hidden="true"
          />
          <div className="container-x relative grid gap-10 py-12 lg:grid-cols-[1fr_1fr] lg:gap-14 lg:py-20">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
                <Wrench size={13} aria-hidden="true" /> Tak och takarbeten
              </span>
              <h1 className="mt-5 text-[2.1rem] leading-[1.1] font-semibold sm:text-5xl">
                Behöver ditt tak ses över?
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
                Beskriv ditt tak på under en minut, så återkommer ett takföretag för en kostnadsfri
                första bedömning av vad arbetet skulle innebära. Du binder dig inte till något.
              </p>
              <div className="mt-7">
                <a
                  href="#offertguide"
                  className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-[var(--glow-accent)] transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Få en kostnadsfri bedömning <ArrowRight size={16} />
                </a>
              </div>

              <ul className="mt-10 grid gap-4 sm:grid-cols-3 lg:gap-5">
                {trustPoints.map((p) => (
                  <li key={p.title} className="rounded-xl border border-border bg-surface p-4">
                    <p.icon size={18} className="text-primary" aria-hidden="true" />
                    <h2 className="mt-3 text-sm font-semibold">{p.title}</h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{p.text}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div id="offertguide" className="scroll-mt-6 lg:pt-2">
              <QuoteWizard config={config} />
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="container-x py-14 sm:py-20">
            <h2 className="text-2xl font-semibold sm:text-3xl">Så går det till</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {steps.map((s) => (
                <li key={s.n} className="rounded-xl border border-border bg-background p-5">
                  <span className="font-display inline-flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="container-x flex flex-col gap-3 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © 2026 {config.companyName}
            {demo ? " · Demosida" : ""}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a href="/integritetspolicy" className="hover:text-foreground">
              Integritetspolicy
            </a>
            <span>{config.email || "Kontaktuppgifter läggs till"}</span>
            <span>Leadflöde levererat av Noryva</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
