/** Unit tests for the model adapter, env gating, prompts and the mock parser. No network. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aiFromEnv, type Env } from '../index';
import { DEFAULT_MODEL } from './deps';
import { parseDay, parseFinance } from './mock';
import { normalizeModelOutput, WorkersAIModel, type AiBinding } from './model';
import { ASSIGNMENT_PROMPT } from './prompts/assignment-entry.v1';
import { FINANCE_PROMPT } from './prompts/finance-qa.v1';
import { ASSIGNMENT_TOOLS, FINANCE_TOOLS } from './tools';

describe('normalizeModelOutput (Workers AI response shapes)', () => {
  it('reads the native shape with object arguments', () => {
    const r = normalizeModelOutput({
      response: null,
      tool_calls: [{ name: 'resolve_schedule', arguments: { date: '2026-11-18' } }],
      usage: { prompt_tokens: 812, completion_tokens: 31 },
    });
    expect(r).toEqual({
      toolCalls: [{ id: 'call_1', name: 'resolve_schedule', args: { date: '2026-11-18' } }],
      text: null,
      usage: { inputTokens: 812, outputTokens: 31 },
    });
  });

  it('reads the OpenAI-compatible shape with string arguments', () => {
    const r = normalizeModelOutput({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'abc',
                type: 'function',
                function: { name: 'search_teachers', arguments: '{"names":["Mr. Smith"]}' },
              },
            ],
          },
        },
      ],
    });
    expect(r.toolCalls).toEqual([{ id: 'abc', name: 'search_teachers', args: { names: ['Mr. Smith'] } }]);
  });

  it('unwraps double-encoded and empty string arguments (seen in a genuine granite run)', () => {
    const r = normalizeModelOutput({
      tool_calls: [
        { name: 'a', arguments: JSON.stringify(JSON.stringify({ date: 'today' })) },
        { name: 'b', arguments: '' },
      ],
    });
    expect(r.toolCalls.map((c) => c.args)).toEqual([{ date: 'today' }, {}]);
  });

  it('keeps unparseable arguments as untrusted data and drops nameless calls', () => {
    const r = normalizeModelOutput({ tool_calls: [{ name: 'x', arguments: '{oops' }, { arguments: {} }, 7] });
    expect(r.toolCalls).toEqual([{ id: 'call_1', name: 'x', args: { __unparseable: '{oops' } }]);
  });

  it('treats anything else as no tool call and no text', () => {
    expect(normalizeModelOutput('nonsense')).toEqual({
      toolCalls: [],
      text: null,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(normalizeModelOutput({ response: '  Which school?  ' }).text).toBe('Which school?');
  });
});

describe('WorkersAIModel', () => {
  it('sends messages, function tools, a token cap and temperature 0 to the binding', async () => {
    const seen: { model: string; input: Record<string, unknown> }[] = [];
    const binding: AiBinding = {
      run: async (model, input) => {
        seen.push({ model, input });
        return { response: 'ok' };
      },
    };
    const m = new WorkersAIModel(binding, DEFAULT_MODEL);
    await m.run([{ role: 'user', content: 'hi' }], ASSIGNMENT_TOOLS.slice(0, 1), 400);
    expect(seen[0]!.model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(seen[0]!.input).toMatchObject({
      max_tokens: 400,
      temperature: 0,
      tools: [{ type: 'function', function: { name: 'get_employment_defaults' } }],
    });
  });
});

describe('aiFromEnv: genuine inference only when explicitly configured', () => {
  const binding: AiBinding = { run: async () => ({}) };
  const env = (v: Partial<Env>) =>
    ({ DB: {} as Env['DB'], ADMIN_PASSWORD_HASH: 'x', ALLOWED_ORIGIN: 'x', ...v }) as Env;
  it('genuine mode defaults to GLM with no fallback model', () => {
    const ai = aiFromEnv(env({ AI: binding, AI_MODE: 'workers-ai' }))!;
    expect(ai.model.id).toBe('@cf/zai-org/glm-4.7-flash');
    expect(ai.model).toBeInstanceOf(WorkersAIModel);
  });
  it('defaults to mock, even when a binding exists', () => {
    expect(aiFromEnv(env({ AI: binding }))!.mode).toBe('mock');
  });
  it('uses Workers AI only with the binding AND AI_MODE=workers-ai', () => {
    // Production safety: no binding (or a typo in the mode) never silently becomes the mock.
    expect(aiFromEnv(env({ AI_MODE: 'workers-ai' }))).toBeUndefined();
    expect(aiFromEnv(env({ AI: binding, AI_MODE: 'workers_ai' }))).toBeUndefined();
    const ai = aiFromEnv(env({ AI: binding, AI_MODE: 'workers-ai', AI_MODEL: '@cf/zai-org/glm-4.7-flash' }))!;
    expect(ai.mode).toBe('workers-ai');
    expect(ai.model.id).toBe('@cf/zai-org/glm-4.7-flash');
  });
  it('can be switched off, and clamps the daily limit', () => {
    expect(aiFromEnv(env({ AI_MODE: 'off' }))).toBeUndefined();
    expect(aiFromEnv(env({ AI_DAILY_LIMIT: '100000' }))!.dailyLimit).toBe(500);
    expect(aiFromEnv(env({ AI_DAILY_LIMIT: 'abc' }))!.dailyLimit).toBe(40);
  });
});

describe('versioned prompts implement the custom skill', () => {
  const skill = readFileSync(
    resolve(__dirname, '../../../.claude/skills/trackwell-assignment-manager/SKILL.md'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  it('names the skill and carries a semantic version', () => {
    expect(skill).toMatch(new RegExp(`^---\\nname: ${ASSIGNMENT_PROMPT.skill}\\n`));
    expect(ASSIGNMENT_PROMPT.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(FINANCE_PROMPT.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('every tool is named in both the prompt and the skill, in procedure order', () => {
    const names = ASSIGNMENT_TOOLS.map((t) => t.name);
    for (const n of names) {
      expect(ASSIGNMENT_PROMPT.system).toContain(n);
      expect(skill).toContain(`\`${n}\``);
    }
    const order = names.map((n) => ASSIGNMENT_PROMPT.system.indexOf(n));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(FINANCE_PROMPT.system).toContain(FINANCE_TOOLS[0]!.name);
  });
  it('keeps the skill’s non-negotiables in the prompt', () => {
    expect(ASSIGNMENT_PROMPT.system).toMatch(/never state or calculate money/i);
    expect(ASSIGNMENT_PROMPT.system).toMatch(/never invent periods, times, rooms or teachers/i);
    expect(ASSIGNMENT_PROMPT.system).toMatch(/you never save/i);
  });
  it('stays small (token budget: system prompt + tools under ~1,000 tokens)', () => {
    const chars = ASSIGNMENT_PROMPT.system.length + JSON.stringify(ASSIGNMENT_TOOLS).length;
    expect(chars / 4).toBeLessThan(1000);
  });
});

describe('mock parser (labelled stand-in for language understanding)', () => {
  it('parses the assignment example', () => {
    expect(
      parseDay(
        'Today I covered Mr. Smith during periods 1 and 3, had period 5 free, and covered Mrs. Jones during period 7.',
      ),
    ).toEqual({
      dateWords: 'today',
      teachers: ['Mr. Smith', 'Mrs. Jones'],
      blocks: [
        { period: '1', status: 'covered', teacherName: 'Mr. Smith' },
        { period: '3', status: 'covered', teacherName: 'Mr. Smith' },
        { period: '5', status: 'free' },
        { period: '7', status: 'covered', teacherName: 'Mrs. Jones' },
      ],
    });
  });
  it('handles ordinals, explicit type, school and date words', () => {
    const p = parseDay(
      'Yesterday I was a regular sub at Lakeview Demo High School and covered Ms. Ortiz first and second period',
    );
    expect(p).toMatchObject({
      dateWords: 'yesterday',
      employmentType: 'regular',
      schoolName: 'Lakeview Demo High School',
    });
    expect(p.blocks.map((b) => b.period)).toEqual(['first', 'second']);
  });
  it('routes finance questions', () => {
    expect(parseFinance('How much did I spend in October 2026?')).toEqual({
      period: '2026-10',
      metric: 'expenses',
    });
    expect(parseFinance('monthly totals this year')).toEqual({ period: 'this_year', metric: 'monthly' });
    expect(parseFinance('What was my income last month?')).toEqual({
      period: 'last_month',
      metric: 'income',
    });
    expect(parseFinance('tell me a joke')).toBeNull();
  });
});
