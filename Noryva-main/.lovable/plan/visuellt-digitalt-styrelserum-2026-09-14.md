# Visuellt digitalt styrelserum

## Mål
Gör om presentationen i den befintliga Boardroom-sektionen till ett modernt, ljust och professionellt digitalt styrelserum. All nuvarande data, mötesautomation, beslut och säkerhet förblir oförändrade.

## Genomförande
- Behåll ändringen i `src/components/admin/AgentBoardroom.tsx`.
- Lägg en responsiv mötesscen överst för valt möte: ett lätt top-down-bord och sex fasta agentplatser med enkla CSS-avatarer, namn och status.
- Härled aktiv, klar, väntande och granskande agent direkt från befintlig mötesstatus och transkriptdata; lägg inte till nya anrop eller ny logik.
- Visa en kompakt statusrad med mötesstatus, antal bidrag, möteskostnad och aktuell aktivitet.
- Presentera befintligt transkript som ett kronologiskt liveprotokoll med tydlig avsändare, bidragstyp, ordning och innehåll.
- Behåll befintliga kontroller exakt: start, återuppta vid fel/budgetstopp samt Godkänn/Avvisa först vid `awaiting_approval`.
- Anpassa bord, platser och protokoll för små skärmar utan horisontell sidscroll.

## Avgränsning
- Ingen backend-, agent-, budget-, harness- eller säkerhetsändring.
- Ingen förändring av andra adminsidor eller externa flöden.
- Inga bilder, paket eller tunga animationer; endast befintliga ikoner, tokens och subtil CSS-animation.

## Verifiering
- Kör snabb TypeScript-kontroll och befintliga Boardroom/agenttester.
- Kontrollera den färdiga vyn i preview på desktop och mobil, inklusive att text och kontroller inte överlappar.
