import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, Play, Plus, Users } from "lucide-react";
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
    mutationFn: () => createMeeting({ data: { agenda, meetingType, maxSpecialists: Number(maxSpecialists) } }),
    onSuccess: async (result) => {
      setOpen(false);
      setAgenda("");
      setSelectedId(result.meetingId);
      setNotice("Mötet skapades i REVIEW. Starta kickoff när du är redo.");
      await queryClient.invalidateQueries({ queryKey: ["agent-meetings"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const advanceMutation = useMutation({
    mutationFn: (meetingId: string) => advance({ data: { meetingId } }),
    onSuccess: async (result) => {
      setNotice(result.paused ? String(result.reason) : result.duplicate ? "Steget var redan behandlat." : "Ett mötessteg slutfördes.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agent-meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-budget"] }),
      ]);
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const decideMutation = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      selected ? decide({ data: { meetingId: selected.id, decision } }) : Promise.reject(new Error("Inget möte valt.")),
    onSuccess: async (result) => {
      setNotice(result.decision === "approved" ? "Mötet godkändes." : "Mötet avvisades. Ingen extern åtgärd utförs.");
      await queryClient.invalidateQueries({ queryKey: ["agent-meetings"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const canAdvance = selected && !["awaiting_approval", "completed", "failed"].includes(selected.status);
  const canDecide = selected && selected.status === "awaiting_approval" && selected.approval_status === "pending";

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Möten &amp; samarbete</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Strukturerade interna möten med ett agentsteg per klick. Allt stannar i REVIEW och kräver mänsklig granskning.
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
              <DialogFooter>
                <Button disabled={agenda.trim().length < 10 || createMutation.isPending} onClick={() => createMutation.mutate()}>
                  Starta i REVIEW
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
          <div className="rounded-md border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(selected.status)}>{MEETING_STATUS_LABEL[selected.status]}</Badge>
                  <Badge variant="outline"><Users />{selected.selected_roles.length || "Manager väljer"}</Badge>
                </div>
                <h4 className="mt-2 font-semibold">{selected.agenda}</h4>
                {selected.selected_roles.length ? <p className="mt-1 text-xs text-muted-foreground">{selected.selected_roles.map((role) => AGENT_LABEL[role as AgentName] ?? role).join(" · ")}</p> : null}
              </div>
              {canAdvance ? (
                <Button size="sm" disabled={advanceMutation.isPending} onClick={() => advanceMutation.mutate(selected.id)}>
                  <Play />{selected.status === "draft" ? "Starta kickoff" : selected.status === "paused_budget" ? "Försök igen" : "Kör nästa steg"}
                </Button>
              ) : null}
              {canDecide ? (
                <div className="flex gap-2">
                  <Button size="sm" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate("approved")}>Godkänn</Button>
                  <Button size="sm" variant="outline" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate("rejected")}>Avvisa</Button>
                </div>
              ) : null}
            </div>

            {selected.error ? <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{selected.error}</p> : null}
            <ol className="mt-4 space-y-3">
              {transcript.map((message) => (
                <li key={message.id} className="border-l-2 border-primary/30 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{AGENT_LABEL[message.role as AgentName] ?? "System"}</span>
                    <Badge variant="outline">{MESSAGE_LABEL[message.message_type] ?? message.message_type}</Badge>
                    <span className="text-xs text-muted-foreground">Runda {message.round} · {message.input_tokens}/{message.output_tokens} tokens</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{readableContent(message.content)}</p>
                </li>
              ))}
              {transcript.length === 0 ? <li className="text-sm text-muted-foreground">Kickoff har inte körts ännu.</li> : null}
            </ol>

            {selected.final_summary ? (
              <div className="mt-5 rounded-md border border-primary/30 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="font-semibold">Manager slutsats</h5>
                  <Badge>{selected.approval_status === "pending" ? "VÄNTAR GODKÄNNANDE" : selected.approval_status.toUpperCase()}</Badge>
                </div>
                <p className="mt-2 text-sm">{selected.final_summary}</p>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Rekommendation</dt><dd>{selected.recommendation}</dd></div>
                  <div><dt className="text-muted-foreground">Förväntad effekt</dt><dd>{selected.expected_effect}</dd></div>
                  <div><dt className="text-muted-foreground">Risk</dt><dd>{selected.risk_level}</dd></div>
                  <div><dt className="text-muted-foreground">Insats</dt><dd>{selected.estimated_effort}</dd></div>
                  <div><dt className="text-muted-foreground">Uppskattad kostnad</dt><dd>{Number(selected.estimated_cost_sek).toFixed(2)} kr</dd></div>
                </dl>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}