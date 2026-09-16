import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  addTestReply,
  createActionFromReply,
  getFunnelSummary,
  listConversations,
  recordLeadOutcome,
} from "@/lib/conversations.functions";
import { OUTCOME_STAGE_LABEL, FUNNEL_ORDER, type OutcomeStage } from "@/lib/ai-sales/funnel";

export const Route = createFileRoute("/_authenticated/admin/konversationer")({
  head: () => ({
    meta: [
      { title: "Konversationer – Noryva" },
      {
        name: "description",
        content: "Interna testsvar, avsiktsklassificering och eskalering i granskningsläge.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Konversationer – Noryva" },
      {
        property: "og:description",
        content: "Interna testsvar, avsiktsklassificering och eskalering i granskningsläge.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConversationsPage,
});

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const btn =
  "rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50";

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warn" }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs ${
        tone === "warn" ? "border-amber-500/40 text-amber-500" : "border-border text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function Funnel() {
  const fetchFunnel = useServerFn(getFunnelSummary);
  const { data } = useQuery({ queryKey: ["funnel"], queryFn: () => fetchFunnel({ data: {} }) });
  if (!data) return null;
  const s = data.summary;

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold">Utfall (funnel)</h2>
      {!s.dataComplete ? (
        <p className="text-sm text-muted-foreground">
          Inga utfall registrerade ännu. Siffror visas först när riktiga steg loggats.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-5">
          {FUNNEL_ORDER.map((stage) => (
            <div key={stage} className="rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">{OUTCOME_STAGE_LABEL[stage]}</p>
              <p className="text-lg font-semibold">{s.counts[stage]}</p>
              <p className="text-xs text-muted-foreground">
                {s.conversion[stage] === null
                  ? "–"
                  : `${Math.round((s.conversion[stage] ?? 0) * 100)}%`}
              </p>
            </div>
          ))}
        </div>
      )}
      {s.counts.lost > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">Förlorade: {s.counts.lost}</p>
      )}
    </section>
  );
}

function ConversationsPage() {
  const queryClient = useQueryClient();
  const fetchConversations = useServerFn(listConversations);
  const addReply = useServerFn(addTestReply);
  const createAction = useServerFn(createActionFromReply);
  const recordOutcome = useServerFn(recordLeadOutcome);

  const [leadId, setLeadId] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => fetchConversations({ data: {} }),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    await queryClient.invalidateQueries({ queryKey: ["funnel"] });
  }

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await task());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Något gick fel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="Konversationer">
      <p className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-500">
        TEST/REVIEW – ingen inkorg är kopplad. Svar matas in manuellt, klassificeras
        deterministiskt och sparas alltid maskerade. Inget skickas ut.
      </p>

      <Funnel />

      <section className="mb-8 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">Mata in testsvar</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <input
            className={field}
            placeholder="Lead-id (UUID)"
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
          />
          <input
            className={field}
            placeholder="Svarstext (testdata)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button
            type="button"
            className={btn}
            disabled={busy || !leadId.trim() || !body.trim()}
            onClick={() =>
              run(async () => {
                const res = await addTestReplySafe();
                return `Svar klassificerat som "${res}".`;
              })
            }
          >
            Klassificera svar
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {notice && <p className="mt-3 text-sm text-muted-foreground">{notice}</p>}
      </section>

      {isLoading && <p className="text-sm text-muted-foreground">Hämtar konversationer …</p>}
      {data && data.conversations.length === 0 && (
        <p className="text-sm text-muted-foreground">Inga konversationer ännu.</p>
      )}

      <div className="space-y-4">
        {(data?.conversations ?? []).map((c: any) => (
          <article key={c.id} className="rounded-xl border border-border bg-card p-5">
            <header className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Lead {String(c.lead_id).slice(0, 8)}</span>
              <Tag>Steg: {c.stage}</Tag>
              <span className="text-xs text-muted-foreground">
                {new Date(c.last_event_at).toLocaleString("sv-SE")}
              </span>
            </header>

            <ul className="space-y-3">
              {c.messages.map((m: any) => (
                <li key={m.id} className="rounded-lg border border-border/60 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Tag>Avsikt: {m.intent}</Tag>
                    <Tag>Säkerhet: {Math.round(Number(m.confidence) * 100)}%</Tag>
                    <Tag>Förslag: {m.suggested_action}</Tag>
                    {m.escalate && <Tag tone="warn">Eskalerat till människa</Tag>}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {m.redacted_body}
                  </p>
                  {m.escalate && m.escalation_reason && (
                    <p className="mt-2 text-xs text-amber-500">{m.escalation_reason}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btn}
                      disabled={busy || Boolean(m.action_id)}
                      onClick={() =>
                        run(async () => {
                          const res = await createAction({ data: { messageId: m.id } });
                          return res.ok
                            ? res.duplicate
                              ? "Åtgärden fanns redan."
                              : "Åtgärdsutkast skapat i granskningsläge."
                            : "Kunde inte skapa åtgärd.";
                        })
                      }
                    >
                      {m.action_id ? "Åtgärd skapad" : "Skapa åtgärdsutkast"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <span className="text-xs text-muted-foreground">Registrera utfall:</span>
              {(["contacted", "replied", "meeting", "won", "lost"] as OutcomeStage[]).map((stage) => (
                <button
                  key={stage}
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const res = await recordOutcome({ data: { leadId: c.lead_id, stage } });
                      return res.duplicate
                        ? "Steget var redan registrerat."
                        : `Utfall registrerat: ${OUTCOME_STAGE_LABEL[stage]}.`;
                    })
                  }
                >
                  {OUTCOME_STAGE_LABEL[stage]}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </AdminShell>
  );

  async function addTestReplySafe() {
    const res = await addReply({ data: { leadId: leadId.trim(), body: body.trim() } });
    setBody("");
    return res.classification.intent;
  }
}
