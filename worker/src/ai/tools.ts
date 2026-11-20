/**
 * The assistant's tools. Each one: a JSON schema the model sees, a Zod schema
 * that validates what the model actually sent, and a deterministic executor.
 * Tools read through fixed, parameterized queries only; none of them writes a
 * work day (saving happens only in the confirm endpoint, after the user clicks).
 */
import { z } from 'zod';
import { formatLong, type ISODate } from '../../../src/domain/dates';
import {
  normalizePeriod,
  resolveDateWords,
  resolveRange,
  WEEKDAY_NAME,
} from '../../../src/domain/assistant/parse';
import { expectedPay, hoursBetween } from '../../../src/domain/pay/engine';
import { PAY_RULES_V1 } from '../../../src/domain/pay/rules';
import { DEFAULT_REGISTRY } from '../../../src/domain/schedule/registry';
import { resolveSchedule } from '../../../src/domain/schedule/resolve';
import { classRows, type ClassRow } from '../../../src/domain/schedule/rows';
import type { LunchVariant, ScheduleRegistry } from '../../../src/domain/schedule/types';
import { defaultsFor, type WeeklyDefaults } from '../../../src/domain/work/defaults';
import { formatMoney } from '../../../src/domain/money';
import { WorkDayInput, fieldErrors } from '../../../src/shared/api';
import { parseDay, surname } from '../../../src/domain/assistant/extract';
import type { D1Like } from '../db';
import type { ToolDef } from './model';

/* ------------------------------ context ------------------------------ */

export interface ToolContext {
  db: D1Like;
  today: ISODate;
  week: WeeklyDefaults;
  usualLunch: LunchVariant;
  /** The user's original words, for the deterministic cross-check of the draft. */
  requestText?: string;
}

export type ToolOutcome =
  | { ok: true; result: Record<string, unknown>; summary: string }
  | { ok: false; error: string; summary: string };

const fail = (error: string): ToolOutcome => ({ ok: false, error, summary: error });

async function registryFor(db: D1Like): Promise<ScheduleRegistry> {
  const { results } = await db
    .prepare('SELECT school_name, date, schedule_id FROM schedule_date_overrides')
    .all<{ school_name: string; date: string; schedule_id: string }>();
  return {
    ...DEFAULT_REGISTRY,
    overrides: (results ?? []).map((o) => ({
      schoolName: o.school_name,
      date: o.date,
      scheduleId: o.schedule_id,
    })),
  };
}

/* ------------------------------ schemas ------------------------------ */

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const DefaultsArgs = z.object({ date: z.string().max(40).optional() });
export const ScheduleArgs = z.object({ date: z.string().max(40), schoolName: shortText(160).optional() });
export const SearchArgs = z.object({ names: z.array(shortText(120)).min(1).max(6) });
export const ProposeArgs = z.object({
  date: z.string().max(40),
  employmentType: z.enum(['permanent', 'regular']).optional(),
  schoolName: shortText(160).optional(),
  district: shortText(120).optional(),
  role: z.enum(['teacher', 'aide']).optional(),
  dayType: z.union([z.literal(1), z.literal(0.5)]).optional(),
  lunchVariant: z.enum(['A', 'B', 'C']).optional(),
  wholeDayTeacher: shortText(120).optional(),
  blocks: z
    .array(
      z.object({
        period: z.union([z.string().max(30), z.number().int().min(0).max(20)]),
        status: z.enum(['covered', 'free', 'planning', 'other']),
        teacherName: shortText(120).optional(),
      }),
    )
    .max(16)
    .default([]),
});
export const FinanceArgs = z.object({
  period: z.string().max(20),
  metric: z.enum(['overview', 'income', 'earnings', 'expenses', 'net', 'monthly']).default('overview'),
});

export const ASSIGNMENT_TOOLS: ToolDef[] = [
  {
    name: 'get_employment_defaults',
    description: "Resolve the work date and read the user's saved employment default for that weekday.",
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'today, yesterday, a weekday name, or YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'resolve_schedule',
    description: 'Bell schedule (period ids and times) for a school on a date.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, schoolName: { type: 'string' } },
      required: ['date'],
    },
  },
  {
    name: 'search_teachers',
    description: 'Find teachers the user covered before (name, room, subject).',
    parameters: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' } } },
      required: ['names'],
    },
  },
  {
    name: 'propose_work_day',
    description: 'Create a draft work day for the user to review. Does not save.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        employmentType: { type: 'string', enum: ['permanent', 'regular'] },
        schoolName: { type: 'string' },
        role: { type: 'string', enum: ['teacher', 'aide'] },
        dayType: { type: 'number', enum: [1, 0.5] },
        lunchVariant: { type: 'string', enum: ['A', 'B', 'C'] },
        wholeDayTeacher: { type: 'string', description: 'Only when one teacher was covered all day' },
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              period: { type: 'string', description: 'Period id, e.g. P1' },
              status: { type: 'string', enum: ['covered', 'free', 'planning', 'other'] },
              teacherName: { type: 'string' },
            },
            required: ['period', 'status'],
          },
        },
      },
      required: ['date', 'blocks'],
    },
  },
];

