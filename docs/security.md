# Security review (Phases 3–4)

| Area | Implementation | Verified by |
|---|---|---|
| Password hashing | PBKDF2-HMAC-SHA256, 100,000 iterations (Workers maximum), 16-byte salt, constant-time compare | `worker/src/app.test.ts` |
| Secrets | `ADMIN_PASSWORD_HASH` from `.dev.vars` locally / Worker secret in production; never in git or the bundle. Dev password is random, stored only in gitignored `.dev.password` | `.gitignore`, secret scan before commit |
| Sessions | Random 256-bit token; only SHA-256(token) stored in D1; 12 h idle + 7 day absolute expiry; logout revokes server-side | API + e2e tests |
| Cookie | `__Host-tw_session`; HttpOnly; Secure; SameSite=Strict; Path=/ | local smoke test, unit tests |
| Rate limiting | 5 failures per client key / 50 global per 15 min, then 15 min lockout (D1 `login_attempts`) | `v1.test.ts` (D1-backed) |
| CSRF | Origin / Sec-Fetch-Site check on every unsafe method + per-session `X-CSRF-Token` header | unit tests |
| Authorization | Every `/api/v1/*` route requires a valid server-side session; checked in the Worker, not the UI | `v1.test.ts` (6 routes), e2e (snapshot 401) |
| Input validation | Zod schemas shared with the client; 422 with field messages; DB CHECK constraints as a second layer | API tests |
| SQL injection | Every query parameterized via `bind()`; offline import SQL uses a tested escaper | hostile-input tests (API and SQL generator) |
| Error handling | Generic messages; server logs only the failure class (no data); client never turns an error into empty data or $0 | API + UI tests |
| Concurrency | Optimistic version checks; stale writes get 409; coverage writes guarded atomically | API tests |
| Browser data exposure | API responses are never logged; no data in localStorage (theme and sidebar only); CSP, X-Frame-Options DENY, nosniff and Referrer-Policy on served pages | code review |


## Assistant (Phase 4)
| Area | Implementation | Verified by |
|---|---|---|
| Authentication | Every `/api/v1/assistant/*` and `/settings/*` route sits behind the session + CSRF boundary | `assistant.test.ts` (6 routes 401, CSRF 403) |
| Secrets | No API key exists: Workers AI is a Worker binding. Nothing about the model is sent to the browser except the model id | code review |
| No raw SQL access | Tools run fixed, parameterized queries (LIKE patterns escaped); unknown tool names are rejected | `assistant.test.ts` ("drop_table" tool rejected, table intact) |
| Output validation | Model output normalized defensively; every tool argument Zod-validated; extra fields (amounts) stripped; final draft re-validated with `WorkDayInput` | `ai.test.ts`, `assistant.test.ts` |
| Money | Pay only from `expectedPay()`; finance answers only from SQL + template; model text containing an amount is withheld | tests: invented `netCents` ignored, "$114.27" reply suppressed |
| Confirmation | Drafts are written only to `ai_drafts`; `work_days` changes only via `/drafts/:id/confirm` (atomic claim, 24 h expiry, re-validation) | duplicate/concurrent confirm → one save; rejected/expired drafts can't save |
| Limits | 500-char messages; 6 model calls, 8 tool calls (3 per turn), 400 output tokens per call; daily request cap (`AI_DAILY_LIMIT`, default 40, atomic counter in `ai_usage`) | limit tests |
| Data minimization | Assignment entry: the message and tool results (dates, period ids, teacher names from history). Finance: the question only. Backups are never read by the Worker, and tests use synthetic data | test asserts the finance model input has no amounts or merchants |
| Logging | Model errors log only the error class, never prompts or data | code review |

## Findings and residual risks
1. **CSP inline theme script:** resolved. The CSP pins the script's sha256 (`worker/src/csp.ts`), and `csp.test.ts` fails if `index.html` changes without the hash. Production also sends HSTS and redirects HTTP to HTTPS (`worker/src/index.ts`).
2. **Single user:** sessions aren't bound to a device and there's no "sign out everywhere" button yet (`revokeAll` exists server-side).
3. **Rate limiting** keys on `CF-Connecting-IP`; locally every request shares one key (expected).
4. **Legacy apps** (unchanged by instruction) still have their Phase 1 defects (password-derived cookie, failed-load overwrite). Retire them after the real migration is signed off.
6. **Assistant genuine inference not yet exercised from this machine:** wrangler isn't logged in; the procedure is in `docs/assistant.md`. Tool-call formats differ between models: the adapter accepts both Workers AI shapes, and a model that can't call tools degrades to a clarifying question (no data risk).
5. **No production resources were accessed:** every wrangler command used `--local`; no `--remote` exists in scripts.
