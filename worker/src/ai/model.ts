/**
 * Model port. The orchestrator talks to `ChatModel` only, so the same loop runs
 * against Cloudflare Workers AI (genuine inference) or the deterministic mock
 * (local tests, labelled as such everywhere it appears).
 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolCall {
  id: string;
  name: string;
  /** Untrusted: validated with Zod before any use. */
  args: unknown;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string; name: string };

type WireToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export interface ModelResult {
  toolCalls: ToolCall[];
  text: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ChatModel {
  readonly id: string;
  run(messages: ChatMessage[], tools: ToolDef[], maxTokens: number): Promise<ModelResult>;
}

/** The `env.AI` binding surface we use. */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export const assistantToolMessage = (calls: ToolCall[]): ChatMessage => ({
  role: 'assistant',
  content: '',
  tool_calls: calls.map((c) => ({
    id: c.id,
    type: 'function',
    function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
  })),
});

/** Genuine inference through the Workers AI binding. Runs only when configured (AI_MODE=workers-ai). */
export class WorkersAIModel implements ChatModel {
  constructor(
    private readonly binding: AiBinding,
    readonly id: string,
  ) {}

  async run(messages: ChatMessage[], tools: ToolDef[], maxTokens: number): Promise<ModelResult> {
    const raw = await this.binding.run(this.id, {
      messages,
      tools: tools.map((t) => ({ type: 'function', function: t })),
      max_tokens: maxTokens,
      temperature: 0,
    });
    return normalizeModelOutput(raw);
  }
}

const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function parseArgs(a: unknown): unknown {
  if (typeof a !== 'string') return a ?? {};
  if (!a.trim()) return {};
  try {
    const v: unknown = JSON.parse(a);
    // Some models (seen with granite-4.0-h-micro) double-encode: "\"{\\\"date\\\":…}\"".
    return typeof v === 'string' ? parseArgs(v) : v;
  } catch {
    return { __unparseable: a.slice(0, 200) };
  }
}

/**
 * Workers AI returns either the native shape `{ response, tool_calls: [{ name, arguments }] }`
 * or the OpenAI-compatible shape `{ choices: [{ message: { content, tool_calls: [{ id, function }] } }] }`.
 * Both normalise to `ModelResult`; anything else becomes "no tool calls, no text".
 */
export function normalizeModelOutput(raw: unknown): ModelResult {
  const r = asObj(raw) ?? {};
  const msg = asObj(asObj((r.choices as unknown[] | undefined)?.[0])?.message);
  const rawCalls = (msg?.tool_calls ?? r.tool_calls) as unknown;
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(rawCalls))
    rawCalls.forEach((c, i) => {
      const o = asObj(c);
      if (!o) return;
      const fn = asObj(o.function);
      const name = (fn?.name ?? o.name) as unknown;
      if (typeof name !== 'string' || !name) return;
      toolCalls.push({
        id: typeof o.id === 'string' && o.id ? o.id : `call_${i + 1}`,
        name,
        args: parseArgs(fn ? fn.arguments : o.arguments),
      });
    });
  const textRaw = msg?.content ?? r.response;
  const text = typeof textRaw === 'string' && textRaw.trim() ? textRaw.trim() : null;
  const u = asObj(r.usage);
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    toolCalls,
    text,
    usage: { inputTokens: n(u?.prompt_tokens), outputTokens: n(u?.completion_tokens) },
  };
}
