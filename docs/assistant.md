# Trackwell Assistant

Two features, both server-side in the Worker:

1. **Smart Assignment Entry.** A sentence describing a work day becomes an editable draft. It is saved only when you press Save.
2. **Financial Q&A.** Answers questions about income, payments, earnings, expenses and monthly totals, using database queries.

## How a sentence becomes a saved day
```
browser ──POST /assistant/assignment──▶ orchestrator (≤6 model calls, ≤8 tool calls)
   model ─▶ get_employment_defaults ─▶ resolve_schedule ─▶ search_teachers ─▶ propose_work_day
                                    server: validate (WorkDayInput) → compute_pay (expectedPay) → store_draft (ai_drafts: pending)
browser ◀── draft + tool trace + pay preview (nothing saved yet)
user edits (optional) and presses Save
browser ──POST /assistant/drafts/:id/confirm──▶ atomic claim → createWorkDay → read-back checks
```
Files:
- orchestrator: `worker/src/ai/orchestrator.ts`
- tools: `worker/src/ai/tools.ts`
- prompts: `worker/src/ai/prompts/*.v1.ts`
- routes: `worker/src/api/assistant.ts`
- skill: `.claude/skills/trackwell-assignment-manager/SKILL.md`

## Model and cost
| | |
|---|---|
| Model | **`@cf/zai-org/glm-4.7-flash`** (default; function calling, 131k context). Granite is for manual testing only (`npm run dev:api:ai:granite`); there is no automatic fallback |
| Price (checked 2026-11-20) | $0.017 per M input tokens, $0.112 per M output tokens (1,542 / 10,158 Neurons per M) |
| Free allocation | 10,000 Neurons per day per account, shared across models, reset at 00:00 UTC |
| One assignment entry | 4 model calls of about 1.0–1.5k input tokens each, plus about 200 output tokens in total. That is about 6k input and 0.2k output, roughly **11 Neurons** (≈ $0.0001) |
| One finance question | 1 model call, about 0.5k input tokens: about **1 Neuron** |
| Daily cap | `AI_DAILY_LIMIT` = 40 requests, at most about 450 Neurons a day: under 5% of the free allocation |

Alternatives:
- `@cf/zai-org/glm-4.7-flash`: available on the Free plan, function calling.
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`: stronger but about 17× the input price.

To switch, set `AI_MODEL`.

## Modes
| `AI_MODE` | Behaviour |
|---|---|
| `mock` (default in `wrangler.toml`) | A deterministic rule-based parser stands in for the model. No network calls and no cost. The UI shows a "Mock model" label. |
| `workers-ai` + `[ai]` binding | Genuine inference. Only `wrangler.ai-test.toml` sets both. |
| `off` | The assistant routes return 503. |

## Genuine-inference test procedure (manual)
Uses the local Worker and local D1 with **synthetic** data. Workers AI calls go to Cloudflare and count against the free allocation.
1. `npx wrangler login` (interactive, once).
2. `npm run build`. If the local D1 is not seeded yet, run `npm run db:migrate:local && npm run db:seed:synthetic`.
3. `npm run dev:api:ai`. Stop `npm run dev:api` first, since both use port 8787.
4. Run `npm run ai:genuine-test -- --out <your-folder>/<date>-workers-ai-run.json`.
   - It prints the tool trace, token usage, the confirm result, the replayed-confirm 409 and the read-back.
   - If today already has a saved permanent day, add `--no-confirm` or pass a different `--message`.
5. Or use the UI: `npm run dev`, open `/assistant`. The mode note should read "Workers AI · @cf/zai-org/glm-4.7-flash".
6. Check usage in the Cloudflare dashboard: AI → Workers AI.

If the model answers in prose instead of calling tools, the run ends with a clarifying question. It never produces a fabricated draft. Try `AI_MODEL=@cf/zai-org/glm-4.7-flash` (edit `wrangler.ai-test.toml`).

## Genuine results (2026-11-20)
| Model | Runs | Result |
|---|---|---|
| granite-4.0-h-micro | 2 | Both completed with real tool calls, and pay, confirm and read-back were correct. One run **dropped a period** from the sentence; one sent double-encoded arguments (now handled by the adapter). About 10 Neurons per run |
| glm-4.7-flash | 1 | Correct on the first try, with 4 tool calls. About 50 Neurons per run, 17 s |

Recommendation: use `@cf/zai-org/glm-4.7-flash` for accuracy. Run records are kept outside the repository.

## Draft cross-check
`propose_work_day` compares the draft with the user's own words: `crossCheck` in `tools.ts`, which uses the extractor in `src/domain/assistant/extract.ts`. It rejects:
- an omitted period;
- a period the user never mentioned;
- a duplicated period;
- a wrong status;
- a period given to the wrong teacher (compared by surname).

The rejection goes back to the model, which retries. Periods the extractor can't read produce no expectation, so unusual wording is never blocked; the editable preview stays the final safeguard.

## Evaluation set
Five cases cover Traditional, A Block, B Block, free and planning periods, and multiple teachers (`worker/src/ai/eval/cases.ts`).
- Offline: `npm test`, with the mock model.
- Genuine: `npm run dev:api:ai`, then `npm run ai:eval -- --out <file>`. Drafts are discarded, never saved.
- Result on 2026-11-20 with GLM: **5/5**. About 4.3k input and 0.5–0.8k output tokens per case; 11–97 s (Workers AI latency varies).

## Tests
- `worker/src/api/assistant.test.ts` (31 tests): orchestration, confirmation, duplicate prevention, authorization, limits, model-output validation, persistence and finance.
- `worker/src/ai/ai.test.ts`: the Workers AI response shapes, env gating, and prompt-to-skill consistency.
- `src/domain/assistant/parse.test.ts`: date words, periods and ranges.
- `e2e/app.spec.ts`: the browser flow with axe checks.

All of these run against the **mock** model or scripted fake models. None of them is genuine inference.
