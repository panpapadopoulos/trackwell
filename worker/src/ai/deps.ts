import type { AssistantMode } from '../../../src/shared/assistant';
import type { ChatModel } from './model';

/** Assistant wiring, built in index.ts from env (or injected by tests). */
export interface AiDeps {
  model: ChatModel;
  mode: AssistantMode;
  /** Max assistant requests per server day (both endpoints). */
  dailyLimit: number;
}

/** Hard limits, independent of configuration. */
export const AI_LIMITS = {
  /** Model round-trips per request. The happy path needs 4. */
  maxModelCalls: 6,
  /** Tool executions per request. */
  maxToolCalls: 8,
  /** Tool calls honoured from a single model response. */
  maxToolCallsPerTurn: 3,
  /** Output token cap per model call (tool calls are short). */
  maxOutputTokens: 400,
  /** One model call may take this long before the request stops (nothing is saved). */
  modelCallTimeoutMs: 60_000,
  /** Whole request budget across all model calls. */
  requestBudgetMs: 150_000,
  /** Pending drafts expire: confirmation must follow the preview. */
  draftTtlMs: 24 * 60 * 60 * 1000,
} as const;

/**
 * Default model: GLM 4.7 Flash (free-plan model, function calling). It was the only
 * model that parsed the reference sentence correctly in genuine runs (2026-11-20).
 * Granite stays available for MANUAL testing only (`npm run dev:api:ai:granite`);
 * there is deliberately no automatic fallback to another model.
 */
export const DEFAULT_MODEL = '@cf/zai-org/glm-4.7-flash';
export const MANUAL_TEST_MODELS = ['@cf/ibm-granite/granite-4.0-h-micro'] as const;
