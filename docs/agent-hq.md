# Noryva Agent HQ

Status: **TEST/REVIEW.** Alla sex interna roller (Noryva Manager + fem specialister) är tekniskt aktiva, men provider-körning är fail closed tills global konfiguration är på.
v1-rollerna. OpenAI Agents API är förberett som fail-closed harness; utan
uttrycklig serverkonfiguration startas inget provider-anrop. Inga mail,
bokningar, Make-actions eller produktionseffekter kan utföras. Godkännande
ändrar endast intern status.

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

## Agent HQ v2 – Manager + Product & Tech (OpenAI Agents API)

Arkitektur:

```text
Lovable / Agent HQ   = kontrollpanel (roller, kö, kostnad, audit, godkännande)
Noryvas backend      = kontroll- och auditlager (agent_tasks, agent_task_events,
                       godkännanden, budget, provider-metadata)
OpenAI Agents API    = agent-harness (sessioner, orkestrering, kontext)
Make                 = ingen agenthjärna, orört
```

Aktiva roller:

- **Noryva Manager (COO)** – tar mål/händelser, prioriterar och delegerar
  internt. Läser endast aggregerad, PII-fri drifttelemetri.
- **Product & Tech** – granskar systemet och föreslår förbättringar plus ett
  färdigt `implementationPrompt`. Får aldrig publicera, ändra produktion, Make,
  mail eller kunddata.
- **Growth & Sales**, **Customer Success**, **QA / Risk** och
  **Operations & Finance** – separata, sparade specialistroller. Strategy &
  Innovation är endast planerad och kan inte köras.

Admin & Finance finns kvar som bakåtkompatibelt värde i databasen men visas inte.

Befogenhetskedja: `LÄSA -> ANALYSERA -> FÖRESLÅ -> TESTA -> BE OM GODKÄNNANDE ->
UTFÖRA`. UTFÖRA är spärrat (`AUTHORITY_EXECUTE_ENABLED = false`).

Adapter: `src/lib/agents/openai-agents.server.ts` – enda platsen som pratar med
providern. `POST https://api.openai.com/v1/agents/sessions` med headern
`OpenAI-Beta: agents=v1`. Återanvändbara agenter skickas som top-level
`agent_id` och miljön som:

```json
{ "type": "openai_hosted", "environment_template_id": "envtmpl_..." }
```

Ingen streaming, inga verktyg, ingen retry. Saknas `NORYVA_AGENTS_API_ENABLED=true`,
`OPENAI_API_KEY` eller environment template görs INGET anrop och Agent HQ visar
"Ej konfigurerad". När `agent_id` används skriver Noryva varken över agentens
modell eller dess permanenta instruktioner – uppgiftens mål och PII-fri telemetri
läggs i session-input, och server-side policytext används bara som safety guard.

Kontrollager: `src/lib/agents/v2.server.ts` – idempotent uppgiftsskapande,
budgetspärr (`run_budget`/`runs_used`, ett run per uppgift), atomisk claim
`queued -> in_progress`, PII-fri audit och verifiering. Managers delegering
SKAPAR endast en specialistuppgift; den körs aldrig i samma kedja utan kräver en
egen explicit körning.

Legacy: `src/lib/agents/run.server.ts` + `reasoning.server.ts` (Responses API)
är kvar för de äldre uppgiftstyperna och väljs aldrig för v2-rollerna.

### Mandat: FRIA HJÄRNOR, HÅRDA HÄNDER

Interna agenter har **brett analys- och förbättringsmandat** men **inget
autonomt exekveringsmandat**.

Fritt (analys/förslag):
- granska hela Noryva ur sitt specialistperspektiv och ifrågasätta arkitektur,
  produkt, erbjudande, prismodell, onboarding, sälj, kundresa, kostnader och
  arbetssätt
- föreslå nya funktioner, experiment, refactors, effektiviseringar,
  implementationsplaner/prompts och prioriterade actions
- lyfta relevanta problem utanför agendans exakta formulering
- säga emot Manager och andra specialister, jämföra alternativ och rekommendera
  en tydlig väg
