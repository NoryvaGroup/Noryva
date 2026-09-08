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

## Så kopplas Make om senare (minimerad AI-kostnad)

1. Make skickar leadet som idag till `/offert`-flödet. Inget kontrakt ändras.
2. Make anropar `routeLead`. Är svaret `deterministic` eller `human` görs
   **inget** AI-anrop – Make använder den deterministiska rekommendationen
   respektive notifierar en handläggare.
3. Endast vid `ai_light`/`ai_full` anropar Make `analyzeLead`.
4. Make anropar `assignLeadVariant` när ett experiment körs.
5. Make rapporterar tillbaka utfall med `registerOutcome` (idempotent – samma
   anrop kan skickas om utan dubbletter).
6. En schemalagd batch hämtar `getGrowthRecommendation` per experiment.

Detta kräver att endpointerna exponeras som publika, signaturverifierade
routes under `src/routes/api/public/*`. Det är **inte** gjort i den här fasen;
funktionerna är i dag admin-skyddade serverfunktioner.

## Medvetet avstängt

Auto-send, riktig e-postkanal, inkorg, kalenderbokning, live-läge och
automatisk viktjustering utifrån optimizerns förslag.
