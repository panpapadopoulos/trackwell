/**
 * Assistant endpoints. All sit behind the session + CSRF boundary in app.ts.
 * - POST /assistant/assignment   → agent loop → PENDING draft (never a work day)
 * - POST /assistant/drafts/:id/confirm → the ONLY path from a draft to work_days
 * - POST /assistant/drafts/:id/reject
 * - POST /assistant/ask          → finance Q&A (SQL + template)
 * - GET  /assistant/status       → mode, model, today's usage
 */
import { expectedPay } from '../../../src/domain/pay/engine';
import { todayISO } from '../../../src/domain/dates';
import { AssistantRequest, ConfirmDraftInput, WorkDayInput } from '../../../src/shared/api';
import type { AssistantStatus, ConfirmResponse } from '../../../src/shared/assistant';
import { AI_LIMITS, type AiDeps } from '../ai/deps';
import { claimDailyRequest, ModelTimeout, recordUsage, runAssignment, runFinance } from '../ai/orchestrator';
import { ASSIGNMENT_PROMPT } from '../ai/prompts/assignment-entry.v1';
import { FINANCE_PROMPT } from '../ai/prompts/finance-qa.v1';
import { body, defineRoute, json, notFound, type ApiCtx, type Route } from './http';
import { loadAssistantPrefs, loadWeekDefaults } from './settings';
import { createWorkDay } from './v1';

export const assistantRoutes: Route[] = [];
const route = defineRoute(assistantRoutes);

const unavailable = () =>
  json(503, { error: 'assistant_unavailable', message: 'The assistant is not configured on this server.' });
const capReached = (limit: number) =>
  json(429, {
    error: 'assistant_limit',
    message: `The assistant's daily limit (${limit} requests) is reached. It resets tomorrow; you can still log days by hand.`,
  });