- cross-review/debatt mellan roller är önskvärt, inte ett undantag. QA/Risk gör
  slutgranskning men är inte ett kreativt filter: oprövade förslag märks med
  risk/antagande i stället för att stoppas. QA nekar endast det som bryter mot
  hårda spärrar.

Hårt spärrat (oförändrat): inga kundmail/SMS/bokningar, inga
Make-produktionsändringar, ingen publicering/deploy på agentens initiativ, ingen
ändring av kunddata eller externa system, inget irreversibelt och ingen ökad
spend utan mänskligt godkännande. `AUTHORITY_EXECUTE_ENABLED = false` och
`AGENT_EXTERNAL_ACTIONS_ENABLED = false` gäller fortfarande. Astra används inte
som execution provider.

### Agentmöten / Boardroom

Manuella interna möten lagras i `agent_meetings` och det faktiska transkriptet i
`agent_meeting_messages`. Högst ett möte är aktivt samtidigt. Flödet är
`draft -> manager kickoff -> round 1 -> valfri cross-review -> QA/Risk -> manager
synthesis -> awaiting approval`. Manager väljer 2–5 av de fem aktiva
specialisterna och ska inte överbegränsa scope. Varje anrop kör högst en sparad
agentroll och skapar en spårbar `agent_tasks`-rad märkt `boardroom_turn`.

Varje provider-turn reserveras atomiskt i befintliga `agent_run_ledger` via
`reserve_agent_run`. Manuella boardroom-runs omfattas av **hard cap 500 SEK**,
men INTE av soft cap eller per-roll/månadstaket för autonoma runs (de taken
gäller `run_kind = 'autonomous'`). Blockerad reservation ger `paused_budget`; inga
fler steg körs. Underlag kondenseras mellan rundorna och agenda med uppenbar
e-postadress eller telefonnummer avvisas. Det finns ingen execute-, publish- eller
send-status, ingen cronstart och inga externa verktyg.

### Miljövariabler

| Variabel | Krävs | Beskrivning |
| --- | --- | --- |
| `OPENAI_API_KEY` | ja | Enda hemligheten. Ska komma från OpenAI-projektet `proj_rkaXcjn0pJ2Xba3MxY27nFrK` (`kontakt@noryva.se`). |
| `NORYVA_AGENTS_API_ENABLED` | ja | `true` slår på harnessen. Utan den är allt fail closed. |
| `NORYVA_OPENAI_ENVIRONMENT_TEMPLATE_ID` | nej | Override. Default `envtmpl_28145d6c83734e1d9f2f88b52b3f009e87223290abd94f9785`. |
| `NORYVA_OPENAI_PROJECT_ID` | nej | Override. Default `proj_rkaXcjn0pJ2Xba3MxY27nFrK`. |
| `NORYVA_OPENAI_*_AGENT_ID` | nej | Override per roll, se tabellen nedan. |
| `NORYVA_OPENAI_AGENT_MODEL` | nej | Reservmodell endast när agent-id saknas. Standard `gpt-5.4-mini`. |

Agent-id, projekt-id och environment template är inte hemligheter och ligger som
server-side defaults i koden. Inga environment secrets läggs i templaten från
Noryva-koden.

### MIGRATION / ROLLBACK

Migrationen är additiv: nya nullbara/defaultade kolumner `provider_type`,
`provider_agent_id`, `provider_run_id`, `run_status`, `usage`, `run_budget`,
`runs_used` på `agent_tasks`, samt utökade CHECK-villkor för `assigned_agent`
och `task_type` (alla sex roller och deras uppgiftstyper stöds redan). Inga rader
eller kolumner tas bort.

Rollback: sätt `NORYVA_AGENTS_API_ENABLED` till `false` – då stoppas alla
provider-run direkt och gamla flöden fortsätter oförändrade.

## Målarkitektur: 1 Manager + 5 aktiva specialistroller