export const FINANCE_TOOLS: ToolDef[] = [
  {
    name: 'finance_totals',
    description: "Totals from the user's records for a period.",
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description:
            'this_month, last_month, YYYY-MM, this_year, last_year, YYYY, school_year, last_30_days, or all',
        },
        metric: { type: 'string', enum: ['overview', 'income', 'earnings', 'expenses', 'net', 'monthly'] },
      },
      required: ['period'],
    },
  },
];

function parseArgs<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> | string {
  const p = schema.safeParse(raw ?? {});
  if (p.success) return p.data;
  return `Invalid arguments: ${Object.entries(fieldErrors(p.error))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ')}`;
}

/* ------------------------------ assignment tools ------------------------------ */

function resolveDate(words: string | undefined, today: ISODate): ISODate | string {
  const d = resolveDateWords(words, today);
  if (!d)
    return `I couldn't tell which date "${words}" means. Use today, yesterday, a weekday, or YYYY-MM-DD.`;
  if (d > today) return `${d} is in the future. Only days already worked can be logged here.`;
  return d;
}

export async function getEmploymentDefaults(ctx: ToolContext, raw: unknown): Promise<ToolOutcome> {
  const a = parseArgs(DefaultsArgs, raw);
  if (typeof a === 'string') return fail(a);
  const date = resolveDate(a.date, ctx.today);
  if (!isDate(date)) return fail(date);
  const def = defaultsFor(date, ctx.week);
  const result = {
    date,
    weekday: WEEKDAY_NAME(date),
    employmentType: def?.employmentType ?? null,
    schoolName: def?.schoolName ?? null,
    district: def?.district ?? null,
    usualLunch: ctx.usualLunch,
  };
  return {
    ok: true,
    result,
    summary: def
      ? `${WEEKDAY_NAME(date)} ${date}: ${def.employmentType}${def.schoolName ? ` at ${def.schoolName}` : ', school per assignment'}`
      : `${WEEKDAY_NAME(date)} ${date}: no weekday default`,
  };
}

const isDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function resolveScheduleTool(ctx: ToolContext, raw: unknown): Promise<ToolOutcome> {
  const a = parseArgs(ScheduleArgs, raw);
  if (typeof a === 'string') return fail(a);
  const date = resolveDate(a.date, ctx.today);
  if (!isDate(date)) return fail(date);
  const school = a.schoolName ?? defaultsFor(date, ctx.week)?.schoolName;
  if (!school)
    return fail('No school given and no default school for this weekday. Ask the user which school.');
  const resolved = resolveSchedule(await registryFor(ctx.db), school, date);
  if (!resolved)
    return {
      ok: true,
      result: {
        date,
        schoolName: school,
        schedule: null,
        note: 'No bell schedule on file; periods are labels only.',
      },
      summary: `No bell schedule on file for ${school}`,
    };
  const s = resolved.schedule;
  const rows = s.status === 'pending-reference' ? [] : classRows(s, ctx.usualLunch);
  return {
    ok: true,
    result: {
      date,
      schoolName: school,
      scheduleId: s.id,
      name: s.name,
      status: s.status,
      lunch: ctx.usualLunch,
      periods: rows.map((r) => `${r.id} ${r.start}-${r.end}`),
    },
    summary: `${s.name} (${s.status}) · ${rows.length} periods · lunch ${ctx.usualLunch}`,
  };
}

type TeacherHit = { name: string; room: string | null; subject: string | null; times: number };

