import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getGrowthDashboard } from "@/lib/growth.functions";
import {
  approveNurtureReview,
  cancelNurtureReview,
  getNurtureQueue,
  getNurtureReviews,
  refreshNurtureReviews,
} from "@/lib/nurture.functions";
import { NURTURE_STATUS_LABEL, type NurtureStatus } from "@/lib/growth/nurture";
import { EXPERIMENT_TYPE_LABEL, type ExperimentType } from "@/lib/growth/experiments";

export const Route = createFileRoute("/_authenticated/admin/growth")({
  head: () => ({
    meta: [
      { title: "Growth Engine – Noryva" },
      {
        name: "description",
        content: "Intern översikt över AI-kostnad, experiment och optimeringsförslag i granskningsläge.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Growth Engine – Noryva" },
      {
        property: "og:description",
        content: "Intern översikt över AI-kostnad, experiment och optimeringsförslag i granskningsläge.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GrowthPage,
});

function pct(value: number | null | undefined): string {
  return value == null ? "–" : `${Math.round(value * 100)} %`;
}

function usd(value: number | null | undefined): string {
  return value == null ? "–" : `$${value.toFixed(4)}`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function GrowthPage() {
  const fetchDashboard = useServerFn(getGrowthDashboard);
  const { data, isLoading, error } = useQuery({
    queryKey: ["growth-dashboard"],
    queryFn: () => fetchDashboard(),
  });

  return (
    <AdminShell title="Noryva 2.0 – Growth Engine">
      {isLoading ? <p className="text-sm text-muted-foreground">Hämtar data …</p> : null}
      {error ? (
        <p className="text-sm text-destructive">Kunde inte hämta översikten: {(error as Error).message}</p>
      ) : null}

      {data ? (
        <div className="space-y-8">
          <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <p className="font-medium">Läge: {data.flags.mode}</p>
            <p className="text-muted-foreground">
              AI-generering {data.flags.aiEnabled ? "på" : "av"} · Granskning krävs{" "}
              {data.flags.reviewRequired ? "ja" : "nej"} · Automatiska utskick{" "}
              {data.flags.autoSend ? "på" : "av (spärrat i kod)"}. Optimizern rekommenderar endast.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Idag</h2>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Metric label="Leads idag" value={String(data.today.leads)} />
              <Metric label="AI-anrop idag" value={String(data.today.aiCalls)} />
              <Metric label="Hanterade utan AI" value={pct(data.today.deterministicShare)} />
              <Metric label="AI-kostnad idag" value={usd(data.today.estimatedCost)} />
              <Metric label="Kostnad per lead" value={usd(data.today.costPerLead)} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Metric
                label="AI-kostnad denna månad"
                value={usd(data.month.estimatedCost)}
                hint={`Budgetläge: ${data.month.budgetState}`}
              />
              <Metric
                label="Budget (standard)"
                value={`$${data.defaultBudget.dailyLimitUsd}/dag · $${data.defaultBudget.monthlyLimitUsd}/mån`}
                hint="Överskriden budget degraderar full analys till lätt analys och sedan till regler."
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Aktiva experiment</h2>
            {data.reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Inga aktiva experiment ännu. Resultat visas först när experiment körts och utfall registrerats.
              </p>
            ) : (
              <div className="space-y-4">
                {data.reports.map((report: any) => (
                  <div key={report.experiment.id} className="rounded-xl border border-border bg-card p-5">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{report.experiment.name}</p>
                      <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                        {EXPERIMENT_TYPE_LABEL[report.experiment.experiment_type as ExperimentType] ??
                          report.experiment.experiment_type}
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="py-1 pr-3">Variant</th>
                            <th className="py-1 pr-3">Leads</th>
                            <th className="py-1 pr-3">Mötesgrad</th>
                            <th className="py-1 pr-3">Win rate</th>
                            <th className="py-1 pr-3">Intäkt/lead</th>
                            <th className="py-1 pr-3">AI-kostnad/lead</th>
                            <th className="py-1 pr-3">Kostnad/vunnen</th>
                            <th className="py-1">ROI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.metrics.map((m: any) => {
                            const variant = report.variants.find((v: any) => v.id === m.variantId);
                            return (
                              <tr key={m.variantId} className="border-t border-border/60">
                                <td className="py-1.5 pr-3">{variant?.name ?? m.variantId}</td>
                                <td className="py-1.5 pr-3">{m.leads}</td>
                                <td className="py-1.5 pr-3">{pct(m.meetingRate)}</td>
                                <td className="py-1.5 pr-3">{pct(m.winRate)}</td>
                                <td className="py-1.5 pr-3">
                                  {m.revenuePerLead == null ? "–" : m.revenuePerLead.toFixed(0)}
                                </td>
                                <td className="py-1.5 pr-3">{usd(m.aiCostPerLead)}</td>
                                <td className="py-1.5 pr-3">{usd(m.costPerWon)}</td>
                                <td className="py-1.5">{m.roi == null ? "–" : `${Math.round(m.roi * 100)} %`}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">
                      Optimizer: {report.recommendation.reason}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Intent-score per förfrågan</h2>
            {(data.leadStates ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ingen intent-data ännu. Score räknas om automatiskt när utfall registreras.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Förfrågan</th>
                      <th className="px-3 py-2">Score</th>
                      <th className="px-3 py-2">Nivå</th>
                      <th className="px-3 py-2">Motivering</th>
                      <th className="px-3 py-2">Uppdaterad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.leadStates as any[]).map((s) => (
                      <tr key={s.lead_id} className="border-t border-border/60">
                        <td className="px-3 py-2 font-mono">{String(s.lead_id).slice(0, 8)}</td>
                        <td className="px-3 py-2">{s.intent_score}</td>
                        <td className="px-3 py-2">
                          {s.intent_level}
                          {s.intent_terminal ? " (avgjord)" : ""}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{s.intent_reason}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(s.intent_updated_at).toLocaleString("sv-SE")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <NurtureSection />

          <NurtureReviewSection />




          <section>
            <h2 className="mb-3 text-sm font-semibold">Senaste optimizer-rekommendationer</h2>
            {data.recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga sparade rekommendationer ännu.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.recommendations.map((r: any) => (
                  <li key={r.id} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("sv-SE")} · {r.metric} · säkerhet{" "}
                      {Math.round(Number(r.confidence) * 100)} %
                    </p>
                    <p>{r.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </AdminShell>
  );
}

/**
 * Nurture-kö: LÅG/NORMAL-leads som får billig uppföljning i stället för att
 * släppas. Vyn är läsbar översikt – inget skickas härifrån.
 */
function NurtureSection() {
  const fetchQueue = useServerFn(getNurtureQueue);
  const { data, isLoading, error } = useQuery({
    queryKey: ["nurture-queue"],
    queryFn: () => fetchQueue(),
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Uppföljningskö (nurture)</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Endast LÅG och NORMAL hamnar här. Inget mail, SMS eller möte lämnar systemet – status
        &quot;{NURTURE_STATUS_LABEL.sent}&quot; betyder markerad i test/granskning.
      </p>
      {isLoading ? <p className="text-sm text-muted-foreground">Hämtar kön …</p> : null}
      {error ? (
        <p className="text-sm text-destructive">Kunde inte hämta kön: {(error as Error).message}</p>
      ) : null}
      {data && data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inga leads i uppföljningskön ännu.</p>
      ) : null}
      {data && data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Intent</th>
                <th className="px-3 py-2">Varför</th>
                <th className="px-3 py-2">Frågor</th>
                <th className="px-3 py-2">Nästa steg</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((n: any) => (
                <tr key={n.lead_id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-mono">{String(n.lead_id).slice(0, 8)}</td>
                  <td className="px-3 py-2">
                    {NURTURE_STATUS_LABEL[n.status as NurtureStatus] ?? n.status}
                    {n.human_takeover ? " · människa" : ""}
                    {n.upgrade_signal ? " · uppgradering" : ""}
                  </td>
                  <td className="px-3 py-2">{n.intent_level}</td>
                  <td className="px-3 py-2 text-muted-foreground">{n.reason}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {(n.questions ?? []).length === 0 ? (
                      "–"
                    ) : (
                      <ul className="list-disc pl-4">
                        {(n.questions as string[]).map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {n.next_step_at ? new Date(n.next_step_at).toLocaleString("sv-SE") : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending_review: "Väntar på granskning",
  blocked: "Spärrad",
  approved: "Godkänd – väntar på utskick",
  claimed: "Hämtad för utskick",
  sent: "Skickad",
  failed: "Misslyckades (inget mail gick iväg)",
  unknown: "Okänt utfall – kontrollera manuellt",
  cancelled: "Avslagen",
};

/**
 * Granskningskö: här står exakt det mail som skickas, till exakt den mottagare
 * som finns lagrad på förfrågan. Ingenting skickas förrän en administratör
 * trycker "Godkänn och skicka". Avslag skickar aldrig något.
 */
function NurtureReviewSection() {
  const queryClient = useQueryClient();
  const fetchReviews = useServerFn(getNurtureReviews);
  const approve = useServerFn(approveNurtureReview);
  const cancel = useServerFn(cancelNurtureReview);
  const refresh = useServerFn(refreshNurtureReviews);
  const [notice, setNotice] = useState<string>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["nurture-reviews"],
    queryFn: () => fetchReviews(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["nurture-reviews"] });
    void queryClient.invalidateQueries({ queryKey: ["nurture-queue"] });
  };

  const refreshMutation = useMutation({
    mutationFn: () => refresh(),
    onSuccess: (r: any) => {
      setNotice(`Uppdaterad: ${r.created} nya, ${r.updated} ändrade, ${r.skipped} hoppades över.`);
      invalidate();
    },
    onError: (e: Error) => setNotice(`Kunde inte uppdatera kön: ${e.message}`),
  });

  const approveMutation = useMutation({
    mutationFn: (vars: { reviewId: string; fingerprint: string }) => approve({ data: vars }),
    onSuccess: (r: any) => {
      setNotice(r.message);
      invalidate();
    },
    onError: (e: Error) => setNotice(`Godkännandet gick inte igenom: ${e.message}`),
  });

  const cancelMutation = useMutation({
    mutationFn: (vars: { reviewId: string }) => cancel({ data: vars }),
    onSuccess: () => {
      setNotice("Avslagen. Inget mail skickades.");
      invalidate();
    },
    onError: (e: Error) => setNotice(`Kunde inte avslå: ${e.message}`),
  });

  const busy = approveMutation.isPending || cancelMutation.isPending || refreshMutation.isPending;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Granskning före utskick</h2>
        <button
          type="button"
          onClick={() => refreshMutation.mutate()}
          disabled={busy}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {refreshMutation.isPending ? "Uppdaterar …" : "Uppdatera förfallna"}
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Mailet nedan är exakt det som skickas. Mottagaren kommer från förfrågan – den går inte att
        ändra här. Svar går till info@noryva.se.
        {data ? (
          <>
            {" "}
            Utskicksbrygga: {data.bridgeConfigured ? "konfigurerad" : "saknas"} · Externa utskick:{" "}
            {data.externalSendEnabled ? "på" : "av (endast testmottagare)"}.
          </>
        ) : null}
      </p>

      {notice ? <p className="mb-3 text-xs text-foreground">{notice}</p> : null}
      {isLoading ? <p className="text-sm text-muted-foreground">Hämtar granskningskön …</p> : null}
      {error ? (
        <p className="text-sm text-destructive">Kunde inte hämta kön: {(error as Error).message}</p>
      ) : null}
      {data && data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inget väntar på granskning just nu.</p>
      ) : null}

      <div className="space-y-3">
        {(data?.items ?? []).map((r: any) => (
          <div key={r.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {REVIEW_STATUS_LABEL[r.status] ?? r.status}
              </span>
              <span>Förfrågan {String(r.lead_id).slice(0, 8)}</span>
              <span>{r.company_name || "Okänd kund"}</span>
              <span>
                Intent {r.intent_level}
                {typeof r.intent_score === "number" ? ` (${r.intent_score})` : ""}
              </span>
              <span>Planerad {new Date(r.due_at).toLocaleString("sv-SE")}</span>
              {r.human_takeover ? (
                <span className="font-medium text-amber-600">Mänsklig handläggning</span>
              ) : null}
            </div>

            {r.reason ? (
              <p className="mt-2 text-xs text-muted-foreground">Bedömning: {r.reason}</p>
            ) : null}

            {r.blocked_reason ? (
              <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                Spärrad: {r.blocked_reason}
              </p>
            ) : null}


            <dl className="mt-3 space-y-1 text-xs">
              <div>
                <dt className="inline text-muted-foreground">Till: </dt>
                <dd className="inline font-medium">{r.recipient_email || "– saknas –"}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Ämne: </dt>
                <dd className="inline font-medium">{r.subject || "– saknas –"}</dd>
              </div>
            </dl>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-xs">
              {r.body || "– ingen text –"}
            </pre>

            {(r.questions ?? []).length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                {(r.questions as string[]).map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            ) : null}

            {r.transport_message_id ? (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                Meddelande-id: {r.transport_message_id}
              </p>
            ) : null}
            {r.failure_reason ? (
              <p className="mt-2 text-xs text-destructive">{r.failure_reason}</p>
            ) : null}

            {r.status === "pending_review" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    approveMutation.mutate({ reviewId: r.id, fingerprint: r.content_fingerprint })
                  }
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Godkänn och skicka
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => cancelMutation.mutate({ reviewId: r.id })}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  Avslå
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
