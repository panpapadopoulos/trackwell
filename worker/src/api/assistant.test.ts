/**
 * Assistant integration tests: real handler, real migrations on SQLite, the
 * deterministic MOCK model (or scripted fake models). Synthetic data only.
 * No network and no Workers AI calls happen here.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle, type Deps } from '../app';
import { hashPassword } from '../auth/password';
import { SESSION_COOKIE } from '../auth/session';
import { D1AttemptStore, D1SessionStore } from '../stores';
import { MockModel } from '../ai/mock';
import type { ChatMessage, ChatModel, ModelResult } from '../ai/model';
import { AI_LIMITS } from '../ai/deps';
import { ModelTimeout } from '../ai/orchestrator';
import { EVAL_CASES, scoreDraft } from '../ai/eval/cases';
import { migratedDb } from '../../../tests/support/sqliteD1';
import type { Snapshot } from '../../../src/shared/snapshot';
import type {
  AnswerResponse,
  AssistantStatus,
  ClarifyResponse,
  ConfirmResponse,
  DraftResponse,
} from '../../../src/shared/assistant';

const ORIGIN = 'http://127.0.0.1:5173';
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}-pw`;
const EXAMPLE =
  'Today I covered Mr. Smith during periods 1 and 3, had period 5 free, and covered Mrs. Jones during period 7.';
let HASH = '';
beforeAll(async () => {
  HASH = await hashPassword(PASSWORD, 10_000);
});

let deps: Deps;
let raw: ReturnType<typeof migratedDb>['raw'];
let clock: number;
let seq = 0;
let auth: { cookie: string; csrf: string };

async function login() {
  const res = await call('POST', '/api/auth/login', { password: PASSWORD }, false);
  const token = /__Host-tw_session=([^;]*)/.exec(res.headers.get('Set-Cookie') ?? '')![1]!;
  auth = {
    cookie: `${SESSION_COOKIE}=${token}`,
    csrf: ((await res.json()) as { csrfToken: string }).csrfToken,
  };
}

function setup(model: ChatModel = new MockModel(), dailyLimit = 40) {
  const m = migratedDb();
  raw = m.raw;
  // Wednesday 2026-11-18, noon in Chicago → MHS A Block (PLC, P1, P3, P5, P7).
  clock = Date.UTC(2026, 10, 18, 18);
  deps = {
    db: m.db,
    sessions: new D1SessionStore(m.db),
    attempts: new D1AttemptStore(m.db),
    adminPasswordHash: HASH,
    allowedOrigin: ORIGIN,
    now: () => clock++,
    newId: () => `id-${++seq}`,
    ai: { mode: 'mock', model, dailyLimit },
  };
}

beforeEach(async () => {
  setup();
  await login();
});

async function call(method: string, path: string, body?: unknown, authed = true, csrf = true) {
  const headers = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json' });
  if (authed) {
    headers.set('Cookie', auth.cookie);
    if (csrf) headers.set('X-CSRF-Token', auth.csrf);
  }
  const withBody = body !== undefined && method !== 'GET';
  return handle(
    new Request(`${ORIGIN}${path}`, { method, headers, ...(withBody ? { body: JSON.stringify(body) } : {}) }),
    deps,
  );
}
const ok = async <T>(r: Response, status = 200) => {
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
};
const ask = (message: string) => call('POST', '/api/v1/assistant/assignment', { message });
const workDayCount = () => (raw.prepare('SELECT COUNT(*) AS n FROM work_days').get() as { n: number }).n;
const draftStatus = (id: string) =>
  (raw.prepare('SELECT status FROM ai_drafts WHERE id = ?').get(id) as { status: string }).status;

/** A scripted model: returns the given results in order (then repeats the last). */
class ScriptedModel implements ChatModel {
  readonly id = 'scripted-test-model';
  seen: ChatMessage[][] = [];
  constructor(private readonly script: ((msgs: ChatMessage[]) => ModelResult)[]) {}
  async run(messages: ChatMessage[]): Promise<ModelResult> {
    this.seen.push(structuredClone(messages));
    const i = Math.min(this.seen.length - 1, this.script.length - 1);
    return this.script[i]!(messages);
  }
}
const calls = (...c: [string, unknown][]): ModelResult => ({
  toolCalls: c.map(([name, args], i) => ({ id: `c${i}`, name, args })),
  text: null,
  usage: { inputTokens: 100, outputTokens: 20 },
});
const say = (text: string): ModelResult => ({
  toolCalls: [],
  text,
  usage: { inputTokens: 50, outputTokens: 10 },
});

