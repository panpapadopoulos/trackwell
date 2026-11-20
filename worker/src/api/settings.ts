/**
 * Settings the user edits and the assistant reads on every request
 * (persistent context): weekday employment defaults and assistant preferences.
 */
import { todayISO, type ISODate } from '../../../src/domain/dates';
import { DEFAULT_WEEK, type WeeklyDefaults } from '../../../src/domain/work/defaults';
import { AssistantPrefsInput, EmploymentDefaultsInput } from '../../../src/shared/api';
import type { D1Like } from '../db';
import { audit, body, defineRoute, json, type Route } from './http';

type DefaultRow = {
  weekday: number;
  employment_type: 'permanent' | 'regular';
  school_name: string | null;
  district: string | null;
};

/** Latest row per weekday that is effective on `today`. Falls back to the built-in week. */
export async function loadWeekDefaults(db: D1Like, today: ISODate): Promise<WeeklyDefaults> {
  const { results } = await db
    .prepare(
      `SELECT d.weekday, d.employment_type, d.school_name, d.district FROM weekday_defaults d
       WHERE d.effective_from = (SELECT MAX(x.effective_from) FROM weekday_defaults x
                                 WHERE x.weekday = d.weekday AND x.effective_from <= ?)
       ORDER BY d.weekday`,
    )
    .bind(today)
    .all<DefaultRow>();
  const week: WeeklyDefaults = { ...DEFAULT_WEEK };
  for (const r of results ?? [])
    if (r.weekday >= 1 && r.weekday <= 5)
      week[r.weekday as 1 | 2 | 3 | 4 | 5] = {
        employmentType: r.employment_type,
        schoolName: r.school_name,
        district: r.district,
      };
  return week;
}

export async function loadAssistantPrefs(db: D1Like): Promise<{ usualLunch: 'A' | 'B' | 'C' }> {
  const row = await db
    .prepare('SELECT usual_lunch FROM ai_preferences WHERE id = 1')
    .first<{ usual_lunch: 'A' | 'B' | 'C' | null }>();
  return { usualLunch: row?.usual_lunch ?? 'A' };
}

export const settingsRoutes: Route[] = [];
const route = defineRoute(settingsRoutes);

route('GET', '/settings/employment-defaults', async (ctx) =>
  json(200, await loadWeekDefaults(ctx.db, todayISO(new Date(ctx.now())))),
);

/**
 * Saves all five weekdays effective from today. Earlier rows are kept (history);
 * saving twice on one day replaces that day's rows. Work days already saved are
 * never touched: defaults only pre-fill new entries.
 */
route('PUT', '/settings/employment-defaults', async (ctx, req) => {
  const d = await body(req, EmploymentDefaultsInput);
  if (d instanceof Response) return d;
  const today = todayISO(new Date(ctx.now()));
  const t = ctx.now();
  await ctx.db.batch([
    ...([1, 2, 3, 4, 5] as const).map((wd) =>
      ctx.db
        .prepare(
          `INSERT INTO weekday_defaults (weekday, effective_from, employment_type, school_name, district, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (weekday, effective_from) DO UPDATE SET employment_type = excluded.employment_type,
             school_name = excluded.school_name, district = excluded.district, updated_at = excluded.updated_at`,
        )
        .bind(wd, today, d[wd].employmentType, d[wd].schoolName, d[wd].district, t),
    ),
    audit(ctx, 'settings', 'employment_defaults', 'update', d),
  ]);
  return json(200, { effectiveFrom: today, defaults: await loadWeekDefaults(ctx.db, today) });
});

route('PUT', '/settings/assistant', async (ctx, req) => {
  const d = await body(req, AssistantPrefsInput);
  if (d instanceof Response) return d;
  const t = ctx.now();
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO ai_preferences (id, enabled, sharing_level, updated_at, usual_lunch) VALUES (1, 1, 'aggregates', ?, ?)
         ON CONFLICT (id) DO UPDATE SET usual_lunch = excluded.usual_lunch, updated_at = excluded.updated_at`,
      )
      .bind(t, d.usualLunch),
    audit(ctx, 'settings', 'assistant', 'update', d),
  ]);
  return json(200, d);
});
