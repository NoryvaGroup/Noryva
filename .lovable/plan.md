# Backend-hardening: säkert utskickskontrakt och manuell avstämning

Sista produktionshärdningen för uppföljningsutskicken. Inga designändringar, inga formulärändringar, ingen publicering.

## Vad som byggs

### 1. Strikt kontrakt för vem som får ta emot ett utskick
Nytt rent regelmodul `src/lib/growth/review-contract.ts`:
- Kunden härleds ur granskningsposten och förfrågan. Skiljer de sig åt stoppas utskicket (`customer_mismatch`).
- Mottagaren måste vara exakt den adress som ligger lagrad på förfrågan (`recipient_mismatch`). Ingen fallback till info@noryva.se eller någon annan kunds adress.
- Kundens mailidentitet måste vara verifierad och ha avsändaradress, svarsadress och anslutningsalias (`mail_identity_unverified`). Saknad, utkast eller avstängd identitet spärrar.

Kontraktet körs på två ställen i `nurture-review.server.ts`:
- vid **godkännande** (efter befintlig stale-kontroll av innehåll och underlag) – posten spärras i stället för att godkännas,
- vid **hämtning för utskick** (före den atomära hämtningen) – inget innehåll lämnas ut.

### 2. Manuell avstämning av fastnade utskick
Ny databasfunktion `reconcile_nurture_review` (endast administratör) plus `reconcileNurtureReviewCore` och adminserverfunktionen `reconcileNurtureReview`:
- lägen `SENT` / `NOT_SENT` / `UNKNOWN`, endast från status hämtad eller osäker,
- `SENT` kräver transportens meddelande-id och bokför steg och konversationslogg exakt en gång; upprepning ger samma svar utan dubblett,
- inget läge släpper någonsin posten tillbaka för nytt automatiskt utskick.

### 3. Oförändrat i övrigt
Planeringen av förfallna uppföljningar fortsätter att bara skapa granskningsposter utan extern effekt.

## Tester
Nya fokuserade tester för: kund som inte matchar, mottagare som inte matchar lagrad adress, overifierad mailidentitet vid både godkännande och hämtning, avstämning av osäkert utskick, dubbel bokföring av samma utskick och att inget läge tillåter automatiskt omförsök.

Körs: fokuserade tester, hela testsviten och typkontroll. Ingen publicering.
