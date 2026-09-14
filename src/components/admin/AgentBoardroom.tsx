import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, ChevronUp, CircleCheck, ExternalLink, FileCode2, Loader2, Play, Plus, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  advanceAgentMeeting,
  advanceMeetingExecution,
  cancelAgentMeeting,
  createAgentMeeting,
  decideAgentMeeting,
  decideExecutionContact,
  getMeetingExecution,
  listAgentMeetings,
} from "@/lib/agents.functions";
import {
  EXECUTION_ACTION_LABEL,
  EXECUTION_BATCH_LABEL,
  type ExecutionActionType,
  type ExecutionBatchStatus,
  type ExecutionStatus,
} from "@/lib/agents/execution";
import { ACTIVE_MEETING_STATUSES, MEETING_STATUS_LABEL, type MeetingStatus, type MeetingType } from "@/lib/agents/boardroom";
import { DEFAULT_BUDGET_CONFIG } from "@/lib/agents/budget";
import { AGENT_LABEL, type AgentName } from "@/lib/agents/tasks";

type MeetingRow = {
  id: string;
  agenda: string;
  meeting_type: MeetingType;
  status: MeetingStatus;
  selected_roles: string[];
  current_round: number;
  needs_cross_review: boolean | null;
  final_summary: string;
  recommendation: string;
  alternatives: string[];
  expected_effect: string;
  risk_level: string;
  estimated_effort: string;
  estimated_cost_sek: number;
  approval_status: string;
  error: string;
  created_at: string;
};

type MessageRow = {
  id: string;
  meeting_id: string;
  sequence: number;
  round: number;
  role: string;
  message_type: string;
  content: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_sek: number;
};

const TYPE_LABEL: Record<MeetingType, string> = {
  strategy: "Strategi",
  product: "Produkt",
  growth: "Tillväxt",
  risk: "Risk",
  operations: "Drift",
  general: "Allmänt",
};

const MESSAGE_LABEL: Record<string, string> = {
  kickoff: "Kickoff",
  analysis: "Analys",
  critique: "Kritik",
  qa_review: "Risk- och kvalitetsgranskning",
  synthesis: "Slutsats",
  system: "System",
};

const TERMINAL_STATUSES: MeetingStatus[] = ["awaiting_approval", "completed", "failed", "paused_budget"];

const WORKING_LABEL: Partial<Record<MeetingStatus, string>> = {
  draft: "Mötet startar – Manager gör kickoff",
  manager_kickoff: "Manager väljer specialister",
  round_1: "Mötet arbetar – specialistanalys",
  cross_review: "Mötet arbetar – specialisterna granskar varandra",
  qa_review: "QA/Risk granskar",
  manager_synthesis: "Manager sammanställer",
};

const BOARDROOM_AGENTS: AgentName[] = [
  "noryva_manager",
  "product_tech",
  "growth_sales",
  "customer_success",
  "qa_risk",
  "operations_finance",
];

const SEAT_POSITION = [
  "left-1/2 top-0 -translate-x-1/2",
  "right-0 top-[18%]",
  "right-[4%] bottom-[3%]",
  "left-1/2 bottom-0 -translate-x-1/2",
  "left-[4%] bottom-[3%]",
  "left-0 top-[18%]",
];

function currentAgent(status: MeetingStatus, transcript: MessageRow[], selectedRoles: string[]) {
  if (status === "draft" || status === "manager_kickoff" || status === "manager_synthesis") return "noryva_manager";
  if (status === "qa_review") return "qa_risk";
  if (status === "round_1") {
    return selectedRoles.find((role) => !transcript.some((message) => message.role === role && message.message_type === "analysis"));
  }
  if (status === "cross_review") {
    return selectedRoles.find((role) => !transcript.some((message) => message.role === role && message.message_type === "critique"));
  }
  return undefined;
}

