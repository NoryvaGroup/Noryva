import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  decideAgentTask,
  dispatchAgentEvent,
  listAgentTasks,
  runAgentTask,
  verifyAgentTask,
} from "@/lib/agents.functions";
import {
  AGENT_LABEL,
  APPROVAL_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_TYPE_LABEL,
  VERIFICATION_LABEL,
  type AgentName,
} from "@/lib/agents/tasks";

export const Route = createFileRoute("/_authenticated/admin/agents")({
  head: () => ({
    meta: [
      { title: "Agent HQ – Noryva" },
      {
        name: "description",
        content: "Intern vy för Noryvas agentroller, uppgiftskö, verifiering och godkännanden i testläge.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Agent HQ – Noryva" },
      {
        property: "og:description",
        content: "Intern vy för Noryvas agentroller, uppgiftskö, verifiering och godkännanden i testläge.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentHqPage,
});

const ORCHESTRATOR = {
  name: "Orchestrator",
  role: "Huvudagent / chef",
  description:
    "Tar emot händelser, tolkar mål och skapar rätt uppgift till rätt specialist. Deterministisk, utan AI-anrop och utan externa actions.",
};

const SPECIALISTS: { key: AgentName; description: string; active: boolean }[] = [
  { key: "sales", description: "Kvalificering och internt utkast från befintlig leaddata.", active: true },
  { key: "systems_qa", description: "Verifierar resultat mot regler och kontrollerar leveransstatus.", active: true },
  { key: "customer_success", description: "Uppföljning och påminnelser. Ej aktiverad.", active: false },
  { key: "growth", description: "Experiment och optimeringsförslag. Ej aktiverad.", active: false },
  { key: "admin_finance", description: "Kostnadsöversikt och rapportering. Ej aktiverad.", active: false },
];

type TaskRow = Record<string, any>;

function AgentHqPage() {
  const fetchTasks = useServerFn(listAgentTasks);
  const dispatch = useServerFn(dispatchAgentEvent);
  const run = useServerFn(runAgentTask);
  const verify = useServerFn(verifyAgentTask);
  const decide = useServerFn(decideAgentTask);
  const queryClient = useQueryClient();
  const [leadId, setLeadId] = useState("");
  const [message, setMessage] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["agent-tasks"],
    queryFn: () => fetchTasks(),
  });

  const mutation = useMutation({
    mutationFn: async (action: () => Promise<{ ok?: boolean } & Record<string, unknown>>) => action(),
    onSuccess: (res) => {
      setMessage(res["duplicate"] ? "Uppgiften fanns redan (idempotent)." : "Klart.");
      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const tasks: TaskRow[] = data?.tasks ?? [];
  const reviews = tasks.filter((t) => t.requires_approval && t.approval_status === "pending");

  return (
    <AdminShell title="Noryva Agent HQ">
      <div className="space-y-8">
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Körläge: {data?.mode ?? "TEST/REVIEW"}</p>
          <p className="text-muted-foreground">
            Agenterna kör deterministiskt och internt. Inga AI-anrop, inga mail, inga bokningar och
            inga Make-actions. Godkännande ändrar endast intern status.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Roller</h2>
          <div className="rounded-xl border-2 border-primary/50 bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base font-semibold">{ORCHESTRATOR.name}</span>
              <Badge>{ORCHESTRATOR.role}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{ORCHESTRATOR.description}</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SPECIALISTS.map((s) => (
              <div key={s.key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{AGENT_LABEL[s.key]}</span>
                  <Badge variant={s.active ? "default" : "secondary"}>
                    {s.active ? "Aktiv i testläge" : "Vilande"}
                  </Badge>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-lg font-semibold">Skapa testhändelse</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Orchestratorn skapar en uppgift av händelsen. Samma händelse och förfrågan ger aldrig en
            dubblett.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              placeholder="Förfrågans id (UUID)"
              className="min-w-[22rem] rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            {(["new_lead", "delivery_error", "lead_followup_due"] as const).map((type) => (
              <button
                key={type}
                type="button"
                disabled={!leadId || mutation.isPending}
                onClick={() => mutation.mutate(() => dispatch({ data: { type, leadId } }))}
                className="rounded-full border border-border px-3 py-2 text-sm disabled:opacity-50"
              >
                {type}
              </button>
            ))}
          </div>
          {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Uppgiftskö</h2>
          {isLoading ? <p className="text-sm text-muted-foreground">Hämtar …</p> : null}
          {error ? (
            <p className="text-sm text-destructive">Kunde inte hämta: {(error as Error).message}</p>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Uppgifts-id</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Prioritet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Godkännande</TableHead>
                  <TableHead>Verifiering</TableHead>
                  <TableHead>Åtgärd</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{String(t.id).slice(0, 8)}</TableCell>
                    <TableCell>{AGENT_LABEL[t.assigned_agent as AgentName]}</TableCell>
                    <TableCell>{TASK_TYPE_LABEL[t.task_type as keyof typeof TASK_TYPE_LABEL]}</TableCell>
                    <TableCell>{PRIORITY_LABEL[t.priority as keyof typeof PRIORITY_LABEL]}</TableCell>
                    <TableCell>{STATUS_LABEL[t.status as keyof typeof STATUS_LABEL]}</TableCell>
                    <TableCell>
                      {APPROVAL_LABEL[t.approval_status as keyof typeof APPROVAL_LABEL]}
                    </TableCell>
                    <TableCell>
                      {VERIFICATION_LABEL[t.verification_status as keyof typeof VERIFICATION_LABEL]}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <button
                        type="button"
                        disabled={t.status !== "queued" || mutation.isPending}
                        onClick={() => mutation.mutate(() => run({ data: { taskId: t.id } }))}
                        className="mr-2 rounded-full border border-border px-3 py-1 text-xs disabled:opacity-40"
                      >
                        Kör
                      </button>
                      <button
                        type="button"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate(() => verify({ data: { taskId: t.id } }))}
                        className="rounded-full border border-border px-3 py-1 text-xs disabled:opacity-40"
                      >
                        Verifiera
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {tasks.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-sm text-muted-foreground">
                      Inga uppgifter ännu.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Granskning och godkännande</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Godkännande krävs innan en uppgift räknas som klar. Beslutet ändrar endast intern status –
            ingen agent får någon extern förmåga av det.
          </p>
          <ul className="space-y-3">
            {reviews.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {TASK_TYPE_LABEL[t.task_type as keyof typeof TASK_TYPE_LABEL]}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(t.id).slice(0, 8)}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {AGENT_LABEL[t.assigned_agent as AgentName]} · Verifiering:{" "}
                    {VERIFICATION_LABEL[t.verification_status as keyof typeof VERIFICATION_LABEL]}
                    {Array.isArray(t.verification_reasons) && t.verification_reasons.length > 0
                      ? ` · ${t.verification_reasons.join(" ")}`
                      : ""}
                  </p>
                  {t.result?.nextStep ? (
                    <p className="mt-1 text-sm">Föreslaget nästa steg: {t.result.nextStep}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={t.verification_status !== "passed" || mutation.isPending}
                    onClick={() =>
                      mutation.mutate(() => decide({ data: { taskId: t.id, decision: "approved" } }))
                    }
                    className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Godkänn
                  </button>
                  <button
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate(() => decide({ data: { taskId: t.id, decision: "rejected" } }))
                    }
                    className="rounded-full border border-border px-4 py-2 text-sm disabled:opacity-50"
                  >
                    Avvisa
                  </button>
                </div>
              </li>
            ))}
            {reviews.length === 0 ? (
              <li className="text-sm text-muted-foreground">Inget väntar på granskning.</li>
            ) : null}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Senaste händelser</h2>
          <ul className="space-y-2 text-sm">
            {(data?.events ?? []).map((e: Record<string, any>) => (
              <li key={e.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleString("sv-SE")}
                </span>{" "}
                · {e.event_type} · {e.actor}
              </li>
            ))}
            {(data?.events ?? []).length === 0 ? (
              <li className="text-muted-foreground">Inga händelser ännu.</li>
            ) : null}
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}
