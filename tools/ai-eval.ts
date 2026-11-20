/**
 * Runs the assistant evaluation set against a LOCAL Worker (synthetic local D1).
 * Drafts only: each draft is discarded afterwards, nothing is saved.
 *   npm run dev:api:ai   then   npm run ai:eval -- --out <your-folder>/<file>.json
 * The dev password is read from .dev.password and never printed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EVAL_CASES, scoreDraft } from '../worker/src/ai/eval/cases';
import type { ClarifyResponse, DraftResponse } from '../src/shared/assistant';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const BASE = arg('base') ?? 'http://127.0.0.1:8787';
const ORIGIN = arg('origin') ?? 'http://127.0.0.1:5173';
const OUT = arg('out');

let cookie = '';
let csrf = '';
async function call<T>(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0]!;
  return { status: res.status, json: (await res.json().catch(() => null)) as T };
}

const login = await call<{ csrfToken: string }>('POST', '/api/auth/login', {
  password: readFileSync('.dev.password', 'utf8').trim(),
});
if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
csrf = login.json.csrfToken;
const status = await call<{ mode: string; model: string }>('GET', '/api/v1/assistant/status');
console.log(`mode ${status.json.mode} · model ${status.json.model}`);

const results = [];
for (const c of EVAL_CASES) {
  const t0 = Date.now();
  const r = await call<DraftResponse | ClarifyResponse>('POST', '/api/v1/assistant/assignment', {
    message: c.message,
  });
  const ms = Date.now() - t0;
  let diffs: string[];
  if (r.status !== 200) diffs = [`HTTP ${r.status}`];
  else if (r.json.kind !== 'draft') diffs = [`clarify: ${r.json.message}`];
  else {
    diffs = scoreDraft(c, r.json.draft);
    await call('POST', `/api/v1/assistant/drafts/${r.json.draftId}/reject`, {});
  }
  const meta = r.status === 200 ? r.json.meta : undefined;
  const trace = r.status === 200 ? r.json.trace : [];
  const rejected = trace.filter((s) => !s.ok).map((s) => `${s.tool}: ${s.summary}`);
  console.log(
    `${diffs.length ? '✗' : '✓'} ${c.id} · ${meta?.modelCalls ?? '-'} model calls · ${meta?.usage.inputTokens ?? 0}/${meta?.usage.outputTokens ?? 0} tokens · ${ms} ms`,
  );
  for (const d of diffs) console.log(`    ${d}`);
  for (const x of rejected) console.log(`    (recovered) ${x}`);
  results.push({ id: c.id, covers: c.covers, pass: diffs.length === 0, diffs, ms, meta, trace });
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify({ at: new Date().toISOString(), mode: status.json.mode, model: status.json.model, passed, total: results.length, results }, null, 2)}\n`,
  );
  console.log(`wrote ${OUT}`);
}