const modelFailed = (e: unknown) => {
  if (e instanceof ModelTimeout)
    return json(504, {
      error: 'model_timeout',
      message: 'The model took too long to answer. Nothing was saved; you can try again.',
    });
  console.error('assistant_model_error', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
  return json(502, {
    error: 'model_error',
    message: 'The assistant could not reach its model. Nothing was saved.',
  });
};

const today = (ctx: ApiCtx) => todayISO(new Date(ctx.now()));
const withAi = (ctx: ApiCtx): (ApiCtx & { ai: AiDeps }) | null =>
  ctx.ai ? (ctx as ApiCtx & { ai: AiDeps }) : null;

route('GET', '/assistant/status', async (ctx) => {
  const c = withAi(ctx);
  if (!c) return unavailable();
  const u = await ctx.db
    .prepare(
      'SELECT requests, model_calls, tool_calls, input_tokens, output_tokens FROM ai_usage WHERE day = ?',
    )
    .bind(today(ctx))
    .first<Record<string, number>>();
  const status: AssistantStatus = {
    mode: c.ai.mode,
    model: c.ai.model.id,
    promptVersions: {
      [ASSIGNMENT_PROMPT.id]: ASSIGNMENT_PROMPT.version,
      [FINANCE_PROMPT.id]: FINANCE_PROMPT.version,
    },
    today: {
      requests: u?.requests ?? 0,
      modelCalls: u?.model_calls ?? 0,
      toolCalls: u?.tool_calls ?? 0,
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
    },
    dailyLimit: c.ai.dailyLimit,
  };
  return json(200, status);
});

route('POST', '/assistant/assignment', async (ctx, req) => {
  const c = withAi(ctx);
  if (!c) return unavailable();
  const d = await body(req, AssistantRequest);
  if (d instanceof Response) return d;
  const day = today(ctx);
  if (!(await claimDailyRequest(ctx, day, c.ai.dailyLimit))) return capReached(c.ai.dailyLimit);
  const tctx = {
    db: ctx.db,
    today: day,
    week: await loadWeekDefaults(ctx.db, day),
    usualLunch: (await loadAssistantPrefs(ctx.db)).usualLunch,
    requestText: d.message,
  };
  try {
    const { response, run } = await runAssignment(c, tctx, d.message);
    await recordUsage(ctx, day, run);
    return json(200, response);
  } catch (e) {
    return modelFailed(e);
  }
});

route('POST', '/assistant/ask', async (ctx, req) => {
  const c = withAi(ctx);
  if (!c) return unavailable();
  const d = await body(req, AssistantRequest);
  if (d instanceof Response) return d;
  const day = today(ctx);
  if (!(await claimDailyRequest(ctx, day, c.ai.dailyLimit))) return capReached(c.ai.dailyLimit);
  try {
    const { response, run } = await runFinance(c, day, d.message);
    await recordUsage(ctx, day, run);
    return json(200, response);
  } catch (e) {
    return modelFailed(e);
  }
});

type DraftRow = {
  id: string;
  status: string;
  payload_json: string;
  created_at: number;
  result_id: string | null;
};

route('POST', '/assistant/drafts/:id/confirm', async (ctx, req, [id]) => {
  const d = await body(req, ConfirmDraftInput);
  if (d instanceof Response) return d;
  const row = await ctx.db
    .prepare(
      "SELECT id, status, payload_json, created_at, result_id FROM ai_drafts WHERE id = ? AND kind = 'work_day'",
    )
    .bind(id)
    .first<DraftRow>();
  if (!row) return notFound();
  if (row.status !== 'pending')
    return json(409, {
      error: 'already_resolved',
      message: row.status === 'confirmed' ? 'This draft was already saved.' : 'This draft was discarded.',
      workDayId: row.result_id,
    });
  if (ctx.now() - row.created_at > AI_LIMITS.draftTtlMs)
    return json(410, { error: 'expired', message: 'This draft expired. Ask the assistant again.' });

  // The stored payload is re-validated too: nothing is trusted because it is ours.
  const stored = JSON.parse(row.payload_json) as { input: unknown };
  const parsed = WorkDayInput.safeParse(d.input ?? stored.input);
  if (!parsed.success)
    return json(422, { error: 'invalid', message: 'The draft no longer validates. Edit it and try again.' });
  const input = parsed.data;

  // Claim the draft atomically: a double click or a replay finds 0 rows and stops here.
  const t = ctx.now();
  const claim = await ctx.db
    .prepare("UPDATE ai_drafts SET status = 'confirmed', resolved_at = ? WHERE id = ? AND status = 'pending'")
    .bind(t, id)
    .run();
  if (claim.meta.changes === 0)
    return json(409, { error: 'already_resolved', message: 'This draft was already saved.' });

  const release = () =>
    ctx.db.prepare("UPDATE ai_drafts SET status = 'pending', resolved_at = NULL WHERE id = ?").bind(id).run();
  let res: Response;
  try {
    res = await createWorkDay(ctx, input);
  } catch (e) {
    await release();
    throw e;
  }
  if (res.status !== 201) {
    await release();
    return res;
  }
  const { id: workDayId } = (await res.json()) as { id: string };
  await ctx.db
    .prepare('UPDATE ai_drafts SET result_id = ?, payload_json = ? WHERE id = ?')
    .bind(workDayId, JSON.stringify({ ...stored, confirmedInput: input, edited: Boolean(d.input) }), id)
    .run();

  // Verify by reading back what the database now holds.
  const saved = await ctx.db
    .prepare(
      'SELECT date, status, employment_type, school_name, format, expected_net_cents, deleted_at FROM work_days WHERE id = ?',
    )
    .bind(workDayId)
    .first<Record<string, unknown>>();
  const blocks = await ctx.db
    .prepare('SELECT COUNT(*) AS n FROM coverage_blocks WHERE work_day_id = ?')
    .bind(workDayId)
    .first<{ n: number }>();
  const pay = expectedPay({
    employmentType: input.employmentType,
    role: input.role,
    dayType: input.dayType,
    hours: input.hours,
    ...(input.payRate ? { payRate: input.payRate } : {}),
  });
  const checks: ConfirmResponse['checks'] = [
    { label: 'Work day exists and is live', ok: Boolean(saved) && saved?.deleted_at === null },
    { label: `Date is ${input.date}`, ok: saved?.date === input.date },
    { label: 'Status is worked', ok: saved?.status === 'worked' },
    {
      label: `Employment type is ${input.employmentType}`,
      ok: saved?.employment_type === input.employmentType,
    },
    { label: `School is ${input.schoolName}`, ok: saved?.school_name === input.schoolName },
    {
      label: `${input.coverage.length} coverage block(s) saved`,
      ok: Number(blocks?.n) === input.coverage.length,
    },
    { label: 'Stored pay equals expectedPay()', ok: Number(saved?.expected_net_cents) === pay.netCents },
  ];
  const body201: ConfirmResponse = { workDayId, verified: checks.every((c) => c.ok), checks };
  return json(201, body201);
});

route('POST', '/assistant/drafts/:id/reject', async (ctx, _req, [id]) => {
  const r = await ctx.db
    .prepare("UPDATE ai_drafts SET status = 'rejected', resolved_at = ? WHERE id = ? AND status = 'pending'")
    .bind(ctx.now(), id)
    .run();
  if (r.meta.changes === 0)
    return json(409, { error: 'already_resolved', message: 'This draft is no longer pending.' });
  return json(200, { id, rejected: true });
});