function agentStatus(
  role: AgentName,
  activeRole: string | undefined,
  selected: MeetingRow,
  transcript: MessageRow[],
  isWorking: boolean,
) {
  if (activeRole === role && isWorking) {
    if (selected.status === "qa_review" || selected.status === "cross_review") return "granskar";
    if (selected.status === "manager_synthesis") return "sammanställer";
    return role === "noryva_manager" ? "arbetar" : "analyserar";
  }
  if (transcript.some((message) => message.role === role)) return "klar";
  if (selected.status === "completed" || selected.status === "awaiting_approval") return "klar";
  return "väntar";
}

function AgentAvatar({ active, complete }: { active: boolean; complete: boolean }) {
  return (
    <div
      className={`relative grid size-10 place-items-center rounded-full border bg-card shadow-sm sm:size-12 ${
        active ? "border-primary ring-4 ring-primary/15" : complete ? "border-primary/35" : "border-border"
      }`}
      aria-hidden="true"
    >
      {active ? <span className="absolute inset-[-5px] rounded-full border border-primary/35 motion-safe:animate-ping" /> : null}
      <div className="flex flex-col items-center">
        <span className="size-3 rounded-full bg-muted-foreground/65 sm:size-3.5" />
        <span className="mt-0.5 h-2.5 w-6 rounded-t-full bg-muted-foreground/45 sm:h-3 sm:w-7" />
      </div>
      {complete ? (
        <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-2.5" />
        </span>
      ) : null}
    </div>
  );
}

type StructuredContent = {
  summary: string;
  details: Array<{ label: string; values: string[] }>;
  raw: string;
};

const CONTENT_LABEL: Record<string, string> = {
  findings: "Iakttagelser",
  recommendations: "Rekommendationer",
  checks: "Kontroller",
  risks: "Risker",
  alternatives: "Alternativ",
  proposedChange: "Föreslagna ändringar",
  changes: "Ändringar",
  files: "Filer",
  verdict: "Bedömning",
};

function structuredContent(content: string): StructuredContent {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const summary = typeof parsed["summary"] === "string" ? parsed["summary"] : "Agentens bidrag är klart.";
    const details = Object.entries(parsed)
      .filter(([key]) => key !== "summary")
      .map(([key, value]) => {
        const nested = value && typeof value === "object" && !Array.isArray(value)
          ? Object.entries(value as Record<string, unknown>).flatMap(([nestedKey, nestedValue]) =>
              Array.isArray(nestedValue)
                ? nestedValue.map((item) => `${CONTENT_LABEL[nestedKey] ?? nestedKey}: ${String(item)}`)
                : [`${CONTENT_LABEL[nestedKey] ?? nestedKey}: ${String(nestedValue)}`],
            )
          : Array.isArray(value)
            ? value.map(String)
            : [String(value)];
        return { label: CONTENT_LABEL[key] ?? key, values: nested };
      });
    return { summary, details, raw: content };
  } catch {
    return { summary: content, details: [], raw: content };
  }
}