describe('Smart Assignment Entry: multi-step tool execution (mock model)', () => {
  it('turns the example sentence into a validated draft through four tool calls, without saving', async () => {
    const before = workDayCount();
    const r = await ok<DraftResponse>(await ask(EXAMPLE));
    expect(r.kind).toBe('draft');
    expect(r.meta.mode).toBe('mock');
    expect(r.meta.promptVersion).toBe('assignment-entry@1.0.0');
    expect(r.trace.filter((s) => s.by === 'model').map((s) => s.tool)).toEqual([
      'get_employment_defaults',
      'resolve_schedule',
      'search_teachers',
      'propose_work_day',
    ]);
    expect(r.trace.filter((s) => s.by === 'server').map((s) => s.tool)).toEqual([
      'cross_check',
      'validate',
      'compute_pay',
      'store_draft',
    ]);
    expect(r.meta.modelCalls).toBe(4);
    expect(r.meta.toolCalls).toBe(4);

    const d = r.draft;
    expect(d).toMatchObject({
      date: '2026-11-18',
      status: 'worked',
      employmentType: 'permanent',
      schoolName: 'Munster High School',
      district: 'Munster',
      format: 'multiple',
      scheduleId: 'mhs-2026-27-a-block',
      lunchVariant: 'A',
    });
    expect(d.coverage.map((b) => [b.periodId, b.status, b.teacherName])).toEqual([
      ['P1', 'covered', 'Mr. Smith'],
      ['P3', 'covered', 'Mr. Smith'],
      ['P5', 'free', undefined],
      ['P7', 'covered', 'Mrs. Jones'],
    ]);
    expect(d.coverage[0]).toMatchObject({ startTime: '08:00', endTime: '09:29' }); // verified A Block times
    expect(r.pay).toMatchObject({ netCents: 11427, grossCents: 13000, basis: 'permanent-flat' });
    expect(r.assumptions.join(' ')).toMatch(/Wednesday default/);
    expect(workDayCount()).toBe(before); // nothing saved
    expect(draftStatus(r.draftId)).toBe('pending');
  });

  it('enriches a teacher from history (room, subject) when exactly one teacher matches', async () => {
    await ok(
      await call('POST', '/api/v1/work-days', {
        date: '2026-11-16',
        employmentType: 'permanent',
        role: 'teacher',
        format: 'multiple',
        schoolName: 'Munster High School',
        district: 'Munster',
        dayType: 1,
        startTime: '07:15',
        endTime: '14:50',
        hours: 7.58,
        coverage: [
          { periodId: 'P2', status: 'covered', teacherName: 'Mr. Smith', room: 'N161', subject: 'Biology' },
        ],
      }),
      201,
    );
    const r = await ok<DraftResponse>(await ask(EXAMPLE));
    expect(r.trace.find((s) => s.tool === 'search_teachers')!.summary).toMatch(/1 of 2/);
    expect(r.draft.coverage[0]).toMatchObject({ teacherName: 'Mr. Smith', room: 'N161', subject: 'Biology' });
    expect(r.draft.coverage[3]!.room).toBeUndefined(); // Mrs. Jones unknown: nothing invented
  });

  it('asks instead of guessing when a period does not exist on that day', async () => {
    const r = await ok<ClarifyResponse>(await ask('Today I covered Mr. Smith during period 2.'));
    expect(r.kind).toBe('clarify');
    expect(r.message).toMatch(/not a period on A Block/);
    expect(r.trace.some((s) => s.tool === 'propose_work_day' && !s.ok)).toBe(true);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM ai_drafts').get()).toEqual({ n: 0 });
  });

  it('flags a duplicate permanent day in the preview; confirming is refused and the draft stays pending', async () => {
    const first = await ok<DraftResponse>(await ask(EXAMPLE));
    await ok(await call('POST', `/api/v1/assistant/drafts/${first.draftId}/confirm`, {}), 201);
    const second = await ok<DraftResponse>(await ask(EXAMPLE));
    expect(second.warnings.join(' ')).toMatch(/already saved/);
    const res = await call('POST', `/api/v1/assistant/drafts/${second.draftId}/confirm`, {});
    expect(res.status).toBe(409);
    expect(draftStatus(second.draftId)).toBe('pending');
  });
});

