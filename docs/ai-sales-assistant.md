# AI-säljassistent (v1 – TEST/REVIEW-läge)

## Vad som är live idag
- Deterministisk scoring för varuautomater (`src/lib/landing/scoring.ts`) – **oförändrad**.
- Lead-submit, idempotens, rate limiting och Make-webhook (`src/lib/public-landing.functions.ts`) – **oförändrade**.
- AI-säljassistenten kör **endast** internt: den skapar utkast som hamnar i en granskningskö på `/admin/ai-assistent`.

## Vad som är testläge
- Assistenten körs manuellt per lead från admin-UI:t (ingen automatisk trigger vid nytt lead).
- Inga mail skickas. Inga leads kontaktas. `sent` kan inte sättas av kod eller UI i v1.
- Om AI-anropet misslyckas används ett deterministiskt reservutkast (`policy.ts`).

## Säkerhetsprinciper
1. **Privacy by design** – namn, e-post, telefon, adress och postnummer tas bort innan kontexten
   skickas till modellen (`context.ts`, testat i `context.test.ts`). Fritext maskeras dessutom.
2. **Policy före modell** – mänsklig handläggning (pris, offert, avtal, juridik, klagomål) sätts
   av deterministisk policy och kan aldrig tas bort av modellen.
3. **Strikt outputvalidering** – allt modellen svarar valideras med zod (`types.ts`).
4. **Kill switches** – `flags.ts`; saknad env ⇒ `false` för riskfyllda funktioner.
5. **Konservativ RLS** – granskningskön är endast läsbar för administratörer; anonyma användare
   har ingen åtkomst.

## Feature flags
| Flagga | Default | Effekt |
| --- | --- | --- |
| `AI_SALES_ASSISTANT_ENABLED` | false | Måste vara `true` för att utkast ska kunna genereras. |
| `AI_SALES_ASSISTANT_AUTO_SEND` | false | Kan inte bli true medan review krävs, och blockeras dessutom i kod (`assertNoExternalSend`). |
| `AI_SALES_ASSISTANT_REVIEW_REQUIRED` | true | Endast exakt `"false"` stänger av kravet. |
| `AI_REPLY_AGENT_ENABLED` | false | v2-stub. |
| `AI_BOOKING_AGENT_ENABLED` | false | v2-stub. |

## Innan auto-send kan aktiveras
1. Manuell utvärdering av minst 50 granskade utkast med dokumenterad träffsäkerhet.
2. Riktig avsändardomän, avregistreringslänk och GDPR-granskning.
3. Loggning av varje utskick med spårbar `prompt_version` + `model`.
4. `V1_EXTERNAL_SEND_ALLOWED` i `flags.ts` måste ändras medvetet i kod – flaggan ensam räcker inte.

## Lägga till en ny branschprofil
1. Lägg till branschen i `src/lib/landing/templates.ts` (frågor + mall).
2. Vid behov: lägg till deterministisk scoring i `src/lib/landing/scoring.ts` och koppla in den i
   `context.ts` (`buildAiSalesContext`).
3. Komplettera `HUMAN_TAKEOVER_TERMS` i `policy.ts` om branschen har egna riskord.
4. Höj `PROMPT_VERSION` i `prompt.ts` om systeminstruktionen ändras.

## Plan v2 / v3
- **v2 (stubbat i `v2-interfaces.ts`)**: klassificering av inkommande svar
  (`reply_needed | book_meeting | handoff_human | no_action`), konversationstillstånd per lead,
  mötesbokningsadapter, CRM-adapter och analytics-feedback (`contacted/replied/meeting/offert/won/lost`).
- **v3**: intern Noryva-agent som sammanställer kundstatistik (`analytics.ts`) och föreslår
  åtgärder – fortfarande med människa i loopen.

## Databas
Tabellen `ai_sales_assistant_runs` (se migrationen) lagrar historiken separat från `leads`.
Index på `lead_id`, `customer_id`, `review_status`, `created_at`. RLS: endast admin.
Rollback: `DROP TABLE public.ai_sales_assistant_runs;`
