import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listCustomers, saveCustomer } from "@/lib/admin.functions";
import { INDUSTRY_OPTIONS, INDUSTRY_TEMPLATES, type Industry } from "@/lib/landing/templates";
import { AdminShell } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Kundpanel – Noryva" },
      { name: "description", content: "Intern panel för Noryvas kundsidor och formulär." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Kundpanel – Noryva" },
      { property: "og:description", content: "Intern panel för Noryvas kundsidor och formulär." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminHome,
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function AdminHome() {
  const fetchCustomers = useServerFn(listCustomers);
  const save = useServerFn(saveCustomer);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState<Industry>("tak");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["customers"],
    queryFn: () => fetchCustomers(),
  });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const template = INDUSTRY_TEMPLATES[industry];
    setBusy(true);
    try {
      const res = await save({
        data: {
          name: name.trim(),
          slug: slugify(name),
          industry,
          status: "draft",
          headline: template.headline,
          description: template.description,
          cta_label: template.cta_label,
          contact_email: "",
          contact_phone: "",
          service_area: "",
          recipient_email: "",
          delivery_webhook_url: "",
          questions: template.questions,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      navigate({ to: "/admin/$customerId", params: { customerId: res.id! } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunde inte skapa kunden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="Kunder">
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          {creating ? "Avbryt" : "Ny kund"}
        </button>
        <a
          href="/takoffert"
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-border px-5 py-2.5 text-sm"
        >
          Öppna befintlig takoffert-sida
        </a>
      </div>

      {creating && (
        <form
          onSubmit={onCreate}
          className="mb-10 space-y-4 rounded-2xl border border-border bg-surface-2 p-5"
        >
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
              Kundens namn
            </label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base"
            />
            {name && (
              <p className="mt-1.5 text-xs text-muted-foreground">Webbadress: /offert/{slugify(name)}</p>
            )}
          </div>
          <div>
            <label htmlFor="industry" className="mb-1.5 block text-sm font-medium">
              Bransch
            </label>
            <select
              id="industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value as Industry)}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base"
            >
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Skapar…" : "Skapa som utkast"}
          </button>
        </form>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Hämtar kunder…</p>}
      {loadError && (
        <p className="text-sm text-destructive">
          {loadError instanceof Error && loadError.message.includes("Behörighet")
            ? "Ditt konto saknar behörighet till panelen. Kontakta Noryva för att få den tilldelad."
            : "Kunderna kunde inte hämtas just nu."}
        </p>
      )}

      {data && data.customers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="font-medium">Inga kunder ännu</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Skapa din första kundsida med knappen "Ny kund". Den sparas som utkast tills du väljer att
            publicera.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {data?.customers.map((c: any) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface-2 p-5"
          >
            <div>
              <p className="font-semibold">{c.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {c.industry === "tak" ? "Tak" : "Varuautomater"} · /offert/{c.slug} ·{" "}
                {c.status === "published" ? "Publicerad" : "Utkast"}
              </p>
            </div>
            <Link
              to="/admin/$customerId"
              params={{ customerId: c.id }}
              className="rounded-full border border-border px-4 py-2 text-sm"
            >
              Öppna
            </Link>
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}
