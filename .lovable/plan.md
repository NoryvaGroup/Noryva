# Shadow Review Mode för Agent Core

## Mål
Skapa en separat HMAC-skyddad TEST-endpoint som läser ett litet antal nyliga, verkliga leads och fyller Agent HQ-kön med idempotenta Sales-uppgifter. Den kör inga workers, AI-anrop eller externa actions och påverkar inte scenario 7276182 eller befintliga kundflöden.

## Implementation
- Lägg till `POST /api/public/agents/shadow-review-test` i det befintliga Growth/Agent-säkerhetslagret.
- Acceptera en strikt payload för `executionMode: "test"`, ett begränsat tidsfönster och `limit` högst 10; andra körlägen eller extra fält avvisas.
- Läs endast `id`, `customer_id` och `created_at` från nyliga leads, sorterade med stabil ordning.
- Hoppa över leads som saknas, saknar kundbindning eller vars kund inte finns. Ingen data gissas.
- Återanvänd `routeEvent({ type: "new_lead" })` och befintlig dispatch/idempotens för att skapa `sales_draft` i `queued`, `execution_mode=test`, `requires_approval=true`, `approval_status=pending`.
- Använd en shadow-specifik occurrence/idempotensnyckel så polling inte skapar dubbletter och vanliga dispatch-events inte störs.
- Logga endast säker auditmetadata. Returnera endast räknare och task-id:n: `scanned`, `created`, `duplicate`, `skipped`, `taskIds`, `externalEffect:false`.

## Säkerhet
- Återanvänd `NORYVA_GROWTH_API_SECRET`, timestamp, HMAC, replay-skydd och throttling; ingen ny secret.
- Ingen lead-payload, e-post, telefon eller annan PII läses eller returneras.
- Ingen ändring av leads, CRM, Growth/nurture, leveransstatus eller mailstatus.
- Ingen worker, OpenAI-körning, Make-callback eller annan nätverkseffekt från batchen.
- Gör idempotensen robust även vid samtidiga insertförsök genom att behandla unik-konflikt som duplicate.

## Tester och dokumentation
- Lägg fokuserade tester för HMAC/replay, max 10, dubletter, saknad lead/kund, fel körläge, PII-fritt svar/audit och permanent `externalEffect:false`.
- Dokumentera endpointens TEST/REVIEW-kontrakt och att processkedjan körs separat.
- Kör hela testsviten och typkontroll. Ingen publicering eller deploy.
