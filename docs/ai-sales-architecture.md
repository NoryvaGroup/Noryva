# AI-säljassistent – arkitektur (fas 1: TEST/REVIEW)

## Flöde

```text
Lead (publikt formulär)
  -> lagring i Supabase (leads.payload: råsvar + Make-fält)
  -> leverans till Make (oförändrad)
  -> deterministisk kvalificering (score / kvalificering / prioritet)
  -> AI-bedömning (ai_sales_assistant_runs: action, kontakthastighet, mailutkast,
     följdfrågor, human_takeover, motivering, confidence, safety flags)
  -> säljåtgärd som utkast (sales_actions)
  -> statusmaskin: draft -> review -> approved -> executed (endast TEST) / rejected / cancelled
  -> audit-logg (ai_sales_events) på varje steg
  -> framtida skarpt utförande (AVSTÄNGT)
```

## Datamodell

| Tabell | Syfte |
| --- | --- |
| `customers`, `form_questions` | Kund + formulärdefinition (multi-tenant) |
| `customer_profiles` | Ton, språk, lead-prefix, kvalificeringsprofil, uppföljningsregler, bokningsregler, notismottagare, AI på/av — per kund, ingen hårdkodning |
| `leads` | Inkomna förfrågningar, leveransstatus mot Make |
| `ai_sales_assistant_runs` | AI:s bedömning och mailutkast per lead |
| `sales_actions` | Åtgärdsutkast med typ, status, idempotensnyckel, planerad tid, körresultat |
| `ai_sales_events` | Append-only audit: vad AI föreslog, vad människa godkände, vad som utfördes |

RLS: samtliga tabeller kräver `has_role(auth.uid(), 'admin')`. Inget är publikt.
`ai_sales_events` saknar UPDATE/DELETE-policy och är därmed oföränderlig.

## Kod

- `src/lib/ai-sales/flags.ts` – kill switches, `assertNoExternalSend`, `V1_EXTERNAL_SEND_ALLOWED = false`.
- `src/lib/ai-sales/profile.ts` – kundprofilens schema och defaults per bransch.
- `src/lib/ai-sales/qualify.ts` – branschoberoende kvalificering; varuautomater använder
  `src/lib/landing/scoring.ts` oförändrad (85/Hög/HÖG-testet gäller fortfarande).
- `src/lib/ai-sales/actions.ts` – åtgärdstyper, statusmaskin, idempotensnyckel,
  `executeActionInTestMode` (no-op, loggar vad som *skulle* ha skett).
- `src/lib/ai-sales/reply.ts` – förberedelse för svarshantering: intent-klassificering
  och eskalering vid pris, offert, förhandling, klagomål och juridik.
- `src/lib/ai-sales/context.ts` – PII-minimering innan text går till modellen.
- `src/lib/crm.functions.ts` – serverfunktioner (admin-only): CRM-lista, profil,
  skapa/överföra/testköra åtgärder, audit-logg.
- `src/routes/_authenticated/admin/crm.tsx` – internt CRM-gränssnitt.

## Åtgärdstyper (interface klara, extern effekt avstängd)

`send_email`, `schedule_followup`, `request_information`, `handoff_to_human`,
`update_crm`, `book_meeting`. Alla skapas som utkast och kan endast "testköras"
efter godkännande. Testkörningen gör inget externt anrop; den skriver ett
resultatobjekt (`performed: false`, `mode: "test"`) och en audit-händelse.

## Idempotens och statusövergångar

- Nyckel: `lead_id:action_type:attempt`, unik i databasen.
- Endast övergångar i `TRANSITIONS` tillåts; `executed` är slutgiltig.
- Utförande skrivs med villkorlig uppdatering (`status = 'approved'`), så samma
  åtgärd inte kan utföras två gånger vid dubbelklick eller parallella anrop.

## GDPR / säkerhet

