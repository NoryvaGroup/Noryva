# Noryva Vercel migration status

Updated 2026-09-21.

## Source of truth
- GitHub repository: `NoryvaGroup/Noryva`
- Migration branch: `migration/vercel-independent`
- Production branch: `main` (untouched by this migration pass)
- Runtime: Vercel
- Database/auth: Supabase project `gojlixakifuadhyczbgd` (Noryva prod)
- Automation: Make remains external to this code migration
- Lovable is not part of the intended production chain and must not be used for code changes.

## Agent timeout recovery
Verified migration commit:
`bb0c79357f669601ecdfaebeb9ad5793db65d578`

It implements durable Boardroom provider-session recovery, GET-only resume of an existing session, conservative accounting for ambiguous starts, persistence before cleanup, and regression coverage for timeout/resume cases.

## CI and preview gates
Current branch CI:
- dependency install: PASS
- lint baseline report: REPORT-ONLY because the legacy codebase contains thousands of pre-existing Prettier/lint findings
- TypeScript: PASS
- tests: PASS
- production build: PASS

Latest release-critical CI run:
- run `35548291584`
- conclusion: SUCCESS

Latest Vercel preview for branch commit `50d1b6c4a44d4f9220445e733d396e6e6730e9f6`:
- project `noryva`: READY
- GitHub Vercel status: SUCCESS
- project `noryvagroup`: SUCCESS

Public preview root has been smoke-tested and returned HTTP 200 with SSR output.

## Supabase compatibility checks
Read-only checks against Noryva prod confirmed:
- `agent_meetings` exists
- `agent_tasks` exists
- `agent_run_ledger` exists
- `agent_meeting_messages` exists
- `claim_agent_meeting_turn` exists
- RLS is enabled on all four agent tables
- required task state/provider/usage columns exist

No production data was changed by these checks.

## Remaining release gates
1. Authenticated browser smoke test of `/admin/agents` on preview.
2. Protected preview smoke test of one known `/offert/<slug>` without submitting data.
3. One fresh internal Boardroom meeting on preview to verify the delayed provider-session recovery path end to end.
4. Immediately inspect Vercel runtime logs after that meeting.
5. Resolve branch divergence from `main` using a controlled cutover/cherry-pick strategy. Do not blindly merge the current draft PR.
6. Only after all gates pass: decide production cutover and DNS/domain timing.

## Important repository cleanup
The branch contains a historical duplicated project tree under `Noryva-main/` from the first migration commit. Vercel builds the repo-root app, not this duplicated tree.

Useful configuration that was trapped in the duplicate has now been ported to root:
- `test` and `typecheck` scripts
- `.github/workflows/ci.yml`

Do not delete the duplicate tree until remaining migration-only documentation/configuration has been audited. Its removal should be a dedicated, reversible cleanup commit.

## Safety state
- No merge to `main`
- No DNS/domain changes
- No production Supabase writes
- No customer/lead email sends
- No Make outbound execution
- No weakening of Vercel Deployment Protection
- Draft PR #1 remains draft and currently has merge conflicts/divergence
