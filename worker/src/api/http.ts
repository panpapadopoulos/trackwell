/** Shared HTTP helpers for the v1 API modules. */
import type { z } from 'zod';
import { fieldErrors } from '../../../src/shared/api';
import type { D1Like, D1Stmt } from '../db';
import type { AiDeps } from '../ai/deps';

export interface ApiCtx {
  db: D1Like;
  now: () => number;
  newId: () => string;
  /** Assistant wiring (model, limits). Absent ⇒ assistant routes answer 503. */
  ai?: AiDeps;
}

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });
export const notFound = () => json(404, { error: 'not_found', message: 'That record no longer exists.' });
export const conflict = (message: string) => json(409, { error: 'conflict', message });

export async function body<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T> | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { error: 'bad_request', message: 'The request body must be JSON.' });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return json(422, {
      error: 'invalid',
      message: 'Some fields need attention.',
      fields: fieldErrors(parsed.error),
    });
  return parsed.data;
}

export const nn = <T>(v: T | undefined) => (v === undefined ? null : v);

export function audit(ctx: ApiCtx, entity: string, id: string, action: string, after: unknown): D1Stmt {
  return ctx.db
    .prepare(
      'INSERT INTO audit_log (at, actor, entity, entity_id, action, after_json) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(ctx.now(), 'user', entity, id, action, after === null ? null : JSON.stringify(after));
}

export type Handler = (ctx: ApiCtx, req: Request, params: string[]) => Promise<Response>;
export type Route = [method: string, pattern: RegExp, handler: Handler];
/** Returns a `route(method, '/path/:id', handler)` registrar that appends to `list`. */
export const defineRoute =
  (list: Route[]) =>
  (method: string, pattern: string, h: Handler): void => {
    list.push([method, new RegExp(`^/api/v1${pattern.replace(/:id/g, '([^/]+)')}$`), h]);
  };
