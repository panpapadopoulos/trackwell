# Legacy migration runbook

Moves the SubTrack and Expenses JSON backups into Trackwell's D1 without losing, duplicating, or exposing a record. **Status: rehearsed locally, then imported into the production D1 (2026-11-20) after every check passed; production was reconciled against the source by count, identifier, relationship and cent total.**

## Guarantees and how they're enforced
| Requirement | Mechanism | Evidence |
|---|---|---|
| Input validated | Zod schemas for both legacy documents (`src/domain/migration/legacy.ts`) | `tests/migration/importPlan.test.ts` (malformed input refused) |
| No silent loss | Pre-validation against DB limits, references and duplicates; SQL uses `ON CONFLICT DO NOTHING` (CHECK/FK violations fail loudly, unlike `INSERT OR IGNORE`) | "refuses to produce SQL when validation fails" test |
| Stable identifiers | `st-<legacy id>`, `ex-<legacy id>`; `(source, legacy_id)` unique indexes | schema tests |
| Idempotent | Deterministic run id from the backups' sha256; re-applying inserts nothing | synthetic + real rehearsal |
| Referential integrity | Category, payment-method and recurring references checked before SQL; FKs enforced in D1 | planner + schema tests |
| Totals preserved | Counts and cent totals compared after import; expected pay also recomputed with the **verbatim legacy payroll code** | real rehearsal: all equal |
| Retired data kept | Raw documents stored write-once in `legacy_archive` (balances, SubTrack sync), never in app tables | archive test |
| Reversible | Rollback SQL deletes exactly one `import_run_id`; re-import restores identical totals | synthetic + real rehearsal |
| Private | Tool refuses output inside the repo, prints pass/fail and counts only; amounts go to a private `report.json` | tool behavior |

## Procedure
1. Copy the backups into a private folder outside every repo (e.g. `SubTrack-Development/private-migration/rehearsal-input/`). Never edit the originals.
2. `npx tsx tools/migrate/legacy-import.ts --subtrack <copy> --expenses <copy> --out ../private-migration/run`
3. Read the PASS/FAIL lines. Any FAIL stops the process; issues are reported as *kind · where · count* (no values).
4. Inspect the local rehearsal database if needed (`wrangler d1 execute trackwell --local --persist-to ../private-migration/run/d1 --command "…"`).
5. **Real import (future, needs explicit approval):** run the same generated `<run>.sql` against the production D1 after a fresh backup, then repeat the verification queries. Keep `<run>.rollback.sql` until the user signs off.

## Real rehearsal result (2026-11-18)
All 15 checks passed: validation; engine = legacy oracle; record counts for every entity; expected-pay, payment and expense totals equal to the cent; idempotent re-apply; rollback; re-import; backups unchanged (sha256).

## Known reconciliation notes
- Two legacy expenses look like content duplicates (same date, merchant, amount, account). Both were **kept**; they need a human decision, not an automatic merge.
- 69 legacy assignments use 12-hour time text (e.g. "7:45 AM"). Stored verbatim; pay doesn't depend on them.
- After import, the app's recurring sync adds any occurrences that came due since the backup, exactly as the legacy app did on load.
