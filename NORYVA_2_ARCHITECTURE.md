# Noryva 2.0 – Growth Engine

Intelligens- och optimeringslager ovanpå den befintliga AI-säljassistenten.
Målet är bättre affärsresultat till lägsta möjliga AI-kostnad per lead.

**Läge: TEST/REVIEW.** Inga externa utskick, inga bokningar, ingen auto-send.
Optimizern rekommenderar – den ändrar aldrig produktion.

## Datapath

```text
Lead (publikt formulär, oförändrat)  ->  leads + Make-webhook (oförändrad)
  -> deterministisk kvalificering (qualify.ts / scoring.ts)
  -> ROUTER (growth/router.ts)
       deterministic | ai_light | ai_full | human   + reason
  -> deterministic: rekommendation utan LLM-anrop (0 kr)
     ai_light/ai_full: ETT strukturerat anrop = Research + Sales i samma svar
     human: pris/offert/klagomål/juridik -> handläggare, aldrig AI
  -> utkast sparas i ai_sales_assistant_runs (befintlig granskningskö)
  -> ai_cost_events loggar nivå, modell, tokens och uppskattad kostnad
  -> growth_assignments: stabil variant per lead (experiment)
  -> growth_outcomes: lead_created -> contacted -> replied -> meeting_booked -> won/lost/revenue
  -> OPTIMIZER (batch, aldrig per lead) -> growth_recommendations
```

## Princip: Low-cost nurture, never discard relevant leads

Ett lead med låg intent kastas aldrig bort – det hanteras billigare. LÅG betyder
0 AI-anrop och deterministisk rekommendation, men leadet ligger kvar och kan
när som helst uppgraderas av nya signaler.

## Intent Engine (growth/intent.ts)

Deterministisk score 0–100. Ingen LLM används för att räkna score.

| Signal | Effekt |
| --- | --- |
| `lead_created` | basnivå = befintlig kvalificeringspoäng |
| `contacted` | +3 (liten/neutral) |
| `replied` | +18 |
| `meeting_booked` | +32 |
| `revenue` | +6 (dubbelräknar inte `won`) |
| `won` | terminalt 100 |
| `lost` | terminalt 0 |

Trösklar: ≥70 = HÖG, ≥40 = NORMAL, annars LÅG. AKUT sätts aldrig av score utan
endast av befintliga hårda regler och vinner över intent-nivån. Uteblivet svar
efter uppföljning påverkar inte score idag – ingen sådan event-typ finns, och
inga events hittas på.

Score räknas om idempotent i `recomputeIntent(leadId)` från initial
kvalificering + `growth_outcomes`, och sparas i `growth_lead_state`
(`intent_score`, `intent_level`, `intent_reason`, `intent_terminal`,
`intent_updated_at`). `registerOutcome` triggar omräkningen – utan externa
actions.

Routern använder aktuell intent-nivå när den finns, men människoregler,
budgetdegradering och komplexitet gäller före.

## Routerregler (growth/router.ts)


| Villkor | Route | LLM-anrop |
| --- | --- | --- |
| Pris, offert, avtal, klagomål, juridik | `human` | 0 |
| AI avstängd för kunden | `deterministic` | 0 |
| Prioritet LÅG, komplett underlag, normal confidence | `deterministic` | 0 |
| Prioritet AKUT/HÖG, ≥2 saknade fält eller confidence < 0.5 | `ai_full` | 1 |
| Prioritet NORMAL | `ai_light` | 1 |

Budgetdegradering: `warn` (≥80 %) sänker `ai_full → ai_light`, `exceeded` (100 %)
sänker allt till `deterministic`. Budget per kund och dygn/månad ligger i
`customer_profiles.ai_daily_budget_usd` / `ai_monthly_budget_usd`.

## Modellnivåer (growth/cost.ts)

| Nivå | Modell | Användning |
| --- | --- | --- |
| `deterministic` | – | regler och scoring, noll kostnad |
| `ai_light` | `openai/gpt-5.4-mini` | normalfall, kort kontext (3 000 tecken) |
| `ai_full` | `openai/gpt-6-astra` | komplexa och högprioriterade fall |
| `optimizer` | `openai/gpt-5.4-mini` | endast batch över aggregerad statistik |

Kostnad uppskattas per anrop och loggas i `ai_cost_events`.

## Agentroller

Research/kvalificering och Sales är två roller i **ett** svar
(`growth/agents.ts`, `growthAnalysisSchema`). Optimizern körs aldrig per lead;
den läser aggregerad statistik och föreslår vinnare enligt
minsta urval, exploration floor och minsta relativa förbättring.

## Tabeller

`growth_experiments`, `growth_variants`, `growth_assignments`,
`growth_outcomes` (unik idempotensnyckel), `growth_recommendations`,
`ai_cost_events`. Alla med RLS: endast `has_role(auth.uid(), 'admin')`.

## Serverfunktioner (src/lib/growth.functions.ts)