describe('confirmation is enforced server-side', () => {
  it('saves only on confirm, verifies by reading back, and the day appears in the snapshot', async () => {
    const d = await ok<DraftResponse>(await ask(EXAMPLE));
    const c = await ok<ConfirmResponse>(
      await call('POST', `/api/v1/assistant/drafts/${d.draftId}/confirm`, {}),
      201,
    );
    expect(c.verified).toBe(true);
    expect(c.checks.every((x) => x.ok)).toBe(true);
    const snap = await ok<Snapshot>(await call('GET', '/api/v1/snapshot'));
    const day = snap.workDays.find((w) => w.id === c.workDayId)!;
    expect(day.coverage.map((b) => b.periodId)).toEqual(['P1', 'P3', 'P5', 'P7']);
    expect(raw.prepare('SELECT status, result_id FROM ai_drafts WHERE id = ?').get(d.draftId)).toEqual({
      status: 'confirmed',
      result_id: c.workDayId,
    });
    expect(
      raw
        .prepare("SELECT action FROM audit_log WHERE entity = 'work_day' AND entity_id = ?")
        .get(c.workDayId),
    ).toEqual({
      action: 'create',
    });
  });

  it('prevents duplicate saves: a replayed or concurrent confirm saves once', async () => {
    const d = await ok<DraftResponse>(await ask(EXAMPLE));
    const path = `/api/v1/assistant/drafts/${d.draftId}/confirm`;
    const [a, b] = await Promise.all([call('POST', path, {}), call('POST', path, {})]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await call('POST', path, {})).status).toBe(409);
    expect(workDayCount()).toBe(1);
  });

  it('accepts the user’s edits, re-validates them, and rejects invalid edits without consuming the draft', async () => {
    const d = await ok<DraftResponse>(await ask(EXAMPLE));
    const path = `/api/v1/assistant/drafts/${d.draftId}/confirm`;
    const bad = { ...d.draft, coverage: [...d.draft.coverage, { ...d.draft.coverage[0]! }] }; // duplicate period
    expect((await call('POST', path, { input: bad })).status).toBe(422);
    expect(draftStatus(d.draftId)).toBe('pending');
    const edited = {
      ...d.draft,
      coverage: d.draft.coverage.map((b) =>
        b.periodId === 'P7' ? { ...b, teacherName: 'Mrs. Jonas', room: 'S12' } : b,
      ),
    };
    const c = await ok<ConfirmResponse>(await call('POST', path, { input: edited }), 201);
    const saved = raw
      .prepare("SELECT teacher_name, room FROM coverage_blocks WHERE work_day_id = ? AND period_id = 'P7'")
      .get(c.workDayId);
    expect(saved).toEqual({ teacher_name: 'Mrs. Jonas', room: 'S12' });
  });

  it('a discarded draft can never be saved', async () => {
    const d = await ok<DraftResponse>(await ask(EXAMPLE));
    await ok(await call('POST', `/api/v1/assistant/drafts/${d.draftId}/reject`, {}));
    expect((await call('POST', `/api/v1/assistant/drafts/${d.draftId}/confirm`, {})).status).toBe(409);
    expect(workDayCount()).toBe(0);
  });

  it('expired drafts cannot be confirmed', async () => {
    const d = await ok<DraftResponse>(await ask(EXAMPLE));
    clock += AI_LIMITS.draftTtlMs + 1000;
    await login(); // the old session idled out too
    expect((await call('POST', `/api/v1/assistant/drafts/${d.draftId}/confirm`, {})).status).toBe(410);
  });
});

