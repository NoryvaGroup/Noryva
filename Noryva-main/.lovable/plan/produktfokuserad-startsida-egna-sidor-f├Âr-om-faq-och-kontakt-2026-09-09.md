# Produktfokuserad startsida + egna sidor för Om, FAQ och Kontakt

Startsidan ska på 30–60 sekunder förklara vad Noryva gör med ett lead. Om Noryva, FAQ och Kontakt flyttas till egna sidor. Befintlig design och komponentstil behålls – ingen redesign.

## Nya sidor

- **/om** – Om Noryva (befintlig sektion, oförändrat innehåll)
- **/faq** – Alla vanliga frågor (flyttar även FAQ-strukturdata för Google hit)
- **/kontakt** – Kontaktformuläret, samma fält och samma mottagare info@noryva.se

Meny och sidfot pekar på de nya sidorna. Alla "Boka kostnadsfri genomgång"-knappar leder till /kontakt. Gamla adresser med #om, #faq och #kontakt skickas vidare till rätt sida.

## Ny ordning på startsidan

1. Hero (oförändrad)
2. Problem (oförändrad)
3. **Så fungerar Noryva** – nytt, fem steg som ett flöde: Lead → Analys → Prioritering → Nästa steg → Säljare, med kort text per steg enligt din formulering
4. **Vad Noryva analyserar** – nytt, sex signaler: behov, köpintention, tidsram, geografisk matchning, relevans för tjänsterna, information och kontext i förfrågan
5. **Ett lead är bara värdefullt om något händer med det** – nytt positioneringsblock med förklaringen om att förfrågningar inte bara hamnar i samma inkorg
6. **Vad företaget får** – sex kort: Prioriterade leads, AI-bedömning, Rekommenderat nästa steg, Strukturerad leadöversikt, Smart uppföljning, Anpassat efter företaget
7. Dashboard (befintlig, visar systemet i praktiken)
8. **AI där det sparar tid. Människor där det spelar roll.** – nytt förtroendeblock: systemet hjälper med analys, prioritering, struktur och nästa steg; viktiga eller osäkra fall går till människa
9. **Sammanhanget följer med leadet** – nytt, kort block om att kontext kring varje lead behålls som grund för smartare uppföljning, formulerat som pågående utveckling
10. Målgrupp (befintlig)
11. Case (befintlig)
12. **Avslutande CTA** – 30 dagars kostnadsfri testperiod utan bindningstid, knapp till /kontakt

Tas bort från startsidan: Om Noryva, FAQ, kontaktformuläret. Sektionerna Tjänster, Resultat och Varför Noryva ersätts av de nya produktsektionerna för att undvika upprepning; deras innehåll om arbetssätt vävs in i Om-sidan där det passar.

## Copy-regler som följs

- Inga tekniska termer (API, LLM, Make, integrationer, modeller).
- Inga påståenden om att systemet självt mailar kunder, förhandlar eller bokar möten.
- Framtida funktioner beskrivs som något vi bygger, inte som färdigt.
- Inga påhittade siffror eller resultat.

## Tekniskt

- Nya route-filer `src/routes/om.tsx`, `faq.tsx`, `kontakt.tsx` med egen `head()` (titel, beskrivning, og-taggar, canonical); återanvänder `About.tsx`, `Faq.tsx`, `Contact.tsx` utan logikändring.
- Nya komponenter under `src/components/site/`: `HowItWorks.tsx`, `Signals.tsx`, `Positioning.tsx`, `Benefits.tsx`, `HumanControl.tsx`, `LeadContext.tsx`; samma mönster som befintliga (Reveal, container-x, surface/border-tokens, lucide-ikoner).
- `index.tsx` uppdateras med ny sektionsordning och behåller ProfessionalService-JSON-LD; FAQ-JSON-LD flyttas till /faq.
- `Nav.tsx` och `Footer.tsx` byter till `<Link to>`; `sitemap.xml` får de tre nya adresserna.
- Ingen ändring i backend, formulärets webhook, admin, Growth Engine eller e-postmottagare.

## Omfattning

En sammanhållen omgång: tre nya sidor, sex nya sektioner, länk- och SEO-justeringar. Inga nya beroenden.