function TranscriptEntry({ message }: { message: MessageRow }) {
  const [expanded, setExpanded] = useState(false);
  const content = structuredContent(message.content);
  const hasMore = content.details.length > 0 || content.summary.length > 220;

  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-2 pb-4 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-3">
      <div className="z-10 grid size-8 place-items-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground sm:size-10">
        {message.sequence}
      </div>
      <article className="min-w-0 rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{AGENT_LABEL[message.role as AgentName] ?? "System"}</span>
          <Badge variant="outline">{MESSAGE_LABEL[message.message_type] ?? message.message_type}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">Runda {message.round}</span>
        </div>
        <p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground ${expanded ? "" : "line-clamp-3"}`}>
          {content.summary}
        </p>
        {expanded && content.details.length > 0 ? (
          <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
            {content.details.map((detail) => (
              <div key={detail.label}>
                <p className="text-xs font-semibold text-foreground">{detail.label}</p>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {detail.values.map((value, index) => <li key={`${detail.label}-${index}`}>• {value}</li>)}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        {hasMore ? (
          <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronUp /> : <ChevronDown />}{expanded ? "Visa mindre" : "Läs mer"}
          </Button>
        ) : null}
      </article>
    </li>
  );
}

function statusVariant(status: MeetingStatus) {
  if (status === "failed" || status === "paused_budget") return "destructive" as const;
  if (status === "awaiting_approval" || status === "completed") return "secondary" as const;
  return "outline" as const;
}

type ExecutionTaskRow = {
  id: string;
  index: number;
  role: string;
  actionType: ExecutionActionType;
  goal: string;
  successCriteria: string;
  executionStatus: ExecutionStatus;
  blockedReason: string;
  approvalStatus: string;
  output: Record<string, unknown> | null;
};

const EXECUTION_STATUS_TEXT: Record<ExecutionStatus, string> = {
  done: "Klart internt",
  queued: "Väntar",
  proposal_only: "Förslag klart – ingen säker automatisk write-path",
  ready_for_repo_executor: "Kodförslag klart – behöver köras manuellt",
  awaiting_human_approval: "Väntar på ditt godkännande",
  blocked: "Blockerat",
  failed: "Misslyckat",
};

function executionStatusClass(status: ExecutionStatus) {
  if (status === "done") return "border-status-success/30 bg-status-success/10 text-status-success";
  if (status === "awaiting_human_approval" || status === "ready_for_repo_executor") {
    return "border-status-warning/30 bg-status-warning/10 text-status-warning";
  }
  if (status === "blocked" || status === "failed") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "queued") return "border-status-neutral/25 bg-muted text-muted-foreground";
  return "border-status-info/30 bg-status-info/10 text-status-info";
}

function displayedExecutionStatus(task: ExecutionTaskRow) {
  if (task.actionType === "customer_contact" && task.approvalStatus === "approved") return "Godkänd för manuell kontakt";
  if (task.actionType === "customer_contact" && task.approvalStatus === "rejected") return "Kundkontakt avvisad";
  return EXECUTION_STATUS_TEXT[task.executionStatus];
}

function displayedExecutionStatusClass(task: ExecutionTaskRow) {
  if (task.actionType === "customer_contact" && task.approvalStatus === "approved") {
    return "border-status-info/30 bg-status-info/10 text-status-info";
  }
  return executionStatusClass(task.executionStatus);
}

function outputSummary(task: ExecutionTaskRow) {
  return typeof task.output?.["summary"] === "string" ? task.output["summary"] : task.goal;
}

function nextStepText(task: ExecutionTaskRow) {
  if (task.executionStatus === "done") return "Ingen åtgärd krävs.";
  if (task.executionStatus === "queued") return "Agenten tar upp uppgiften automatiskt när tidigare steg är klara.";
  if (task.executionStatus === "ready_for_repo_executor") return "Granska förslaget och låt Lovable eller en annan executor applicera det manuellt om du vill.";
  if (task.executionStatus === "proposal_only") return "Granska förslaget. Ingen ändring har gjorts automatiskt.";
  if (task.executionStatus === "awaiting_human_approval" && task.approvalStatus === "pending") return "Du behöver ta ställning till den föreslagna kundkontakten nedan.";
  if (task.actionType === "customer_contact" && task.approvalStatus === "approved") return "Godkänt för manuell hantering. Inget meddelande har skickats automatiskt.";
  if (task.executionStatus === "blocked") return "Ingen åtgärd utförs.";
  return "Ingen åtgärd krävs.";
}

function ExecutionTaskCard({
  task,
  contactPending,
  onContactDecision,
}: {
  task: ExecutionTaskRow;
  contactPending: boolean;
  onContactDecision: (decision: "approved" | "rejected") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = task.output ? structuredContent(JSON.stringify(task.output)) : null;
  const hasDetails = Boolean(detail && detail.details.length > 0);
  const isCodeProposal = task.executionStatus === "ready_for_repo_executor";

  return (
    <li className="rounded-md border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Vad ska göras</p>
          <p className="mt-1 text-sm font-semibold">{task.goal}</p>
          <p className="mt-1 text-xs text-muted-foreground">{AGENT_LABEL[task.role as AgentName] ?? task.role} · {EXECUTION_ACTION_LABEL[task.actionType]}</p>
        </div>
        <Badge variant="outline" className={displayedExecutionStatusClass(task)}>
          {displayedExecutionStatus(task)}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Status</p>
          <p className="mt-1 text-sm">{outputSummary(task)}</p>
          {isCodeProposal ? (
            <p className="mt-2 flex items-start gap-2 rounded-md border border-status-warning/25 bg-status-warning/10 p-2.5 text-xs font-medium text-foreground">
              <FileCode2 className="mt-0.5 size-4 shrink-0 text-status-warning" />
              Agenten har inte ändrat Lovable-koden. Detta är endast ett manuellt ändringsförslag.
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Vad händer nu</p>
          <p className="mt-1 text-sm text-muted-foreground">{nextStepText(task)}</p>
        </div>
      </div>

      {hasDetails ? (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronUp /> : <ChevronDown />}{expanded ? "Dölj ändringsförslag" : isCodeProposal ? "Visa ändringsförslag" : "Läs mer"}
          </Button>
          {expanded ? (
            <div className="mt-3 space-y-3 rounded-md bg-surface p-3 text-sm">
              {detail?.details.map((item) => (
                <div key={item.label}>
                  <p className="text-xs font-semibold">{item.label}</p>
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {item.values.map((value, index) => <li key={`${item.label}-${index}`}>• {value}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {task.actionType === "customer_contact" && task.approvalStatus === "pending" ? (
        <div className="mt-4 rounded-md border border-status-warning/30 bg-status-warning/10 p-3">
          <p className="text-sm font-semibold">Separat godkännande för kundkontakt</p>
          <p className="mt-1 text-xs text-muted-foreground">Du godkänner att kontakten får hanteras manuellt. Knappen skickar inget mail, SMS eller meddelande.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={contactPending} onClick={() => onContactDecision("approved")}>Godkänn för manuell kontakt</Button>
            <Button size="sm" variant="outline" disabled={contactPending} onClick={() => onContactDecision("rejected")}>Avvisa kontakt</Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Genomförande efter godkänd slutsats. Kör de interna uppgifterna sekventiellt
 * och stannar alltid vid kundkontakt, som kräver separat mänskligt beslut.
 */
function ExecutionPanel({ meetingId }: { meetingId: string }) {
  const listExecution = useServerFn(getMeetingExecution);
  const advanceExecution = useServerFn(advanceMeetingExecution);
  const decideContact = useServerFn(decideExecutionContact);
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const stoppedRef = useRef(false);

  const query = useQuery({
    queryKey: ["meeting-execution", meetingId],
    queryFn: () => listExecution({ data: { meetingId } }),
    refetchInterval: busy ? 4_000 : false,
  });
  const tasks = (query.data?.tasks ?? []) as ExecutionTaskRow[];
  const batchStatus = (query.data?.batchStatus ?? "not_started") as ExecutionBatchStatus;

  const run = useCallback(async () => {
    if (busyRef.current || stoppedRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      for (;;) {
        const result = await advanceExecution({ data: { meetingId } });
        await queryClient.invalidateQueries({ queryKey: ["meeting-execution", meetingId] });
        if (!result.ok) {
          stoppedRef.current = true;
          setError(String(result.reason ?? "Genomförandet stoppades."));
          return;
        }
        if (result.done) return;
      }
    } catch (caught) {
      stoppedRef.current = true;
      setError((caught as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [advanceExecution, meetingId, queryClient]);

  useEffect(() => {
    stoppedRef.current = false;
  }, [meetingId]);

  useEffect(() => {
    if (query.isLoading || busyRef.current || stoppedRef.current) return;
    if (batchStatus === "running" || batchStatus === "not_started") void run();
  }, [batchStatus, query.isLoading, run]);

  const contactDecision = useMutation({
    mutationFn: (input: { taskId: string; decision: "approved" | "rejected" }) => decideContact({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["meeting-execution", meetingId] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const done = tasks.filter((task) => task.executionStatus !== "queued").length;

  return (
    <section className="order-2 mt-4 rounded-md border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div><p className="text-xs font-semibold uppercase text-primary">3. Vad som händer efter godkännandet</p><h5 className="mt-1 text-lg font-semibold">Genomförande</h5></div>
          {busy ? <Loader2 className="size-4 animate-spin text-primary" /> : null}
        </div>
        <Badge variant={batchStatus === "completed" ? "secondary" : "outline"}>
          {EXECUTION_BATCH_LABEL[batchStatus]}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {tasks.length ? `${done} av ${tasks.length} uppgifter behandlade.` : "Manager bryter ned slutsatsen i uppgifter."} Kundkontakt kräver alltid ett separat godkännande och kodförslag körs aldrig automatiskt.
      </p>
      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
      ) : null}
      <ul className="mt-4 space-y-3">
        {tasks.map((task) => <ExecutionTaskCard key={task.id} task={task} contactPending={contactDecision.isPending} onContactDecision={(decision) => contactDecision.mutate({ taskId: task.id, decision })} />)}
        {!query.isLoading && tasks.length === 0 ? (
          <li className="text-sm text-muted-foreground">Inga genomförandeuppgifter ännu.</li>
        ) : null}
      </ul>
    </section>
  );
}

export function AgentBoardroom() {
  const list = useServerFn(listAgentMeetings);
  const createMeeting = useServerFn(createAgentMeeting);
  const advance = useServerFn(advanceAgentMeeting);
  const decide = useServerFn(decideAgentMeeting);
  const cancel = useServerFn(cancelAgentMeeting);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [agenda, setAgenda] = useState("");
  const [meetingType, setMeetingType] = useState<MeetingType>("general");
  const [maxSpecialists, setMaxSpecialists] = useState("3");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [createError, setCreateError] = useState("");
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const stoppedRef = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["agent-meetings"],
    queryFn: () => list(),
    refetchInterval: running ? 4_000 : 20_000,
  });
  const meetings = (query.data?.meetings ?? []) as MeetingRow[];
  const messages = (query.data?.messages ?? []) as MessageRow[];
  const selected = meetings.find((meeting) => meeting.id === selectedId) ?? meetings[0] ?? null;
  const transcript = useMemo(
    () => messages.filter((message) => message.meeting_id === selected?.id),
    [messages, selected?.id],
  );

  const createMutation = useMutation({
    mutationFn: () => {
      setCreateError("");
      return createMeeting({ data: { agenda, meetingType, maxSpecialists: Number(maxSpecialists) } });
    },
    onSuccess: async (result) => {
      setOpen(false);
      setAgenda("");
      setCreateError("");
      setSelectedId(result.meetingId);
      setNotice("Mötet skapades i REVIEW. Agenterna börjar arbeta internt.");
      await queryClient.invalidateQueries({ queryKey: ["agent-meetings"] });
    },
    // Felet måste synas i dialogen – annars ser knappen död ut.
    onError: (error: Error) => {
      setCreateError(error.message || "Mötet kunde inte skapas.");
      setNotice(error.message);
    },
  });

  /** Kör mötet sekventiellt, ett internt steg i taget, tills det når ett slutläge. */
  const runMeeting = useCallback(
    async (meetingId: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      stoppedRef.current.delete(meetingId);
      // Inget godtyckligt stegtak: budgeten styr. Loop-skyddet stoppar bara
      // faktisk upprepning av exakt samma roll + samma steg.
      const seen = new Map<string, number>();
      try {
        for (;;) {
          const result = await advance({ data: { meetingId } });
          const signature = `${String(result.role ?? "")}:${String(result.messageType ?? "")}`;
          const repeats = (seen.get(signature) ?? 0) + 1;
          seen.set(signature, repeats);
          if (repeats > 2) {
            stoppedRef.current.add(meetingId);
            setNotice("Mötet stoppades: samma steg upprepades utan framsteg.");
            return;
          }
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["agent-meetings"] }),
            queryClient.invalidateQueries({ queryKey: ["agent-tasks"] }),
            queryClient.invalidateQueries({ queryKey: ["agent-budget"] }),
          ]);
          if (result.paused) {
            stoppedRef.current.add(meetingId);
            setNotice(String(result.reason));
            return;
          }
          const status = String(result.status) as MeetingStatus;
          if (TERMINAL_STATUSES.includes(status)) {
            setNotice(
              status === "awaiting_approval"
                ? "Mötet är klart och väntar på ditt godkännande."
                : "Mötet avslutades.",
            );
            return;
          }
        }
      } catch (error) {
        stoppedRef.current.add(meetingId);
        setNotice((error as Error).message);
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [advance, queryClient],
  );

  useEffect(() => {
    if (!selected || runningRef.current) return;
    if (TERMINAL_STATUSES.includes(selected.status)) return;
    if (stoppedRef.current.has(selected.id)) return;
    void runMeeting(selected.id);
  }, [selected, runMeeting]);
  const decideMutation = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      selected ? decide({ data: { meetingId: selected.id, decision } }) : Promise.reject(new Error("Inget möte valt.")),
    onSuccess: async (result) => {
      setNotice(result.decision === "approved" ? "Slutsatsen godkändes. Det interna genomförandet startade." : "Mötet avvisades. Ingen extern åtgärd utförs.");
      await queryClient.invalidateQueries({ queryKey: ["agent-meetings"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!selected) return Promise.reject(new Error("Inget möte valt."));
      // Stoppa den interna autoloopen omedelbart.
      stoppedRef.current.add(selected.id);
      return cancel({ data: { meetingId: selected.id } });
    },
    onSuccess: async () => {
      setNotice("Mötet avbröts. Inga fler interna steg körs och du kan starta ett nytt möte.");
      await queryClient.invalidateQueries({ queryKey: ["agent-meetings"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const isWorking = Boolean(selected && running && !TERMINAL_STATUSES.includes(selected.status));
  const canResume = Boolean(
    selected &&
      !running &&
      !["awaiting_approval", "completed"].includes(selected.status) &&
      (selected.status === "paused_budget" || stoppedRef.current.has(selected.id) || Boolean(selected.error)),
  );
  const canDecide = selected && selected.status === "awaiting_approval" && selected.approval_status === "pending";
  const canCancel = Boolean(selected && ACTIVE_MEETING_STATUSES.includes(selected.status));
  const activeRole = selected ? currentAgent(selected.status, transcript, selected.selected_roles) : undefined;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Möten &amp; samarbete</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Agenterna arbetar autonomt internt steg för steg och Manager sammanställer resultatet. Du godkänner endast
            mötets slutsats – ingen extern åtgärd sker automatiskt.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus />Starta agentmöte</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nytt agentmöte</DialogTitle>
                <DialogDescription>PII-fri agenda. Manager väljer 2–5 relevanta specialister efter kickoff och får bredda analysen.</DialogDescription>
              </DialogHeader>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Ämne och agenda</span>
                <textarea
                  value={agenda}
                  onChange={(event) => setAgenda(event.target.value)}
                  rows={5}
                  maxLength={2000}
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2"
                  placeholder="Beslutet eller frågan teamet ska analysera …"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Mötestyp</span>
                  <Select value={meetingType} onValueChange={(value) => setMeetingType(value as MeetingType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TYPE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Max specialister</span>
                  <Select value={maxSpecialists} onValueChange={setMaxSpecialists}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{[2, 3, 4, 5].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
              </div>
              {createError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{createError}</p>
              ) : null}
              <DialogFooter>
                <Button disabled={agenda.trim().length < 10 || createMutation.isPending} onClick={() => createMutation.mutate()}>
                  {createMutation.isPending ? <><Loader2 className="animate-spin" />Skapar …</> : "Starta i REVIEW"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" asChild>
            <a href="https://docs.google.com/spreadsheets/d/1BdlkE4bJO7fyRkdJFaIYHNzhXYYG6fgaLiwFyHqkRak/edit" target="_blank" rel="noreferrer">
              <ExternalLink />Öppna möteslogg
            </a>
          </Button>
        </div>
      </div>

      {isWorking && selected ? (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>
            {WORKING_LABEL[selected.status] ?? "Mötet arbetar"} · {transcript.length} mötesbidrag klara
          </span>
        </div>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-muted-foreground">{notice}</p> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]">
        <div className="space-y-2">
          {meetings.map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              onClick={() => setSelectedId(meeting.id)}
              className={`w-full rounded-md border p-3 text-left ${selected?.id === meeting.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant={statusVariant(meeting.status)}>{MEETING_STATUS_LABEL[meeting.status]}</Badge>
                <span className="text-xs text-muted-foreground">{Number(meeting.estimated_cost_sek).toFixed(2)} kr</span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-medium">{meeting.agenda}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {TYPE_LABEL[meeting.meeting_type]} · runda {meeting.current_round}/2 · {meeting.selected_roles.length || "–"} specialister
              </p>
            </button>
          ))}
          {!query.isLoading && meetings.length === 0 ? <p className="text-sm text-muted-foreground">Inga möten ännu.</p> : null}
        </div>

        {selected ? (
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(selected.status)}>{MEETING_STATUS_LABEL[selected.status]}</Badge>
                  <Badge variant="outline"><Users />{selected.selected_roles.length || "Manager väljer"}</Badge>
                </div>
                <h4 className="mt-2 font-semibold">{selected.agenda}</h4>
                {selected.selected_roles.length ? <p className="mt-1 text-xs text-muted-foreground">{selected.selected_roles.map((role) => AGENT_LABEL[role as AgentName] ?? role).join(" · ")}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {canResume ? (
                  <Button size="sm" onClick={() => void runMeeting(selected.id)}>
                    <Play />Återuppta mötet
                  </Button>
                ) : null}
                {canCancel ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={cancelMutation.isPending}
                    onClick={() => {
                      if (window.confirm("Avsluta mötet? Inga fler interna steg körs.")) cancelMutation.mutate();
                    }}
                  >
                    {cancelMutation.isPending ? "Avslutar …" : "Avsluta mötet"}
                  </Button>
                ) : null}
              </div>
            </div>

            {selected.error ? <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{selected.error}</p> : null}

            <section className={`order-3 mt-5 overflow-hidden rounded-md border border-border bg-surface ${TERMINAL_STATUSES.includes(selected.status) ? "opacity-75" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-border bg-card px-3 py-2.5 text-xs sm:px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(selected.status)}>{MEETING_STATUS_LABEL[selected.status]}</Badge>
                  <span className="text-muted-foreground">{transcript.length} interna bidrag</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span><span className="text-muted-foreground">Aktiv:</span> {activeRole ? AGENT_LABEL[activeRole as AgentName] : "–"}</span>
                  <span>
                    <span className="text-muted-foreground">Aktuellt möte (uppskattat):</span>{" "}
                    {Number(selected.estimated_cost_sek).toFixed(2)} / {DEFAULT_BUDGET_CONFIG.boardroomMeetingCapSek.toFixed(2)} kr
                  </span>
                </div>
              </div>

              <div className="relative mx-auto aspect-[4/3] w-full max-w-3xl min-w-0 px-2 py-3 sm:aspect-[16/9] sm:px-8 sm:py-4">
                <div className="absolute left-1/2 top-1/2 h-[38%] w-[48%] -translate-x-1/2 -translate-y-1/2 rotate-[-2deg] rounded-[50%] border border-border bg-card shadow-[var(--shadow-elevated)] sm:h-[46%] sm:w-[55%]">
                  <div className="absolute inset-[9%] rounded-[50%] border border-border/60 bg-surface-2" />
                  <div className="absolute inset-0 flex rotate-[2deg] flex-col items-center justify-center px-5 text-center">
                    <span className="text-[10px] font-semibold uppercase text-muted-foreground sm:text-xs">Noryva Boardroom</span>
                    <span className="mt-1 hidden max-w-56 text-xs font-medium sm:block">{TYPE_LABEL[selected.meeting_type]} · runda {selected.current_round}/2</span>
                  </div>
                </div>

                {BOARDROOM_AGENTS.map((role, index) => {
                  const status = agentStatus(role, activeRole, selected, transcript, isWorking);
                  const active = role === activeRole && isWorking;
                  const complete = status === "klar";
                  return (
                    <div key={role} className={`absolute z-10 flex w-[30%] flex-col items-center text-center sm:w-36 ${SEAT_POSITION[index]}`}>
                      <AgentAvatar active={active} complete={complete} />
                      <span className="mt-1 max-w-full text-[10px] font-semibold leading-tight sm:text-xs">{AGENT_LABEL[role]}</span>
                      <span className={`mt-0.5 text-[9px] leading-none sm:text-[10px] ${active ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <details className="order-4 mt-6 border-t border-border pt-4" open={isWorking || undefined}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-1 py-2 hover:bg-surface-2">
                <div>
                  <h5 className="font-semibold">Mötesprotokoll</h5>
                  <p className="text-xs text-muted-foreground">{transcript.length} bidrag · kort sammanfattning först</p>
                </div>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {isWorking ? <Loader2 className="size-4 animate-spin text-primary" aria-label="Mötet arbetar" /> : null}
                  Visa protokoll <ChevronDown className="size-4" />
                </div>
              </summary>
              <ol className="relative mt-4 space-y-0 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-border sm:before:left-[19px]">
                {transcript.map((message) => <TranscriptEntry key={message.id} message={message} />)}
                {transcript.length === 0 ? <li className="pl-10 text-sm text-muted-foreground sm:pl-12">Kickoff har inte körts ännu.</li> : null}
              </ol>
            </details>

            {selected.final_summary ? (
              <section className="order-1 mt-5 rounded-md border border-primary/30 bg-card p-4 shadow-[var(--shadow-elevated)] sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AgentAvatar active={false} complete />
                    <div><p className="text-xs font-semibold uppercase text-primary">1. Vad teamet kom fram till</p><h5 className="mt-1 text-lg font-semibold">Manager-slutsats</h5></div>
                  </div>
                  <Badge
                    variant="outline"
                    className={selected.approval_status === "approved" ? "border-status-success/30 bg-status-success/10 text-status-success" : selected.approval_status === "rejected" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-status-warning/30 bg-status-warning/10 text-status-warning"}
                  >
                    {selected.approval_status === "approved" ? "Godkänd – genomförande startat" : selected.approval_status === "rejected" ? "Avvisad – inget genomförande" : "Väntar på ditt beslut"}
                  </Badge>
                </div>
                <p className="mt-4 text-sm leading-relaxed">{selected.final_summary}</p>
                <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-primary/20 pt-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Rekommendation</dt><dd className="mt-0.5">{selected.recommendation}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Förväntad effekt</dt><dd className="mt-0.5">{selected.expected_effect}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Risk</dt><dd className="mt-0.5">{selected.risk_level}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Insats</dt><dd className="mt-0.5">{selected.estimated_effort}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Uppskattad kostnad</dt><dd className="mt-0.5">{Number(selected.estimated_cost_sek).toFixed(2)} kr</dd></div>
                </dl>
                <div className="mt-5 rounded-md border border-status-info/25 bg-status-info/10 p-3">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase text-status-info"><ShieldCheck className="size-4" />2. Vad du {selected.approval_status === "approved" ? "har godkänt" : "godkänner"}</p>
                  <p className="mt-2 text-sm">Du {selected.approval_status === "approved" ? "har godkänt" : "godkänner"} att agenterna börjar arbeta vidare internt på slutsatsen. Ingen kundkontakt, kodändring i Lovable eller publicering sker automatiskt.</p>
                </div>
                {canDecide ? (
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate("approved")}>
                        <CircleCheck />Godkänn och starta genomförande
                      </Button>
                      <Button size="sm" variant="outline" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate("rejected")}>Avvisa och stoppa</Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {selected.approval_status === "approved" ? <ExecutionPanel meetingId={selected.id} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}