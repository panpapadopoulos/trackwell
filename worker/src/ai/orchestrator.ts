/**
 * The agent loop. The model chooses tool calls; the server validates and runs
 * them; results go back to the model until a draft exists or limits are hit.
 * Every step is recorded in the trace the user sees. Nothing here writes a work
 * day: a successful run ends with a PENDING row in ai_drafts.
 */
import { formatMonthKey } from '../../../src/domain/dates';
import { formatMoney } from '../../../src/domain/money';
import type {
  AnswerResponse,
  AssistantMeta,
  ClarifyResponse,
  DraftResponse,
  TraceStep,
} from '../../../src/shared/assistant';
import type { ApiCtx } from '../api/http';
import { AI_LIMITS, type AiDeps } from './deps';
import { assistantToolMessage, type ChatMessage, type ToolCall } from './model';
import { ASSIGNMENT_PROMPT } from './prompts/assignment-entry.v1';
import { FINANCE_PROMPT } from './prompts/finance-qa.v1';
import {
  ASSIGNMENT_TOOLS,
  FINANCE_TOOLS,
  financeTotals,
  getEmploymentDefaults,
  proposeWorkDay,
  resolveScheduleTool,
  searchTeachers,
  type FinanceResult,
  type ProposedDraft,
  type ToolContext,
  type ToolOutcome,
} from './tools';

/** Keys the trace may show. Free text the user typed stays out of logs. */
const safeArgs = (args: unknown): Record<string, unknown> | undefined => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>).slice(0, 12))
    out[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  return out;
};

/** The model didn't answer in time. Nothing was saved; retrying is safe. */
export class ModelTimeout extends Error {
  constructor() {
    super('model_timeout');
  }
}

class Run {
  trace: TraceStep[] = [];
  modelCalls = 0;
  toolCalls = 0;
  usage = { inputTokens: 0, outputTokens: 0 };
  constructor(
    readonly ai: AiDeps,
    readonly promptVersion: string,
  ) {}
  add(s: Omit<TraceStep, 'step'>) {
    this.trace.push({ step: this.trace.length + 1, ...s });
  }
  meta(): AssistantMeta {
    return {
      mode: this.ai.mode,
      model: this.ai.model.id,
      promptVersion: this.promptVersion,
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
      usage: this.usage,
    };
  }
  readonly started = Date.now();
  async call(messages: ChatMessage[], tools: typeof ASSIGNMENT_TOOLS) {
    const left = AI_LIMITS.requestBudgetMs - (Date.now() - this.started);
    if (left <= 0) throw new ModelTimeout();
    this.modelCalls++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      this.ai.model.run(messages, tools, AI_LIMITS.maxOutputTokens),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ModelTimeout()), Math.min(left, AI_LIMITS.modelCallTimeoutMs));
      }),
    ]).finally(() => clearTimeout(timer));
    this.usage.inputTokens += r.usage.inputTokens;
    this.usage.outputTokens += r.usage.outputTokens;
    return r;
  }
}

/** Atomically counts a request against the daily cap. False ⇒ cap reached. */
export async function claimDailyRequest(ctx: ApiCtx, day: string, limit: number): Promise<boolean> {
  const r = await ctx.db
    .prepare(
      `INSERT INTO ai_usage (day, requests) VALUES (?, 1)
       ON CONFLICT (day) DO UPDATE SET requests = requests + 1 WHERE requests < ?`,
    )
    .bind(day, limit)
    .run();
  return r.meta.changes > 0;
}

export async function recordUsage(ctx: ApiCtx, day: string, run: Run) {
  await ctx.db
    .prepare(
      `UPDATE ai_usage SET model_calls = model_calls + ?, tool_calls = tool_calls + ?,
         input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE day = ?`,
    )
    .bind(run.modelCalls, run.toolCalls, run.usage.inputTokens, run.usage.outputTokens, day)
    .run();
}

/* ------------------------------ Smart Assignment Entry ------------------------------ */

