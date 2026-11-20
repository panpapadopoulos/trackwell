/**
 * LOCAL-ONLY legacy migration rehearsal.
 *
 *   npx tsx tools/migrate/legacy-import.ts --subtrack <file> --expenses <file> --out <dir outside the repo>
 *
 * - Reads the backups read-only and verifies their sha256 is unchanged at the end.
 * - Refuses an --out directory inside this repository (private data never lands here).
 * - Applies migrations + the import to a LOCAL D1 under <out>/d1 (wrangler --local --persist-to).
 *   It never uses --remote and never touches a Cloudflare account.
 * - Verifies counts and totals against the legacy control totals and against the
 *   byte-identical legacy payroll oracle; re-applies to prove idempotency; rehearses
 *   rollback on a disposable copy.
 * - Prints ONLY pass/fail and record counts. Amounts go to <out>/report.json (private).
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planImport, verificationQueries } from '../../src/domain/migration/importPlan';
import { centsFromDollars } from '../../src/domain/money';
import { calculateExpectedPay } from '../../src/domain/legacy/subtrack/utils/payroll';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const subtrackPath = arg('subtrack');
const expensesPath = arg('expenses');
const outArg = arg('out');
if (!subtrackPath || !expensesPath || !outArg) {
  console.error('usage: legacy-import.ts --subtrack <file> --expenses <file> --out <dir outside repo>');
  process.exit(2);
}
const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const out = resolve(outArg);
if (!relative(repo, out).startsWith('..')) {
  console.error('Refusing: --out must be OUTSIDE the trackwell repository (private data).');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaBefore = { subtrack: sha(subtrackPath), expenses: sha(expensesPath) };
const subtrackRaw = JSON.parse(readFileSync(subtrackPath, 'utf8')) as { jobs?: unknown[] };
const expensesRaw = JSON.parse(readFileSync(expensesPath, 'utf8'));
const runId = `legacy-${shaBefore.subtrack.slice(0, 10)}-${shaBefore.expenses.slice(0, 10)}`;

const results: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const plan = planImport(subtrackRaw, expensesRaw, {
  runId,
  now: Date.now(),
  subtrackSha256: shaBefore.subtrack,
  expensesSha256: shaBefore.expenses,
});
check(
  'input validation (schema, references, DB limits, duplicates)',
  plan.ok,
  plan.ok ? undefined : `${plan.issues.length} issue group(s)`,
);
if (!plan.ok) {
  for (const i of plan.issues) console.log(`      ${i.kind}: ${i.where} × ${i.count}`);
  process.exit(1);
}

// Independent check: expected pay recomputed with the VERBATIM legacy payroll code.
const oracleCents = (subtrackRaw.jobs ?? []).reduce<number>(
  (s, j) => s + centsFromDollars(calculateExpectedPay(j as Parameters<typeof calculateExpectedPay>[0])),
  0,
);
check(
  'expected pay: Trackwell engine == legacy oracle (to the cent)',
  oracleCents === plan.controls.expectedNetCents,
);

const sqlFile = resolve(out, `${runId}.sql`);
const rollbackFile = resolve(out, `${runId}.rollback.sql`);
writeFileSync(sqlFile, `${plan.sql.join('\n')}\n`);
writeFileSync(rollbackFile, `${plan.rollbackSql.join('\n')}\n`);

const wrangler = (args: string, persist: string) =>
  execSync(`npx wrangler d1 ${args} trackwell --local --persist-to "${persist}"`, {
    cwd: repo,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
const query = (sql: string, persist: string): number => {
  const outJson = wrangler(`execute --json --command "${sql.replace(/"/g, '\\"')}"`, persist);
  const parsed = JSON.parse(outJson.slice(outJson.indexOf('['))) as Array<{ results: Array<{ v: number }> }>;
  return Number(parsed[0]!.results[0]!.v);
};
const verify = (persist: string) =>
  Object.fromEntries(Object.entries(verificationQueries(runId)).map(([k, q]) => [k, query(q, persist)]));

const d1 = resolve(out, 'd1');
rmSync(d1, { recursive: true, force: true }); // disposable local rehearsal database
wrangler('migrations apply', d1);
wrangler(`execute --file "${sqlFile}"`, d1);
const imported = verify(d1);
for (const [k, v] of Object.entries(plan.controls))
  check(`${k}: imported == legacy`, imported[k] === v, k.endsWith('Cents') ? undefined : `${v}`);

wrangler(`execute --file "${sqlFile}"`, d1);
const again = verify(d1);
check(
  'idempotent: re-applying the same import adds nothing',
  JSON.stringify(again) === JSON.stringify(imported),
);

const scratch = resolve(out, 'd1-rollback-test');
rmSync(scratch, { recursive: true, force: true });
cpSync(d1, scratch, { recursive: true });
wrangler(`execute --file "${rollbackFile}"`, scratch);
const rolled = verify(scratch);
check(
  'rollback removes exactly this run',
  Object.values(rolled).every((v) => v === 0),
);
wrangler(`execute --file "${sqlFile}"`, scratch);
check(
  're-import after rollback restores identical totals',
  JSON.stringify(verify(scratch)) === JSON.stringify(imported),
);
rmSync(scratch, { recursive: true, force: true });

const shaAfter = { subtrack: sha(subtrackPath), expenses: sha(expensesPath) };
check(
  'original backups unchanged (sha256 before == after)',
  JSON.stringify(shaBefore) === JSON.stringify(shaAfter),
);

writeFileSync(
  resolve(out, 'report.json'),
  JSON.stringify(
    {
      runId,
      at: new Date().toISOString(),
      shaBefore,
      shaAfter,
      controls: plan.controls,
      imported,
      oracleCents,
      checks: results,
    },
    null,
    2,
  ),
);
const failed = results.filter((r) => !r[1]).length;
console.log(
  `\n${failed ? `${failed} check(s) FAILED` : 'ALL CHECKS PASSED'} · run ${runId} · detailed private report: ${relative(repo, resolve(out, 'report.json'))}`,
);
if (!existsSync(sqlFile)) process.exit(1);
process.exit(failed ? 1 : 0);