describe('authorization and limits', () => {
  for (const [m, p] of [
    ['POST', '/api/v1/assistant/assignment'],
    ['POST', '/api/v1/assistant/ask'],
    ['POST', '/api/v1/assistant/drafts/x/confirm'],
    ['POST', '/api/v1/assistant/drafts/x/reject'],
    ['GET', '/api/v1/assistant/status'],
    ['PUT', '/api/v1/settings/employment-defaults'],
  ] as const)
    it(`${m} ${p} requires a session`, async () => {
      expect((await call(m, p, { message: 'x' }, false)).status).toBe(401);
    });

  it('a session without the CSRF token cannot run the assistant or confirm', async () => {
    expect(
      (await call('POST', '/api/v1/assistant/assignment', { message: EXAMPLE }, true, false)).status,
    ).toBe(403);
    const d = await ok<DraftResponse>(await ask(EXAMPLE));
    expect(
      (await call('POST', `/api/v1/assistant/drafts/${d.draftId}/confirm`, {}, true, false)).status,
    ).toBe(403);
    expect(workDayCount()).toBe(0);
  });

  it('enforces the daily request cap atomically', async () => {
    setup(new MockModel(), 2);
    await login();
    await ok(await ask(EXAMPLE));
    await ok(await call('POST', '/api/v1/assistant/ask', { message: 'How much did I spend this month?' }));
    const r = await ask(EXAMPLE);
    expect(r.status).toBe(429);
    const s = await ok<AssistantStatus>(await call('GET', '/api/v1/assistant/status'));
    expect(s.today.requests).toBe(2);
    expect(s.dailyLimit).toBe(2);
  });

  it('rejects over-long messages before any model call', async () => {
    const model = new ScriptedModel([() => say('x')]);
    setup(model);
    await login();
    expect((await ask('a'.repeat(501))).status).toBe(422);
    expect(model.seen).toHaveLength(0);
  });

  it('a model timeout answers 504, saves nothing, and leaves no draft (safe to retry)', async () => {
    setup({ id: 'slow', run: () => Promise.reject(new ModelTimeout()) });
    await login();
    const r = await ask(EXAMPLE);
    expect(r.status).toBe(504);
    expect(((await r.json()) as { message: string }).message).toMatch(/Nothing was saved/);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM ai_drafts').get()).toEqual({ n: 0 });
    expect(workDayCount()).toBe(0);
  });

  it('answers 503 when the assistant is not configured', async () => {
    delete deps.ai;
    expect((await ask(EXAMPLE)).status).toBe(503);
  });
});