export async function runAssignment(
  ctx: ApiCtx & { ai: AiDeps },
  tctx: ToolContext,
  message: string,
): Promise<{ response: DraftResponse | ClarifyResponse; run: Run }> {
  const run = new Run(ctx.ai, `${ASSIGNMENT_PROMPT.id}@${ASSIGNMENT_PROMPT.version}`);
  const messages: ChatMessage[] = [
    { role: 'system', content: ASSIGNMENT_PROMPT.system },
    { role: 'user', content: message },
  ];
  const clarify = (text: string) => ({
    response: { kind: 'clarify', message: text, trace: run.trace, meta: run.meta() } as ClarifyResponse,
    run,
  });

  while (run.modelCalls < AI_LIMITS.maxModelCalls) {
    const r = await run.call(messages, ASSIGNMENT_TOOLS);
    if (!r.toolCalls.length) {
      run.add({
        by: 'model',
        tool: 'reply',
        ok: true,
        summary: 'Asked a question instead of calling a tool',
      });
      return clarify(sanitizeReply(r.text));
    }
    const calls = r.toolCalls.slice(0, AI_LIMITS.maxToolCallsPerTurn);
    messages.push(assistantToolMessage(calls));
    for (const tc of calls) {
      if (run.toolCalls >= AI_LIMITS.maxToolCalls) {
        run.add({
          by: 'server',
          tool: 'limit',
          ok: false,
          summary: `Stopped at the ${AI_LIMITS.maxToolCalls}-tool-call limit`,
        });
        return clarify(
          'That took too many steps. Try describing the day in one sentence with the periods and teachers.',
        );
      }
      run.toolCalls++;
      const { outcome, draft } = await execAssignmentTool(tctx, tc);
      run.add({
        by: 'model',
        tool: tc.name,
        args: safeArgs(tc.args),
        ok: outcome.ok,
        summary: outcome.summary,
      });
      if (draft) {
        for (const s of draft.serverSteps) run.add({ by: 'server', ...s });
        const draftId = await storeDraft(ctx, draft, run);
        run.add({
          by: 'server',
          tool: 'store_draft',
          ok: true,
          summary: `Pending draft stored; nothing saved to work days`,
        });
        await ctx.db
          .prepare('UPDATE ai_drafts SET trace_json = ? WHERE id = ?')
          .bind(JSON.stringify(run.trace), draftId)
          .run();
        return {
          response: {
            kind: 'draft',
            draftId,
            draft: draft.input,
            schedule: draft.schedule,
            pay: {
              netCents: draft.pay.netCents,
              grossCents: draft.pay.grossCents,
              basis: draft.pay.basis,
              rulesVersion: draft.pay.rulesVersion,
            },
            assumptions: draft.assumptions,
            warnings: draft.warnings,
            trace: run.trace,
            meta: run.meta(),
          },
          run,
        };
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
      });
    }
  }
  run.add({
    by: 'server',
    tool: 'limit',
    ok: false,
    summary: `Stopped at the ${AI_LIMITS.maxModelCalls}-model-call limit`,
  });
  return clarify('I couldn’t finish the draft. Try naming the date, the periods, and who you covered.');
}

async function execAssignmentTool(
  tctx: ToolContext,
  tc: ToolCall,
): Promise<{ outcome: ToolOutcome; draft?: ProposedDraft }> {
  switch (tc.name) {
    case 'get_employment_defaults':
      return { outcome: await getEmploymentDefaults(tctx, tc.args) };
    case 'resolve_schedule':
      return { outcome: await resolveScheduleTool(tctx, tc.args) };
    case 'search_teachers':
      return { outcome: await searchTeachers(tctx, tc.args) };
    case 'propose_work_day':
      return proposeWorkDay(tctx, tc.args);
    default:
      return {
        outcome: {
          ok: false,
          error: `Unknown tool "${tc.name.slice(0, 40)}".`,
          summary: 'Rejected unknown tool',
        },
      };
  }
}

