# Noryva customer-flow cutover runbook

This document is the source of truth for moving the customer lead flow from the legacy runtime to
`migration/vercel-independent` / Vercel + the new Supabase project.

## Safety invariants

- Do not run OpenAI Boardroom/agent sessions.
- Do not enable external nurture sends during migration.
- Internal test recipient is `info@noryva.se`.
- Do not change DNS until the complete E2E checklist below is green.
- Keep Vercel Deployment Protection enabled for previews.
- Make must use Vercel's automation bypass header; do not disable preview protection globally.

## Authoritative migration environment

- Vercel preview alias:
  `https://noryva-git-migration-vercel-independent-noryva.vercel.app`
- Supabase project ref: `gojlixakifuadhyczbgd`
- Feedpoint customer id: `802728cd-acc5-49df-ad8b-3ec473006086`
- Feedpoint slug: `feedpoint-ab`
- Feedpoint form:
  `/offert/feedpoint-ab`

## Make -> Growth API

During pre-cutover testing, every Growth API HTTP module in Make must target the migration preview
alias, not `noryva.se` and not a legacy Lovable runtime.

Endpoints used by lead intake:

- POST `/api/public/growth/route-lead`
- POST `/api/public/growth/analyze-lead` only when the router returns an AI tier

Each request must pass both security layers.

### 1. Vercel Deployment Protection

Header:

```
x-vercel-protection-bypass: <VERCEL_AUTOMATION_BYPASS_SECRET>
```

Generate/store the bypass secret in Vercel Deployment Protection. Store the value as a Make secret;
never place it in Sheets, source code, logs, or lead data.

### 2. Noryva Growth HMAC

Headers:

```
content-type: application/json
x-noryva-timestamp: <unix-seconds>
x-noryva-signature: <hex HMAC-SHA256>
x-noryva-event-id: <unique id>
```

Signature input:

```
<timestamp>.<exact raw JSON body>
```

Secret: `NORYVA_GROWTH_API_SECRET`. The Make-side secret must match the Vercel Preview value.
Do not copy the secret into chat or source control.

Lead request:

```json
{"leadId":"<uuid>"}
```

If `makeContext` is used, `customerId` must exactly match the stored lead customer id.

## Required E2E proof before customer launch

A single internal Feedpoint submission must prove all of the following:

1. Form POST returns success on migration preview.
2. A lead row is created in Supabase project `gojlixakifuadhyczbgd`.
3. `leads.delivery_status` becomes `delivered`.
4. Make creates/updates exactly one CRM row.
5. A signed Growth request appears in `inbound_webhook_events`.
6. `growth_lead_state` exists for the lead.
7. For an AI route, `growth_analysis_claims` is created and reaches a terminal state.
8. At most one model attempt is recorded for a lead/version.
9. CRM fields are overwritten by the normalized Growth response; FALLBACK is not accepted as green.
10. Contact name is populated from current vending form key `namn` (legacy `kontaktperson` remains fallback).
11. Contact-action URL stays on the active Vercel runtime before DNS cutover.
12. Notification recipient is `info@noryva.se` during internal testing.
13. No external customer/lead email is sent.
14. No agent task/provider session is created.
15. Reminder/nurture/reply flows remain review/test gated.

## Failure interpretation

If the form lead is in the new Supabase but CRM shows:

- qualification `Manuell`
- priority `FALLBACK`
- draft text `Growth API kunde inte slutföra analysen...`

and the new Supabase has no matching `inbound_webhook_events`, Make did not successfully reach
the new Growth API. Check, in order:

1. Make HTTP URL points to the migration Vercel alias.
2. `x-vercel-protection-bypass` is present and valid.
3. `NORYVA_GROWTH_API_SECRET` matches Preview.
4. timestamp is Unix seconds and less than 300 seconds old.
5. HMAC signs the exact raw request body.
6. event id is unique.
7. `leadId` exists in the new Supabase.

Do not compensate for a failed Growth API by adding more LLM calls. The deterministic/manual fallback
exists specifically so leads are not lost.

## Cutover

Only after the E2E proof above is green:

1. make the intended Vercel deployment the production runtime;
2. verify Production environment variables point to the new Supabase;
3. repoint Make Growth API base URL from preview to the production Noryva URL;
4. retain HMAC authentication;
5. remove the preview-only Vercel bypass header from production calls if production is not protected;
6. run one internal E2E test again;
7. change customer notification/mail identity from Noryva test addresses to the real verified customer
   addresses only after explicit approval.

DNS is the final step, not the first.
