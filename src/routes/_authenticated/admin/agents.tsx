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
  createImprovementReview,
  createV2Task,
  decideAgentTask,
  dispatchAgentEvent,
  getAgentBudgetStatus,
  getAgentHarnessStatus,
  listAgentTasks,
  runAgentTask,
  runV2Task,
  verifyAgentTask,
} from "@/lib/agents.functions";
import { BUDGET_ROLES, BUDGET_STATE_LABEL, type BudgetRole } from "@/lib/agents/budget";
import {
  AGENT_LABEL,
  AGENT_ROLE_CONFIG,
  APPROVAL_LABEL,
  AUTHORITY_CHAIN,
  PRIORITY_LABEL,
  SPECIALIST_AGENTS_V1,
  STATUS_LABEL,
  TASK_TYPE_LABEL,
  VERIFICATION_LABEL,
  type ActiveAgentV1,
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

const MANAGER = {
  key: "noryva_manager" as AgentName,
  role: "Huvudagent / COO",
  description:
    "Tar emot mål och händelser, prioriterar och delegerar internt. Läser endast aggregerad, avidentifierad drifttelemetri. Skapar interna uppgifter – aldrig något som når kunder eller produktion.",
};

const ACTIVE_ROLES: { key: ActiveAgentV1; description: string }[] = SPECIALIST_AGENTS_V1.map(
  (key) => ({ key, description: AGENT_ROLE_CONFIG[key].description }),
);



type LlmMetaRow = {
  used?: boolean;
  model?: string;
  promptVersion?: string;
  attempts?: number;
  usedFallback?: boolean;
  fallbackReason?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
};

type ImprovementFindingRow = { area?: string; observation?: string; severity?: string };
type ImprovementRecommendationRow = {
  title?: string;
  priority?: string;
  evidence?: string;
  risk?: string;
  suggestedAction?: string;
};

type TaskResultRow = {
  kind?: string;
  summary?: string;
  healthScore?: number;
  findings?: ImprovementFindingRow[];
  recommendations?: Array<ImprovementRecommendationRow | string>;
  priorities?: string[];
  implementationPrompt?: string;
  nextStep?: string;
  internalNotes?: string[];
  draft?: { subject?: string; body?: string };
  generatedBy?: string;
  llm?: LlmMetaRow;
} | null;

type TaskRow = {
  id: string;
  assigned_agent: string;
  task_type: string;
  priority: string;
  status: string;
  approval_status: string;
  verification_status: string;
  verification_reasons: unknown;
  requires_approval: boolean;
  provider_type?: string;
  provider_run_id?: string;
  run_status?: string;
  usage?: { inputTokens?: number; outputTokens?: number; runs?: number } | null;
  run_budget?: number;
  runs_used?: number;
  result: TaskResultRow;
};

const V2_TASK_TYPES: string[] = [
  "manager_directive",
  "product_tech_review",
  "growth_sales_review",
  "customer_success_review",
  "qa_risk_review",
  "operations_finance_review",
];



type EventRow = { id: string; event_type: string; actor: string; created_at: string };

const FILTERS = [
  { key: "all", label: "Alla" },
  { key: "awaiting_review", label: "Väntar granskning" },
  { key: "done", label: "Klara" },
  { key: "failed", label: "Fel" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function ResultDetails({ result }: { result: TaskResultRow }) {
  if (!result) return null;
  const llm = result.llm;
  return (
    <div className="mt-2 space-y-2 text-sm">
      {result.kind === "cto_improvement_review" ||
      result.kind === "manager_directive" ||
      result.kind === "product_tech_review" ? (
        <div className="space-y-2">
          {typeof result.healthScore === "number" ? (
            <p>
              <span className="text-muted-foreground">Hälsopoäng:</span> {result.healthScore}/100
            </p>
          ) : null}
          {result.summary ? <p>{result.summary}</p> : null}
          {Array.isArray(result.priorities) && result.priorities.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {result.priorities.map((p, i) => (
                <li key={`${p}-${i}`}>{p}</li>
              ))}
            </ul>
          ) : null}

          {Array.isArray(result.findings) && result.findings.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {result.findings.map((f, i) => (
                <li key={`${f.area}-${i}`}>
                  <span className="font-medium text-foreground">{f.area}</span> ({f.severity}):{" "}
                  {f.observation}
                </li>
              ))}
            </ul>
          ) : null}
          {Array.isArray(result.recommendations) && result.recommendations.length > 0 ? (
            <ul className="space-y-2">
              {result.recommendations.map((raw, i) => {
                const r = typeof raw === "string" ? { title: raw } : raw;
                return (
                  <li key={`${r.title}-${i}`} className="rounded-lg border border-border p-3">
                    <p className="font-medium">
                      {r.title}{" "}
                      {"priority" in r && r.priority ? (
                        <span className="text-xs text-muted-foreground">({r.priority})</span>
                      ) : null}
                    </p>
                    {"evidence" in r && r.evidence ? (
                      <p className="text-xs text-muted-foreground">Underlag: {r.evidence}</p>
                    ) : null}
                    {"risk" in r && r.risk ? (
                      <p className="text-xs text-muted-foreground">Risk: {r.risk}</p>
                    ) : null}
                    {"suggestedAction" in r && r.suggestedAction ? (
                      <p className="text-xs">Förslag: {r.suggestedAction}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {result.implementationPrompt ? (
            <div>
              <p className="text-muted-foreground">Färdig instruktion att godkänna:</p>
              <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs">
                {result.implementationPrompt}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {result.draft?.subject ? (
        <p>
          <span className="text-muted-foreground">Ämne:</span> {result.draft.subject}
        </p>
      ) : null}
      {result.draft?.body ? (
        <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs">
          {result.draft.body}
        </pre>
      ) : null}
      {result.nextStep ? <p>Föreslaget nästa steg: {result.nextStep}</p> : null}
      {Array.isArray(result.internalNotes) && result.internalNotes.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {result.internalNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {llm ? (
        <p className="text-xs text-muted-foreground">
          Källa: {result.generatedBy === "llm" ? "OpenAI-resonemang" : "Deterministisk"} · modell{" "}
          {llm.model ?? "–"} · försök {llm.attempts ?? 0} ·{" "}
          {llm.usedFallback ? `reserv (${llm.fallbackReason || "okänd orsak"})` : "ingen reserv"} ·{" "}
          {llm.inputTokens ?? 0}/{llm.outputTokens ?? 0} tokens · {llm.latencyMs ?? 0} ms
        </p>
      ) : null}
    </div>
  );
}

function AgentHqPage() {
  const fetchTasks = useServerFn(listAgentTasks);
  const dispatch = useServerFn(dispatchAgentEvent);
  const run = useServerFn(runAgentTask);
  const verify = useServerFn(verifyAgentTask);
  const decide = useServerFn(decideAgentTask);
  const improvement = useServerFn(createImprovementReview);
  const createTask = useServerFn(createV2Task);
  const runHarness = useServerFn(runV2Task);
  const fetchHarness = useServerFn(getAgentHarnessStatus);
  const fetchBudget = useServerFn(getAgentBudgetStatus);
  const queryClient = useQueryClient();
  const [leadId, setLeadId] = useState("");
  const [goal, setGoal] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["agent-tasks"],
    queryFn: () => fetchTasks(),
    // Endast läsning. Uppdateringen skapar aldrig uppgifter eller AI-anrop.
    refetchInterval: 10_000,
  });

  // Läses en gång: statusen ändras bara när en hemlighet ändras server-side.
  const harness = useQuery({ queryKey: ["agent-harness"], queryFn: () => fetchHarness() });
  const budget = useQuery({ queryKey: ["agent-budget"], queryFn: () => fetchBudget() });


  const mutation = useMutation({
    mutationFn: async (action: () => Promise<{ ok?: boolean } & Record<string, unknown>>) => action(),
    onSuccess: (res) => {
      setMessage(res["duplicate"] ? "Uppgiften fanns redan (idempotent)." : "Klart.");
      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const tasks = (data?.tasks ?? []) as unknown as TaskRow[];
  const visibleTasks = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  const reviews = tasks.filter((t) => t.requires_approval && t.approval_status === "pending");

  return (
    <AdminShell title="Noryva Agent HQ">
      <div className="space-y-8">
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Körläge: {data?.mode ?? "TEST/REVIEW"}</p>
          <p className="text-muted-foreground">
            Lovable är kontrollpanel, Noryvas backend är kontroll- och auditlager och OpenAI Agents
            API är agent-harnessen. Inga mail, SMS, bokningar eller Make-actions sker – godkännande
            ändrar endast intern status.
          </p>
          <p className="mt-2">
            <span className="text-muted-foreground">Harness:</span>{" "}
            {harness.isLoading
              ? "hämtar …"
              : harness.data?.configured
                ? "OpenAI Agents API – ansluten"
                : `OpenAI Agents API – ej konfigurerad${
                    harness.data?.reason ? ` (${harness.data.reason})` : ""
                  }`}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Befogenhet: {AUTHORITY_CHAIN.join(" → ")}. UTFÖRA är spärrat i den här versionen för
            allt som kan påverka produktion eller kunder.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">Kostnadstak</h2>
            <Badge variant={budget.data?.state === "ok" ? "secondary" : "destructive"}>
              {budget.isLoading ? "hämtar …" : BUDGET_STATE_LABEL[budget.data?.state ?? "ok"]}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <p>
              <span className="text-muted-foreground">Uppskattad kostnad denna månad:</span>{" "}
              {(budget.data?.snapshot.spentMonthSek ?? 0).toFixed(2)} kr
            </p>
            <p>
              <span className="text-muted-foreground">Mjukt tak:</span>{" "}
              {budget.data?.config.softCapSek ?? 300} kr
            </p>
            <p>
              <span className="text-muted-foreground">Hårt tak:</span>{" "}
              {budget.data?.config.hardCapSek ?? 500} kr
            </p>
            <p>
              <span className="text-muted-foreground">Autonoma körningar idag:</span>{" "}
              {budget.data?.snapshot.autonomousRunsToday ?? 0} (tak{" "}
              {budget.data?.config.maxAutonomousRunsPerDay ?? 2} per agent/dygn)
            </p>
            <p>
              <span className="text-muted-foreground">Autonoma körningar denna månad:</span>{" "}
              {budget.data?.snapshot.autonomousRunsMonth ?? 0} /{" "}
              {budget.data?.config.maxAutonomousRunsPerMonth ?? 360}
            </p>
            <p className="sm:col-span-3">
              <span className="text-muted-foreground">Idag per agent:</span>{" "}
              {BUDGET_ROLES.map(
                (role) =>
                  `${AGENT_LABEL[role] ?? role} ${
                    budget.data?.snapshot.autonomousRunsTodayByRole?.[role] ?? 0
                  }/${budget.data?.config.maxAutonomousRunsPerDay ?? 2}`,
              ).join(" · ")}
            </p>
            <p className="text-xs text-muted-foreground">
              Intern, konservativ uppskattning (inkl. säkerhetsmarginal) – inte OpenAI:s egen
              fakturering.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Roller</h2>
          <div className="rounded-xl border-2 border-primary/50 bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base font-semibold">{AGENT_LABEL[MANAGER.key]}</span>
              <Badge>{MANAGER.role}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{MANAGER.description}</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {ACTIVE_ROLES.map((s) => (
              <div key={s.key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{AGENT_LABEL[s.key]}</span>
                  <Badge>Aktiv intern roll</Badge>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-lg font-semibold">Starta agentarbete</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Alla sex roller kan få en egen uppgift. Manager kör högst en gång per uppgift och kan
            delegera internt – en delegering skapar bara en uppgift, den startas aldrig automatiskt.
            Utan giltig global konfiguration görs ingen körning alls.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Mål (valfritt)"
              className="min-w-[22rem] rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate(() =>
                  createTask({ data: { role: "noryva_manager", ...(goal ? { goal } : {}) } }),
                )
              }
              className="rounded-full border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              Ny Manager-uppgift
            </button>
            {SPECIALIST_AGENTS_V1.map((role) => (
              <button
                key={role}
                type="button"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate(() => createTask({ data: { role, ...(goal ? { goal } : {}) } }))
                }
                className="rounded-full border border-border px-3 py-2 text-sm disabled:opacity-50"
              >
                Ny {AGENT_LABEL[role]}-uppgift
              </button>
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
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-sm text-muted-foreground">
              Intern systemgranskning (CTO) läser endast aggregerad drifttelemetri – ingen kunddata.
              En granskning per dygn. Den analyserar och föreslår, men ändrar aldrig kod eller data.
            </p>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(() => improvement({}))}
              className="rounded-full border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              Skapa systemgranskning
            </button>
          </div>
          {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Uppgiftskö</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  filter === f.key
                    ? "border-primary bg-primary/10 font-medium"
                    : "border-border text-muted-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="self-center text-xs text-muted-foreground">
              Listan uppdateras automatiskt var tionde sekund (endast läsning).
            </span>
          </div>
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
                  <TableHead>Körning</TableHead>
                  <TableHead>Åtgärd</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTasks.map((t) => (
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
                    <TableCell className="text-xs text-muted-foreground">
                      {t.provider_type && t.provider_type !== "none" ? (
                        <>
                          <span className="font-mono">
                            {t.provider_run_id ? t.provider_run_id.slice(0, 12) : "–"}
                          </span>{" "}
                          · {t.run_status ?? "not_started"} · {t.runs_used ?? 0}/{t.run_budget ?? 0}{" "}
                          · {t.usage?.inputTokens ?? 0}/{t.usage?.outputTokens ?? 0} tokens
                        </>
                      ) : (
                        "–"
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <button
                        type="button"
                        disabled={t.status !== "queued" || mutation.isPending}
                        onClick={() =>
                          mutation.mutate(() =>
                            V2_TASK_TYPES.includes(t.task_type)
                              ? runHarness({ data: { taskId: t.id } })
                              : run({ data: { taskId: t.id } }),
                          )
                        }
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
                {visibleTasks.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-sm text-muted-foreground">
                      Inga uppgifter i det här urvalet.
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
            Godkännande krävs innan en uppgift räknas som klar. Beslutet ändrar ENDAST intern
            approval-status: inget mail, inget SMS och ingen bokning kan triggas av det. Godkänn är
            låst tills verifieringen är godkänd.
          </p>
          <ul className="space-y-3">
            {reviews.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
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
                  <ResultDetails result={t.result} />
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
            {((data?.events ?? []) as unknown as EventRow[]).map((e) => (
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
