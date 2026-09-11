# Agent HQ v2 – Lovable som kontrollpanel, Supabase som kontrollager, OpenAI Agents API som harness

Sammanhållen refaktor av befintlig Agent HQ. Ingen redesign utanför Agent HQ, inga Make-, mail- eller formulärändringar, ingen publicering.

## Roller i v1

Aktiva:
- **Noryva Manager (COO)** – tar emot mål/händelser, prioriterar och delegerar internt. Läser endast aggregerade, PII-fria sammanställningar. Skapar interna uppgifter, aldrig produktionseffekt.
- **Product & Tech** – granskar systemets drift och föreslår förbättringar/patchplaner. Analyserar och testar i kontrollerat läge, men får aldrig publicera, ändra produktion, Make, mail eller kunddata.

Vilande/planerade (syns men går inte att köra): Growth & Sales, Customer Success, QA/Risk.
Admin & Finance behålls endast som bakåtkompatibelt värde i databasen och visas inte som roll.

Befogenhetskedjan visas i vyn: LÄSA → ANALYSERA → FÖRESLÅ → TESTA → BE OM GODKÄNNANDE → UTFÖRA, där UTFÖRA är spärrat i denna version.

## Arkitektur

```text
Lovable/Agent HQ (kontrollpanel)
        |  admin-gated serverfunktioner
Supabase (uppgifter, audit, godkännanden, budget, run-metadata)
        |  isolerad server-adapter
OpenAI Agents API (agent-harness)
```

- **Adapter** `src/lib/agents/openai-agents.server.ts`: typad create/status-hantering mot officiella `openai`-paketet (`beta.agents.sessions`, verifierad REST-form `POST /v1/agents/sessions` med `OpenAI-Beta: agents=v1`). Miljö `type: "none"` – ingen sandbox, inga verktyg, inga externa actions. Nycklar stannar server-side.
- **Fail closed**: saknas `OPENAI_API_KEY` eller agentkonfiguration körs inget agent-run alls. Adaptern rapporterar `configured: false` och Agent HQ visar "Ej konfigurerad". Ingen tyst fallback till externa effekter.
- **Legacy**: nuvarande Responses-baserade `reasoning.server.ts` behålls som uttryckligen märkt legacy/test-fallback för gamla uppgiftstyper och väljs aldrig automatiskt när Agents API är konfigurerat.
- **Make**: orörd.

## Kostnad och körning

- Ett Manager-run per användarstart/händelse. Specialist-run skapas bara om Manager faktiskt delegerar.
- Hårt tak per uppgift: max antal provider-run och en konservativ run-budget. Saknas budget stoppas körningen innan nytt agent-run startas.
- Usage (tokens/kostnad) lagras när providern rapporterar den; annars räknas antal run mot taket.
- Ingen polling-loop som kostar när inget händer – körningar startas explicit.

## Datamodell (minimal, icke-destruktiv migration)

Nya kolumner på `agent_tasks`: `provider_type`, `provider_agent_id`, `provider_run_id`, `run_status`, `usage`, `run_budget`, `runs_used`.
Utökade CHECK-villkor för `assigned_agent` (`noryva_manager`, `product_tech`) och `task_type` (`manager_directive`, `product_tech_review`). Inga kolumner tas bort och gamla uppgifter bevaras.

## Agent HQ UI (ingen redesign)

Samma layout och komponenter. Uppdateras med: aktiva v1-roller, vilande roller, befogenhetskedjan, harness-status ("OpenAI Agents API – ansluten" / "Ej konfigurerad"), samt providerRunId/run-status/usage per uppgift. Uppgiftskö, verifiering, godkänn/avvisa och senaste händelser behålls. Texten som pekar ut Sales som primär agent tas bort.

## Dokumentation och tester

`docs/agent-hq.md` uppdateras med nya arkitekturen, gränsdragningen och en MIGRATION/ROLLBACK-sektion.
Tester: fail-closed konfiguration, idempotens, budgetspärr, mänskligt godkännande och att inga externa effekter kan triggas. Inga riktiga OpenAI-agentkörningar görs.

## Manuellt efteråt

Följande måste sättas manuellt av dig innan harnessen kan aktiveras (skapas aldrig i kod):
`NORYVA_AGENTS_API_ENABLED`, samt vid behov `NORYVA_OPENAI_MANAGER_AGENT_ID` och `NORYVA_OPENAI_PRODUCT_TECH_AGENT_ID`. `OPENAI_API_KEY` finns redan.
