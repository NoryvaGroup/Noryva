# Noryva -> Vercel migration status

Prepared from the uploaded full Noryva codebase on 2026-09-16.

## Applied in this copy
- Replaced Lovable's Vite build wrapper with standard TanStack Start + Nitro + React + Tailwind + tsconfig paths.
- Added `vercel.json` with the official `tanstack-start` framework preset.
- Removed the committed `.env` from this deliverable.
- Added a complete `.env.example` based on the environment variables referenced by the source tree.
- Hardened `.gitignore` for environment files and `.vercel/`.
- Added `test` (`vitest run`) and `typecheck` (`tsc --noEmit`) package scripts.
- Added `.github/workflows/ci.yml` to gate pull requests / `main` on install, lint, typecheck, tests and production build.
- Preserved the existing Supabase schema, migrations, auth, CRM, AI Sales, Growth Engine, agents, Make contracts, routes and UI.
- Preserved `@lovable.dev/mcp-js` because the live `/mcp` route still imports it.
- Preserved legacy Lovable environment variable names that current server code still uses. Removing those now would change AI/cron behavior and belongs in phase 2 after preview validation.

## Static verification performed
- Confirmed `vite.config.ts` uses the Vercel-documented TanStack Start order with `tanstackStart()`, `nitro()`, `viteReact()` and retains Tailwind/tsconfig-path plugins.
- Confirmed `vercel.json` uses the documented `tanstack-start` framework slug.
- Confirmed there is no `VITE_SUPABASE_SERVICE_ROLE_KEY` reference.
- Confirmed the real `.env` is absent from this deliverable.
- Enumerated the runtime environment-variable references and represented them in `.env.example`.
- Confirmed production code still intentionally uses Lovable AI Gateway in selected AI Sales/Growth paths; those are not silently redirected to OpenAI because that would be a behavior/model change.

## 2026-09-21 checkpoint

Current branch: `migration/vercel-independent`.

Latest verified agent-recovery commit:
`bb0c79357f669601ecdfaebeb9ad5793db65d578`
(`Fix boardroom timeout recovery with durable sessions and conservative accounting`).

Verified at this checkpoint:
- GitHub write access works for `NoryvaGroup/Noryva`.
- Branch commit `bb0c793...` is present and remains isolated from `main`.
- GitHub/Vercel status checks are green for both connected Vercel projects.
- Vercel preview deployments for `noryva` and `noryvagroup` are both `READY`.
- Public preview root responds HTTP 200 and server-side rendering works.
- Vercel reports no runtime error clusters for the preview deployment in the checked 24-hour window.
- No Supabase development branch currently exists.
- No production data was changed during this checkpoint.
- No real customer mail, Make action, DNS change, domain cutover or production-branch mutation was performed.
- Deployment Protection remains enabled. Protected routes such as `/auth`, `/admin/agents` and `/offert/boras-varuautomater` cannot be fully browser-smoke-tested by the automated fetcher without an authenticated browser session; protection was intentionally not weakened.
- The agent-recovery implementation has local verification recorded in commit `bb0c793...`: TypeScript/build pass and 522 tests across 50 files, including session resume, concurrent advance, unknown create outcome and durable-output recovery.
- A real authenticated delayed-agent Boardroom run has still not been executed against this preview. That remains the main runtime release gate for the agent timeout fix.

Important branch state:
- `migration/vercel-independent` and `main` are diverged.
- Do NOT merge the entire migration branch blindly into `main`.
- Review/cherry-pick intentional migration changes or perform a controlled cutover sequence.
- Production `main` is intentionally left untouched at this checkpoint.

## Preview deployment checklist
1. [x] Put the migration code on `migration/vercel-independent`.
2. [x] Build Vercel Preview deployments.
3. [x] Confirm Vercel build/status checks are green.
4. [x] Smoke-test public `/` over the preview deployment.
5. [ ] Smoke-test authenticated `/admin/agents` in a real authenticated browser session.
6. [ ] Smoke-test one known `/offert/<slug>` in the protected preview browser session without submitting it.
7. [ ] Run one fresh internal Boardroom meeting on preview and verify:
   - one provider session is created,
   - pending polling resumes the same session,
   - no second provider POST/budget reservation occurs,
   - result is persisted before cleanup,
   - no external effect occurs.
8. [ ] Re-check Vercel runtime logs immediately after that Boardroom test.
9. [ ] Review branch-vs-main differences and define the exact cutover/cherry-pick plan.
10. [ ] Do not move `noryva.se` until all release gates above pass.

## Phase 2 after preview passes
- Move AI Sales/Growth from `LOVABLE_API_KEY` + Lovable AI Gateway to a chosen direct/provider-neutral gateway deliberately, with regression tests.
- Rename/replace Lovable cron variable names.
- Remove Lovable preview auth/error-reporting code after verifying it is no longer used.
- Decide whether the public MCP endpoint remains on `@lovable.dev/mcp-js` or is migrated.
- Audit all `SECURITY DEFINER` functions and public API routes before broad production exposure.