/** Words used for matching: drop honorifics and initials. */
const nameWords = (n: string) =>
  n
    .replace(/\b(mr|mrs|ms|miss|mx|dr|coach)\b\.?/gi, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}'-]/gu, ''))
    .filter((w) => w.length > 1);

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function findTeachers(db: D1Like, name: string): Promise<TeacherHit[]> {
  const words = nameWords(name);
  if (!words.length) return [];
  const key = words[words.length - 1]!; // surname
  const { results } = await db
    .prepare(
      `SELECT name, room, subject, COUNT(*) AS times FROM (
         SELECT b.teacher_name AS name, b.room AS room, b.subject AS subject, w.date AS date
           FROM coverage_blocks b JOIN work_days w ON w.id = b.work_day_id
          WHERE w.deleted_at IS NULL AND b.teacher_name LIKE ? ESCAPE '\\'
         UNION ALL
         SELECT teacher_name, NULL, class_name, date FROM work_days
          WHERE deleted_at IS NULL AND teacher_name LIKE ? ESCAPE '\\'
         ORDER BY date DESC
       ) GROUP BY name ORDER BY times DESC LIMIT 3`,
    )
    .bind(`%${likeEscape(key)}%`, `%${likeEscape(key)}%`)
    .all<TeacherHit>();
  return results ?? [];
}

export async function searchTeachers(ctx: ToolContext, raw: unknown): Promise<ToolOutcome> {
  const a = parseArgs(SearchArgs, raw);
  if (typeof a === 'string') return fail(a);
  const out: Record<string, unknown>[] = [];
  for (const n of a.names) {
    const hits = await findTeachers(ctx.db, n);
    out.push({ query: n, matches: hits.map((h) => ({ name: h.name, room: h.room, subject: h.subject })) });
  }
  const found = out.filter((o) => (o.matches as unknown[]).length).length;
  return {
    ok: true,
    result: { results: out },
    summary: `${found} of ${a.names.length} teacher(s) found in history`,
  };
}

export interface ProposedDraft {
  input: WorkDayInput;
  schedule: { id: string; name: string; status: string } | null;
  pay: ReturnType<typeof expectedPay>;
  assumptions: string[];
  warnings: string[];
  serverSteps: { tool: string; ok: boolean; summary: string }[];
}

/**
 * Builds and validates the draft. Everything is decided here, deterministically:
 * date, defaults, schedule, period ids, times, teacher enrichment, Zod validation
 * and pay. Fields the model may have added (an amount, an id) are dropped by Zod.
 */
