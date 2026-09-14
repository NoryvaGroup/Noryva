# Tydligare Boardroom-beslut och genomförande

## Mål
Göra det färdiga mötesflödet lätt att förstå i tre tydliga nivåer: teamets slutsats, vad godkännandet innebär och vad som faktiskt har hänt efteråt.

## Ändringar
- Prioritera slutsatsen och genomförandet visuellt när mötet är färdigt; Boardroom-bordet behålls men tonas ned.
- Byt beslutstext till **Godkänn och starta genomförande**, förklara exakt vilka interna steg som startar och vad som aldrig sker automatiskt.
- Visa godkänt läge som **Godkänd – genomförande startat**.
- Bygg om varje genomförandeuppgift till ett kort med **Vad ska göras**, **Status** och **Vad händer nu**.
- Översätt alla statusar till tydlig svenska och visa resultatets `summary` när det finns.
- För kodförslag: markera uttryckligen att ingen Lovable-kod har ändrats och låt användaren expandera ändringsförslaget utan körknapp.
- För kundkontakt: förklara separat godkännande och att godkännandet inte skickar något automatiskt.
- Visa **Ingen åtgärd krävs** när det inte finns något användaren behöver göra.
- Korta varje protokollbidrag till sammanfattningen som standard, med **Läs mer/Visa mindre** för full data och begripliga findings/recommendations.

## Teknisk avgränsning
- Ändra endast `src/components/admin/AgentBoardroom.tsx` om verifieringen inte visar något oväntat.
- Ingen ändring av budget, agentkörning, auto-execution, kodpolicy, kundkontaktspärr eller externa flöden.
- Använd befintliga komponenter, ikoner, semantiska färger och data från `output`; ingen ny paketinstallation.

## Verifiering
- Kör TypeScript-kontroll och befintliga agenttester.
- Kontrollera den färdiga Boardroom-vyn på desktop och mobil: hierarki, expanderbara texter, statusförklaringar och inga överlappningar.