- Kontaktuppgifter maskeras innan de går till modellen (`context.ts`).
- CRM-listan visar referens och behovssammanfattning, inte namn/telefon/mail.
- Audit-loggen innehåller metadata och beslut, inte personuppgifter.
- Alla nycklar/secrets läses server-side; klienten ser aldrig modellnyckeln.

## Medvetet avstängt inför nästa fas

- Extern sändning av mail/SMS (`AI_SALES_ASSISTANT_AUTO_SEND`, hårdspärr i kod).
- Mötesbokning och kalenderintegration (`AI_BOOKING_AGENT_ENABLED`).
- Inkommande svar / inboxkoppling (`AI_REPLY_AGENT_ENABLED`) – endast interface.
- Skarp CRM-synk (`update_crm` är no-op).
- AI-generering kräver `AI_SALES_ASSISTANT_ENABLED=true` i serverinställningarna.

## Kvar innan autonom försäljning kan aktiveras

1. Verklig mailkanal med avsändardomän, avregistrering och loggning.
2. Inbox-/svarsflöde och konversationstillstånd i databasen.
3. Kalender-/bokningsadapter med kundens regler.
4. Skarpt läge bakom explicit godkännande per kund (`customer_profiles`).
5. Utfallsmätning (kontaktad → svar → möte → affär) som återkoppling till scoring.

## Fas 2 (denna build)

- **CRM ↔ granskningskö:** varje lead i Lead-CRM har knappen "Generera AI-utkast"
  och länken "Öppna i granskningskön" (`/admin/ai-assistent?lead=<uuid>`). Inga
  UUID behöver kopieras manuellt. Granskningskön filtrerar på `lead`-parametern
  och länkar tillbaka till CRM.
- **Kundprofiler i UI:** `/admin/profiler` läser `listCustomerProfiles` och
  sparar via `saveCustomerProfile` med `customerProfileSchema`-validering
  (ton, språk, lead-prefix, uppföljningstimmar per prioritet, max uppföljningar,
  bokningsregler, AI på/av). Kunder utan sparad rad visas med branschens
  defaults.
- **Readiness-block:** `ReadinessPanel` (CRM + granskningskö) visar läge,
  AI-generering, review-krav, auto-send, reply-agent, bokning, v1-spärren för
  extern sändning, om modellnyckel finns (endast ja/nej) samt antal kunder,
  AI-påslagna kunder, utkast att granska och åtgärder att besluta. Inga
  hemligheter, adresser eller personuppgifter visas.
- **Audit:** `logEvent` skriver `ai_run_generated`, `ai_run_approved`,
  `ai_run_rejected`, `ai_draft_edited` samt åtgärdernas statusövergångar till
  `ai_sales_events`. Endast metadata loggas (längd på ämne/brödtext, modell,
  promptversion, policy) – aldrig mailtext eller PII.
- **PII:** företagsnamn räknas som affärskontext och behålls; personnamn,
  e-post, telefon, adress och postnummer tas bort både som fältnycklar och som
  värden i fritext (`src/lib/ai-sales/pii.test.ts`).

## Medvetet avstängt

Auto-send, inkorg/svarsagent, kalenderbokning och all extern kommunikation.
`V1_EXTERNAL_SEND_ALLOWED = false` blockerar auto-send i kod oavsett miljövariabler.

## Nästa steg för riktig extern exekvering (ej implementerat)

1. **Mailkanal:** verifierad avsändardomän (SPF/DKIM/DMARC), avregistreringslänk,
   bounce-/klagomålshantering och loggning av leveransstatus per åtgärd.
2. **Inkorg/svar:** inkommande mail till en server-route, intent-klassificering
   via `ReplyClassifier`, eskalering vid pris/offert/förhandling/klagomål/juridik.
3. **Kalender:** `MeetingBookingAdapter` mot riktig kalender med dubbelbokningsskydd.
4. **Skarpt läge per kund:** `ai_assistant_enabled` + separat `execution_mode`
   (`test` → `live`) med explicit godkännande och möjlighet till omedelbar kill switch.
5. **Utfallsmätning:** svarsfrekvens och vunna affärer tillbaka till scoringen.