| Roll | Nyckel | Uppgiftstyp | OpenAI agent-id (default) | Env-override |
| --- | --- | --- | --- | --- |
| Noryva Manager (COO) | `noryva_manager` | `manager_directive` | `agent_95cc9942a05847fb9cce479340eed36adf10e2ea0029431ab4` | `NORYVA_OPENAI_MANAGER_AGENT_ID` |
| Product & Tech | `product_tech` | `product_tech_review` | `agent_87c79d1adf914afe85ad8d4d6d00273a4944facc95014bed89` | `NORYVA_OPENAI_PRODUCT_TECH_AGENT_ID` |
| Growth & Sales | `growth_sales` | `growth_sales_review` | `agent_29b1bef0218f478bb13c760e899255d8cae8bae0f1c8410bab` | `NORYVA_OPENAI_GROWTH_SALES_AGENT_ID` |
| Customer Success | `customer_success` | `customer_success_review` | `agent_616c6f367cb648bbbf647d8563316703aab81539fdad4f20a1` | `NORYVA_OPENAI_CUSTOMER_SUCCESS_AGENT_ID` |
| QA / Risk | `qa_risk` | `qa_risk_review` | `agent_43a8b74da1ba478cb29c749cbde48d197728ad6b7fd64ea28d` | `NORYVA_OPENAI_QA_RISK_AGENT_ID` |
| Operations & Finance | `operations_finance` | `operations_finance_review` | `agent_f1557f32b62e45e19d6dc47fa54eaedc17ab1e8ffcb549018e` | `NORYVA_OPENAI_OPERATIONS_FINANCE_AGENT_ID` |

Modellval sker i OpenAI-agenternas egen konfiguration: Manager, Growth & Sales,
Customer Success och Operations & Finance på GPT-5.4 mini / Medium; Product & Tech
och QA/Risk på GPT-5.4 / High.

Operations & Finance ersätter gamla `admin_finance` som synlig målroll. Det gamla
värdet finns kvar i databasens CHECK-villkor enbart för bakåtkompatibilitet.

### Kvarvarande spärrar

- `AUTHORITY_EXECUTE_ENABLED = false` och `AGENT_EXTERNAL_ACTIONS_ENABLED = false`.
  Godkännande ändrar endast intern status och utlöser aldrig extern åtgärd.
- Endast `test`/`review` som körläge; alla resultat kräver mänskligt godkännande.
- QA/Risk kan verifiera andra agenters resultat men får varken godkänna sin egen
  effekt eller ersätta mänsklig granskning.
- Manager-delegering skapar uppgift, kör den inte.

### Kvar innan första riktiga API-testet

1. Lägg `OPENAI_API_KEY` från projektet ovan server-side (Projektinställningar → Secrets).
2. Sätt `NORYVA_AGENTS_API_ENABLED=true`.

Inget annat manuellt steg återstår – agent-id och environment template är redan
konfigurerade i koden.

### Budgetmål

Globalt månadsmål för agentkostnad: **≤ 500 SEK**, med rekommenderad initial
soft cap på **300 SEK**. Målet är en driftregel och följs upp manuellt – ingen
valuta- eller betalningsintegration finns i koden.


## Kostnadstak och autonomt läge (v2)

### Budgetlager

Budgeten är Noryvas egen interna guardrail, inte OpenAI:s projektbudget.

- `src/lib/agents/budget.ts` – ren logik: modellpris per roll, USD→SEK (11.5),
  säkerhetsmarginal 1.25, schablon 12 000 in / 2 000 ut tokens, soft cap 300 SEK,
  hard cap 500 SEK (kan aldrig konfigureras högre), max 2 autonoma körningar
  **per agent/roll och dygn** och 360/månad globalt (6 roller × 2 × 30). Det
  globala månadstaket är endast ett skyddsnät – kostnadstaken 300/500 SEK är den
  primära totalspärren och stoppar normalt långt tidigare.
- Dygnstaket räknas per roll både i SQL (`reserve_agent_run` filtrerar på `role`)
  och i `evaluateBudgetGate`. Status `run_capped` visas bara när samtliga roller
  är capade för dygnet, eller när månadstaket nåtts.
- `src/lib/agents/budget.server.ts` – reservation och bokföring mot Supabase.
- SQL: tabellen `agent_run_ledger`, funktionen `reserve_agent_run(...)` med
  advisory lock (parallella workers serialiseras, taken kan inte passeras
  samtidigt) och `agent_budget_snapshot()` för adminvyns status.

