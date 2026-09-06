import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientConfig, isDemoMode, type RoofClientConfig } from "./config";
import {
  AGER_FASTIGHETEN,
  BEHOV,
  PLANERAD_TIDPUNKT,
  TAKETS_ALDER,
  leadSchema,
  type Lead,
  type LeadErrors,
} from "./types";

type Draft = {
  behov: string;
  takets_alder: string;
  ager_fastigheten: string;
  planerad_tidpunkt: string;
  projektbeskrivning: string;
  postnummer: string;
  fullstandigt_namn: string;
  telefonnummer: string;
  epost: string;
  samtycke: boolean;
};

const emptyDraft: Draft = {
  behov: "",
  takets_alder: "",
  ager_fastigheten: "",
  planerad_tidpunkt: "",
  projektbeskrivning: "",
  postnummer: "",
  fullstandigt_namn: "",
  telefonnummer: "",
  epost: "",
  samtycke: false,
};

const CHOICE_STEPS = [
  {
    key: "behov" as const,
    title: "Vad behöver du hjälp med?",
    options: BEHOV,
  },
  {
    key: "takets_alder" as const,
    title: "Hur gammalt är taket?",
    options: TAKETS_ALDER,
  },
  {
    key: "ager_fastigheten" as const,
    title: "Äger du fastigheten?",
    options: AGER_FASTIGHETEN,
  },
  {
    key: "planerad_tidpunkt" as const,
    title: "När vill du genomföra projektet?",
    options: PLANERAD_TIDPUNKT,
  },
];

const TOTAL_STEPS = CHOICE_STEPS.length + 3; // val + beskrivning + kontakt + sammanfattning

const fieldClass =
  "w-full rounded-xl border border-input bg-surface px-4 py-3.5 text-base text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring";

function readUtm() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  return {
    utm_source: p.get("utm_source") ?? "",
    utm_medium: p.get("utm_medium") ?? "",
    utm_campaign: p.get("utm_campaign") ?? "",
    utm_content: p.get("utm_content") ?? "",
    utm_term: p.get("utm_term") ?? "",
  };
}

