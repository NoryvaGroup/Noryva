# Uppdatera customer_profiles: ai_assistant_enabled = true

## Vad som ska göras
- Uppdatera raden i `customer_profiles` för kund-id `802728cd-acc5-49df-ad8b-3ec473006086` (Borås varuautomater) så att `ai_assistant_enabled` sätts till `true`.
- Alla övriga fält lämnas oförändrade.

## Hur
- Använd `supabase--run_sql` med en `UPDATE`-sats som matchar `customer_id` och endast ändrar `ai_assistant_enabled`.

## Verifiering
- Läs tillbaka raden för att bekräfta att värdet är `true`.

## Vad som INTE ändras
- Ingen UI-kod, ingen routing, ingen Make-integration, inga experiment eller andra tabeller.
- Ingen deploy/publicering.