Regler: hard cap stoppar **alla** körningar. Soft cap pausar **endast** autonoma
körningar; manuella körningar tillåts tills hard cap nås. Saknas usage från
providern bokförs den konservativa schablonkostnaden, aldrig noll.

### Autonomt läge

`src/lib/agents/autonomous.server.ts` kör högst **en** provider-körning per tick:

1. Finns en köad specialistuppgift körs den – och kedjar aldrig vidare.
2. Annars skapas och körs högst **en** Manager-kickoff per dygn (idempotent via
   datummärkt `idempotency_key`).

Allt sker i `review`-läge, kräver mänskligt godkännande och har
`externalEffect=false`. QA/Risk körs endast när en uppgift faktiskt köats.

### Scheduler (aktiv)

`POST /api/public/agents/autonomous-tick` schemaläggs av pg_cron-jobbet
`noryva-agent-hq-tick` (jobid 1, schema `7 * * * *`) via pg_net mot
`https://www.noryva.se/...` (www används direkt: pg_net följer inte 307).

Auth: en egen slumpad hemlighet genererades i databasen och ligger i Vault
(`noryva_agent_cron_secret`). Endast SHA-256-avtrycket lagras i
`public.agent_cron_auth` (service_role, RLS på, inga policies). Servern jämför
avtrycket i `src/lib/agents/cron-auth.server.ts`; värdet finns aldrig i kod,
loggar eller svar. `LOVABLE_CRON_SECRET` accepteras fortfarande som alternativ.
Fail closed: utan giltig token 401.

Tick:en är idempotent – extra anrop blir no-ops när dygnets kickoff redan skett,
inget arbete finns eller budget-/run-taken är nådda.

### Verifierat E2E (manuellt, riktiga anrop)

- Manager-körning: completed, structured output, delegerade **endast** en
  QA/Risk-uppgift (`queued`, `not_started`) – ingen kedjad körning.
- Specialistkörning i separat anrop: completed, verification `passed`,
  `awaiting_review`, `externalEffect=false`.
- `agent_run_ledger` bokförde båda körningarna; snapshot visade 0,60 SEK för
  månaden och 0 autonoma körningar.

## Pilot readiness (kund-onboarding)

Adminvyn `/admin/pilot` är **READ-ONLY** diagnostik: inga mutationer, inga
externa anrop (mail/SMS/Make), inga provider-runs. Reglerna bor i
`src/lib/readiness/rules.ts`, datainsamlingen i `src/lib/readiness.functions.ts`
(`listPilotReadiness`, admin-only via `requireSupabaseAuth` + `has_role`).

Läser: `customers`, `form_questions`, `customer_profiles`,
`customer_mail_channels`, `leads`, `nurture_reviews`,
`lead_reminder_deliveries`, `nurture_inbound_events`.

Kontroller, grupp CORE (lead pipeline):
- `published` – status = published (annars blockerande)
- `form` – minst 1 fråga (blockerande), minst 1 obligatorisk (varning)
- `webhook`, `recipient` – måste finnas
- `profile`, `notify` – kundprofil sparad och minst en notismottagare
- `delivery` – misslyckade leveranser blockerar, pending/0 leads ger varning

Grupp FULL (nurture/reply-automation):
- `mail` – mailkanal måste vara verified med avsändare och svarsadress
- `nurture` – fastnade/misslyckade poster blockerar, kö ger varning
- `reminders` – misslyckade/fastnade blockerar
- `replies` – inkomna svar som inte slutförts blockerar
- `ai`, `mode`, `contacted` – informativa/varningar

Statusregler (`evaluateReadiness`):
1. CORE har `fail` → **NO-GO**
2. CORE har `unknown` → **REVIEW** (fail-safe: oläsbar data blir aldrig grönt)
3. FULL har `fail`/`unknown` → **CORE READY**
4. Enbart varningar → **REVIEW**
5. Allt grönt → **FULL READY**

Testdata filtreras från standardvyn när status ≠ published eller när
slug/namn matchar test/e2e/router/demo/sandbox; visas via "Visa testdata".
Fastnad = `claimed` utan `sent_at` äldre än 30 minuter.
