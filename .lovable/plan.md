# Första riktiga AI-agenten i TEST (OpenAI, inte Lovable AI)

Målet: Sales-agenten och Orchestratorn får ett resonemangslager som drivs direkt av OpenAI:s Responses API med en egen serverhemlighet. Allt förblir TEST-läge, allt kundnära går till manuell granskning, ingenting skickas ut.

## Du behöver göra en sak själv

`OPENAI_API_KEY` finns inte i projektet i dag. Lägg in den under Projektinställningar → Secrets. Utan nyckeln kraschar ingenting: agenten faller automatiskt tillbaka till dagens deterministiska logik och markerar det i resultatet.

## Vad som byggs

**1. Nytt resonemangslager `src/lib/agents/reasoning.server.ts`**
- Anropar `https://api.openai.com/v1/responses` direkt, server-side, med `OPENAI_API_KEY` läst via befintlig `runtimeEnvFromRequest`/`process.env`-hjälp.
- Max **ett** anrop per uppgift. Ingen retry, ingen kedja, inga verktyg.
- Strikt JSON-schema (`text.format: json_schema`, `strict: true`), varje fält obligatoriskt, inga extra fält.
- Timeout via abort efter en fast gräns (default 20 s, konfigurerbar med env).
- Vid saknad nyckel, timeout, HTTP-fel, ogiltig JSON eller schemafel: deterministisk fallback till dagens `runSalesWorker`, med `usedFallback: true` och orsakskod.
- Prompten får endast PII-fri kontext (återanvänder befintlig maskering i `ai-sales/context.ts` + `redactText`).

**2. Orchestrator: regler först, LLM bara vid oklarhet**
- `routeEvent()` är oförändrad för kända event.
- Ny funktion som endast används när ett event/uppdrag är oklassificerbart; den kan fråga modellen om vilken specialist/uppgiftstyp som passar, men resultatet valideras mot befintliga tillåtna värden. Faller annars tillbaka till dagens regelval.
- Kända event (`new_lead`, `delivery_error`, `lead_followup_due`) ger fortfarande **0 LLM-anrop**.

**3. Sales-agenten får använda modellen**
- `buildTaskResult` i `src/lib/agents/run.server.ts` kör LLM-vägen för Sales när nyckel finns och läget är test; annars deterministiskt.
- Resultatet passerar befintlig `verifyTaskResult` som förut. Underkänt utkast blockeras av verifieringen, inte av modellen.
- Kundnära uppgifter hamnar fortfarande i `awaiting_review` med `pending` godkännande.

**4. Kostnads- och försöksfält + audit**
- Resultatet får `llm: { used, model, attempts (0/1), usedFallback, fallbackReason, latencyMs, inputTokens, outputTokens }`.
- Nya auditrader `llm_call` (actor `agent`) med endast metadata: modell, försök, fallback-orsak, tokens, latens. Ingen prompt, inget svar, ingen lead-PII.

**5. Spärrar som behålls oförändrade**
- Endast `execution_mode = "test"` behandlas; övrigt nekas som i dag.
- Ingen mail, SMS, bokning, Make-callback eller annan extern effekt.
- Ingen ändring i Growth-flöden, nurture, publika formulär, produktionsroutes eller UI/design.

## Tester

Nya tester i `src/lib/agents/reasoning.server.test.ts` samt tillägg i befintliga agenttester, alla med mockad `fetch`:
- känt event ger 0 LLM-anrop, Sales-körning ger exakt 1
- saknad `OPENAI_API_KEY` → deterministisk fallback, inget krasch, inget nätverksanrop
- HTTP-fel och ogiltigt schema → fallback med orsakskod
- timeout → fallback, exakt ett försök
- audit och svar innehåller ingen PII och ingen nyckel
- godkännandespärren: Sales hamnar i `awaiting_review`/`pending`
- `execution_mode != test` nekas fortfarande

Därefter körs hela testsviten och typkontroll. Ingen publicering.

## Filer som berörs

- ny: `src/lib/agents/reasoning.server.ts`, `src/lib/agents/reasoning.server.test.ts`
- ändras: `src/lib/agents/run.server.ts`, `src/lib/agents/tasks.ts` (endast ny valfri oklarhets-routing), `docs/agent-hq.md`
- eventuellt: små tillägg i `src/lib/agents/run.server.test.ts`
