/**
 * Cloudflare Worker entry. /api/* is handled here (auth boundary + data API);
 * everything else is the SPA, served from static assets with security headers.
 */
import { handle } from './app';
import { CSP } from './csp';
import { D1AttemptStore, D1SessionStore } from './stores';
import type { D1Like } from './db';
import { DEFAULT_MODEL, type AiDeps } from './ai/deps';
import { MockModel } from './ai/mock';
import { WorkersAIModel, type AiBinding } from './ai/model';

export interface Env {
  DB: D1Like;
  ADMIN_PASSWORD_HASH: string;
  ALLOWED_ORIGIN: string;
  ASSETS?: { fetch(req: Request): Promise<Response> };
  /** Workers AI binding. Present only when [ai] is enabled in wrangler.toml. */
  AI?: AiBinding;
  /** 'mock' (default) | 'workers-ai' | 'off'. Genuine inference needs BOTH the binding and 'workers-ai'. */
  AI_MODE?: string;
  AI_MODEL?: string;
  AI_DAILY_LIMIT?: string;
}

/** Never silently upgrades to paid inference: the real model runs only when explicitly configured. */
export function aiFromEnv(env: Env): AiDeps | undefined {
  const mode = env.AI_MODE ?? 'mock';
  const limit = Math.min(Math.max(Number(env.AI_DAILY_LIMIT) || 40, 1), 500);
  if (mode === 'workers-ai') {
    // Never degrade to the mock: a missing binding means "assistant unavailable" (503).
    if (!env.AI) {
      console.error('assistant_misconfigured: AI_MODE=workers-ai but no AI binding');
      return undefined;
    }
    return {
      mode: 'workers-ai',
      model: new WorkersAIModel(env.AI, env.AI_MODEL || DEFAULT_MODEL),
      dailyLimit: limit,
    };
  }
  if (mode === 'mock') return { mode: 'mock', model: new MockModel(), dailyLimit: limit };
  return undefined; // 'off' or an unknown value: assistant unavailable, never a silent mock
}

const withAi = (ai: AiDeps | undefined) => (ai ? { ai } : {});

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const https = env.ALLOWED_ORIGIN?.startsWith('https://') ?? false;
    // Production: plain HTTP never serves content (done here, not zone-wide).
    if (https && url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    const res = await route(req, url, env);
    if (!https) return res;
    const headers = new Headers(res.headers);
    headers.set('Strict-Transport-Security', 'max-age=31536000');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
};

async function route(req: Request, url: URL, env: Env): Promise<Response> {
  {
    if (url.pathname.startsWith('/api/')) {
      if (!env.ADMIN_PASSWORD_HASH)
        return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      return handle(req, {
        db: env.DB,
        sessions: new D1SessionStore(env.DB),
        attempts: new D1AttemptStore(env.DB),
        adminPasswordHash: env.ADMIN_PASSWORD_HASH,
        allowedOrigin: env.ALLOWED_ORIGIN,
        now: () => Date.now(),
        ...withAi(aiFromEnv(env)),
      });
    }
    if (!env.ASSETS) return new Response('Not found', { status: 404 });
    const res = await env.ASSETS.fetch(req);
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return new Response(res.body, { status: res.status, headers });
  }
}
