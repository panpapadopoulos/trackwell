---
name: trackwell-assignment-manager
description: Turn a natural-language description of a substitute-teaching work day ("covered Mr. Johnson 1st, free 2nd, Mrs. Smith 3rd and 4th at Munster") into a validated Trackwell work-day draft with period-level coverage and a deterministic pay preview, then save it only after explicit user confirmation. Use when the user wants to log, record, or correct a work day, assignment, or coverage in Trackwell.
---

# Trackwell assignment manager

You turn what the user says about a work day into a **draft** Trackwell work day, show it for review, and save it **only after the user confirms**. You never calculate pay yourself and never invent schedule times.

## Inputs you rely on (all in this repo)
| Need | Source |
|---|---|
| Today's date (user's time zone, America/Chicago) | `todayISO()` in `src/domain/dates.ts` |
| Default employment type and school for a weekday | `defaultsFor()` in `src/domain/work/defaults.ts` |
| Bell schedule for a school and date | `resolveSchedule()` in `src/domain/schedule/resolve.ts` (registry: `src/domain/schedule/registry.ts`) |
| Pay preview | `expectedPay()` in `src/domain/pay/engine.ts`, the only source of money figures |
| Known teachers and rooms | Teacher history from saved days (`GET /api/v1/snapshot`: coverage blocks and single-day teachers); the editor's autocomplete uses the same history |
| Save | `POST /api/v1/work-days` (schema `WorkDayInput` in `src/shared/api.ts`); `PUT /api/v1/work-days/:id` with `updatedAt` for edits |

## Procedure
1. **Resolve the date.** Convert "today", "yesterday", "last Wednesday" with `todayISO()` and civil-date arithmetic. If two dates are plausible, ask one question.
2. **Employment type and school.** Start from `defaultsFor(date)`. An explicit statement from the user overrides it ("I was regular at Birchwood today"). Defaults never mean the day was worked; the user's message does.
3. **Role and day type.** Default teacher, full day. Change only on explicit words ("as an assistant", "half day", "until 11:30").
4. **Schedule.** Call `resolveSchedule(school, date)`.
   - `verified` or `synthetic`: map "1st", "first period", "P3" to period ids from the schedule. Respect the chosen lunch variant for split periods.
   - MHS 2026–27 is `verified` (official image, tested). For a `pending-reference` schedule (a future year not yet transcribed), keep the named periods as labels with **no times**.
   - None: use free-form blocks with user-given times only.
5. **Coverage blocks.** For each period: `covered` (teacher, room, subject when given), `free`, `planning`, or `other`. "3rd and 4th" means two blocks with the same teacher. Unmentioned periods stay absent (an incomplete schedule is allowed), never invented.
6. **Format.** One teacher for the whole day: `single`. Several periods or teachers: `multiple`. Format is independent of employment type.
7. **Validate** (stop and ask on any failure):
   - date is valid and not in the future, unless the user says it's a plan;
   - at most one worked permanent day on that date (check existing days);
   - no two blocks on the same period; times are HH:MM with end after start;
   - names ≤ 120 chars, rooms ≤ 40, notes ≤ 1000.
8. **Pay preview.** Call `expectedPay()` on the WORK DAY (never per block). Show net and gross from its result and say: "Covering several teachers doesn't change daily pay."
9. **Review.** Present the draft in the output format below and ask: *Save this work day?* Offer edits.
10. **Save only on an explicit yes** ("yes", "save", "confirm"): `POST /api/v1/work-days` with the CSRF token. The server re-validates, computes pay itself, and audits the write. A 409 means a permanent day already exists on that date: offer to edit it instead. Anything else ("looks right?", silence) is not consent.

## In-app execution (Phase 4)
The Trackwell Assistant runs this procedure server-side as a tool-calling agent (`worker/src/ai/orchestrator.ts`) with the versioned prompt `worker/src/ai/prompts/assignment-entry.v1.ts`. Model tool calls map to the steps:

| Step | Tool | Who decides |
|---|---|---|
| 1–2 date, employment default | `get_employment_defaults` | server (`resolveDateWords`, saved `weekday_defaults`) |
| 4 schedule | `resolve_schedule` | server (`resolveSchedule`, `classRows`, saved lunch preference) |
| teacher history | `search_teachers` | server (parameterized `LIKE`, history only) |
| 5–8 blocks, format, validation, pay | `propose_work_day` | the model parses the words; the server maps periods, validates with `WorkDayInput`, computes `expectedPay()`, stores a **pending** `ai_drafts` row |
| 9 review | Assistant page preview (editable in the work-day editor) | user |
| 10 save | `POST /api/v1/assistant/drafts/:id/confirm` | user click only: atomic claim, `createWorkDay`, read-back verification |

Limits: 6 model calls, 8 tool calls (3 per turn), 500-character messages, a daily request cap. Mock mode (`AI_MODE=mock`) replaces only the language understanding with rules; everything else is identical.

## Output format (draft, before saving)
```json
{
  "kind": "work_day_draft",
  "date": "2026-11-18",
  "status": "worked",
  "employmentType": "permanent",
  "role": "teacher",
  "format": "multiple",
  "schoolName": "Munster High School",
  "district": "Munster",
  "dayType": 1,
  "scheduleId": "mhs-2026-27-a-block",
  "scheduleStatus": "verified",
  "coverage": [
    { "label": "Period 1", "status": "covered", "teacherName": "Mr. Johnson" },
    { "label": "Period 2", "status": "free" },
    { "label": "Period 3", "status": "covered", "teacherName": "Mrs. Smith" },
    { "label": "Period 4", "status": "covered", "teacherName": "Mrs. Smith" }
  ],
  "payPreview": { "netCents": 11427, "grossCents": 13000, "basis": "permanent-flat", "source": "expectedPay()" },
  "assumptions": ["Permanent at Munster High School from the Wednesday default"],
  "questions": [],
  "requiresConfirmation": true
}
```
Then one short human summary: date, type, school, each period, pay preview, and the confirmation question.

## Constraints
- Never state a money amount that didn't come from `expectedPay()`.
- Never fill in schedule times, teachers, rooms, or subjects the user didn't give or the data doesn't contain.
- Never mark a day as worked from defaults alone.
- Never save without explicit confirmation; never delete without a separate confirmation.
- Prefer one clarifying question over a guess when the date, employment type, or a period is ambiguous.
- Real records are private: don't echo other days' financial details unless the user asks.

## Error handling
| Situation | Response |
|---|---|
| Date ambiguous | One question with the two candidate dates |
| Duplicate worked permanent day | Show the existing day; offer to edit it instead |
| Period not in the schedule | Ask which period was meant; list the valid ones |
| Schedule pending | Proceed with labels, no times; note it in `assumptions` |
| Save API fails | Say nothing was saved; keep the draft; offer retry |
