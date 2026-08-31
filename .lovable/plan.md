# Noryva v2 – redesign och konverteringsoptimering

Ja, det här är i huvudsak bra ändringar. De starkaste förbättringarna: skarpare hero-budskap, tomma kundcase bort, en enda konsekvent CTA, enklare formulär och en ny datadriven dashboard-sektion. Två saker rekommenderar jag att vi justerar (se "Avvikelser").

Du kan se resultatet direkt i förhandsvisningen så fort planen är godkänd – ändringarna byggs på befintlig kod, inte från noll.

## Vad som ändras

**Färg och typografi**
- Ny mörkare bas: bakgrund nära svart, alternativa sektioner något ljusare, cards en nivå upp, subtila mörkgrå borders.
- Accentfärgen byts från grön-teal till en sofistikerad elektrisk blå/lila, använd sparsamt (CTA, linjer, ikoner, hover, grafik).
- Behåller Sora/Manrope; ökar hero-rubrikens storlek och luft mellan sektioner.

**Navigation**
- Länkar: Tjänster, Så fungerar det, Resultat, Om Noryva, FAQ, Kontakt.
- CTA överallt: "Boka kostnadsfri genomgång →". Mobilmeny med mjuk öppningsanimation och stor CTA.

**Hero**
- Rubrik: "Fler kunder. Utan att gissa vad som fungerar."
- Ny underrubrik, primär + sekundär CTA, och en diskret rad: Annonsering → Leads → Bokningar → Kunder.
- Trust-raden ("ingen bindningstid…") tas bort härifrån.
- Ny visualisering: ANNONS → BESÖKARE → LEAD → BOKNING → KUND med tunna linjer och en ljuspunkt som rör sig genom flödet (SVG + CSS, pausas vid `prefers-reduced-motion`).

**Sektionsordning** (ny)
Hero → Problemet → Hur Noryva fungerar → Tjänster → Dashboard → Det vi optimerar → Varför Noryva → Vilka vi hjälper → Om Noryva → Framtida kundcase → FAQ → Stor CTA → Kontaktformulär → Footer.

**Innehåll per sektion**
- Problem: tre stora kort (För få förfrågningar / Fel typ av leads / Kunder tappas på vägen) + avslutning "Noryva bygger systemet som kopplar ihop allt."
- Process: fyra steg, steg 04 blir "Vi skalar det som fungerar", elegant linje Analys → Bygg → Optimera → Skala. CTA efter sektionen.
- Tjänster: fyra kort med nya rubriker/beskrivningar och detaljlistor. "Läs mer"-knappar ersätts av hover/expandera utan knappkänsla.
- Ny dashboard-sektion "Vi gissar inte. Vi mäter." med CAMPAIGN OVERVIEW (Leads, Cost per lead, Conversion rate, Bookings) och animerade grafer, tydligt märkta som exempeldata.
- Resultat blir "Det vi optimerar" med fyra KPI-kort + notisen "När vi har data visar vi den. Inga påhittade siffror."
- Varför Noryva: fyra nya USP-kort.
- Målgrupp: "Byggt för företag där varje ny kund räknas" med fyra kategorier; "Passar Noryva?"-blocket krymps till en liten CTA-rad efteråt.
- Om Noryva: ny, mer personlig text.
- Kundcase: placeholder-korten tas bort; ersätts av kort text + "Ditt företag kan bli vårt nästa case." + CTA.
- FAQ: nya svar samt ny fråga om annonsbudget kontra arvode.
- Stor CTA: "Är det dags att få ordning på kundinflödet?" med mycket whitespace.
- Formulär: Namn, Företag, E-post, Telefon, Hemsida, Vad vill du förbättra. Budgetfrågan tas bort. Bekräftelsetexten behålls.
- Footer: minimalistisk, e-post hej@noryva.se, ingen "telefonnummer kommer snart".

**SEO**
- Title: "Noryva | Digital annonsering som ger fler kunder".
- Ny meta description, uppdaterad Open Graph, JSON-LD (inkl. uppdaterad FAQ). Sitemap/robots/favicon behålls.

## Avvikelser jag föreslår

1. **Formuläret skickas fortfarande inte någonstans.** Idag visar det bara en tacktext lokalt – förfrågningar når aldrig din inkorg. Jag föreslår att vi kopplar det till Lovable Cloud (lagring + mejlnotis) som ett separat steg efter redesignen. Säg till om du vill ha med det direkt.
2. **Behåll en kort trust-rad längre ner** (t.ex. vid stora CTA:t) i stället för att ta bort den helt – den gör nytta när besökaren är nära beslut, bara inte i heron.

## Tekniskt

- Tokens uppdateras i `src/styles.css` (OKLCH); inga hårdkodade färger i komponenter.
- Nya komponenter: `Dashboard.tsx`, `FlowVisual` bryts ut ur `Hero.tsx`.
- Omskrivna: `Nav`, `Hero`, `Problem`, `Process`, `Services`, `Results`, `Why`, `Audience`, `About`, `Cases`, `Faq`, `Contact`, `Footer`, `src/routes/index.tsx` (ordning + metadata).
- Animationer via befintliga `Reveal` + CSS; inga nya tunga bibliotek.
- Kontroll av mobil (ingen horisontell scroll, tryckvänliga CTA) och `prefers-reduced-motion`.
- Inga påhittade kunder, resultat eller garantier någonstans.
