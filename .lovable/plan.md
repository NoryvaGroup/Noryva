# Lägg till Google Search Console meta-verifiering

## Vad som ska göras
- Lägga till den tillhandahållna meta-taggen i `<head>` på alla sidor genom `src/routes/__root.tsx`.
- Behålla den befintliga HTML-verifieringsfilen (`public/googlea02ecc314bf17462.html`) så båda metoderna fungerar parallellt.

## Varför
Google rekommenderade flera verifieringsmetoder för att äganderätten inte ska återkallas om en metod försvinner. Meta-taggen ligger osynligt i sidkällan och påverkar inte designen.

## Tekniska detaljer
- Meta-taggen som ska läggas in:
  ```html
  <meta name="google-site-verification" content="JADYkfjIhYIMHO0j8azC0cXDl2exizbVtz-UJekPyz0" />
  ```
- Placering: i `meta`-arrayen i `src/routes/__root.tsx`.
- Efter ändringen behöver sidan publiceras för att Google ska kunna läsa den nya taggen.
