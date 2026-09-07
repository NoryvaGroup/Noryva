import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { DynamicLanding } from "@/components/landing/dynamic/DynamicLanding";
import { deleteCustomer, getCustomer, listLeads, saveCustomer } from "@/lib/admin.functions";
import {
  INDUSTRY_TEMPLATES,
  QUESTION_TYPE_LABELS,
  type Industry,
  type QuestionDraft,
  type QuestionType,
} from "@/lib/landing/templates";
import type { PublicLanding } from "@/lib/landing/schema";

export const Route = createFileRoute("/_authenticated/admin/$customerId")({
  head: () => ({
    meta: [
      { title: "Redigera kundsida – Noryva" },
      { name: "description", content: "Redigera innehåll, formulär och publicering för en kundsida." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Redigera kundsida – Noryva" },
      {
        property: "og:description",
        content: "Redigera innehåll, formulär och publicering för en kundsida.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EditCustomer,
});

type FormState = {
  name: string;
  slug: string;
  industry: Industry;
  status: "draft" | "published";
  headline: string;
  description: string;
  cta_label: string;
  contact_email: string;
  contact_phone: string;
  service_area: string;
  recipient_email: string;
  delivery_webhook_url: string;
};

const field =
  "w-full rounded-xl border border-border bg-background px-4 py-3 text-base";
const labelCls = "mb-1.5 block text-sm font-medium";

function EditCustomer() {
  const { customerId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchCustomer = useServerFn(getCustomer);
  const fetchLeads = useServerFn(listLeads);
  const save = useServerFn(saveCustomer);
  const remove = useServerFn(deleteCustomer);

  const { data, isLoading, error } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => fetchCustomer({ data: { id: customerId } }),
  });
  const leadsQuery = useQuery({
    queryKey: ["leads", customerId],
    queryFn: () => fetchLeads({ data: { customerId } }),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!data) return;
    const c = data.customer as any;
    setForm({
      name: c.name,
      slug: c.slug,
      industry: c.industry,
      status: c.status,
      headline: c.headline ?? "",
      description: c.description ?? "",
      cta_label: c.cta_label ?? "Skicka förfrågan",
      contact_email: c.contact_email ?? "",
      contact_phone: c.contact_phone ?? "",
      service_area: c.service_area ?? "",
      recipient_email: c.recipient_email ?? "",
      delivery_webhook_url: c.delivery_webhook_url ?? "",
    });
    setQuestions(
      (data.questions as any[]).map((q, i) => ({
        field_key: q.field_key,
        label: q.label,
        field_type: q.field_type as QuestionType,
        options: q.options ?? [],
        required: q.required,
        sort_order: i,
      })),
    );
  }, [data]);

  if (isLoading || !form) {
    return (
      <AdminShell title="Kundsida">
        <p className="text-sm text-muted-foreground">
          {error ? "Kunde inte hämta kunden." : "Hämtar…"}
        </p>
      </AdminShell>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const publicUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/offert/${form.slug}`;

  const previewLanding: PublicLanding = {
    slug: form.slug,
    name: form.name,
    industry: form.industry,
    schema_version: 1,
    headline: form.headline,
    description: form.description,
    cta_label: form.cta_label,
    contact_email: form.contact_email,
    contact_phone: form.contact_phone,
    service_area: form.service_area,
    accepts_leads: false,
    questions: questions.map((q) => ({
      field_key: q.field_key,
      label: q.label,
      field_type: q.field_type,
      options: q.options,
      required: q.required,
    })),
  };

  async function onSave(nextStatus?: "draft" | "published") {
    if (!form) return;
    setBusy(true);
    setMessage("");
    try {
      await save({
        data: {
          id: customerId,
          ...form,
          status: nextStatus ?? form.status,
          questions: questions.map((q, i) => ({ ...q, sort_order: i })),
        },
      });
      if (nextStatus) set("status", nextStatus);
      await queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      setMessage("Sparat.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Kunde inte spara.");
    } finally {
      setBusy(false);
    }
  }

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function moveQuestion(index: number, delta: number) {
    setQuestions((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <AdminShell title={form.name}>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <span className="rounded-full border border-border px-3 py-1.5 text-xs">
          {form.status === "published" ? "Publicerad" : "Utkast"}
        </span>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="rounded-full border border-border px-4 py-2 text-sm"
        >
          {showPreview ? "Stäng förhandsgranskning" : "Förhandsgranska"}
        </button>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="rounded-full border border-border px-4 py-2 text-sm"
        >
          {copied ? "Länk kopierad" : "Kopiera länk"}
        </button>
        {form.status === "published" && (
          <a
            href={`/offert/${form.slug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-border px-4 py-2 text-sm"
          >
            Öppna sidan
          </a>
        )}
      </div>

      {showPreview && (
        <div className="mb-10 overflow-hidden rounded-2xl border border-border">
          <DynamicLanding landing={previewLanding} preview />
        </div>
      )}

      <section className="space-y-5 rounded-2xl border border-border bg-surface-2 p-5">
        <h2 className="text-lg font-semibold">Innehåll</h2>
        <div>
          <label className={labelCls} htmlFor="c-name">Kundens namn</label>
          <input id="c-name" className={field} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="c-slug">Webbadress (efter /offert/)</label>
          <input id="c-slug" className={field} value={form.slug} onChange={(e) => set("slug", e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="c-headline">Rubrik</label>
          <input
            id="c-headline"
            className={field}
            value={form.headline}
            onChange={(e) => set("headline", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="c-desc">Beskrivning</label>
          <textarea
            id="c-desc"
            rows={3}
            className={field}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="c-cta">Knapptext</label>
          <input id="c-cta" className={field} value={form.cta_label} onChange={(e) => set("cta_label", e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="c-area">Område (visas publikt)</label>
            <input id="c-area" className={field} value={form.service_area} onChange={(e) => set("service_area", e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="c-phone">Telefon (visas publikt)</label>
            <input id="c-phone" className={field} value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="c-email">E-post (visas publikt)</label>
            <input id="c-email" className={field} value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
          </div>
        </div>
      </section>

      <section className="mt-8 space-y-5 rounded-2xl border border-border bg-surface-2 p-5">
        <div>
          <h2 className="text-lg font-semibold">Mottagare och leverans</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Dessa uppgifter är interna och visas aldrig på den publika sidan.
          </p>
        </div>
        <div>
          <label className={labelCls} htmlFor="c-recipient">Mottagarens e-post</label>
          <input
            id="c-recipient"
            className={field}
            value={form.recipient_email}
            onChange={(e) => set("recipient_email", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="c-hook">Integrationsadress (https)</label>
          <input
            id="c-hook"
            className={field}
            value={form.delivery_webhook_url}
            onChange={(e) => set("delivery_webhook_url", e.target.value)}
          />
          {!form.delivery_webhook_url && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              Inte ansluten — formuläret tar inte emot förfrågningar förrän en adress är angiven.
            </p>
          )}
        </div>
      </section>

      <section className="mt-8 space-y-4 rounded-2xl border border-border bg-surface-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Frågor i formuläret</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setQuestions((prev) => [
                  ...prev,
                  {
                    field_key: `fraga_${prev.length + 1}`,
                    label: "Ny fråga",
                    field_type: "text",
                    options: [],
                    required: false,
                    sort_order: prev.length,
                  },
                ])
              }
              className="rounded-full border border-border px-4 py-2 text-sm"
            >
              Lägg till fråga
            </button>
            <button
              type="button"
              onClick={() => setQuestions(INDUSTRY_TEMPLATES[form.industry].questions)}
              className="rounded-full border border-border px-4 py-2 text-sm"
            >
              Återställ mall
            </button>
          </div>
        </div>

        {questions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Inga frågor ännu. Lägg till en fråga eller återställ branschmallen.
          </p>
        )}

        {questions.map((q, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor={`q-label-${i}`}>Frågetext</label>
                <input
                  id={`q-label-${i}`}
                  className={field}
                  value={q.label}
                  onChange={(e) => updateQuestion(i, { label: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor={`q-type-${i}`}>Typ</label>
                <select
                  id={`q-type-${i}`}
                  className={field}
                  value={q.field_type}
                  onChange={(e) => updateQuestion(i, { field_type: e.target.value as QuestionType })}
                >
                  {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor={`q-key-${i}`}>Fältnyckel (intern)</label>
              <input
                id={`q-key-${i}`}
                className={field}
                value={q.field_key}
                onChange={(e) => updateQuestion(i, { field_key: e.target.value })}
              />
            </div>
            {q.field_type === "select" && (
              <div>
                <label className={labelCls} htmlFor={`q-opt-${i}`}>Alternativ (ett per rad)</label>
                <textarea
                  id={`q-opt-${i}`}
                  rows={3}
                  className={field}
                  value={q.options.join("\n")}
                  onChange={(e) =>
                    updateQuestion(i, {
                      options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={(e) => updateQuestion(i, { required: e.target.checked })}
                />
                Obligatorisk
              </label>
              <button type="button" onClick={() => moveQuestion(i, -1)} className="text-sm underline">
                Flytta upp
              </button>
              <button type="button" onClick={() => moveQuestion(i, 1)} className="text-sm underline">
                Flytta ner
              </button>
              <button
                type="button"
                onClick={() => setQuestions((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-sm text-destructive underline"
              >
                Ta bort
              </button>
            </div>
          </div>
        ))}
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave()}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Sparar…" : "Spara"}
        </button>
        {form.status === "draft" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave("published")}
            className="rounded-full border border-border px-5 py-2.5 text-sm"
          >
            Publicera
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave("draft")}
            className="rounded-full border border-border px-5 py-2.5 text-sm"
          >
            Avpublicera
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("Ta bort kunden och alla dess förfrågningar?")) return;
            await remove({ data: { id: customerId } });
            await queryClient.invalidateQueries({ queryKey: ["customers"] });
            navigate({ to: "/admin" });
          }}
          className="text-sm text-destructive underline"
        >
          Ta bort kund
        </button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Senaste förfrågningar</h2>
        {leadsQuery.data && leadsQuery.data.leads.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">Inga förfrågningar ännu.</p>
        )}
        <ul className="mt-4 space-y-3">
          {leadsQuery.data?.leads.map((lead: any) => (
            <li key={lead.id} className="rounded-2xl border border-border bg-surface-2 p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2 text-muted-foreground">
                <span>{new Date(lead.created_at).toLocaleString("sv-SE")}</span>
                <span>
                  {lead.delivery_status === "delivered"
                    ? "Levererad"
                    : lead.delivery_status === "failed"
                      ? `Misslyckad leverans${lead.delivery_error ? `: ${lead.delivery_error}` : ""}`
                      : "Väntar"}
                </span>
              </div>
              <dl className="mt-3 grid gap-1 sm:grid-cols-2">
                {Object.entries(lead.payload as Record<string, unknown>).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline text-muted-foreground">{k}: </dt>
                    <dd className="inline">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </AdminShell>
  );
}
