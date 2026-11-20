import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '@/domain/money';

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  /** solid = actual; dashed = expected (outline only); line form carries state, not hue. */
  form: 'solid' | 'dashed';
  stackId?: string;
  /** Drawn below the axis (money out). Values are passed positive; the chart negates them. */
  below?: boolean;
}

export interface TimeBarsProps {
  data: Array<Record<string, number | string>>;
  /** Field holding the short x label. */
  xKey: string;
  /** Field holding the full label for tooltips/tables. */
  fullKey?: string;
  series: SeriesDef[];
  unit: 'cents' | 'count';
  height?: number;
  /** A horizontal reference (e.g. monthly budget), in the same unit. */
  reference?: { value: number; label: string };
  ariaLabel: string;
}

function fmt(unit: TimeBarsProps['unit'], v: number, axis = false): string {
  if (unit === 'count') return String(v);
  return formatMoney(v, { whole: true, compact: axis && Math.abs(v) >= 1_000_000 });
}

/**
 * Bars over time. One axis, horizontal recessive gridlines only, square bars
 * (3px top radius at most), no gradients, a text-token tooltip.
 */
export function TimeBars({
  data,
  xKey,
  fullKey,
  series,
  unit,
  height = 240,
  reference,
  ariaLabel,
}: TimeBarsProps) {
  const rows = data.map((d) => {
    const r: Record<string, number | string> = { ...d };
    for (const s of series) if (s.below) r[s.key] = -Number(d[s.key] ?? 0);
    return r;
  });
  const scale = outlierScale(rows, series, xKey, fullKey);
  return (
    <div className="w-full">
      <div role="img" aria-label={ariaLabel} className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 6, right: 4, bottom: 0, left: 4 }}
            barCategoryGap="22%"
            barGap={2}
          >
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis
              dataKey={xKey}
              tickLine={false}
              axisLine={{ stroke: 'var(--rule-strong)' }}
              tick={{ fill: 'var(--faint)', fontSize: 11.5 }}
              interval="preserveStartEnd"
              minTickGap={14}
            />
            <YAxis
              width={unit === 'cents' ? 64 : 32}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--faint)', fontSize: 11.5 }}
              tickFormatter={(v: number) => fmt(unit, v, true)}
              allowDecimals={false}
              tickCount={5}
              {...(scale ? { domain: scale.domain, allowDataOverflow: true } : {})}
            />
            {series.some((s) => s.below) && <ReferenceLine y={0} stroke="var(--rule-strong)" />}
            {reference && (
              <ReferenceLine
                y={reference.value}
                stroke="var(--muted)"
                strokeDasharray="4 3"
                label={{
                  value: reference.label,
                  position: 'insideTopRight',
                  fill: 'var(--muted)',
                  fontSize: 11.5,
                }}
              />
            )}
            <Tooltip
              cursor={{ fill: 'var(--raised)', opacity: 0.6 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]!.payload as Record<string, number | string>;
                return (
                  <div className="rounded-ctl border border-rule-strong bg-surface px-3 py-2 text-[0.78125rem] shadow-[0_6px_20px_rgba(0,0,0,0.25)]">
                    <div className="mb-1 font-semibold text-ink">{String(row[fullKey ?? xKey])}</div>
                    {series.map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-6 text-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="inline-block h-2 w-3 rounded-[2px]"
                            style={
                              s.form === 'solid'
                                ? { background: s.color }
                                : { border: `1.5px dashed ${s.color}` }
                            }
                          />
                          {s.label}
                        </span>
                        <span className="num text-ink">{fmt(unit, Math.abs(Number(row[s.key] ?? 0)))}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                {...(s.stackId ? { stackId: s.stackId } : {})}
                fill={s.form === 'solid' ? s.color : 'transparent'}
                stroke={s.form === 'dashed' ? s.color : 'none'}
                strokeWidth={s.form === 'dashed' ? 1.5 : 0}
                strokeDasharray={s.form === 'dashed' ? '3 2' : undefined}
                radius={s.below ? [0, 0, 3, 3] : [3, 3, 0, 0]}
                isAnimationActive={false}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {scale && (
        <p className="mt-2 text-[0.75rem] text-faint">
          Scale capped so the other bars stay readable. Off the scale:{' '}
          {scale.outliers.map((o) => `${o.label} (${fmt(unit, Math.abs(o.value))})`).join(', ')}. The Table
          view shows exact values.
        </p>
      )}
    </div>
  );
}

/**
 * break-ui / Phase 3 fix: one extreme value (e.g. a $123M typo or a lump-sum
 * payment) flattens every other bar. When the largest bar is more than 4× the
 * next-largest typical value, cap the axis just above the rest and name the
 * outliers in words. Nothing is hidden: the table keeps every exact value.
 */
export function outlierScale(
  rows: Array<Record<string, number | string>>,
  series: SeriesDef[],
  xKey: string,
  fullKey?: string,
): { domain: [number, number]; outliers: Array<{ label: string; value: number }> } | null {
  const pos: Array<{ label: string; value: number }> = [];
  const neg: Array<{ label: string; value: number }> = [];
  for (const r of rows) {
    // stacked series add up; unstacked are compared individually
    const stacks = new Map<string, number>();
    for (const s of series) {
      const v = Number(r[s.key] ?? 0);
      const k = s.stackId ?? s.key;
      stacks.set(k, (stacks.get(k) ?? 0) + v);
    }
    for (const v of stacks.values()) {
      const label = String(r[fullKey ?? xKey]);
      if (v > 0) pos.push({ label, value: v });
      if (v < 0) neg.push({ label, value: v });
    }
  }
  const cap = (xs: Array<{ label: string; value: number }>, sign: 1 | -1) => {
    const sorted = [...xs].sort((a, b) => sign * (b.value - a.value));
    if (sorted.length < 3) return null;
    const typical = Math.abs(
      sorted[Math.min(sorted.length - 1, Math.max(1, Math.floor(sorted.length * 0.1)))]!.value,
    );
    const out = sorted.filter((x) => Math.abs(x.value) > typical * 4);
    if (!out.length || typical === 0) return null;
    return { limit: sign * typical * 1.3, out };
  };
  const p = cap(pos, 1);
  const n = cap(neg, -1);
  if (!p && !n) return null;
  const minV = n ? n.limit : Math.min(0, ...neg.map((x) => x.value));
  const maxV = p ? p.limit : Math.max(0, ...pos.map((x) => x.value));
  return { domain: [Math.floor(minV), Math.ceil(maxV)], outliers: [...(p?.out ?? []), ...(n?.out ?? [])] };
}

export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Array<Record<string, string>>;
}) {
  return (
    <div className="max-h-[300px] overflow-auto">
      <table className="w-full border-collapse text-[0.8125rem]">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`border-b border-rule pb-1.5 font-medium text-faint ${c.numeric ? 'text-right' : 'text-left'}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-rule last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={`py-1.5 ${c.numeric ? 'num text-right' : 'text-muted'}`}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