async function storeDraft(ctx: ApiCtx & { ai: AiDeps }, d: ProposedDraft, run: Run): Promise<string> {
  const id = ctx.newId();
  await ctx.db
    .prepare(
      `INSERT INTO ai_drafts (id, kind, payload_json, status, created_at, prompt_version, mode, model)
       VALUES (?, 'work_day', ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      JSON.stringify({
        input: d.input,
        schedule: d.schedule,
        assumptions: d.assumptions,
        warnings: d.warnings,
      }),
      ctx.now(),
      run.promptVersion,
      ctx.ai.mode,
      ctx.ai.model.id,
    )
    .run();
  return id;
}

/** Model text is shown only as a question; anything that looks like an amount is withheld. */
function sanitizeReply(text: string | null): string {
  const t = (text ?? '').trim().slice(0, 400);
  if (!t) return 'Could you describe the day again, with the date, periods and teachers?';
  if (/[$€£]\s?\d|\d+\.\d{2}\b/.test(t))
    return 'Could you describe the day again, with the date, periods and teachers?';
  return t;
}

/* ------------------------------ Financial Q&A ------------------------------ */

export async function runFinance(
  ctx: ApiCtx & { ai: AiDeps },
  today: string,
  question: string,
): Promise<{ response: AnswerResponse | ClarifyResponse; run: Run }> {
  const run = new Run(ctx.ai, `${FINANCE_PROMPT.id}@${FINANCE_PROMPT.version}`);
  // Only the question goes to the model. No records, no amounts.
  const r = await run.call(
    [
      { role: 'system', content: FINANCE_PROMPT.system },
      { role: 'user', content: question },
    ],
    FINANCE_TOOLS,
  );
  const tc = r.toolCalls.find((c) => c.name === 'finance_totals');
  const help =
    'I can answer questions about your income, payments, earnings, expenses and monthly totals, e.g. “How much did I spend last month?”';
  if (!tc) {
    run.add({ by: 'model', tool: 'reply', ok: true, summary: 'No finance tool chosen' });
    return { response: { kind: 'clarify', message: help, trace: run.trace, meta: run.meta() }, run };
  }
  run.toolCalls++;
  const res = await financeTotals(ctx.db, today, tc.args);
  run.add({
    by: 'model',
    tool: 'finance_totals',
    args: safeArgs(tc.args),
    ok: res.ok,
    summary: res.ok ? `Parameterized SQL over ${res.data.range.from} … ${res.data.range.to}` : res.error,
  });
  if (!res.ok)
    return {
      response: { kind: 'clarify', message: `${res.error} ${help}`, trace: run.trace, meta: run.meta() },
      run,
    };
  run.add({
    by: 'server',
    tool: 'compose_answer',
    ok: true,
    summary: 'Answer written from a template; the model writes no numbers',
  });
  return {
    response: { kind: 'answer', ...composeAnswer(res.data), trace: run.trace, meta: run.meta() },
    run,
  };
}

const m = (c: number) => formatMoney(c);

export function composeAnswer(d: FinanceResult): Pick<AnswerResponse, 'answer' | 'figures' | 'range'> {
  const net = d.receivedCents - d.spentCents;
  const label = d.range.label;
  const top = d.topCategories.length
    ? ` Biggest categories: ${d.topCategories.map((c) => `${c.name} ${m(c.cents)}`).join(', ')}.`
    : '';
  let answer: string;
  let figures: AnswerResponse['figures'];
  switch (d.metric) {
    case 'income':
      answer = `You received ${m(d.receivedCents)} in ${d.paymentCount} payment${d.paymentCount === 1 ? '' : 's'} in ${label}.`;
      figures = [{ label: 'Received', cents: d.receivedCents, kind: 'received' }];
      break;
    case 'earnings':
      answer = `Your ${d.workedDays} worked day${d.workedDays === 1 ? '' : 's'} in ${label} earn ${m(d.earnedCents)} by the pay rules (expected pay, not money received). Payments received in the same dates: ${m(d.receivedCents)}.`;
      figures = [
        { label: 'Expected from work', cents: d.earnedCents, kind: 'expected' },
        { label: 'Received', cents: d.receivedCents, kind: 'received' },
      ];
      break;
    case 'expenses':
      answer = `You spent ${m(d.spentCents)} across ${d.expenseCount} expense${d.expenseCount === 1 ? '' : 's'} in ${label}.${top}`;
      figures = [
        { label: 'Spent', cents: d.spentCents, kind: 'spent' },
        ...d.topCategories.map((c) => ({ label: c.name, cents: c.cents, kind: 'spent' as const })),
      ];
      break;
    case 'monthly':
      answer = d.months.length
        ? `Month by month in ${label}: ${d.months.map((x) => `${formatMonthKey(x.month)} received ${m(x.receivedCents)}, spent ${m(x.spentCents)}`).join('; ')}.`
        : `No payments or expenses in ${label}.`;
      figures = d.months.flatMap((x) => [
        { label: `${formatMonthKey(x.month)} received`, cents: x.receivedCents, kind: 'received' as const },
        { label: `${formatMonthKey(x.month)} spent`, cents: x.spentCents, kind: 'spent' as const },
      ]);
      break;
    case 'net':
      answer = `Net cash flow in ${label} is ${m(net)}: received ${m(d.receivedCents)} minus spent ${m(d.spentCents)} (not a bank balance).`;
      figures = [
        { label: 'Received', cents: d.receivedCents, kind: 'received' },
        { label: 'Spent', cents: d.spentCents, kind: 'spent' },
        { label: 'Net cash flow', cents: net, kind: 'net' },
      ];
      break;
    default:
      answer = `In ${label}: received ${m(d.receivedCents)}, spent ${m(d.spentCents)}, so net cash flow is ${m(net)} (received minus spent; not a bank balance). Work done in those dates is worth ${m(d.earnedCents)} by the pay rules.`;
      figures = [
        { label: 'Received', cents: d.receivedCents, kind: 'received' },
        { label: 'Spent', cents: d.spentCents, kind: 'spent' },
        { label: 'Net cash flow', cents: net, kind: 'net' },
        { label: 'Expected from work', cents: d.earnedCents, kind: 'expected' },
      ];
  }
  return { answer, figures, range: d.range };
}

export type { Run };
