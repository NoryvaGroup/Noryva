import { createFileRoute } from "@tanstack/react-router";
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

export const Route = createFileRoute("/_authenticated/admin/agents")({
  head: () => ({
    meta: [
      { title: "Agent HQ – Noryva" },
      {
        name: "description",
        content: "Intern grundvy för Noryvas agentroller, uppgiftskö och godkännanden i testläge.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Agent HQ – Noryva" },
      {
        property: "og:description",
        content: "Intern grundvy för Noryvas agentroller, uppgiftskö och godkännanden i testläge.",
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
    "Tar emot händelser, tolkar mål, bryter ner arbetet i uppgifter och fördelar dem till specialisterna. Utför aldrig externa actions själv.",
};

const SPECIALISTS = [
  {
    name: "Sales",
    description: "Kvalificering, nästa steg och utkast till svar. Allt går till granskning.",
  },
  {
    name: "Systems & QA",
    description: "Verifierar resultat, kontrollerar regler, data och tekniska fel.",
  },
  {
    name: "Customer Success",
    description: "Uppföljning, kundhälsa och påminnelser i granskningsläge.",
  },
  {
    name: "Growth",
    description: "Experiment, mätning och optimeringsförslag. Rekommenderar endast.",
  },
  {
    name: "Admin & Finance",
    description: "Administrativa underlag, kostnadsöversikt och intern rapportering.",
  },
];

type Task = {
  id: string;
  agent: string;
  type: string;
  priority: "Låg" | "Normal" | "Hög";
  status: "Kö" | "Pågår" | "Väntar granskning" | "Klar";
  requiresApproval: boolean;
  verification: "Ej påbörjad" | "Godkänd" | "Underkänd";
};

/** FOUNDATION: statiska exempelrader, ingen backend och ingen körning. */
const TASKS: Task[] = [
  {
    id: "TASK-0001",
    agent: "Sales",
    type: "Utkast till första svar",
    priority: "Hög",
    status: "Väntar granskning",
    requiresApproval: true,
    verification: "Godkänd",
  },
  {
    id: "TASK-0002",
    agent: "Systems & QA",
    type: "Verifiera leveransstatus",
    priority: "Normal",
    status: "Pågår",
    requiresApproval: false,
    verification: "Ej påbörjad",
  },
  {
    id: "TASK-0003",
    agent: "Customer Success",
    type: "24-timmarspåminnelse",
    priority: "Normal",
    status: "Kö",
    requiresApproval: true,
    verification: "Ej påbörjad",
  },
  {
    id: "TASK-0004",
    agent: "Growth",
    type: "Experimentutvärdering",
    priority: "Låg",
    status: "Klar",
    requiresApproval: false,
    verification: "Godkänd",
  },
  {
    id: "TASK-0005",
    agent: "Admin & Finance",
    type: "Kostnadssammanställning",
    priority: "Låg",
    status: "Kö",
    requiresApproval: false,
    verification: "Ej påbörjad",
  },
];

const REVIEWS = TASKS.filter((t) => t.requiresApproval);

function AgentHqPage() {
  return (
    <AdminShell title="Noryva Agent HQ">
      <div className="space-y-8">
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">FOUNDATION / TEST</p>
          <p className="text-muted-foreground">
            Detta är en grundvy utan koppling till drift. Inga agenter körs, inga AI-anrop görs och
            ingen agent får utföra externa actions. All data nedan är exempeldata.
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
              <div key={s.name} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="secondary">Specialistagent</Badge>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Uppgiftskö</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Uppgifts-id</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Prioritet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Kräver godkännande</TableHead>
                  <TableHead>Verifiering</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TASKS.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.id}</TableCell>
                    <TableCell>{t.agent}</TableCell>
                    <TableCell>{t.type}</TableCell>
                    <TableCell>{t.priority}</TableCell>
                    <TableCell>{t.status}</TableCell>
                    <TableCell>{t.requiresApproval ? "Ja" : "Nej"}</TableCell>
                    <TableCell>{t.verification}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Granskning och godkännande</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Här kommer en människa framöver att godkänna eller avvisa uppgifter innan något får
            utföras. Knapparna är avsiktligt inaktiva i detta steg.
          </p>
          <ul className="space-y-3">
            {REVIEWS.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div>
                  <p className="font-medium">
                    {t.type} <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.agent} · Verifiering: {t.verification}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled
                    className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground opacity-60"
                  >
                    Godkänn
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-full border border-border px-4 py-2 text-sm opacity-60"
                  >
                    Avvisa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}
