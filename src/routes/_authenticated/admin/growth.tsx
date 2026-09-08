import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin/AdminShell";
import { getGrowthDashboard } from "@/lib/growth.functions";
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