export function QuoteWizard({ config = clientConfig }: { config?: RoofClientConfig }) {
  const demo = isDemoMode(config);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<LeadErrors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const submitting = useRef(false);

  const progress = Math.round(((step + 1) / TOTAL_STEPS) * 100);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const focusHeading = () => {
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  const go = (next: number) => {
    setStep(next);
    focusHeading();
  };

  function validateStep(current: number): boolean {
    const next: LeadErrors = {};
    const choice = CHOICE_STEPS[current];
    if (choice && !draft[choice.key]) {
      next[choice.key] = "Välj ett alternativ för att gå vidare.";
    }
    if (current === CHOICE_STEPS.length + 1) {
      const partial = leadSchema.pick({
        postnummer: true,
        fullstandigt_namn: true,
        telefonnummer: true,
        epost: true,
      });
      const res = partial.safeParse(draft);
      if (!res.success) {
        for (const issue of res.error.issues) {
          const key = issue.path[0] as keyof LeadErrors;
          if (!next[key]) next[key] = issue.message;
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleNext() {
    if (!validateStep(step)) return;
    go(Math.min(step + 1, TOTAL_STEPS - 1));
  }

  async function handleSubmit() {
    if (submitting.current) return;
    const res = leadSchema.safeParse({ ...draft, samtycke: draft.samtycke === true });
    if (!res.success) {
      const next: LeadErrors = {};
      for (const issue of res.error.issues) {
        const key = issue.path[0] as keyof LeadErrors;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    submitting.current = true;
    setStatus("sending");

    const lead: Lead = res.data;
    const payload = {
      ...lead,
      submitted_at: new Date().toISOString(),
      source: "noryva_takoffert",
      page_url: typeof window !== "undefined" ? window.location.href : "",
      ...readUtm(),
    };

    if (demo) {
      // Demo-läge: inget nätverksanrop, inga uppgifter lämnar webbläsaren.
      window.setTimeout(() => {
        setStatus("sent");
        submitting.current = false;
        focusHeading();
      }, 500);
      return;
    }

    try {
      const response = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(String(response.status));
      setStatus("sent");
      focusHeading();
    } catch {
      setStatus("error");
    } finally {
      submitting.current = false;
    }
  }

  const summary = useMemo(
    () => [
      { label: "Behov", value: draft.behov },
      { label: "Takets ålder", value: draft.takets_alder },
      { label: "Äger fastigheten", value: draft.ager_fastigheten },
      { label: "Tidpunkt", value: draft.planerad_tidpunkt },
      { label: "Postnummer", value: draft.postnummer },
      { label: "Namn", value: draft.fullstandigt_namn },
      { label: "Telefon", value: draft.telefonnummer },
      { label: "E-post", value: draft.epost },
      { label: "Beskrivning", value: draft.projektbeskrivning || "—" },
    ],
    [draft],
  );

  if (status === "sent") {
    return (
      <div
        className="rounded-2xl border border-border bg-surface p-6 text-center shadow-sm sm:p-10"
        aria-live="polite"
      >
        <CheckCircle2 size={44} className="mx-auto text-primary" aria-hidden="true" />
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="mt-5 text-2xl font-semibold outline-none sm:text-3xl"
        >
          Tack! Din förfrågan är mottagen.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
          {demo
            ? "Detta är ett demosvar. Inga uppgifter skickades och ingenting sparades – sidan är en mall som ännu inte är kopplad till ett takföretag."
            : `${config.companyName} går igenom din förfrågan och hör av sig med nästa steg.`}
        </p>
      </div>
    );
  }

  const choice = CHOICE_STEPS[step];

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            Steg {step + 1} av {TOTAL_STEPS}
          </span>
          <span>{progress}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-valuenow={step + 1}
          aria-label="Formulärets framsteg"
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {choice && (
        <fieldset>
          <legend className="sr-only">{choice.title}</legend>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold outline-none sm:text-2xl"
          >
            {choice.title}
          </h2>
          <div
            role="radiogroup"
            aria-label={choice.title}
            aria-describedby={errors[choice.key] ? `${choice.key}-error` : undefined}
            className="mt-5 grid gap-2.5"
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) return;
              e.preventDefault();
              const opts = choice.options as readonly string[];
              const idx = opts.indexOf(draft[choice.key]);
              const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
              const nextIdx = (((idx < 0 ? 0 : idx + dir) % opts.length) + opts.length) % opts.length;
              set(choice.key, opts[nextIdx] as string);
            }}
          >
            {(choice.options as readonly string[]).map((option) => {
              const selected = draft[choice.key] === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected || (!draft[choice.key] && option === choice.options[0]) ? 0 : -1}
                  onClick={() => set(choice.key, option)}
                  className={cn(
                    "flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left text-base font-medium transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary/8 text-foreground shadow-[var(--glow-accent)]"
                      : "border-border bg-background hover:border-primary/50 hover:bg-surface-2",
                  )}
                >
                  {option}
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-primary bg-primary" : "border-input",
                    )}
                    aria-hidden="true"
                  >
                    {selected && <Check size={13} className="text-primary-foreground" />}
                  </span>
                </button>
              );
            })}
          </div>
          {errors[choice.key] && <ErrorText id={`${choice.key}-error`}>{errors[choice.key]}</ErrorText>}
        </fieldset>
      )}

      {step === CHOICE_STEPS.length && (
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold outline-none sm:text-2xl"
          >
            Vill du beskriva projektet? (frivilligt)
          </h2>
          <label htmlFor="projektbeskrivning" className="mt-5 mb-2 block text-sm font-medium">
            Beskrivning
          </label>
          <textarea
            id="projektbeskrivning"
            name="projektbeskrivning"
            rows={5}
            maxLength={1000}
            value={draft.projektbeskrivning}
            onChange={(e) => set("projektbeskrivning", e.target.value)}
            className={fieldClass}
            placeholder="Till exempel takets storlek, material eller vad du har märkt."
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Skriv inte känsliga personuppgifter här, till exempel personnummer eller uppgifter om
            hälsa. {draft.projektbeskrivning.length}/1000 tecken.
          </p>
        </div>
      )}

      {step === CHOICE_STEPS.length + 1 && (
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold outline-none sm:text-2xl"
          >
            Vart ska återkopplingen skickas?
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field
              label="Postnummer"
              name="postnummer"
              value={draft.postnummer}
              onChange={(v) => set("postnummer", v)}
              error={errors.postnummer}
              autoComplete="postal-code"
              inputMode="numeric"
              placeholder="123 45"
            />
            <Field
              label="För- och efternamn"
              name="fullstandigt_namn"
              value={draft.fullstandigt_namn}
              onChange={(v) => set("fullstandigt_namn", v)}
              error={errors.fullstandigt_namn}
              autoComplete="name"
            />
            <Field
              label="Telefonnummer"
              name="telefonnummer"
              type="tel"
              value={draft.telefonnummer}
              onChange={(v) => set("telefonnummer", v)}
              error={errors.telefonnummer}
              autoComplete="tel"
              inputMode="tel"
            />
            <Field
              label="E-post"
              name="epost"
              type="email"
              value={draft.epost}
              onChange={(v) => set("epost", v)}
              error={errors.epost}
              autoComplete="email"
              inputMode="email"
            />
          </div>
        </div>
      )}

      {step === TOTAL_STEPS - 1 && (
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold outline-none sm:text-2xl"
          >
            Stämmer allt?
          </h2>
          <dl className="mt-5 divide-y divide-border rounded-xl border border-border bg-background">
            {summary.map((row) => (
              <div key={row.label} className="flex gap-4 px-4 py-3 text-sm">
                <dt className="w-36 shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 break-words">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5">
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                name="samtycke"
                checked={draft.samtycke}
                onChange={(e) => set("samtycke", e.target.checked)}
                aria-invalid={!!errors.samtycke}
                aria-describedby={errors.samtycke ? "samtycke-error" : undefined}
                className="mt-0.5 size-5 shrink-0 rounded border-input accent-[var(--color-primary)]"
              />
              <span>
                Jag godkänner att mina uppgifter används för att kontakta mig om den här
                förfrågan. Läs mer i{" "}
                <a href="/integritetspolicy" className="underline underline-offset-2">
                  integritetspolicyn
                </a>
                .
              </span>
            </label>
            {errors.samtycke && <ErrorText id="samtycke-error">{errors.samtycke}</ErrorText>}
          </div>

          {status === "error" && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
            >
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
              <span>
                Förfrågan kunde inte skickas just nu. Kontrollera din uppkoppling och försök igen.
              </span>
            </div>
          )}

          {demo && (
            <p className="mt-5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted-foreground">
              Demo-läge: inget skickas iväg och inga uppgifter sparas.
            </p>
          )}
        </div>
      )}

      <div className="mt-7 flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => go(step - 1)}
            className="inline-flex min-h-[52px] items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={16} /> Tillbaka
          </button>
        )}
        {step < TOTAL_STEPS - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Nästa <ArrowRight size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={status === "sending"}
            className="inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {status === "sending" ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Skickar…
              </>
            ) : (
              <>
                Skicka förfrågan <ArrowRight size={16} />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function ErrorText({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-3 text-sm text-destructive">
      {children}
    </p>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  error,
  type = "text",
  ...rest
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  type?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type">) {
  return (
    <div>
      <label htmlFor={name} className="mb-2 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        className={fieldClass}
        {...rest}
      />
      {error && (
        <p id={`${name}-error`} role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
