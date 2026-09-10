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
- Endpointen skapar ENDAST en uppgift.

`POST /api/public/agents/process-test` kör och verifierar EN redan skapad
uppgift, med samma säkerhetslager och samma secret (ingen ny secret).

- Payload: `{ taskId }` – inget annat accepteras.
- Endast `execution_mode = "test"` behandlas; review/live/okänt läge ger 403 och
  okänt id ger 404.
- Kör samma deterministiska worker och `verifyTaskResult()` som adminvyn via den
  gemensamma kärnan `src/lib/agents/run.server.ts`.
- Idempotent: endast `queued` startas (atomisk övergång). Redan behandlade
  uppgifter svarar `alreadyProcessed: true` utan ny effekt, och `in_progress`,
  `failed` eller `cancelled` auto-retryas aldrig (409).
- Audit: `task_started`, `result_saved`, `task_verified` med actor `agent`/
  `system` och endast metadata/regelresultat – aldrig lead-PII.
- Godkännande är fortfarande mänskligt i `/admin/agents`. Ingen LLM, inga mail,
  SMS, bokningar eller Make-callbacks.

`POST /api/public/agents/shadow-review-test` fyller en separat intern
Shadow Review-kö från nyliga, verkliga leads utan att köra Sales-workern.

- Payload: `{ executionMode: "test", limit?, recentHours? }`; `limit` är högst
  10 och andra körlägen avvisas.
- Endast lead-id, customer-id och created_at läses. Lead-payload och PII läses
  eller returneras inte.
- Saknad lead- eller kundbindning hoppas över utan gissningar.
- Varje lead routas som `new_lead` med occurrence `shadow-review-v1`, vilket ger
  en idempotent, köad Sales-uppgift i testläge med väntande godkännande.
- Svaret innehåller endast räknare och task-id:n samt `externalEffect: false`.
- Endpointen kör aldrig worker/OpenAI och påverkar inte Make-, mail-, CRM-,
  Growth-, nurture- eller formulärflöden. Processkedjan anropas separat.

`POST /api/public/agents/process-shadow-batch-test` (Auto Process Review Mode)
processar den kön EN uppgift i taget genom befintlig Sales-worker + QA.

- Payload: `{ executionMode: "test", limit?: 1..3 }` (strict). Batchtaket är 3
  per körning för kostnadskontroll.
- Plockar endast `queued` Sales-uppgifter med `source_event=new_lead`,
  `task_type=sales_draft`, `execution_mode=test` och idempotensnyckel som slutar
  på `shadow-review-v1`.
- Återanvänder `processAgentTaskCore`: högst ett OpenAI-anrop per uppgift, ingen
  retry-loop och befintlig deterministisk fallback vid fel/saknad nyckel.
- Concurrency: claim sker via villkorad övergång `queued -> in_progress`, så två
  samtidiga batchar kan aldrig processa samma uppgift dubbelt (förloraren
  räknas som `skipped`).
- Ingen auto-approval: kundnära uppgifter stannar i `awaiting_review` med
  `verification_status=passed` och `approval_status=pending`.
- Svaret innehåller `scanned`, `processed`, `awaitingReview`, `failed`,
  `skipped`, `taskIds` och `externalEffect: false` – ingen PII eller mailtext.
- Audit `shadow_batch_processed` loggar endast metadata.

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

## Resonemangslager (OpenAI, TEST-only)

`src/lib/agents/reasoning.server.ts` anropar OpenAI Responses API direkt
(`https://api.openai.com/v1/responses`) med serverhemligheten `OPENAI_API_KEY`.
Lovable AI Gateway används inte.

Regler:
- Max **1** anrop per uppgift. Ingen retry, inga verktyg, ingen kedja.
- Strikt JSON-schema (`strict: true`). Ogiltigt svar → deterministisk fallback.
- Timeout (default 20 s) → deterministisk fallback, fortfarande ett försök.
- Saknad nyckel → ingen nätverkstrafik alls, deterministisk fallback.
- Prompten är PII-fri (PII-nycklar filtreras bort och fri text maskeras).
- Orchestratorn är regelstyrd; kända event kostar 0 LLM-anrop. Endast oklara
  event kan gå via `classifyUnclearEvent`, vars svar valideras mot tillåtna
  agenter/uppgiftstyper.
- Sales-resultatet bär `llm: { used, model, promptVersion, attempts, usedFallback,
  fallbackReason, latencyMs, inputTokens, outputTokens }` och loggas som
  auditeventet `llm_call` med endast metadata.
- Kundnära resultat går fortfarande till `awaiting_review` med manuellt
  godkännande. Inga mail, bokningar, Make-callbacks eller andra externa effekter.

## CTO / Systems Improvement Agent (v1, TEST/REVIEW)

Intern agent som granskar Noryva-systemet självt, inte ett lead.

- Skapas via adminknappen "Skapa systemgranskning" i Agent HQ eller via
  HMAC-endpointen `POST /api/public/agents/improvement-review-test`
  (payload strikt `{ "executionMode": "test" }`). En granskning per dygn
  (idempotensnyckel `internal_improvement:<YYYY-MM-DD>`), utan `lead_id`.
- Körs med befintlig `processAgentTaskCore`: samma state machine, samma
  atomiska claim och samma PII-fria audit (`task_started`, `llm_call`,
  `result_saved`, `task_verified`).
- Läser endast aggregerad drifttelemetri: agent_tasks-statusar,
  agent_task_events-typer, ai_cost_events-summor, inbound_webhook_events
  signaturandel och antal leads per leveransstatus. Aldrig payloads,
  kontaktuppgifter eller mailtext.
- Max ETT `gpt-5.4-mini`-anrop, ingen retry, konservativ deterministisk reserv.
- Resultat: `summary`, `healthScore`, `findings[]`, `recommendations[]` och ett
  färdigt `implementationPrompt` som en människa kan godkänna senare.
- Agenten ändrar aldrig kod, Make, mail eller annan data än sin egen uppgift.
  `externalEffect: false`, allt stannar i `awaiting_review`.
