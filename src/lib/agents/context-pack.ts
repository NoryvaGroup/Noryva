/**
 * Boardroom context pack – ett läsbart, kompakt snapshot av Noryvas verkliga
 * arkitektur som skickas med varje mötessteg.
 *
 * Bakgrund: agenternas hosted environment hos providern är en TOM sandbox.
 * Noryvas repo mountas aldrig där. Utan detta paket drar agenterna slutsatsen
 * att "systemet saknas" och bränner dessutom stora mängder input-tokens på att
 * leta i en tom filstruktur.
 *
 * Reglerna här är hårda:
 * - Endast arkitektur och filnamn, aldrig hemligheter, nycklar eller kunddata.
 * - Kompakt: hela paketet är hårt teckenbegränsat, och varje roll får bara sitt
 *   eget fokusavsnitt utöver den gemensamma översikten.
 */

export const MAX_CONTEXT_PACK_CHARS = 6_000;
export const MAX_ROLE_FOCUS_CHARS = 2_200;

export const CONTEXT_PACK_SOURCE =
  "Källa: Noryvas repo (NORYVA_2_ARCHITECTURE.md, docs/ai-sales-architecture.md, docs/agent-hq.md och src/lib/**), sammanställt av Noryva – inte hämtat från din sandbox.";

/** Gemensam systemöversikt. Gäller alla roller. */
export const ARCHITECTURE_OVERVIEW = [
  "NORYVA – SYSTEMÖVERSIKT (faktisk implementation, inte hypotes)",
  "Stack: Lovable/TanStack Start (UI + serverfunktioner), Supabase (data, RLS, audit), Make (extern automation), OpenAI Agents (agenthjärna).",
  "Publikt flöde: publika formulär (src/components/site/Contact.tsx, src/components/landing/**) -> serverfunktioner (src/lib/contact.functions.ts, src/lib/public-landing.functions.ts) -> tabellerna leads/contact_requests -> Make-webhook.",
  "Kvalificering och routing: deterministisk scoring (src/lib/ai-sales/qualify.ts, src/lib/landing/scoring.ts) -> src/lib/growth/router.ts väljer deterministic | ai_light | ai_full | human. deterministic = 0 LLM-anrop. ai_* = ETT strukturerat anrop.",
  "Intent: src/lib/growth/intent.ts räknar deterministisk score 0–100 ur growth_outcomes, sparas i growth_lead_state. Ingen LLM.",
  "AI-säljassistent: src/lib/ai-sales/** (profile, prompt, reply, policy, pii, execution-mode). Utkast sparas i ai_sales_assistant_runs för mänsklig granskning. Kostnad loggas i ai_cost_events.",
  "Uppföljning: src/lib/growth/nurture*.ts + lead-reminders.server.ts med köer, snapshots, fingerprints och atomiska RPC:er. Leverans/avstämning: delivery-recovery.server.ts (dry-run som standard) och review-reconciliation.server.ts (fail-closed SENT/NOT_SENT/UNKNOWN).",
  "Multi-tenant: kundprofiler och kundspecifika mailkanaler är data (customer_profiles, customer_mail_channels, form_questions), inte kod. Onboarding sker via /admin-vyerna i src/routes/_authenticated/admin/**.",
  "Driftkontroll: src/lib/readiness/rules.ts + /admin/pilot ger read-only GO/NO-GO per kund.",
  "Agent HQ: src/lib/agents/** (tasks, budget, boardroom, openai-agents.server). Supabase-tabeller agent_tasks, agent_task_events, agent_meetings, agent_meeting_messages, agent_run_ledger.",
  "Spärrar: AUTHORITY_EXECUTE_ENABLED=false och AGENT_EXTERNAL_ACTIONS_ENABLED=false. Inga utskick, ingen deploy, ingen kunddataändring från agenter. Allt slutar i REVIEW/awaiting_approval.",
  "Budget: per möte 10 kr, dag 40 kr, nödstopp 60 kr, månad soft 300 kr / hard 500 kr.",
].join("\n");

/** Rollens eget fokusavsnitt – hålls medvetet kort. */
export const ROLE_FOCUS: Record<string, string> = {
  noryva_manager: [
    "Fokus: dekomponera agendan mot ovanstående faktiska moduler och välj roller efter var risken/värdet finns.",
  ].join("\n"),
  product_tech: [
    "Fokus: src/lib/growth/router.ts, intent.ts, nurture.server.ts, delivery-recovery.server.ts, review-reconciliation.server.ts, src/lib/ai-sales/reply.ts, src/lib/agents/**.",
    "Kända mekanismer: idempotency keys per task/lead, CAS/claim via Supabase-RPC, stale-detektering, fail-closed leveransstatus, ett LLM-anrop per lead i ai_light/ai_full.",
  ].join("\n"),
  growth_sales: [
    "Fokus: src/lib/growth/experiments.ts, optimizer.ts, outcomes.ts, funnel.ts samt publika landningssidor och formulärfält (form_questions).",
  ].join("\n"),
  customer_success: [
    "Fokus: onboarding utan kodändring (customer_profiles, customer_mail_channels, form_questions), /admin/pilot readiness, kundens egen avsändaradress i kundnära utskick.",
  ].join("\n"),
  qa_risk: [
    "Fokus: dubblettskydd, idempotens, race conditions, RLS-policys, approval-gates, PII-minimering (src/lib/ai-sales/pii.ts, reply-redact.ts), webhook-säkerhet (HMAC, replay).",
    "Notera: TEST/REVIEW är avsiktligt – externa utskick är avstängda på systemnivå, inte glömda.",
  ].join("\n"),
  operations_finance: [
    "Fokus: AI-kostnad per lead (ai_cost_events), agentkostnad (agent_run_ledger, src/lib/agents/budget.ts), antal LLM-anrop per flöde, budgettak och nödstopp.",
  ].join("\n"),
};

/**
 * Bygger rollens kontextpaket. Returnerar alltid en icke-tom text med tydlig
 * källa och ett uttryckligt påpekande om att sandboxen är tom by design.
 */
export function buildContextPack(role: string): string {
  const focus = (ROLE_FOCUS[role] ?? "").slice(0, MAX_ROLE_FOCUS_CHARS);
  const pack = [
    "NORYVA KONTEXTPAKET (auktoritativt underlag)",
    CONTEXT_PACK_SOURCE,
    "Din sandbox/workspace är TOM by design. Du har ingen fil-, repo- eller terminalåtkomst. Leta inte efter filer och dra aldrig slutsatsen att systemet saknas – underlaget nedan är systemet.",
    ARCHITECTURE_OVERVIEW,
    focus ? `ROLLENS FOKUS:\n${focus}` : "",
    "Saknas ett detaljunderlag du behöver: skriv det som ett uttryckligt antagande eller en öppen fråga, inte som att implementationen inte finns.",
  ]
    .filter(Boolean)
    .join("\n");
  return pack.slice(0, MAX_CONTEXT_PACK_CHARS);
}
