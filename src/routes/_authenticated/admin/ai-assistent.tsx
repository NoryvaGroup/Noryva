import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReadinessPanel } from "@/components/admin/ReadinessPanel";
import {
  generateAssistantRun,
  getAiSalesFlags,
  listAssistantRuns,
  setAssistantReviewStatus,
  updateAssistantDraft,
} from "@/lib/ai-sales.functions";

export const Route = createFileRoute("/_authenticated/admin/ai-assistent")({
  validateSearch: (search: Record<string, unknown>): { lead?: string } =>
    typeof search["lead"] === "string" ? { lead: search["lead"] as string } : {},


  head: () => ({
    meta: [
      { title: "AI-säljassistent (test) – Noryva" },
      {
        name: "description",
        content: "Intern granskningskö för AI-genererade säljutkast i testläge.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "AI-säljassistent (test) – Noryva" },
      {
        property: "og:description",
        content: "Intern granskningskö för AI-genererade säljutkast i testläge.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AiAssistantQueue,
});

type Run = Record<string, any>;

const STATUS_LABEL: Record<string, string> = {
  draft: "Utkast",
  approved: "Godkänt",
  rejected: "Avvisat",
  sent: "Skickat",
};

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" | "warn" }) {
  const tones: Record<string, string> = {
    muted: "border-border text-muted-foreground",
    accent: "border-primary/40 text-primary",
    warn: "border-destructive/40 text-destructive",
  };
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
  );
}

function AiAssistantQueue() {
  const queryClient = useQueryClient();
  const fetchRuns = useServerFn(listAssistantRuns);
  const fetchFlags = useServerFn(getAiSalesFlags);
  const generate = useServerFn(generateAssistantRun);
  const setStatus = useServerFn(setAssistantReviewStatus);
  const saveDraft = useServerFn(updateAssistantDraft);

  const [leadId, setLeadId] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const flags = useQuery({ queryKey: ["ai-flags"], queryFn: () => fetchFlags() });
  const runs = useQuery({
    queryKey: ["ai-runs"],
    queryFn: () => fetchRuns({ data: {} }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai-runs"] });

  const generateMutation = useMutation({
    mutationFn: (id: string) => generate({ data: { leadId: id } }),
    onSuccess: async (res: any) => {
      setNotice(
        res.ok
          ? res.usedFallback
            ? `Utkast skapat med reservlogik (${res.generationError}).`
            : "Utkast skapat."
          : res.message,
      );
      await refresh();
    },
    onError: (e: unknown) => setNotice(e instanceof Error ? e.message : "Något gick fel."),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; reviewStatus: "approved" | "rejected" | "draft" }) =>
      setStatus({ data: input }),
    onSuccess: async () => {
      setNotice("Status uppdaterad. Inget mail har skickats.");
      await refresh();
    },
  });

  const draftMutation = useMutation({
    mutationFn: (input: { id: string; subject: string; emailDraft: string }) =>
      saveDraft({ data: input }),
    onSuccess: async () => {
      setEditing(null);
      setNotice("Utkastet sparat. Inget mail har skickats.");
      await refresh();
    },
  });

  const f = (flags.data as any)?.flags;
  const list: Run[] = ((runs.data as any)?.runs ?? []) as Run[];
  const tableMissing = Boolean((runs.data as any)?.tableMissing);

  return (
    <AdminShell title="AI-säljassistent">
      <div className="mb-8 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">TEST / REVIEW-läge</Badge>
          <Badge>Auto-send: AV</Badge>
          <Badge>Granskning krävs</Badge>
          {f && !f.enabled ? <Badge tone="warn">Assistenten är avstängd</Badge> : null}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Assistenten skapar endast interna utkast. Inga mail skickas, inga leads kontaktas och
          inga personuppgifter skickas till modellen.
        </p>
      </div>

      <div className="mb-8 rounded-lg border border-border p-5">
        <h2 className="mb-3 text-sm font-semibold">Skapa utkast för en förfrågan</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            placeholder="Lead-id (uuid)"
            className="w-80 max-w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!leadId || generateMutation.isPending}
            onClick={() => generateMutation.mutate(leadId.trim())}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {generateMutation.isPending ? "Analyserar…" : "Analysera lead"}
          </button>
        </div>
        {notice ? <p className="mt-3 text-sm text-muted-foreground">{notice}</p> : null}
        {tableMissing ? (
          <p className="mt-3 text-sm text-destructive">
            Historiktabellen ai_sales_assistant_runs saknas i databasen. Kör migrationen innan
            kön kan användas.
          </p>
        ) : null}
      </div>

      <h2 className="mb-4 text-sm font-semibold">Granskningskö</h2>
      {runs.isLoading ? <p className="text-sm text-muted-foreground">Hämtar…</p> : null}
      {!runs.isLoading && list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inga utkast ännu.</p>
      ) : null}

      <div className="space-y-5">
        {list.map((run) => (
          <article key={run["id"]} className="rounded-lg border border-border bg-card p-5">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">{run["subject"]}</div>
                <div className="text-xs text-muted-foreground">
                  Lead {String(run["lead_id"]).slice(0, 8)} · Kund{" "}
                  {String(run["customer_id"]).slice(0, 8)} ·{" "}
                  {new Date(run["created_at"]).toLocaleString("sv-SE")}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="accent">{run["action"]}</Badge>
                <Badge>{run["contact_speed"]}</Badge>
                <Badge>{STATUS_LABEL[run["review_status"]] ?? run["review_status"]}</Badge>
                {run["human_takeover"] ? <Badge tone="warn">Mänsklig handläggning</Badge> : null}
              </div>
            </header>

            {editing === run["id"] ? (
              <div className="space-y-3">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      draftMutation.mutate({ id: run["id"], subject, emailDraft: body })
                    }
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                  >
                    Spara utkast
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap rounded-md border border-border bg-background p-4 text-sm">
                {run["email_draft"]}
              </pre>
            )}

            {(run["followup_questions"] ?? []).length > 0 ? (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Följdfrågor
                </h3>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {(run["followup_questions"] as string[]).map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="mt-4 text-sm text-muted-foreground">{run["strategy_reason"]}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Säkerhet: {Number(run["confidence"]).toFixed(2)} ·{" "}
              {(run["safety_flags"] as string[])?.length
                ? (run["safety_flags"] as string[]).join(", ")
                : "inga flaggor"}{" "}
              · {run["model"]} / {run["prompt_version"]}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  statusMutation.mutate({ id: run["id"], reviewStatus: "approved" })
                }
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                Godkänn
              </button>
              <button
                type="button"
                onClick={() =>
                  statusMutation.mutate({ id: run["id"], reviewStatus: "rejected" })
                }
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                Avvisa
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(run["id"]);
                  setSubject(run["subject"]);
                  setBody(run["email_draft"]);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                Redigera utkast
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Godkännande ändrar endast status internt – ingen extern kommunikation sker.
            </p>
          </article>
        ))}
      </div>
    </AdminShell>
  );
}