describe('model output is validated, bounded, and never trusted for money', () => {
  it('rejects unknown tools and invalid arguments, feeding the error back to the model', async () => {
    const model = new ScriptedModel([
      () => calls(['drop_table', { sql: 'DROP TABLE work_days' }], ['resolve_schedule', { date: 42 }]),
      () => say('Which date did you mean?'),
    ]);
    setup(model);
    await login();
    const r = await ok<ClarifyResponse>(await ask(EXAMPLE));
    expect(r.kind).toBe('clarify');
    expect(r.trace.filter((s) => s.by === 'model' && !s.ok).map((s) => s.tool)).toEqual([
      'drop_table',
      'resolve_schedule',
    ]);
    const toolMsgs = model.seen[1]!.filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => JSON.parse(m.content).error)).toEqual([
      expect.stringMatching(/Unknown tool/),
      expect.stringMatching(/Invalid arguments/),
    ]);
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'work_days'").get()).toBeTruthy();
  });

  it('ignores amounts the model invents: pay comes only from expectedPay()', async () => {
    setup(
      new ScriptedModel([
        () =>
          calls([
            'propose_work_day',
            {
              date: 'today',
              netCents: 999_999,
              pay: '$5,000.00',
              blocks: [{ period: 'first', status: 'covered', teacherName: 'Mr. A', grossCents: 1 }],
            },
          ]),
      ]),
    );
    await login();
    const r = await ok<DraftResponse>(await ask('Today I covered Mr. A during first period.'));
    expect(r.pay.netCents).toBe(11427);
    expect(JSON.stringify(r.draft)).not.toMatch(/999999|5,000|grossCents/);
    expect(r.draft.coverage[0]!.periodId).toBe('P1');
  });

  it('stops at the model-call limit when the model loops', async () => {
    const model = new ScriptedModel([() => calls(['get_employment_defaults', { date: 'today' }])]);
    setup(model);
    await login();
    const r = await ok<ClarifyResponse>(await ask(EXAMPLE));
    expect(r.kind).toBe('clarify');
    expect(model.seen).toHaveLength(AI_LIMITS.maxModelCalls);
    expect(r.meta.toolCalls).toBeLessThanOrEqual(AI_LIMITS.maxToolCalls);
    expect(r.trace.at(-1)!.tool).toBe('limit');
  });

  it('caps tool calls per turn and never shows model-written amounts', async () => {
    const model = new ScriptedModel([
      () => calls(...Array.from({ length: 6 }, () => ['get_employment_defaults', {}] as [string, unknown])),
      () => say('You earned $114.27 today!'),
    ]);
    setup(model);
    await login();
    const r = await ok<ClarifyResponse>(await ask(EXAMPLE));
    expect(r.meta.toolCalls).toBe(AI_LIMITS.maxToolCallsPerTurn);
    expect(r.message).not.toMatch(/114/);
  });

  it('records token usage per day', async () => {
    setup(
      new ScriptedModel([
        () => calls(['get_employment_defaults', { date: 'today' }]),
        () => say('Which periods?'),
      ]),
    );
    await login();
    await ok(await ask(EXAMPLE));
    expect(
      raw
        .prepare('SELECT requests, model_calls, tool_calls, input_tokens, output_tokens FROM ai_usage')
        .get(),
    ).toEqual({
      requests: 1,
      model_calls: 2,
      tool_calls: 1,
      input_tokens: 150,
      output_tokens: 30,
    });
  });
});

