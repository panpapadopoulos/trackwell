import { TrackwellMark, TrackwellWordmark } from '../shell/Logo';
import { Money, Panel, Stamp } from '../ui/primitives';

const TOKENS: Array<[string, string, string]> = [
  ['Ground', '--ground', 'page'],
  ['Surface', '--surface', 'panels'],
  ['Raised', '--raised', 'nested, selected'],
  ['Ink', '--ink', 'primary text, primary action'],
  ['Muted', '--muted', 'secondary text'],
  ['Faint', '--faint', 'captions (≥ 4.5:1)'],
  ['Stamp', '--stamp', 'received money, permanent days (data only)'],
  ['Brass', '--brass', 'money out'],
  ['Teal', '--teal', 'regular days'],
  ['Danger', '--danger', 'over budget, failures'],
];

export function BrandPage() {
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Mark"
        subtitle="Period Grid: a T built from five class-period blocks, three across the school day and two down. One block is stamped violet: periods worked become pay."
      >
        <div className="flex flex-wrap items-end gap-8">
          {[16, 24, 32, 48, 96].map((s) => (
            <figure key={s} className="flex flex-col items-center gap-2">
              <TrackwellMark size={s} title={`Trackwell mark at ${s} pixels`} />
              <figcaption className="num text-[0.75rem] text-faint">{s}px</figcaption>
            </figure>
          ))}
          <figure className="flex flex-col items-center gap-2">
            <div className="grid size-[96px] place-items-center rounded-[22px] bg-ground ring-1 ring-rule-strong">
              <TrackwellMark size={64} variant="bare" title="Trackwell mark without tile" />
            </div>
            <figcaption className="text-[0.75rem] text-faint">bare, on ground</figcaption>
          </figure>
        </div>
      </Panel>
      <Panel
        title="Wordmark"
        subtitle="Public Sans semibold, −1.5% tracking. Tagline: Work. Earn. Understand."
      >
        <div className="flex flex-col gap-5">
          <TrackwellWordmark size={44} />
          <TrackwellWordmark size={26} />
          <p className="text-[0.9375rem] text-muted">Work. Earn. Understand.</p>
        </div>
      </Panel>
      <Panel title="Money states" subtitle="Each kind of money has its own form, never color alone.">
        <div className="flex flex-wrap items-center gap-8 text-[1.125rem]">
          <span className="flex flex-col gap-1">
            <Money cents={57135} kind="received" />{' '}
            <span className="text-[0.75rem] text-faint">received</span>
          </span>
          <span className="flex flex-col gap-1">
            <Money cents={57135} kind="expected" />{' '}
            <span className="text-[0.75rem] text-faint">expected (dashed)</span>
          </span>
          <span className="flex flex-col gap-1">
            <Money cents={57135} kind="projected" />{' '}
            <span className="text-[0.75rem] text-faint">projected (dotted)</span>
          </span>
          <span className="flex flex-col gap-1">
            <Money cents={18497} kind="spent" /> <span className="text-[0.75rem] text-faint">spent</span>
          </span>
          <Stamp date="2026-11-06" />
        </div>
      </Panel>
      <Panel
        title="Color"
        subtitle="Validated with the dataviz palette checker in both themes. Switch themes to compare."
      >
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {TOKENS.map(([name, v, use]) => (
            <li key={v} className="min-w-0">
              <div className="h-12 rounded-ctl ring-1 ring-rule-strong" style={{ background: `var(${v})` }} />
              <div className="mt-1.5 text-[0.8125rem] text-ink">{name}</div>
              <div className="truncate text-[0.75rem] text-faint" title={use}>
                {use}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Type" subtitle="One family, tabular figures, sentence case.">
        <div className="flex flex-col gap-2">
          <span className="num text-[2rem] font-semibold tracking-[-0.02em]">$18,402.60</span>
          <span className="text-[1.25rem] font-semibold">Page title 20</span>
          <span className="text-[0.875rem] font-semibold">Panel heading 14</span>
          <span className="text-[0.84375rem]">
            Body 13.5: Covering several teachers doesn’t change daily pay.
          </span>
          <span className="text-[0.78125rem] text-faint">Caption 12.5</span>
        </div>
      </Panel>
    </div>
  );
}
