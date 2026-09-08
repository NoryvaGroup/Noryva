import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { listCustomerProfiles, saveCustomerProfile } from "@/lib/crm.functions";
import { customerProfileSchema, type CustomerProfile } from "@/lib/ai-sales/profile";

export const Route = createFileRoute("/_authenticated/admin/profiler")({
  head: () => ({
    meta: [
      { title: "Kundprofiler – Noryva" },
      { name: "description", content: "Ton, språk, uppföljning och bokningsregler per kund." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Kundprofiler – Noryva" },
      {
        property: "og:description",
        content: "Ton, språk, uppföljning och bokningsregler per kund.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilesPage,
});

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function ProfileForm({
  initial,
  customerName,
  onSaved,
}: {
  initial: CustomerProfile;
  customerName: string;
  onSaved: () => Promise<void>;
}) {
  const save = useServerFn(saveCustomerProfile);
  const [profile, setProfile] = useState<CustomerProfile>(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function patch(next: Partial<CustomerProfile>) {
    setProfile((p) => ({ ...p, ...next }));
    setSaved(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = customerProfileSchema.safeParse(profile);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ogiltiga värden.");
      return;
    }
    setBusy(true);
    try {
      await save({ data: parsed.data });
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunde inte spara.");
    } finally {
      setBusy(false);
    }
  }

  const fu = profile.followupRules;
  const booking = profile.bookingRules;

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Ton</span>
          <input className={field} value={profile.tone} onChange={(e) => patch({ tone: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Språk</span>
          <select
            className={field}
            value={profile.language}
            onChange={(e) => patch({ language: e.target.value })}
          >
            <option value="sv">Svenska</option>
            <option value="en">Engelska</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Lead-prefix</span>
          <input
            className={field}
            value={profile.leadPrefix}
            onChange={(e) => patch({ leadPrefix: e.target.value })}
            placeholder="t.ex. VA"
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Uppföljning (timmar till första kontaktförsök)
        </legend>
        <div className="grid gap-4 sm:grid-cols-4">
          {(["HÖG", "NORMAL", "LÅG"] as const).map((p) => (
            <label key={p} className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">{p}</span>
              <input
                type="number"
                min={0}
                className={field}
                value={fu.firstFollowupHours[p]}
                onChange={(e) =>
                  patch({
                    followupRules: {
                      ...fu,
                      firstFollowupHours: {
                        ...fu.firstFollowupHours,
                        [p]: Number(e.target.value) || 0,
                      },
                    },
                  })
                }
              />
            </label>
          ))}
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Max uppföljningar</span>
            <input
              type="number"
              min={0}
              max={10}
              className={field}
              value={fu.maxFollowups}
              onChange={(e) =>
                patch({ followupRules: { ...fu, maxFollowups: Number(e.target.value) || 0 } })
              }
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Bokningsregler (ingen bokning sker i testläge)
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={booking.enabled}
              onChange={(e) => patch({ bookingRules: { ...booking, enabled: e.target.checked } })}
            />
            Förberedd för bokning
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Mötets längd (min)</span>
            <input
              type="number"
              min={5}
              className={field}
              value={booking.meetingLengthMinutes}
              onChange={(e) =>
                patch({
                  bookingRules: {
                    ...booking,
                    meetingLengthMinutes: Number(e.target.value) || 30,
                  },
                })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Bokningslänk</span>
            <input
              className={field}
              value={booking.bookingUrl}
              onChange={(e) => patch({ bookingRules: { ...booking, bookingUrl: e.target.value } })}
            />
          </label>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={profile.aiAssistantEnabled}
          onChange={(e) => patch({ aiAssistantEnabled: e.target.checked })}
        />
        AI-assistent påslagen för {customerName} (endast interna utkast)
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Sparar …" : "Spara profil"}
        </button>
        {saved ? <span className="text-sm text-emerald-500">Sparat.</span> : null}
        {error ? <span className="text-sm text-red-500">{error}</span> : null}
      </div>
    </form>
  );
}

function ProfilesPage() {
  const fetchProfiles = useServerFn(listCustomerProfiles);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["customer-profiles"],
    queryFn: () => fetchProfiles(),
  });

  return (
    <AdminShell title="Kundprofiler">
      <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
        <strong>TEST / REVIEW-läge.</strong> Profilen styr ton, kvalificering och uppföljning i
        interna utkast. Inget mail, SMS eller möte skickas oavsett inställning.
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Laddar …</p> : null}
      {error ? (
        <p className="text-sm text-red-500">
          {error instanceof Error ? error.message : "Kunde inte hämta profiler."}
        </p>
      ) : null}

      <div className="space-y-4">
        {(data?.customers ?? []).map((c) => (
          <article key={c.id} className="rounded-xl border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.industry} · {c.status} · {c.saved ? "profil sparad" : "standardvärden"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    c.profile.aiAssistantEnabled
                      ? "border-emerald-500/40 text-emerald-500"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  AI {c.profile.aiAssistantEnabled ? "på" : "av"}
                </span>
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                >
                  {open === c.id ? "Dölj" : "Redigera"}
                </button>
              </div>
            </div>
            {open === c.id ? (
              <ProfileForm
                initial={c.profile}
                customerName={c.name}
                onSaved={async () => {
                  await queryClient.invalidateQueries({ queryKey: ["customer-profiles"] });
                  await queryClient.invalidateQueries({ queryKey: ["system-readiness"] });
                }}
              />
            ) : null}
          </article>
        ))}
      </div>
    </AdminShell>
  );
}