describe('persistent context: saved preferences survive sessions and drive the assistant', () => {
  const week = {
    1: { employmentType: 'permanent', schoolName: 'Munster High School', district: 'Munster' },
    2: { employmentType: 'permanent', schoolName: 'Munster High School', district: 'Munster' },
    3: { employmentType: 'permanent', schoolName: 'Munster High School', district: 'Munster' },
    4: { employmentType: 'regular', schoolName: null, district: null },
    5: { employmentType: 'permanent', schoolName: 'Munster High School', district: 'Munster' },
  };

  it('defaults start as Mon/Wed/Fri permanent at MHS and Tue/Thu regular', async () => {
    const s = await ok<Snapshot>(await call('GET', '/api/v1/snapshot'));
    expect(s.employmentDefaults[1]).toEqual({
      employmentType: 'permanent',
      schoolName: 'Munster High School',
      district: 'Munster',
    });
    expect(s.employmentDefaults[2]).toEqual({ employmentType: 'regular', schoolName: null, district: null });
    expect(s.employmentDefaults[4]!.employmentType).toBe('regular');
    expect(s.assistant.usualLunch).toBe('A');
  });

  it('edits persist across sessions, keep history, and leave saved work days untouched', async () => {
    const d = await ok<DraftResponse>(await ask(EXAMPLE));
    await ok(await call('POST', `/api/v1/assistant/drafts/${d.draftId}/confirm`, {}), 201);
    const before = raw.prepare('SELECT employment_type, expected_net_cents FROM work_days').all();
    await ok(await call('PUT', '/api/v1/settings/employment-defaults', week));
    await login(); // a brand-new session
    const s = await ok<Snapshot>(await call('GET', '/api/v1/snapshot'));
    expect(s.employmentDefaults[2]!.employmentType).toBe('permanent');
    expect(raw.prepare('SELECT COUNT(*) AS n FROM weekday_defaults').get()).toEqual({ n: 10 }); // seed + today's
    expect(raw.prepare('SELECT employment_type, expected_net_cents FROM work_days').all()).toEqual(before);
  });

  it('the assistant uses the saved weekday default and saved lunch preference', async () => {
    await ok(await call('PUT', '/api/v1/settings/employment-defaults', week));
    await ok(await call('PUT', '/api/v1/settings/assistant', { usualLunch: 'B' }));
    await login();
    const r = await ok<DraftResponse>(await ask('Yesterday I covered Mr. Lee during period 2 and period 5.'));
    expect(r.draft).toMatchObject({ date: '2026-11-17', employmentType: 'permanent', lunchVariant: 'B' });
    expect(r.draft.scheduleId).toBe('mhs-2026-27-traditional');
    expect(r.assumptions.join(' ')).toMatch(/Tuesday default/);
    expect(r.assumptions.join(' ')).toMatch(/Lunch B from your saved preference/);
    expect(r.pay.netCents).toBe(11427);
  });

  it('rejects invalid defaults (a permanent day needs a school)', async () => {
    const r = await call('PUT', '/api/v1/settings/employment-defaults', {
      ...week,
      3: { employmentType: 'permanent', schoolName: '', district: null },
    });
    expect(r.status).toBe(422);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM weekday_defaults').get()).toEqual({ n: 5 });
  });
});

describe('Financial Q&A: real queries, deterministic answers', () => {
  async function seedMoney() {
    const { id: cat } = await ok<{ id: string }>(
      await call('POST', '/api/v1/categories', { name: 'Groceries', color: '#4f9d69' }),
      201,
    );
    const { id: pm } = await ok<{ id: string }>(
      await call('POST', '/api/v1/payment-methods', { name: 'Debit', type: 'Debit card' }),
      201,
    );
    for (const [date, amountCents] of [
      ['2026-11-02', 4210],
      ['2026-11-10', 1999],
      ['2026-10-30', 5000],
    ] as const)
      await ok(
        await call('POST', '/api/v1/expenses', {
          date,
          merchant: 'Synthetic Market',
          amountCents,
          categoryId: cat,
          paymentMethodId: pm,
        }),
        201,
      );
    await ok(
      await call('POST', '/api/v1/payments', { date: '2026-11-13', district: 'Munster', amountCents: 79989 }),
      201,
    );
  }

  it('answers spending for a named month from SQL, with the model seeing only the question', async () => {
    await seedMoney();
    const r = await ok<AnswerResponse>(
      await call('POST', '/api/v1/assistant/ask', { message: 'How much did I spend in November 2026?' }),
    );
    expect(r.kind).toBe('answer');
    expect(r.range).toMatchObject({ from: '2026-11-01', to: '2026-11-18' });
    expect(r.figures[0]).toEqual({ label: 'Spent', cents: 6209, kind: 'spent' });
    expect(r.answer).toBe(
      'You spent $62.09 across 2 expenses in November 2026. Biggest categories: Groceries $62.09.',
    );
    expect(r.trace.map((s) => s.tool)).toEqual(['finance_totals', 'compose_answer']);
  });

  it('net cash flow = received − spent; the model never receives records or amounts', async () => {
    await seedMoney();
    const model = new ScriptedModel([
      () => calls(['finance_totals', { period: 'this_month', metric: 'net' }]),
    ]);
    deps.ai = { mode: 'mock', model, dailyLimit: 40 };
    const r = await ok<AnswerResponse>(
      await call('POST', '/api/v1/assistant/ask', { message: 'What is my net this month?' }),
    );
    expect(r.figures.find((f) => f.kind === 'net')!.cents).toBe(79989 - 6209);
    expect(model.seen).toHaveLength(1); // one model call total
    const sent = JSON.stringify(model.seen[0]);
    expect(sent).not.toMatch(/79989|6209|Synthetic Market|Groceries/);
  });

  it('declines off-topic questions without numbers', async () => {
    const r = await ok<ClarifyResponse>(
      await call('POST', '/api/v1/assistant/ask', { message: 'Write me a poem about clouds' }),
    );
    expect(r.kind).toBe('clarify');
    expect(r.message).toMatch(/income, payments, earnings, expenses/);
  });
});

