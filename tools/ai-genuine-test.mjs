#!/usr/bin/env node
/**
 * End-to-end assistant run against a LOCAL Worker (synthetic local D1 only).
 *
 *   Mock run:     npm run dev:api        then  npm run ai:genuine-test -- --out <file>
 *   Genuine run:  npm run dev:api:ai     then  npm run ai:genuine-test -- --out <file>
 *                 (needs `wrangler login`; uses the Workers AI free allocation)
 *
 * Steps: sign in → status → Smart Assignment Entry (prints the tool trace) →
 * confirm (unless --no-confirm) → read back via the snapshot → one finance
 * question → status (usage). Writes a JSON record with --out. Prints no secrets:
 * the dev password is read from .dev.password and never echoed.
 *
 * Options: --base URL (default http://127.0.0.1:8787) --origin URL (default http://127.0.0.1:5173)
 *          --message "..." --question "..." --no-confirm --out path.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:8787');
const ORIGIN = arg('origin', 'http://127.0.0.1:5173');
const MESSAGE = arg(
  'message',
  'Today I covered Mr. Smith during periods 1 and 3, had period 5 free, and covered Mrs. Jones during period 7.',
);
const QUESTION = arg('question', 'How much did I spend last month?');
const CONFIRM = !process.argv.includes('--no-confirm');
const OUT = arg('out', null);

let cookie = '';
let csrf = '';
async function call(method, path, body) {
  const headers = { Origin: ORIGIN, 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const json = await res.json().catch(() => null);
  return { status: res.status, ms: Date.now() - t0, json };
}

const log = (...a) => console.log(...a);
const record = {
  startedAt: new Date().toISOString(),
  base: BASE,
  message: MESSAGE,
  question: QUESTION,
  steps: [],
};

const password = readFileSync('.dev.password', 'utf8').trim();
const login = await call('POST', '/api/auth/login', { password });
if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
csrf = login.json.csrfToken;
log('✓ signed in (dev password, not printed)');

const status = await call('GET', '/api/v1/assistant/status');
record.statusBefore = status.json;
log(
  `mode: ${status.json?.mode} · model: ${status.json?.model} · requests today: ${status.json?.today?.requests}/${status.json?.dailyLimit}`,
);

log(`\n> ${MESSAGE}`);
const a = await call('POST', '/api/v1/assistant/assignment', { message: MESSAGE });
record.assignment = { status: a.status, ms: a.ms, response: a.json };
if (a.status !== 200) {
  log(`✗ assistant returned ${a.status}: ${a.json?.message ?? ''}`);
} else {
  for (const s of a.json.trace)
    log(`  ${String(s.step).padStart(2)}. [${s.by}] ${s.tool}${s.ok ? '' : ' (rejected)'} — ${s.summary}`);
  log(
    `  model calls ${a.json.meta.modelCalls}, tool calls ${a.json.meta.toolCalls}, tokens in/out ${a.json.meta.usage.inputTokens}/${a.json.meta.usage.outputTokens}, ${a.ms} ms`,
  );
  if (a.json.kind === 'clarify') log(`  ? ${a.json.message}`);
  if (a.json.kind === 'draft') {
    const d = a.json.draft;
    log(
      `  draft ${a.json.draftId}: ${d.date} ${d.employmentType} @ ${d.schoolName}, ${d.coverage.length} block(s): ${d.coverage.map((b) => `${b.periodId ?? b.label}=${b.status}${b.teacherName ? `:${b.teacherName}` : ''}`).join(', ')}`,
    );
    log(`  pay preview (expectedPay): ${a.json.pay.netCents} cents net`);
    for (const w of a.json.warnings) log(`  ! ${w}`);
    if (CONFIRM) {
      const c = await call('POST', `/api/v1/assistant/drafts/${a.json.draftId}/confirm`, {});
      record.confirm = { status: c.status, response: c.json };
      if (c.status === 201) {
        log(`✓ confirmed → work day ${c.json.workDayId}, verified=${c.json.verified}`);
        for (const x of c.json.checks) log(`    ${x.ok ? '✓' : '✗'} ${x.label}`);
        const replay = await call('POST', `/api/v1/assistant/drafts/${a.json.draftId}/confirm`, {});
        record.replay = { status: replay.status };
        log(`  replayed confirm → ${replay.status} (duplicate save prevented: ${replay.status === 409})`);
        const snap = await call('GET', '/api/v1/snapshot');
        const day = snap.json.workDays.find((w) => w.id === c.json.workDayId);
        record.readBack = day ? { date: day.date, coverage: day.coverage.map((b) => b.periodId) } : null;
        log(
          `  snapshot read-back: ${day ? `found, periods ${day.coverage.map((b) => b.periodId).join(',')}` : 'NOT FOUND'}`,
        );
      } else log(`✗ confirm returned ${c.status}: ${c.json?.message ?? ''}`);
    }
  }
}

log(`\n> ${QUESTION}`);
const q = await call('POST', '/api/v1/assistant/ask', { message: QUESTION });
record.finance = { status: q.status, ms: q.ms, response: q.json };
if (q.status === 200) {
  for (const s of q.json.trace) log(`  ${s.step}. [${s.by}] ${s.tool} — ${s.summary}`);
  log(`  ${q.json.kind === 'answer' ? q.json.answer : `? ${q.json.message}`}`);
} else log(`✗ ${q.status}: ${q.json?.message ?? ''}`);

const after = await call('GET', '/api/v1/assistant/status');
record.statusAfter = after.json;
log(`\nusage today: ${JSON.stringify(after.json?.today)}`);
record.finishedAt = new Date().toISOString();
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
  log(`wrote ${OUT}`);
}
