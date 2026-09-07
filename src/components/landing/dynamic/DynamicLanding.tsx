import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitPublicLead } from "@/lib/public-landing.functions";
import { validateAnswers, type PublicLanding } from "@/lib/landing/schema";

type Props = {
  landing: PublicLanding;
  /** Förhandsgranskning: inget skickas och inga leads skapas. */
  preview?: boolean;
};

export function DynamicLanding({ landing, preview = false }: Props) {
  const submit = useServerFn(submitPublicLead);
  const submissionId = useRef<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [result, setResult] = useState<"delivered" | "sending" | "failed">("delivered");
  const [retrying, setRetrying] = useState(false);

  const setValue = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const disabled = preview || !landing.accepts_leads;

  /** Skickar med samma submission_id och samma svar – servern skapar aldrig en ny förfrågan. */
  async function send() {
    if (!submissionId.current) submissionId.current = crypto.randomUUID();
    const res = await submit({
      data: {
        slug: landing.slug,
        submission_id: submissionId.current,
        consent,
        values,
        company: honeypot,
      },
    });
    return res;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const found = validateAnswers(landing.questions, values, consent);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (disabled) return;

    setStatus("sending");
    try {
      const res = await send();
      if (res.ok) {
        setResult(res.status ?? (res.delivered ? "delivered" : "failed"));
        setStatus("done");
      } else {
        setStatus("idle");
        setMessage(res.message ?? "Något gick fel.");
        if (res.errors) setErrors(res.errors);
      }
    } catch {
      setStatus("idle");
      setMessage("Förfrågan kunde inte skickas. Försök igen.");
    }
  }

  async function onRetry() {
    if (disabled || retrying) return;
    setRetrying(true);
    setMessage("");
    try {
      const res = await send();
      if (res.ok) setResult(res.status ?? (res.delivered ? "delivered" : "failed"));
      else setMessage(res.message ?? "Det gick inte att skicka igen just nu.");
    } catch {
      setMessage("Det gick inte att skicka igen just nu. Försök om en stund.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="lp-light min-h-screen bg-background text-foreground">
      <main className="mx-auto w-full max-w-3xl px-5 py-14 sm:py-20">
        {preview && (
          <p className="mb-6 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
            Förhandsgranskning — inget skickas och inga förfrågningar sparas.
          </p>
        )}
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {landing.name}
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
          {landing.headline || landing.name}
        </h1>
        {landing.description && (
          <p className="mt-4 max-w-2xl text-base text-muted-foreground">{landing.description}</p>
        )}
        {(landing.service_area || landing.contact_phone || landing.contact_email) && (
          <p className="mt-4 text-sm text-muted-foreground">
            {[landing.service_area, landing.contact_phone, landing.contact_email]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        {status === "done" ? (
          <div className="mt-10 rounded-2xl border border-border bg-surface-2 p-6">
            <h2 className="text-xl font-semibold">Tack! Din förfrågan är mottagen.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {delivered
                ? "Vi hör av oss till dig med nästa steg."
                : "Din förfrågan är sparad. Vidarebefordringen till vårt system dröjer just nu, men inget behöver göras om – vi hör av oss."}
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-10 space-y-5" noValidate>
            {!landing.accepts_leads && !preview && (
              <p className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
                Formuläret är inte kopplat till någon mottagare ännu, så det går inte att skicka in
                just nu.
              </p>
            )}

            {landing.questions.map((q) => (
              <div key={q.field_key}>
                <label htmlFor={q.field_key} className="mb-1.5 block text-sm font-medium">
                  {q.label}
                  {q.required && <span aria-hidden> *</span>}
                </label>
                {q.field_type === "select" ? (
                  <select
                    id={q.field_key}
                    value={values[q.field_key] ?? ""}
                    onChange={(e) => setValue(q.field_key, e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base"
                  >
                    <option value="">Välj…</option>
                    {q.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : q.field_type === "textarea" ? (
                  <textarea
                    id={q.field_key}
                    rows={4}
                    value={values[q.field_key] ?? ""}
                    onChange={(e) => setValue(q.field_key, e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base"
                  />
                ) : (
                  <input
                    id={q.field_key}
                    type={q.field_type === "email" ? "email" : q.field_type === "tel" ? "tel" : "text"}
                    value={values[q.field_key] ?? ""}
                    onChange={(e) => setValue(q.field_key, e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base"
                  />
                )}
                {errors[q.field_key] && (
                  <p className="mt-1.5 text-sm text-destructive">{errors[q.field_key]}</p>
                )}
              </div>
            ))}

            {/* Honeypot – dold för människor */}
            <div aria-hidden className="hidden">
              <label htmlFor="company">Företag</label>
              <input
                id="company"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            <div>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 size-4"
                />
                <span>Jag godkänner att bli kontaktad om min förfrågan.</span>
              </label>
              {errors["samtycke"] && (
                <p className="mt-1.5 text-sm text-destructive">{errors["samtycke"]}</p>
              )}
            </div>

            {message && <p className="text-sm text-destructive">{message}</p>}

            <button
              type="submit"
              disabled={disabled || status === "sending"}
              className="w-full rounded-full bg-primary px-6 py-4 text-base font-semibold text-primary-foreground disabled:opacity-60"
            >
              {status === "sending" ? "Skickar…" : landing.cta_label || "Skicka förfrågan"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