export async function proposeWorkDay(
  ctx: ToolContext,
  raw: unknown,
): Promise<{ outcome: ToolOutcome; draft?: ProposedDraft }> {
  const a = parseArgs(ProposeArgs, raw);
  if (typeof a === 'string') return { outcome: fail(a) };
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const date = resolveDate(a.date, ctx.today);
  if (!isDate(date)) return { outcome: fail(date) };

  const def = defaultsFor(date, ctx.week);
  const employmentType = a.employmentType ?? def?.employmentType;
  if (!employmentType)
    return {
      outcome: fail(`${date} is a weekend with no default. Ask whether it was a permanent or regular day.`),
    };
  if (!a.employmentType)
    assumptions.push(
      `${employmentType === 'permanent' ? 'Permanent' : 'Regular'} from your ${WEEKDAY_NAME(date)} default`,
    );
  const schoolName = a.schoolName ?? def?.schoolName ?? null;
  if (!schoolName)
    return { outcome: fail('Which school was this? There is no default school for this weekday.') };
  if (!a.schoolName) assumptions.push(`${schoolName} from your ${WEEKDAY_NAME(date)} default`);
  const district = a.district ?? (schoolName === def?.schoolName ? def?.district : null) ?? 'Munster';
  const role = a.role ?? 'teacher';
  const dayType = a.dayType ?? 1;
  const lunch: LunchVariant = a.lunchVariant ?? ctx.usualLunch;

  // Schedule and period ids.
  const resolved = resolveSchedule(await registryFor(ctx.db), schoolName, date);
  const schedule = resolved?.schedule ?? null;
  const rows: ClassRow[] =
    schedule && schedule.status !== 'pending-reference' ? classRows(schedule, lunch) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const serverSteps: ProposedDraft['serverSteps'] = [];
  const blocks: WorkDayInput['coverage'] = [];
  for (const b of a.blocks) {
    const id = normalizePeriod(b.period);
    if (rows.length) {
      if (!id || !byId.has(id))
        return {
          outcome: fail(
            `"${b.period}" is not a period on ${schedule!.name} (${WEEKDAY_NAME(date)}). Valid: ${rows.map((r) => r.id).join(', ')}. Ask the user which period they meant.`,
          ),
        };
      const r = byId.get(id)!;
      if (blocks.some((x) => x.periodId === r.id))
        return {
          outcome: fail(
            `${r.label} appears twice in the draft. Send each period once, with the status and teacher the user gave.`,
          ),
        };
      blocks.push({ periodId: r.id, label: r.label, startTime: r.start, endTime: r.end, status: b.status });
    } else {
      blocks.push({
        label: id ? `Period ${id.replace(/^P/, '')}` : String(b.period).slice(0, 40),
        status: b.status,
      });
    }
    const last = blocks[blocks.length - 1]!;
    if (b.status === 'covered' && !b.teacherName)
      return { outcome: fail(`Who was covered during ${last.label}? Ask the user for the teacher's name.`) };
    if (b.teacherName && b.status === 'covered') last.teacherName = b.teacherName;
  }
  if (rows.length && ctx.requestText) {
    const mismatch = crossCheck(ctx.requestText, blocks, new Set(byId.keys()));
    if (mismatch && mismatch.length)
      return {
        outcome: fail(
          `The draft does not match the user's words: ${mismatch.join('; ')}. Call propose_work_day again with exactly the periods the user mentioned.`,
        ),
      };
    if (mismatch)
      serverSteps.push({
        tool: 'cross_check',
        ok: true,
        summary: 'Periods, statuses and teachers match the request wording',
      });
  }
  if (schedule && !rows.length)
    assumptions.push(`${schedule.name} times are pending; periods kept as labels only`);
  if (!schedule && blocks.length)
    assumptions.push('No bell schedule on file: periods are labels without times');
  if (schedule && rows.length && !a.lunchVariant && blocks.length)
    assumptions.push(`Lunch ${lunch} from your saved preference`);

  // Teacher enrichment from history (only when exactly one teacher matches).
  for (const b of blocks) {
    if (!b.teacherName) continue;
    const hits = await findTeachers(ctx.db, b.teacherName);
    if (hits.length === 1) {
      const h = hits[0]!;
      if (h.name !== b.teacherName)
        assumptions.push(`"${b.teacherName}" matched ${h.name} from your history`);
      b.teacherName = h.name;
      if (h.room) b.room = h.room;
      if (h.subject) b.subject = h.subject;
    } else if (hits.length > 1) warnings.push(`Several teachers match "${b.teacherName}"; check the name.`);
  }

  const permanent = employmentType === 'permanent';
  const startTime = permanent ? PAY_RULES_V1.permanentDefaultStart : '08:00';
  const endTime = permanent ? PAY_RULES_V1.permanentDefaultEnd : '15:00';
  const single = blocks.length === 0;
  const candidate = {
    date,
    status: 'worked',
    employmentType,
    role,
    format: single ? 'single' : 'multiple',
    schoolName,
    district,
    dayType,
    startTime,
    endTime,
    hours: hoursBetween(startTime, endTime),
    ...(single && a.wholeDayTeacher ? { teacherName: a.wholeDayTeacher } : {}),
    ...(schedule ? { scheduleId: schedule.id } : {}),
    ...(!single && rows.length ? { lunchVariant: lunch } : {}),
    coverage: blocks,
  };
  const parsed = WorkDayInput.safeParse(candidate);
  if (!parsed.success) {
    const msg = Object.entries(fieldErrors(parsed.error))
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    return { outcome: fail(`The draft did not validate (${msg}). Ask the user to clarify.`) };
  }
  serverSteps.push({
    tool: 'validate',
    ok: true,
    summary: `WorkDayInput schema passed · ${blocks.length} block(s) on valid period ids · ${employmentType} ${role}`,
  });

  const dup = await ctx.db
    .prepare(
      "SELECT id FROM work_days WHERE date = ? AND status = 'worked' AND deleted_at IS NULL AND employment_type = 'permanent' LIMIT 1",
    )
    .bind(date)
    .first<{ id: string }>();
  if (dup && permanent)
    warnings.push(
      `A permanent day is already saved for ${formatLong(date)}. Saving this draft will be refused; edit that day instead.`,
    );

  const pay = expectedPay({
    employmentType,
    role,
    dayType,
    hours: parsed.data.hours,
  });
  serverSteps.push({
    tool: 'compute_pay',
    ok: true,
    summary: `expectedPay(): ${formatMoney(pay.netCents)} net / ${formatMoney(pay.grossCents)} gross (${pay.basis}, ${pay.rulesVersion})`,
  });

  return {
    outcome: {
      ok: true,
      result: { status: 'draft_ready', blocks: blocks.length },
      summary: `Draft ready: ${formatLong(date)}, ${blocks.length} block(s)`,
    },
    draft: {
      input: parsed.data,
      schedule: schedule ? { id: schedule.id, name: schedule.name, status: schedule.status } : null,
      pay,
      assumptions,
      warnings,
      serverSteps,
    },
  };
}

/* ------------------------------ finance tool ------------------------------ */

