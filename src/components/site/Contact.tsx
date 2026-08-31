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
  forbattra: z.string().trim().min(1, "Välj vad du vill förbättra").max(200),
  meddelande: z.string().trim().max(1000).optional().or(z.literal("")),
});

type Lead = z.infer<typeof schema>;
type Errors = Partial<Record<keyof Lead, string>>;

const fieldClass =
  "w-full rounded-xl border border-input bg-surface/70 px-4 py-3.5 text-base text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus-visible:ring-ring";

const goals = [
  "Fler leads",
  "Bättre kvalitet på leads",
  "Lägre kostnad per lead",
  "Snabbare uppföljning",
  "Komma igång med annonsering",
  "Annat",
];

/**
 * ENDA stället där ett inskick skickas vidare.
 * Fältnamnen (namn, foretag, epost, telefon, hemsida, forbattra, meddelande)
 * mappar rakt av mot kolumner i Google Sheets.
 *
 * För att koppla på automationen senare: gör funktionen async och posta
 * `lead` som JSON till din Make-webhook (eller motsvarande) här, t.ex.:
 *   await fetch(MAKE_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) });
 * Alternativt kan ett Tally-formulär bäddas in i sektionen istället.
 */
function submitLead(lead: Lead) {
  void lead; // webhook-koppling läggs till här
}

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
    submitLead(result.data);
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
              Berätta om ditt företag.
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Fyll i formuläret så återkommer vi med en kostnadsfri genomgång av din nuvarande
              kundanskaffning och vilka möjligheter som finns.
            </p>
            <div className="mt-8">
              <CtaLink href="mailto:hej@noryva.se" variant="ghost" className="py-3.5">
                <Mail size={16} /> hej@noryva.se
              </CtaLink>
            </div>
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
                  label="Telefon"
                  name="telefon"
                  type="tel"
                  error={errors.telefon}
                  autoComplete="tel"
                  required
                />
                <div className="sm:col-span-2">
                  <Field
                    label="Hemsida"
                    name="hemsida"
                    placeholder="valfritt"
                    error={errors.hemsida}
                    autoComplete="url"
                  />
                </div>

                <div className="sm:col-span-2">
                  <SelectField
                    label="Vad vill du förbättra?"
                    name="forbattra"
                    options={goals}
                    error={errors.forbattra}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label htmlFor="meddelande">Meddelande</Label>
                  <textarea
                    id="meddelande"
                    name="meddelande"
                    rows={4}
                    maxLength={1000}
                    className={fieldClass}
                    placeholder="Berätta kort om ditt företag och vad du vill uppnå (valfritt)."
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
