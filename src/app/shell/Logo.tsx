/**
 * Trackwell mark, "Period Grid": a T assembled from five class-period blocks
 * (three across the school day, two down), one of them stamped violet. Periods
 * worked become pay. 24-unit grid; editable sources live in brand/.
 */
interface MarkProps {
  size?: number;
  /** 'tile': ink tile with knocked-out blocks (app icon, sidebar). 'bare': blocks only, for inline use. */
  variant?: 'tile' | 'bare';
  title?: string;
}

const BLOCKS = [
  { x: 2.5, y: 3.5 },
  { x: 9.125, y: 3.5 },
  { x: 9.125, y: 10.125 },
  { x: 9.125, y: 16.75 },
];
const STAMPED = { x: 15.75, y: 3.5 };

export function TrackwellMark({ size = 24, variant = 'tile', title }: MarkProps) {
  const tile = variant === 'tile';
  const block = tile ? 'var(--ground)' : 'var(--ink)';
  const mark = (
    <>
      {BLOCKS.map((b) => (
        <rect key={`${b.x}-${b.y}`} x={b.x} y={b.y} width="5.75" height="5.75" rx="1.5" fill={block} />
      ))}
      <rect
        x={STAMPED.x}
        y={STAMPED.y}
        width="5.75"
        height="5.75"
        rx="1.5"
        fill={tile ? 'var(--logo-stamp)' : 'var(--stamp)'}
      />
    </>
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {tile ? (
        <>
          <rect width="24" height="24" rx="5.4" fill="var(--ink)" />
          <g transform="translate(3.6 3.6) scale(0.7)">{mark}</g>
        </>
      ) : (
        mark
      )}
    </svg>
  );
}

export function TrackwellWordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <TrackwellMark size={size} />
      <span className="font-semibold tracking-[-0.015em] text-ink" style={{ fontSize: size * 0.68 }}>
        Trackwell
      </span>
    </span>
  );
}
