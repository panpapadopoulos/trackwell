# Legacy oracle (verbatim, do not edit)

Byte-for-byte copies of the original business logic, kept only as a **regression oracle** for tests:

| Copy | Source (commit) |
|---|---|
| `subtrack/utils/payroll.ts`, `subtrack/types.ts` | `subtrack@def1e6a` |
| `expenses/utils/recurring.ts`, `expenses/utils/format.ts`, `expenses/types.ts` | `expenses@76a2327` |

- Application code must never import from here. Only `tests/legacy/**` does.
- They're type-checked by `tsconfig.legacy.json`, which uses the original repos' (non-strict) compiler settings, so the files never need edits or suppressions.
- `tests/legacy/oracle-integrity.test.ts` asserts that they still match the original files whenever the sibling repos are present.
