import type { ReactNode } from 'react';

export interface BarListItem {
  id: string;
  label: string;
  /** Identity dot (e.g. a category's own color); bars stay one hue. */
  dot?: string;
  /** Override the list's hue for this bar (e.g. a series color). */
  color?: string;
  value: number;
  display: ReactNode;
  sub?: ReactNode;
}

/**
 * Ranked bar list: one hue, bar length = share of the largest value, value
 * right-aligned on one edge. Replaces pie/donut charts (legible, accessible).
 */
export function BarList({
  items,
  color,
  ariaLabel,
  max,
}: {
  items: BarListItem[];
  color: string;
  ariaLabel: string;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul aria-label={ariaLabel} className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.id} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              {i.dot && (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: i.dot }}
                />
              )}
              <span className="min-w-0 truncate" title={i.label}>
                {i.label}
              </span>
            </span>
            <span className="num shrink-0 text-ink">{i.display}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-raised">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${Math.max(1.5, (i.value / top) * 100)}%`, background: i.color ?? color }}
              />
            </div>
            {i.sub && <span className="num w-12 shrink-0 text-right text-[0.75rem] text-faint">{i.sub}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
