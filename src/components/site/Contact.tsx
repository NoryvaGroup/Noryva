import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Mail } from "lucide-react";
import { z } from "zod";
import { Reveal } from "./Reveal";
import { CtaButton, CtaLink } from "./Button";

const schema = z.object({
  namn: z.string().trim().min(2, "Ange ditt namn").max(100),
  foretag: z.string().trim().min(1, "Ange företagsnamn").max(120),
  epost: z.string().trim().email("Ange en giltig e-postadress").max(255),
  telefon: z.string().trim().min(6, "Ange ett telefonnummer").max(30),
  hemsida: z.string().trim().max(200).optional().or(z.literal("")),
  bransch: z.string().trim().min(1, "Ange bransch").max(100),
  forbattra: z.string().trim().min(1, "Välj vad du vill förbättra").max(200),
  budget: z.string().trim().min(1, "Välj ungefärlig budget").max(100),
  meddelande: z.string().trim().max(1000).optional().or(z.literal("")),
});

type Errors = Partial<Record<keyof z.infer<typeof schema>, string>>;

const fieldClass =
  "w-full rounded-xl border border-input bg-surface/70 px-4 py-3.5 text-base text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring";

const budgets = [
  "Under 10 000 kr / månad",
  "10 000 – 25 000 kr / månad",
  "25 000 – 50 000 kr / månad",
  "Över 50 000 kr / månad",
  "Vet ej ännu",
];

const goals = [
  "Fler leads",
  "Bättre kvalitet på leads",
  "Lägre kostnad per lead",
  "Snabbare uppföljning",
  "Komma igång med annonsering",
  "Annat",
];

export function Contact() {
  const [errors, setErrors] = useState<Errors>({});
  const [sent, setSent] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const result = schema.safeParse(data);
    if (!result.success) {
      const next: Errors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof Errors;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSent(true);
  }

  return (
    <section id="kontakt" className="relative overflow-hidden border-t border-border py-20 sm:py-28">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-veil)" }}
        aria-hidden="true"
      />
      <div className="container-x relative grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <Reveal>
          <div className="lg:sticky lg:top-28">
            <span className="eyebrow">Kontakt</span>
            <h2 className="mt-5 text-3xl leading-tight font-semibold sm:text-[2.6rem]">
              Redo att få fler rätt kunder?
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Boka ett kostnadsfritt möte så går vi igenom ditt företag, din nuvarande
              kundanskaffning och vilka möjligheter som finns.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CtaLink href="#formular" className="py-4 sm:py-3.5">
                Boka ett kostnadsfritt möte <ArrowRight size={17} />
              </CtaLink>
              <CtaLink href="mailto:hej@noryva.se" variant="ghost" className="py-4 sm:py-3.5">
                <Mail size={16} /> Kontakta Noryva
              </CtaLink>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Ingen bindningstid <span className="mx-1.5 text-primary">•</span> Kostnadsfri genomgång
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div
            id="formular"
            className="scroll-mt-28 rounded-2xl border border-border bg-surface/70 p-6 sm:p-9"
          >
            {sent ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                <CheckCircle2 size={44} className="text-primary" />
                <h3 className="mt-6 text-2xl font-semibold">Tack!</h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base">
                  Vi har tagit emot din förfrågan och återkommer så snart som möjligt.
                </p>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
                <Field label="Namn" name="namn" error={errors.namn} autoComplete="name" required />
                <Field
                  label="Företag"
                  name="foretag"
                  error={errors.foretag}
                  autoComplete="organization"
                  required
                />
                <Field
                  label="E-post"
                  name="epost"
                  type="email"
                  error={errors.epost}
                  autoComplete="email"
                  required
                />
                <Field
                  label="Telefonnummer"
                  name="telefon"
                  type="tel"
                  error={errors.telefon}
                  autoComplete="tel"
                  required
                />
                <Field
                  label="Hemsida"
                  name="hemsida"
                  placeholder="valfritt"
                  error={errors.hemsida}
                  autoComplete="url"
                />
                <Field label="Vilken bransch?" name="bransch" error={errors.bransch} required />

                <SelectField
                  label="Vad vill du förbättra?"
                  name="forbattra"
                  options={goals}
                  error={errors.forbattra}
                />
                <SelectField
                  label="Ungefärlig månadsbudget"
                  name="budget"
                  options={budgets}
                  error={errors.budget}
                />

                <div className="sm:col-span-2">
                  <Label htmlFor="meddelande">Meddelande</Label>
                  <textarea
                    id="meddelande"
                    name="meddelande"
                    rows={4}
                    maxLength={1000}
                    className={fieldClass}
                    placeholder="Berätta kort om ditt företag och vad du vill uppnå."
                  />
                </div>

                <div className="sm:col-span-2">
                  <CtaButton type="submit" className="w-full py-4">
                    Skicka förfrågan <ArrowRight size={17} />
                  </CtaButton>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Vi använder dina uppgifter endast för att kontakta dig om din förfrågan.
                  </p>
                </div>
              </form>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Label({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-foreground">
      {children}
    </label>
  );
}

function Field({
  label,
  name,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string | undefined }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <input
        id={name}
        name={name}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        className={fieldClass}
        {...rest}
      />
      {error && (
        <p id={`${name}-error`} className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function SelectField({
  label,
  name,
  options,
  error,
}: {
  label: string;
  name: string;
  options: string[];
  error?: string | undefined;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue=""
        aria-invalid={!!error}
        className={`${fieldClass} appearance-none`}
      >
        <option value="" disabled>
          Välj ett alternativ
        </option>
        {options.map((o) => (
          <option key={o} value={o} className="bg-background">
            {o}
          </option>
        ))}
      </select>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
