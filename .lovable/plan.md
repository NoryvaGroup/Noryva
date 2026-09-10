# Semantisk bedömning av nurture-svar

## Mål
Ett nytt nurture-svar ska bara skapa en positiv uppgraderingssignal när just den nya, ociterade svarstexten tydligt uttrycker köpintresse eller vilja att gå vidare. Befintlig legitim historik lämnas orörd, och TEST/REVIEW får fortsatt inga externa effekter.

## Ändringar
- Lägg en liten server-only reply-bedömare bredvid befintlig AI-infrastruktur och återanvänd dess OpenAI Responses-anrop, modell, runtime-secret, metadata och säkra fallbackmönster.
- Separera den nya svarsdelen från citerad mailhistorik/signatur innan PII-maskering och analys.
- Kör deterministiska säkerhetsregler först för avböjande/opt-out, juridik, klagomål, pris och förhandling.
- För övriga relevanta svar: högst ett strikt strukturerat LLM-anrop som klassificerar aktuell text. Neutral text ger ingen uppgradering. Vid saknad nyckel eller modellfel används en konservativ fallback som aldrig gissar köpintresse.
- Låt nurture-effekten och eventuellt `meeting_booked`-utfall styras av den aktuella bedömningen. Ett vanligt eller neutralt svar får inte skapa positiv outcome-signal.
- Skriv aktuell `upgrade_signal` från det nya svaret i stället för att låta en gammal testflagga maskera resultatet. Historiska riktiga outcomes raderas eller omskrivs inte.
- Behåll `externalEffect=false` och `notificationSent=false` samt alla befintliga HMAC-, idempotens- och TEST/REVIEW-spärrar.

## Tekniska detaljer
- Utöka befintlig reply-klassificering med explicit semantisk metadata och strikt schema.
- Skicka runtime-env/requestberoenden genom befintlig serverkedja utan klientexponering.
- Lägg fokuserade tester för neutral `hej/test`, tydligt gå-vidare-intresse, verklig bokningsvilja, avböjande och neutral ny text ovanför citerad gammal mötestext.
- Kör relevanta tester, hela testsviten och typkontroll. Ingen publicering.