| Funktion | Request | Response |
| --- | --- | --- |
| `routeLead` | `{ leadId }` | `{ decision, qualification, budget, usage }` |
| `analyzeLead` | `{ leadId, forceTier? }` | `{ ok, decision, tier, model, cost, runId, research }` |
| `assignLeadVariant` | `{ leadId, experimentId? }` | `{ assigned, experimentId, variantId }` |
| `registerOutcome` | `{ leadId, outcomeType, outcomeValue?, revenueValue? }` | `{ ok, created, idempotencyKey }` |
| `getGrowthRecommendation` | `{ experimentId, persist? }` | `{ experiment, variants, metrics, recommendation }` |
| `getGrowthDashboard` | – | dagens/månadens kostnad, experiment, rekommendationer |

## Publika Make-endpoints (HMAC-verifierade)

Alla ligger under `/api/public/growth/*`, tar `POST` med JSON och kräver
**ingen** adminsession. Service-rollen används först efter godkänd signatur.

| Path | Body | Svar |
| --- | --- | --- |
| `/api/public/growth/route-lead` | `{ leadId }` | `{ leadId, route, requestedRoute, reason, requiresHuman, llmCalls, budgetState, qualification, intent: { score, level, reason } }` |
| `/api/public/growth/analyze-lead` | `{ leadId }` | `{ ok, leadId, route, tier, model, llmCalls, estimatedCost, usedFallback, runId, requiresHuman }` |
| `/api/public/growth/assign-variant` | `{ leadId, experimentId? }` | `{ assigned, experimentId, variantId, variantName, reused }` |
| `/api/public/growth/register-outcome` | `{ leadId, outcomeType, outcomeValue?, revenueValue? }` | `{ ok, created, idempotencyKey }` |
| `/api/public/growth/growth-recommendation` | `{ experimentId }` | `{ experimentId, status, metrics, recommendation }` |

Scheman är `strict`: okända fält avvisas med 400. `analyze-lead` tar inte emot
någon tier – routern avgör ensam om AI får köras, så en klient kan aldrig
tvinga fram `ai_full`.

### Headers

```text
content-type: application/json
x-noryva-timestamp: <unix-sekunder>
x-noryva-signature: hex(HMAC-SHA256(NORYVA_GROWTH_API_SECRET, "<timestamp>.<raw body>"))
x-noryva-event-id: <unikt id per anrop>
```

Hemligheten läses från env-variabeln `NORYVA_GROWTH_API_SECRET` (Project
Settings → Secrets). Den finns aldrig i klientkod och står aldrig i repot.

### Exempel

```http
POST /api/public/growth/route-lead
x-noryva-timestamp: 1767225600
x-noryva-signature: 9f1c...   (exempel, inte en riktig signatur)
x-noryva-event-id: make-9f2b1d

{ "leadId": "11111111-1111-4111-8111-111111111111" }
```

```json
{
  "leadId": "11111111-1111-4111-8111-111111111111",
  "route": "deterministic",
  "requestedRoute": "deterministic",
  "reason": "Låg prioritet och tydligt standardfall – inget AI-anrop behövs.",
  "requiresHuman": false,
  "llmCalls": 0,
  "budgetState": "ok",
  "qualification": { "score": 0, "qualification": "Låg", "priority": "LÅG" }
}
```

### Felkoder

| Status | Orsak |
| --- | --- |
| 400 | Saknat event-id, ogiltig JSON eller fält utanför schemat |
| 401 | Saknad/felaktig signatur eller för gammal tidsstämpel (>300 s) |
| 405 | Annat än POST |
| 409 | Replay: samma `x-noryva-event-id` har redan behandlats |
| 413 | Nyttolast över 20 kB |
| 429 | Throttling (60 anrop/minut och IP) |
| 500 | Hemlighet saknas eller internt fel |

Replayskydd sker i `inbound_webhook_events` (unik `source + external_id`).
`register-outcome` är dessutom idempotent i `growth_outcomes`.

### Throttling – nästa hårdningssteg

Nuvarande throttling är per serverinstans (in-memory) och är ett skydd mot
skenande anrop, inte en distribuerad rate limit. Nästa steg vid behov är en
räknare i databasen eller en IP-tillåtelselista för Make.

## Så kopplas Make om senare (minimerad AI-kostnad)

1. Make skickar leadet som idag till `/offert`-flödet. Inget kontrakt ändras.
2. Make anropar `route-lead`. Är svaret `deterministic` eller `human` görs
   **inget** AI-anrop – Make använder den deterministiska rekommendationen
   respektive notifierar en handläggare.
3. Endast vid `ai_light`/`ai_full` anropar Make `analyze-lead`.
4. Make anropar `assign-variant` när ett experiment körs.
5. Make rapporterar tillbaka utfall med `register-outcome` (idempotent – samma
   anrop kan skickas om utan dubbletter).
6. En schemalagd batch hämtar `growth-recommendation` per experiment.

Endpointerna finns nu och är signaturverifierade. Det som återstår innan Make
kopplas om är att sätta `NORYVA_GROWTH_API_SECRET` och publicera – ingen
ändring är gjord i det aktiva Make-scenariot.


## Medvetet avstängt

Auto-send, riktig e-postkanal, inkorg, kalenderbokning, live-läge och
automatisk viktjustering utifrån optimizerns förslag.
