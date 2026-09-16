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

## Local verification limitation
The execution environment used to prepare this archive has Node/npm but no Bun, and network dependency installation did not complete inside the allowed execution window. Therefore the full dependency-backed commands could not be executed here:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
```

The included GitHub Actions workflow runs those checks automatically once the code is on a writable branch/repository.

## Preview deployment checklist
1. Put this code on a non-production branch such as `migration/vercel-independent`.
2. Configure Vercel environment variables from the existing secret store using `.env.example` as the variable-name checklist.
3. Deploy as Preview only.
4. Smoke-test `/`, `/auth`, authenticated `/admin`, one known `/offert/<slug>`, and Make-facing API routes using test data only.
5. Check Vercel build/runtime logs for missing variables or runtime differences.
6. Do not move `noryva.se` until Preview passes.

## Phase 2 after preview passes
- Move AI Sales/Growth from `LOVABLE_API_KEY` + Lovable AI Gateway to a chosen direct/provider-neutral gateway deliberately, with regression tests.
- Rename/replace Lovable cron variable names.
- Remove Lovable preview auth/error-reporting code after verifying it is no longer used.
- Decide whether the public MCP endpoint remains on `@lovable.dev/mcp-js` or is migrated.
- Audit all `SECURITY DEFINER` functions and public API routes before broad production exposure.
