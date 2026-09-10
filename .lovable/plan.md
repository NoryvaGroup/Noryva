# CTO / Systems Improvement Agent – v1 (REVIEW-läge)

Första interna agenten som granskar Noryva-systemet självt i stället för ett lead.
Analyserar → föreslår → skapar ett färdigt implementationPrompt. Ingen kodändring,
ingen publicering, inga externa actions. Allt stannar i "Väntar granskning".

## Vad som byggs

**1. Minsta säkra migration**
`agent_tasks.task_type` får ett nytt tillåtet värde: `cto_improvement_review`.
Inget annat rörs; `lead_id` är redan valfritt så interna uppgifter utan lead fungerar.
Rollback = återställ CHECK-villkoret till nuvarande fyra värden.

**2. Säker telemetri-läsning** (`src/lib/agents/improvement.server.ts`)
Endast aggregerad drift-metadata:
- `agent_tasks`: antal per status, verifiering, godkännandeläge, uppgiftstyp
- `agent_task_events`: antal per händelsetyp, andel LLM-reserv
- `ai_cost_events`: antal och summerad uppskattad kostnad per route/tier
- `inbound_webhook_events`: antal och andel med verifierad signatur
- `leads`: enbart antal per `delivery_status` (inga payloads)

Inga kontaktuppgifter, inga lead-payloads, ingen mailtext, inga kund-id:n i resultatet.

**3. Ett (1) OpenAI-anrop** via befintlig `callOpenAiStructured` (`gpt-5.4-mini`),
strikt JSON-schema, ingen retry, timeout → konservativ deterministisk reserv.

Resultatform:
```text
summary, healthScore (0-100),
findings[]        : { area, observation, severity }
recommendations[] : { title, priority, evidence, risk, suggestedAction }
implementationPrompt : färdig text att senare ge Lovable vid godkännande
```

**4. Skapa + kör på begäran**
- Adminfunktion `createImprovementReview` i `src/lib/agents.functions.ts` (admin-gated).
- HMAC-skyddad TEST-endpoint `POST /api/public/agents/improvement-review-test`
  (samma signatur/replay/throttle-lager som övriga Agent Core-endpoints),
  payload strikt `{ executionMode: "test" }`.
Idempotensnyckel per dygn: `internal_improvement:<YYYY-MM-DD>` – en review per dag.
Uppgiften skapas som Systems & QA, `requires_approval=true`, `approval_status=pending`,
`execution_mode=test`, utan `lead_id`.

**5. Körning och verifiering**
Återanvänder befintlig `processAgentTaskCore`: samma state machine, samma
atomiska claim, samma audit (`task_started`, `llm_call`, `result_saved`,
`task_verified`) – helt PII-fri. QA-reglerna utökas med kontroll av healthScore,
minst en rekommendation och att implementationPrompt finns.

**6. Agent HQ**
Minsta möjliga rendering i befintligt resultatkort: summary, hälsopoäng, findings,
rekommendationer och implementationPrompt (kopieringsbar text). Ingen redesign.
Specialistkortet för Systems & QA beskrivs som verifiering + intern systemgranskning.

## Säkerhetsgränser
- `externalEffect: false` överallt; agenten kan inte ändra kod, SQL-data (utöver
  egen task/audit), Make, mail eller publicering.
- Godkännande ändrar endast intern status, precis som idag.
- Max ett LLM-anrop per review, ingen retry-loop.

## Tester
Nytt `src/lib/agents/improvement.server.test.ts` plus utökningar i befintliga sviter:
task utan lead_id, idempotens per dygn, max 1 LLM-anrop, PII-fri kontext/resultat/audit,
awaiting_review + pending approval, externalEffect false, modellfel → reserv,
felaktigt execution mode och auth/replay på endpointen. Full svit + typecheck körs.
