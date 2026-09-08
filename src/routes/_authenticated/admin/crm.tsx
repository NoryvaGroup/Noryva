import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReadinessPanel } from "@/components/admin/ReadinessPanel";
import {
  createSalesAction,
  executeSalesActionTest,
  listAuditEvents,
  listLeadOverview,
  transitionSalesAction,
} from "@/lib/crm.functions";
import { generateAssistantRun } from "@/lib/ai-sales.functions";
import { ACTION_STATUS_LABEL, ACTION_TYPE_LABEL, type ActionType } from "@/lib/ai-sales/actions";


export const Route = createFileRoute("/_authenticated/admin/crm")({
  head: () => ({
    meta: [
      { title: "Lead-CRM – Noryva" },
      { name: "description", content: "Internt CRM för leads, kvalificering och AI-utkast." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Lead-CRM – Noryva" },
      { property: "og:description", content: "Internt CRM för leads, kvalificering och AI-utkast." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CrmPage,
});

const ACTION_CHOICES: ActionType[] = [
  "send_email",
  "schedule_followup",
  "request_information",
  "handoff_to_human",
  "update_crm",
  "book_meeting",
];

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "accent" | "warn" | "ok";
}) {
  const tones = {
    muted: "border-border text-muted-foreground",
    accent: "border-primary/40 text-primary",
    warn: "border-amber-500/40 text-amber-500",
    ok: "border-emerald-500/40 text-emerald-500",
  } as const;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
  );
}

function CrmPage() {
  const fetchLeads = useServerFn(listLeadOverview);
  const fetchEvents = useServerFn(listAuditEvents);
  const create = useServerFn(createSalesAction);
  const transition = useServerFn(transitionSalesAction);
  const executeTest = useServerFn(executeSalesActionTest);
  const generateRun = useServerFn(generateAssistantRun);

  const queryClient = useQueryClient();

  const [openLead, setOpenLead] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["crm-leads"],
    queryFn: () => fetchLeads({ data: {} }),
  });

  const { data: audit } = useQuery({
    queryKey: ["crm-audit", openLead],
    queryFn: () => fetchEvents({ data: openLead ? { leadId: openLead } : {} }),
    enabled: Boolean(openLead),
  });

  async function run(fn: () => Promise<{ ok?: boolean; message?: string }>) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fn();
      if (res && res.ok === false) setMessage(res.message ?? "Åtgärden gick inte att utföra.");
      await queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      await queryClient.invalidateQueries({ queryKey: ["crm-audit"] });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Något gick fel.");
    } finally {
      setBusy(false);
    }
  }

  const leads = data?.leads ?? [];

  return (
    <AdminShell title="Lead-CRM">
      <ReadinessPanel />
      <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
        <strong>TEST / REVIEW-läge.</strong> Inga mail, SMS eller bokningar lämnar systemet. Alla
        AI-förslag måste godkännas av en människa och utförs endast som testkörning som loggas.
      </div>


      {message ? (
        <p className="mb-5 rounded-lg border border-border px-4 py-2 text-sm">{message}</p>
      ) : null}

      {isLoading ? <p className="text-sm text-muted-foreground">Laddar leads …</p> : null}
      {error ? (
        <p className="text-sm text-red-500">
          {error instanceof Error ? error.message : "Kunde inte hämta leads."}
        </p>
      ) : null}
      {!isLoading && leads.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inga förfrågningar ännu.</p>
      ) : null}

      <div className="space-y-4">
        {leads.map((lead: any) => {
          const open = openLead === lead.id;
          const q = lead.qualification;
          return (
            <article key={lead.id} className="rounded-xl border border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {lead.customerName} · <span className="text-muted-foreground">{lead.reference}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {lead.summary || "Ingen sammanfattning"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={q.priority === "HÖG" ? "accent" : "muted"}>
                    Prioritet {q.priority}
                  </Badge>
                  <Badge>
                    {q.source === "unscored" ? "Ej scorad" : `${q.score} p · ${q.qualification}`}
                  </Badge>
                  <Badge tone={lead.deliveryStatus === "delivered" ? "ok" : "warn"}>
                    {lead.deliveryStatus}
                  </Badge>
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => setOpenLead(open ? null : lead.id)}
                  >
                    {open ? "Dölj" : "Öppna"}
                  </button>
                </div>
              </div>

              {open ? (
                <div className="mt-5 space-y-6 border-t border-border pt-5">
                  <section>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold">AI-bedömning</h2>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg border border-primary px-3 py-1 text-sm text-primary disabled:opacity-50"
                          onClick={() =>
                            run(async () => {
                              const res: any = await generateRun({ data: { leadId: lead.id } });
                              if (res?.ok === false) return res;
                              setMessage(
                                res?.usedFallback
                                  ? "Utkast skapat med reservlogik. Inget mail skickades."
                                  : "AI-utkast skapat. Inget mail skickades.",
                              );
                              return { ok: true };
                            })
                          }
                        >
                          {lead.run ? "Generera nytt AI-utkast" : "Generera AI-utkast"}
                        </button>
                        <Link
                          to="/admin/ai-assistent"
                          search={{ lead: lead.id }}
                          className="rounded-lg border border-border px-3 py-1 text-sm"
                        >
                          Öppna i granskningskön
                        </Link>
                      </div>
                    </div>
                    {lead.run ? (
                      <div className="space-y-2 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="accent">{lead.run.action}</Badge>
                          <Badge>{lead.run.contact_speed}</Badge>
                          <Badge>Granskning: {lead.run.review_status}</Badge>
                          {lead.run.human_takeover ? (
                            <Badge tone="warn">Mänsklig handläggning</Badge>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground">{lead.run.strategy_reason}</p>
                        <p className="font-medium">{lead.run.subject}</p>
                        <pre className="whitespace-pre-wrap rounded-lg border border-border p-3 text-xs">
                          {lead.run.email_draft}
                        </pre>
                        {(lead.run.followup_questions ?? []).length > 0 ? (
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {lead.run.followup_questions.map((f: string) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Ingen AI-bedömning ännu – generera ett utkast direkt härifrån.
                      </p>
                    )}
                  </section>


                  <section>
                    <h2 className="mb-2 text-sm font-semibold">Skapa åtgärd (utkast)</h2>
                    <div className="flex flex-wrap gap-2">
                      {ACTION_CHOICES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          disabled={busy}
                          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary disabled:opacity-50"
                          onClick={() =>
                            run(() =>
                              create({
                                data: {
                                  leadId: lead.id,
                                  actionType: type,
                                  subject: type === "send_email" ? (lead.run?.subject ?? "") : "",
                                  body: type === "send_email" ? (lead.run?.email_draft ?? "") : "",
                                  strategyReason: lead.run?.strategy_reason ?? "",
                                  followupQuestions: lead.run?.followup_questions ?? [],
                                  runId: lead.run?.id ?? null,
                                },
                              }),
                            )
                          }
                        >
                          {ACTION_TYPE_LABEL[type]}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h2 className="mb-2 text-sm font-semibold">Åtgärder</h2>
                    {lead.actions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Inga åtgärder ännu.</p>
                    ) : (
                      <ul className="space-y-3">
                        {lead.actions.map((a: any) => (
                          <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone="accent">{ACTION_TYPE_LABEL[a.action_type as ActionType]}</Badge>
                              <Badge tone={a.status === "executed" ? "ok" : "muted"}>
                                {ACTION_STATUS_LABEL[a.status as keyof typeof ACTION_STATUS_LABEL]}
                              </Badge>
                              <Badge tone="warn">Läge: {a.execution_mode}</Badge>
                              {a.scheduled_for ? (
                                <Badge>Planerad {new Date(a.scheduled_for).toLocaleString("sv-SE")}</Badge>
                              ) : null}
                            </div>
                            {a.subject ? <p className="mt-2 font-medium">{a.subject}</p> : null}
                            {a.execution_result?.wouldHaveDone ? (
                              <p className="mt-2 text-muted-foreground">
                                Testkörning: {a.execution_result.wouldHaveDone} (inget skickades)
                              </p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {a.status === "draft" ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="rounded-lg border border-border px-3 py-1 disabled:opacity-50"
                                    onClick={() =>
                                      run(() => transition({ data: { id: a.id, status: "review" } }))
                                    }
                                  >
                                    Till granskning
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="rounded-lg border border-border px-3 py-1 disabled:opacity-50"
                                    onClick={() =>
                                      run(() => transition({ data: { id: a.id, status: "rejected" } }))
                                    }
                                  >
                                    Avvisa
                                  </button>
                                </>
                              ) : null}
                              {a.status === "review" ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="rounded-lg border border-primary px-3 py-1 text-primary disabled:opacity-50"
                                    onClick={() =>
                                      run(() => transition({ data: { id: a.id, status: "approved" } }))
                                    }
                                  >
                                    Godkänn
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="rounded-lg border border-border px-3 py-1 disabled:opacity-50"
                                    onClick={() =>
                                      run(() => transition({ data: { id: a.id, status: "rejected" } }))
                                    }
                                  >
                                    Avvisa
                                  </button>
                                </>
                              ) : null}
                              {a.status === "approved" ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="rounded-lg border border-border px-3 py-1 disabled:opacity-50"
                                  onClick={() => run(() => executeTest({ data: { id: a.id } }))}
                                >
                                  Testkör (skickar inget)
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <h2 className="mb-2 text-sm font-semibold">Händelselogg</h2>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {(audit?.events ?? []).map((e: any) => (
                        <li key={e.id}>
                          {new Date(e.created_at).toLocaleString("sv-SE")} · {e.actor} · {e.event_type}
                        </li>
                      ))}
                      {(audit?.events ?? []).length === 0 ? <li>Inga händelser ännu.</li> : null}
                    </ul>
                  </section>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </AdminShell>
  );
}
