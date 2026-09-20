# Agent timeout and boardroom recovery

Branch: migration/vercel-independent. Base: b96d1a092d280153ed5490db8a7fa1c90cf990d8.

Changes:
- Ported the five agent files from production timeout commit b44d206a, without merging main or replacing migration configuration.
- Boardroom persists provider session ID and the original ledger ID before polling. Polling yields after 15 seconds and subsequent requests read the same session, without POST or a second reservation.
- Raw output, usage and cost are persisted before provider cleanup. Persistence failures preserve the session; failures after cleanup can reuse durable raw output.
- Running or unknown executions retain a conservative accounted charge. Budget writes must succeed before boardroom provider calls. In the existing ledger schema, completed denotes an accounted charge; the task separately remains running until output is available.
- Unknown create outcomes stop automatic retries. Only explicit 409 without a session is automatically retried. No assumption that a client timeout means a free provider run.
- Frontend waiting and claim contention do not consume the completed-step loop guard.
- Manager revision synthesis uses a separate task/idempotency key, avoiding reuse of a deleted prior session.
- Fixed lazy Supabase admin-client initialization fallback in budget accounting.
- Added isolated test configuration that strips live credentials and rejects unmocked network requests.

Verification:
- 522 tests pass across 50 files, including concurrency, multiple pending polls, failed durable storage, raw-output recovery, unknown POST outcome, missing session and body-read timeout.
- TypeScript check and production build pass locally.
- Read-only Noryva prod checks confirm required tables, task statuses, admin RLS and claim function are present. No migrations are required or applied.
- GitHub connector write access now works after installation on NoryvaGroup.
- Vercel preview build and browser verification are the next gate at this checkpoint.

Limits and release gate:
- No authenticated live agent meeting has been run with this version. Mocked OpenAI responses were used for regression tests; actual delayed completion must be checked in preview before production approval.
- Existing failed/cancelled meetings have not been reopened or modified. Known-session task recovery requires an active/reopened meeting; creating a fresh test meeting is the simplest preview test.
- The new automatic resume flow applies to boardroom meetings. Standalone V2 and post-approval execution receive conservative timeout accounting but retain their existing stop-on-error behavior.
- No production/main, DNS, Lovable, customer mail or production data modifications.

Rollback: restore the changed code from b96d1a0 in a new migration-branch commit. Never force-push or reset published history. Do not merge the full migration branch into main without reviewing its pre-existing differences.
