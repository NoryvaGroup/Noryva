# Egna sidor för Om Noryva, FAQ och Kontakt

Startsidan blir kortare: tre av dagens sektioner flyttas till egna sidor som nås via menyn.

## Vad du får

- **/om** – Om Noryva (samma innehåll som sektionen idag, plus avslutande uppmaning att boka genomgång)
- **/faq** – Alla vanliga frågor
- **/kontakt** – Kontaktformuläret, exakt samma fält och samma mottagare (info@noryva.se)

Varje sida får egen rubrik, egen sidtitel och beskrivning för Google, samt samma meny och sidfot som resten av sajten.

## Startsidan efter ändringen

Behåller: hero, problem, process, tjänster, dashboard, resultat, varför, målgrupp, case och en avslutande uppmaning som leder vidare till /kontakt.

Tas bort från startsidan: Om Noryva, FAQ och kontaktformuläret.

## Länkar

- Meny och sidfot pekar på /om, /faq och /kontakt i stället för hopp till sektioner på startsidan.
- Alla knappar av typen "Boka kostnadsfri genomgång" pekar på /kontakt.
- Gamla adresser med #om, #faq och #kontakt fortsätter att fungera genom att startsidan skickar besökaren vidare till rätt sida.

## Tekniskt

- Nya route-filer: `src/routes/om.tsx`, `src/routes/faq.tsx`, `src/routes/kontakt.tsx`, var och en med egen `head()` (title, description, og-taggar, canonical).
- Återanvänder befintliga komponenter `About.tsx`, `Faq.tsx`, `Contact.tsx` utan att ändra logik eller formulärflöde.
- FAQ-strukturdata (JSON-LD) flyttas från startsidan till `/faq`; övrig JSON-LD ligger kvar på startsidan.
- `Nav.tsx` och `Footer.tsx` byter till `<Link to="...">`.
- `sitemap.xml` uppdateras med de tre nya adresserna.
- Ingen ändring av backend, formulärets webhook, e-postmottagare eller admin.

## Omfattning

Litet till medelstort: tre nya sidor plus länkjusteringar. Ungefär en arbetsomgång, inga nya beroenden.