export interface FinanceResult {
  range: { from: string; to: string; label: string };
  metric: z.infer<typeof FinanceArgs>['metric'];
  receivedCents: number;
  earnedCents: number;
  spentCents: number;
  paymentCount: number;
  workedDays: number;
  expenseCount: number;
  topCategories: { name: string; cents: number }[];
  months: { month: string; receivedCents: number; spentCents: number }[];
}

export async function financeTotals(
  db: D1Like,
  today: ISODate,
  raw: unknown,
): Promise<{ ok: true; data: FinanceResult } | { ok: false; error: string }> {
  const a = parseArgs(FinanceArgs, raw);
  if (typeof a === 'string') return { ok: false, error: a };
  const range = resolveRange(a.period, today);
  if (!range) return { ok: false, error: `Unknown or future period "${a.period}".` };
  const q = (sql: string) => db.prepare(sql).bind(range.from, range.to);
  const r = await db.batch([
    q(
      'SELECT COALESCE(SUM(amount_cents),0) AS c, COUNT(*) AS n FROM income_payments WHERE deleted_at IS NULL AND date BETWEEN ? AND ?',
    ),
    q(
      "SELECT COALESCE(SUM(expected_net_cents),0) AS c, COUNT(*) AS n FROM work_days WHERE deleted_at IS NULL AND status = 'worked' AND date BETWEEN ? AND ?",
    ),
    q(
      'SELECT COALESCE(SUM(amount_cents),0) AS c, COUNT(*) AS n FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ?',
    ),
    q(
      `SELECT c.name AS name, SUM(e.amount_cents) AS cents FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.date BETWEEN ? AND ? GROUP BY c.id ORDER BY cents DESC LIMIT 3`,
    ),
    q(
      `SELECT month, SUM(rc) AS receivedCents, SUM(sc) AS spentCents FROM (
         SELECT substr(date,1,7) AS month, amount_cents AS rc, 0 AS sc FROM income_payments WHERE deleted_at IS NULL AND date BETWEEN ?1 AND ?2
         UNION ALL
         SELECT substr(date,1,7), 0, amount_cents FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ?1 AND ?2
       ) GROUP BY month ORDER BY month`,
    ),
  ]);
  type Tot = { c: number; n: number };
  const first = (i: number) => ((r[i]!.results ?? [])[0] as Tot | undefined) ?? { c: 0, n: 0 };
  return {
    ok: true,
    data: {
      range,
      metric: a.metric,
      receivedCents: Number(first(0).c),
      paymentCount: Number(first(0).n),
      earnedCents: Number(first(1).c),
      workedDays: Number(first(1).n),
      spentCents: Number(first(2).c),
      expenseCount: Number(first(2).n),
      topCategories: ((r[3]!.results ?? []) as { name: string; cents: number }[]).map((c) => ({
        name: c.name,
        cents: Number(c.cents),
      })),
      months: ((r[4]!.results ?? []) as FinanceResult['months']).map((m) => ({
        month: m.month,
        receivedCents: Number(m.receivedCents),
        spentCents: Number(m.spentCents),
      })),
    },
  };
}

/**
 * Compares a proposed draft with what the user's own words make identifiable:
 * omitted periods, periods the user never mentioned, a wrong status, or a
 * period given to the wrong teacher. Periods the extractor can't read produce
 * no expectation, so an unusual phrasing never blocks a correct draft.
 */
export function crossCheck(
  text: string,
  blocks: WorkDayInput['coverage'],
  validIds: ReadonlySet<string>,
): string[] | null {
  const expected = new Map<string, { status: string; teacher?: string | undefined }>();
  for (const e of parseDay(text).blocks) {
    const id = normalizePeriod(e.period);
    if (id && validIds.has(id)) expected.set(id, { status: e.status, teacher: e.teacherName });
  }
  if (!expected.size) return null; // nothing identifiable: no check
  const issues: string[] = [];
  const label = (id: string) => (/^P\d+$/.test(id) ? `period ${id.slice(1)}` : id);
  for (const [id, e] of expected)
    if (!blocks.some((b) => b.periodId === id))
      issues.push(`${label(id)} is missing (${e.status}${e.teacher ? `, ${e.teacher}` : ''})`);
  for (const b of blocks) {
    if (!b.periodId) continue;
    const e = expected.get(b.periodId);
    if (!e) issues.push(`${label(b.periodId)} was not mentioned`);
    else if (e.status !== b.status)
      issues.push(`${label(b.periodId)} should be ${e.status}, not ${b.status}`);
    else if (e.teacher && surname(e.teacher) !== surname(b.teacherName))
      issues.push(`${label(b.periodId)} was ${e.teacher}, not ${b.teacherName ?? 'nobody'}`);
  }
  return issues;
}
