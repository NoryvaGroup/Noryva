# Fix: kontaktförfrågningar läsliga för alla inloggade

## Problem (det kritiska fyndet)

Säkerhetsskannern flaggade en kategori `exposed_data`, nivå **error**:

> "Contact form submissions exposed to any logged-in user"

Orsak (verifierad i databasen): SELECT-policyn på tabellen `contact_requests`
heter "Inloggade kan lasa forfragningar" och har villkoret `true` — den
begränsar alltså ingenting. Vilken inloggad användare som helst (inte bara
admin) kan läsa alla inskick med namn, e-post, telefon och meddelanden från
det publika kontaktformuläret.

## Åtgärd

En enda SQL-migrering som byter policyn:

1. `DROP POLICY "Inloggade kan lasa forfragningar" ON public.contact_requests;`
2. Ny policy, SELECT endast för admin:
   `CREATE POLICY "Endast admin kan lasa forfragningar" ON public.contact_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));`

Inget annat ändras.

## Varför säkert

- `has_role(...)` är en befintlig SECURITY DEFINER-funktion i projektet — ingen ny kod krävs.
- Ingen kod i appen läser `contact_requests` med inloggad klient idag; kontaktinsicken skrivs bara via serverfunktioner som använder den privilegierade backend-klienten, så inget fungerande flöde bryts.
- Besökare (anon) kan fortfarande skicka in formuläret — INSERT-policyn rörs inte.
