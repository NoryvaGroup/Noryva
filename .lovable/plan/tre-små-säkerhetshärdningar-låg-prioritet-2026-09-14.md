# Tre små säkerhetshärdningar (låg prioritet)

Uppföljning av den read-only auditen. Inga funktionella ändringar i lead-, mail- eller Make-flöden, inga migrationer som rör befintlig data, inga externa anrop.

## 1. Kontrollera mottagaradressen innan leverans

Idag anropas kundens leveransadress rakt av från databasen utan någon kontroll.

- Ny liten hjälpfil `src/lib/landing/webhook-url.ts` med `isSafeDeliveryUrl(url)`: kräver `https:`, avvisar `localhost`, `127.*`, `10.*`, `172.16–31.*`, `192.168.*`, `169.254.*` och `::1`.
- `src/lib/public-landing.functions.ts` (runt rad 70 och 220): om adressen inte är säker → samma vänliga fel som när adress saknas, ingen leverans.
- `src/lib/growth/delivery-recovery.server.ts` (runt rad 226 och 300): adressen som inte klarar kontrollen ger `skipped` med orsak `unsafe_webhook` i stället för anrop.
- Testadressen (`TEST_WEBHOOK_URL`) passerar kontrollen oförändrat.

## 2. Spärr mot spam i kontaktformuläret

`src/lib/contact.functions.ts` sparar utan hastighetsspärr, medan offertformuläret har en.

- Återanvänd samma mönster som i `public-landing.functions.ts:117-131`: hasha IP, räkna inskick senaste 10 minuterna, avvisa vänligt vid 5 eller fler.
- Kräver en ny kolumn `source_ip_hash` på `contact_requests` (nullable text) plus index — en additiv migration, ingen befintlig data rörs.

## 3. Notering om hastighetsspärren i Growth-API:t

`src/lib/growth/api-security.ts:281-299` håller spärren i minnet per instans. Signaturkontrollen är den faktiska säkerheten. Ingen kodändring nu — bara en tydlig kommentar om begränsningen och att en databasbaserad räknare är nästa steg om trafiken ökar.

## Verifiering

- `bunx tsgo --noEmit`
- `bunx vitest run src/lib` (nuvarande baslinje ska hållas)
- Nya små tester: säkra/osäkra adresser, och att kontaktspärren släpper igenom under gränsen
- Inga provider-körningar, inga riktiga utskick
