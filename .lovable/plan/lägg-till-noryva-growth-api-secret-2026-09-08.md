# Lägg till NORYVA_GROWTH_API_SECRET

## Mål
Säkerställa att Growth Engine:s publika Make-endpoints (`/api/public/growth/*`) kan verifiera HMAC-signaturer från Make.

## Åtgärder
1. Öppna det säkra secret-formuläret för `NORYVA_GROWTH_API_SECRET`.
2. Användaren anger ett starkt slumpmässigt värde (minst 32 tecken, t.ex. genererat i en lösenordshanterare eller med `openssl rand -hex 32`).
3. Efter sparning bekräftar jag att secret finns konfigurerat.
4. Påminn användaren att samma värde måste läggas in i Make-scenariot som signeringsnyckel för HMAC-SHA256.

## Vad som INTE görs
- Ingen ändring av befintligt Make-scenario.
- Ingen publicering/deploy.
- Inga destruktiva ändringar i kod eller databas.

## Nästa steg efter secret
- Endpointerna behöver publiceras för att vara åtkomliga utifrån (Make).
- Make-scenariot konfigureras med samma secret, timestamp- och signaturheaders enligt `NORYVA_2_ARCHITECTURE.md`.