describe('cross-check: the draft must match the user’s words', () => {
  const propose = (blocks: unknown[]) => () => calls(['propose_work_day', { date: 'today', blocks }]);
  const right = [
    { period: '1', status: 'covered', teacherName: 'Mr. Smith' },
    { period: '3', status: 'covered', teacherName: 'Mr. Smith' },
    { period: '5', status: 'free' },
    { period: '7', status: 'covered', teacherName: 'Mrs. Jones' },
  ];
  async function run(first: unknown[]) {
    const model = new ScriptedModel([propose(first), propose(right)]);
    setup(model);
    await login();
    const r = await ok<DraftResponse>(await ask(EXAMPLE));
    const feedback = JSON.parse(model.seen[1]!.find((m) => m.role === 'tool')!.content).error as string;
    return { r, feedback };
  }

  it('rejects an omitted period (the genuine granite failure) and accepts the corrected retry', async () => {
    const { r, feedback } = await run(right.filter((b) => b.period !== '3'));
    expect(feedback).toMatch(/period 3 is missing \(covered, Mr\. Smith\)/);
    expect(r.kind).toBe('draft');
    expect(r.draft.coverage.map((b) => b.periodId)).toEqual(['P1', 'P3', 'P5', 'P7']);
    expect(r.trace.filter((s) => s.tool === 'propose_work_day').map((s) => s.ok)).toEqual([false, true]);
  });

  it('rejects a duplicated period', async () => {
    const { feedback } = await run([...right, { period: 'P1', status: 'covered', teacherName: 'Mr. Smith' }]);
    expect(feedback).toMatch(/Period 1 appears twice/);
  });

  it('rejects a period given to the wrong teacher or status, and an unmentioned period', async () => {
    const { feedback } = await run([
      { period: '1', status: 'covered', teacherName: 'Mrs. Jones' },
      { period: '3', status: 'covered', teacherName: 'Mr. Smith' },
      { period: '5', status: 'planning' },
      { period: 'PLC', status: 'free' },
      { period: '7', status: 'covered', teacherName: 'Mrs. Jones' },
    ]);
    expect(feedback).toMatch(/period 1 was Mr\. Smith, not Mrs\. Jones/);
    expect(feedback).toMatch(/period 5 should be free, not planning/);
    expect(feedback).toMatch(/PLC was not mentioned/);
  });

  it('never blocks wording it cannot read (no expectation, no check)', async () => {
    setup(new ScriptedModel([propose([{ period: '3', status: 'covered', teacherName: 'Mr. Smith' }])]));
    await login();
    const r = await ok<DraftResponse>(await ask('Subbed in the science wing, third block only.'));
    expect(r.kind).toBe('draft');
    expect(r.trace.some((s) => s.tool === 'cross_check')).toBe(false);
  });
});

describe('evaluation set (mock model; the same cases run on Workers AI via npm run ai:eval)', () => {
  for (const c of EVAL_CASES)
    it(`${c.id}: ${c.covers}`, async () => {
      const r = await ok<DraftResponse>(await ask(c.message));
      expect(r.kind, (r as unknown as ClarifyResponse).message).toBe('draft');
      expect(scoreDraft(c, r.draft)).toEqual([]);
      expect(r.trace.some((s) => s.tool === 'cross_check' && s.ok)).toBe(true);
    });
});
