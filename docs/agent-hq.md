# Noryva Agent HQ

Status: **TEST/REVIEW.** Orchestrator, Sales och Systems & QA har nu persistent
backend, men allt är internt: inga AI-anrop, inga mail, inga bokningar och inga
Make-actions. Godkännande ändrar endast intern status.

## Arkitektur

```text
EVENT -> ORCHESTRATOR -> TASK -> SPECIALIST -> VERIFICATION -> APPROVAL
```

- **EVENT** – `new_lead`, `delivery_error`, `lead_followup_due`. Skapas manuellt
  från `/admin/agents` i detta steg.
- **ORCHESTRATOR** – `routeEvent()` i `src/lib/agents/tasks.ts`. Helt
  deterministisk: ett event ger exakt en uppgift till exakt en specialist.
- **TASK** – rad i `agent_tasks`. Varje mutation loggas i `agent_task_events`
  med actor (`human` | `agent` | `system`), event_type och detail.
- **SPECIALIST** – Sales (`runSalesWorker`, återanvänder `qualifyLead` och
  kundprofilens uppföljningsregler) eller Systems & QA (leveranskontroll).
- **VERIFICATION** – `verifyTaskResult()` kontrollerar resultatet mot enkla
  regler: ämnesrad, längd, hälsning, ingen e-post/telefon i text, inget
  pris-/offertprat, och att kundnära utkast kräver godkännande.
- **APPROVAL** – människa godkänner eller avvisar. Godkännande kräver
  `verification_status = passed`.

## Statusmaskin

```text
queued -> in_progress -> awaiting_review -> done | cancelled
queued -> cancelled | failed
failed -> queued
done, cancelled = terminala
```

`verification_status`: `not_started | passed | failed`.
`approval_status`: `not_required | pending | approved | rejected`.
Ogiltiga värden blockeras av CHECK-villkor i databasen och ogiltiga övergångar
av `assertTransition()` server-side.

## Maskin-till-maskin (TEST)

`POST /api/public/agents/dispatch-test` låter vårt separata Make TEST-scenario
skicka in ett event. Endpointen återanvänder Growth API:s säkerhetslager
(`NORYVA_GROWTH_API_SECRET`, timestamp-/signatur-/event-id-headers, replayskydd
och throttling) och kör exakt samma `routeEvent()` + idempotens som
admin-funktionen.

- Payload: `{ type, leadId, occurrence? }` – inget annat accepteras.
- Service-rollen används först efter verifierad signatur.
- Svar: `{ ok, taskId, duplicate, assignedAgent, taskType, priority,
  requiresApproval, executionMode: "test", externalEffect: false }`.
- Endpointen skapar ENDAST en uppgift. Workers, verifiering och godkännande är
  fortfarande manuella och test-only i `/admin/agents`.

## Säkerhetsspärrar

- Alla serverfunktioner kräver inloggad admin (`has_role`).
- RLS på `agent_tasks` och `agent_task_events` släpper endast in admin.
- `execution_mode` kan bara vara `test` eller `review`; live saknas.
- Ingen worker anropar nätverket, LLM, mail, SMS, kalender eller Make.
- Resultatet innehåller ingen personuppgift; endast poäng, prioritet och en
  generisk intern text.
- Idempotens: `agent_tasks.idempotency_key` är unik per event + lead +
  occurrence, så samma testhändelse skapar aldrig en dubblett.

## Kvar innan en agent får externa verktyg

1. Kanalregister med verifierad avsändaridentitet per kund (finns i
   `customer_mail_channels`) kopplat till agentens uppgifter.
2. Claim/complete/fail-flöde med transport-id och idempotens, i linje med
   nurture-review, innan något får skickas.
3. Regler för när ett godkännande får utlösa en action, plus spärr mot
   auto-retry vid okänd transportstatus.
4. Kostnadstak och budgetkoppling om Orchestrator/Sales någon gång ska använda
   LLM.
5. Reconciliation-vy för uppgifter som fastnar i `in_progress`.
