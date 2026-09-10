# Roadmap

- [x] Bredda startsidans positionering mot tjänste- och B2B-företag med högt kundvärde
- [x] Uppdatera startsidans SEO och publika AI-innehåll konsekvent
- [x] Behåll /takoffert orörd
- [x] Verifiera TypeScript, mobil/desktop, navigation och formulär
- [x] Kundpanel: inloggning, kundlista, skapa/redigera kund, branschmallar (Tak, Varuautomater)
- [x] Publika kundsidor på /offert/{slug} med utkast/publicerad, förhandsgranskning och kopiera länk
- [x] Serverskyddad inskickning med validering, honeypot, hastighetsspärr och dubblettskydd
- [x] Tilldela ägarkontot behörighet efter att första kontot skapats
- [x] Stäng av nya registreringar så att endast befintligt ägarkonto kan logga in
- [ ] Ange mottagare och integrationsadress per kund innan publicering
- [x] Varuautomatformulär kopplat till Make via kompatibilitetsadapter (server-side)
- [x] Återleverans av misslyckade förfrågningar med atomisk låsning
- [x] Datamodell för säljåtgärder, kundprofiler och audit-logg (RLS, admin-only)
- [x] Internt Lead-CRM med kvalificering, AI-bedömning och åtgärdsflöde i TEST/REVIEW
- [x] Åtgärdsinterface (mail, uppföljning, komplettering, överlämning, CRM, bokning) som säkra no-ops
- [x] Förberedd svarshantering med eskalering vid pris/förhandling/klagomål/juridik
- [x] Arkitekturdokumentation i docs/ai-sales-architecture.md
- [ ] Skarpt läge: mailkanal, inbox/svar, kalenderbokning och utfallsmätning (kräver separat godkännande)
- [x] Noryva 2.0: kostnadsmedveten router (deterministic/ai_light/ai_full/human)
- [x] Noryva 2.0: research + sälj i ett strukturerat AI-anrop, optimizer endast batch
- [x] Noryva 2.0: experiment, varianter, tilldelning, utfall och AI-kostnadslogg (RLS admin-only)
- [x] Noryva 2.0: adminvy Growth Engine med tomma states och TEST/REVIEW-status
- [x] Noryva 2.0: serverfunktioner förberedda för Make (routeLead, analyzeLead, assignLeadVariant, registerOutcome, getGrowthRecommendation)
- [ ] Exponera Make-endpoints som signaturverifierade publika routes (kräver separat beslut)
- [x] Noryva 2.0: granskningskö (nurture_reviews) med atomiska SQL-funktioner för godkänn/avslå/hämta/slutför/misslyckas
- [x] Noryva 2.0: signerade Make-endpoints för förfallna granskningar, hämtning, slutförande, misslyckande och svar i tråd
- [x] Noryva 2.0: adminvy "Granskning före utskick" med exakt mottagare/ämne/text och Godkänn och skicka
- [x] NORYVA_NURTURE_REVIEW_WEBHOOK_URL satt (Make-scenario 7332133, inaktivt inlärningsläge)
- [ ] Sätt NORYVA_NURTURE_EXTERNAL_SEND_ENABLED=true först när riktiga kundutskick ska tillåtas (nu endast info@noryva.se)
- [ ] Uppdatera Make-scenarierna 7331509 och 7331569 till de nya endpointsen (görs av dig, inte av mig)

- [ ] Semantisk nurture-reply-bedömning: aktuell ociterad text styr upgrade/meeting outcome; historik bevaras; TEST/REVIEW utan externa effekter

- [ ] Bekräftat: neutral aktuell reply skapar ingen upgrade/meeting; tydlig köpavsikt kan uppgradera; legitim historik bevaras
