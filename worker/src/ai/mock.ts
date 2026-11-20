/**
 * MOCK MODEL: deterministic, rule-based stand-in for an LLM, used for local
 * development and automated tests (no network, no cost). It is NOT inference.
 * It emits the same tool calls a model would, through the same orchestrator,
 * tools, validation and confirmation path, so everything except language
 * understanding is exercised for real. Responses are labelled mode "mock".
 */
import type { ChatMessage, ChatModel, ModelResult, ToolCall, ToolDef } from './model';

export { parseDay, type ParsedDay } from '../../../src/domain/assistant/extract';
import { parseDay } from '../../../src/domain/assistant/extract';

type FinanceArgs = { period: string; metric: string };
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export function parseFinance(text: string): FinanceArgs | null {
  const t = text.toLowerCase();
  if (!/(earn|income|paid|payment|spend|spent|expense|cost|net|month|total|money|made)/.test(t)) return null;
  const metric = /month by month|monthly|each month|per month/.test(t)
    ? 'monthly'
    : /net|left over|save/.test(t)
      ? 'net'
      : /spend|spent|expense|cost/.test(t)
        ? 'expenses'
        : /earn|made|work/.test(t)
          ? 'earnings'
          : /income|paid|payment|receiv/.test(t)
            ? 'income'
            : 'overview';
  const monthIdx = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(t));
  const year = /\b(20\d{2})\b/.exec(t)?.[1];
  let period = 'this_month';
  if (/last month/.test(t)) period = 'last_month';
  else if (monthIdx >= 0 && year) period = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
  else if (/school year/.test(t)) period = 'school_year';
  else if (/last year/.test(t)) period = 'last_year';
  else if (/this year/.test(t)) period = 'this_year';
  else if (year) period = year;
  else if (/30 days/.test(t)) period = 'last_30_days';
  else if (/all time|ever|total/.test(t) && !/this month/.test(t)) period = 'all';
  return { period, metric };
}

const call = (n: number, name: string, args: Record<string, unknown>): ToolCall => ({
  id: `mock_${n}`,
  name,
  args,
});
const result = (calls: ToolCall[], text: string | null = null): ModelResult => ({
  toolCalls: calls,
  text,
  usage: { inputTokens: 0, outputTokens: 0 },
});

export class MockModel implements ChatModel {
  readonly id = 'mock-rules-v1';

  async run(messages: ChatMessage[], tools: ToolDef[]): Promise<ModelResult> {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const toolMsgs = messages.filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool');
    const last = toolMsgs[toolMsgs.length - 1];
    const lastJson = last ? (JSON.parse(last.content) as Record<string, unknown>) : null;
    if (lastJson && typeof lastJson.error === 'string')
      return result([], String(lastJson.error).replace(/ Ask the user.*$/, ''));

    if (tools.some((t) => t.name === 'finance_totals')) {
      const f = parseFinance(user);
      return f
        ? result([call(1, 'finance_totals', f)])
        : result(
            [],
            'I can answer questions about your income, payments, earnings, expenses and monthly totals.',
          );
    }

    const p = parseDay(user);
    const done = (name: string) => toolMsgs.find((m) => m.name === name);
    const n = toolMsgs.length + 1;
    const defaults = done('get_employment_defaults');
    if (!defaults) return result([call(n, 'get_employment_defaults', { date: p.dateWords })]);
    const d = JSON.parse(defaults.content) as { date: string; schoolName: string | null };
    if (!p.blocks.length)
      return result(
        [],
        'Which periods did you cover, and for whom? For example: "covered Mr. Lee during period 2".',
      );
    if (!done('resolve_schedule')) {
      const school = p.schoolName ?? d.schoolName;
      if (!school) return result([], 'Which school were you at?');
      return result([call(n, 'resolve_schedule', { date: d.date, schoolName: school })]);
    }
    if (p.teachers.length && !done('search_teachers'))
      return result([call(n, 'search_teachers', { names: p.teachers })]);
    return result([
      call(n, 'propose_work_day', {
        date: d.date,
        ...(p.employmentType ? { employmentType: p.employmentType } : {}),
        ...(p.schoolName ? { schoolName: p.schoolName } : {}),
        ...(p.role ? { role: p.role } : {}),
        ...(p.dayType ? { dayType: p.dayType } : {}),
        blocks: p.blocks,
      }),
    ]);
  }
}
