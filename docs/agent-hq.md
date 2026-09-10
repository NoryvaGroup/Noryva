# Noryva Agent HQ – foundation

Status: **FOUNDATION / TEST.** Vyn `/admin/agents` visar endast struktur och
exempeldata. Inga agenter körs, inga AI-anrop görs, inga mail eller
Make-actions triggas och ingen backend finns ännu för uppgiftskön.

## Framtida arkitektur som sidan representerar

```text
EVENT -> ORCHESTRATOR -> TASK -> SPECIALIST -> VERIFICATION -> APPROVAL/ACTION
```

- **EVENT** – något inträffar: nytt lead, uteblivet svar, statusändring, schemalagd körning.
- **ORCHESTRATOR** – huvudagenten tolkar händelsen, sätter mål och bryter ner arbetet i uppgifter.
- **TASK** – en uppgift med id, tilldelad agent, typ, prioritet, status, krav på godkännande och verifieringsstatus.
- **SPECIALIST** – en av fem roller utför uppgiften: Sales, Systems & QA, Customer Success, Growth, Admin & Finance.
- **VERIFICATION** – resultatet kontrolleras deterministiskt mot regler och data innan det får gå vidare.
- **APPROVAL/ACTION** – en människa godkänner. Först därefter kan en action utföras.

## Gränser som gäller

- Orchestrator utför aldrig externa actions själv.
- Ingen uppgift får leda till extern effekt utan mänskligt godkännande.
- Befintliga flöden (publika formulär, leads, Growth Engine, nurture, Make-endpoints) berörs inte.
