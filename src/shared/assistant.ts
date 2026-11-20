/** Assistant response contract (browser ⇄ Worker). Money comes only from the pay engine or SQL. */
import type { WorkDayInput } from './api';

export type AssistantMode = 'mock' | 'workers-ai';

export interface TraceStep {
  step: number;
  /** model = the model chose this tool call; server = deterministic server step (validation, pay, save). */
  by: 'model' | 'server';
  tool: string;
  args?: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface AssistantMeta {
  mode: AssistantMode;
  model: string;
  promptVersion: string;
  modelCalls: number;
  toolCalls: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface DraftResponse {
  kind: 'draft';
  draftId: string;
  draft: WorkDayInput;
  schedule: { id: string; name: string; status: string } | null;
  pay: { netCents: number; grossCents: number; basis: string; rulesVersion: string };
  assumptions: string[];
  warnings: string[];
  trace: TraceStep[];
  meta: AssistantMeta;
}

export interface ClarifyResponse {
  kind: 'clarify';
  message: string;
  trace: TraceStep[];
  meta: AssistantMeta;
}

export interface AnswerResponse {
  kind: 'answer';
  answer: string;
  figures: { label: string; cents: number; kind: 'received' | 'expected' | 'spent' | 'net' }[];
  range: { from: string; to: string; label: string };
  trace: TraceStep[];
  meta: AssistantMeta;
}

export interface ConfirmResponse {
  workDayId: string;
  verified: boolean;
  checks: { label: string; ok: boolean }[];
}

export interface AssistantStatus {
  mode: AssistantMode;
  model: string;
  promptVersions: Record<string, string>;
  today: {
    requests: number;
    modelCalls: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
  };
  dailyLimit: number;
}
