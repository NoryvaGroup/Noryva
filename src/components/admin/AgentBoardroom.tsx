import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ExternalLink, Loader2, Play, Plus, Users } from "lucide-react";
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
import { advanceAgentMeeting, createAgentMeeting, decideAgentMeeting, listAgentMeetings } from "@/lib/agents.functions";
import { MEETING_STATUS_LABEL, type MeetingStatus, type MeetingType } from "@/lib/agents/boardroom";
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

function readableContent(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(" · ") : String(value)}`)
      .join("\n");
  } catch {
    return content;
  }
}

function statusVariant(status: MeetingStatus) {
  if (status === "failed" || status === "paused_budget") return "destructive" as const;
  if (status === "awaiting_approval" || status === "completed") return "secondary" as const;
  return "outline" as const;
}

export function AgentBoardroom() {
  const list = useServerFn(listAgentMeetings);
  const createMeeting = useServerFn(createAgentMeeting);
  const advance = useServerFn(advanceAgentMeeting);
  const decide = useServerFn(decideAgentMeeting);
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
      setNotice(result.decision === "approved" ? "Mötet godkändes." : "Mötet avvisades. Ingen extern åtgärd utförs.");
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
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(selected.status)}>{MEETING_STATUS_LABEL[selected.status]}</Badge>
                  <Badge variant="outline"><Users />{selected.selected_roles.length || "Manager väljer"}</Badge>
                </div>
                <h4 className="mt-2 font-semibold">{selected.agenda}</h4>
                {selected.selected_roles.length ? <p className="mt-1 text-xs text-muted-foreground">{selected.selected_roles.map((role) => AGENT_LABEL[role as AgentName] ?? role).join(" · ")}</p> : null}
              </div>
              {canResume ? (
                <Button size="sm" onClick={() => void runMeeting(selected.id)}>
                  <Play />Återuppta mötet
                </Button>
              ) : null}
            </div>

            {selected.error ? <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{selected.error}</p> : null}

            <section className="mt-5 overflow-hidden rounded-md border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-border bg-card px-3 py-2.5 text-xs sm:px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(selected.status)}>{MEETING_STATUS_LABEL[selected.status]}</Badge>
                  <span className="text-muted-foreground">{transcript.length} interna bidrag</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span><span className="text-muted-foreground">Aktiv:</span> {activeRole ? AGENT_LABEL[activeRole as AgentName] : "–"}</span>
                  <span><span className="text-muted-foreground">Kostnad:</span> {Number(selected.estimated_cost_sek).toFixed(2)} kr</span>
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

            <div className="mt-6 flex items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h5 className="font-semibold">Live mötesprotokoll</h5>
                <p className="text-xs text-muted-foreground">Bidragen visas i den ordning de lämnas.</p>
              </div>
              {isWorking ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-label="Mötet arbetar" /> : null}
            </div>
            <ol className="relative mt-4 space-y-0 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-border sm:before:left-[19px]">
              {transcript.map((message) => (
                <li key={message.id} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-2 pb-5 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-3">
                  <div className="z-10 grid size-8 place-items-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground sm:size-10">
                    {message.sequence}
                  </div>
                  <article className="min-w-0 rounded-md border border-border bg-card p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{AGENT_LABEL[message.role as AgentName] ?? "System"}</span>
                      <Badge variant="outline">{MESSAGE_LABEL[message.message_type] ?? message.message_type}</Badge>
                      <span className="ml-auto text-xs text-muted-foreground">Runda {message.round}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{readableContent(message.content)}</p>
                  </article>
                </li>
              ))}
              {transcript.length === 0 ? <li className="pl-10 text-sm text-muted-foreground sm:pl-12">Kickoff har inte körts ännu.</li> : null}
            </ol>

            {selected.final_summary ? (
              <section className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AgentAvatar active={false} complete />
                    <div><p className="text-xs text-muted-foreground">Noryva Manager</p><h5 className="font-semibold">Slutsats</h5></div>
                  </div>
                  <Badge>{selected.approval_status === "pending" ? "VÄNTAR GODKÄNNANDE" : selected.approval_status.toUpperCase()}</Badge>
                </div>
                <p className="mt-4 text-sm leading-relaxed">{selected.final_summary}</p>
                <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-primary/20 pt-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Rekommendation</dt><dd className="mt-0.5">{selected.recommendation}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Förväntad effekt</dt><dd className="mt-0.5">{selected.expected_effect}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Risk</dt><dd className="mt-0.5">{selected.risk_level}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Insats</dt><dd className="mt-0.5">{selected.estimated_effort}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Uppskattad kostnad</dt><dd className="mt-0.5">{Number(selected.estimated_cost_sek).toFixed(2)} kr</dd></div>
                </dl>
                {canDecide ? (
                  <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-primary/20 pt-4">
                    <Button size="sm" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate("approved")}>Godkänn</Button>
                    <Button size="sm" variant="outline" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate("rejected")}>Avvisa</Button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}