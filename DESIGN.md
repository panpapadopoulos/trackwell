# Trackwell design system

Recorded from the built world (impeccable new-work, finish step). Direction: **Date-Due Card** (impeccable concept roll, seed `seed:c9eaa6bc392a6107`; the user chose the roll). App style: taste **true-black-flat** on a **ruled T-frame** shell. Mode: Operate.

## Idea
Every paycheck is a line on a library date-due slip. Expected lines stay blank and dashed; money that actually arrived gets a violet date stamp. The stamp is the one ornament, and it appears only where a payment record exists.

## Color (tokens in `src/index.css`)
| Token | Dark | Light | Job |
|---|---|---|---|
| ground | `#0e0d0c` | `#f4f3f0` | page, sidebar, top bar (one ground) |
| surface | `#181716` | `#ffffff` | panels (elevation by lightness, no shadow) |
| raised | `#23211f` | `#efede9` | selected nav, nested wells, bar tracks |
| rule / rule-strong | `#2a2826` / `#3a3734` | `#e4e1dc` / `#cfcbc4` | 1px rules (printed card ruling), control borders |
| ink / muted / faint | `#ecebe7` / `#b4b1aa` / `#8f8b84` | `#1a1917` / `#56524c` / `#6b675f` | text tiers, all ≥ 4.5:1 |
| stamp | `#a276e4` | `#7444c0` | DATA ONLY: received money, permanent days, the stamp |
| brass | `#b88424` | `#946412` | money out |
| teal | `#14a08a` | `#00866f` | regular days |
| danger / warning | `#f08a7a` / `#e3b553` | `#b3261e` / `#7d5800` | over budget, failures / no payment recorded |
| primary-bg/fg | ink / ground | ink / white | the primary action, by inversion |

Data hues validated with `dataviz/validate_palette.js` (all checks pass; worst CVD pair ΔE 11.8). Color budget ≤ 3%; the accent never touches buttons, tabs, or nav. **Exception, documented:** taste bans violet as an "assistant palette". The violet here is the subject's real material (date-stamp ink), shifted redder than the AI indigo, and confined to data.

## Money states (never color alone)
| Kind | Form |
|---|---|
| Received | solid; a stamp where a payment exists |
| Expected (earned, unpaid) | dashed underline / dashed outline bar |
| Projected (defaults, recurring plans) | dotted underline / dotted outline |
| Spent | true minus sign (−) |
| Net | always signed (+ / −) |

## Type
One family: Public Sans Variable (self-hosted via @fontsource; public-institution workhorse). Tabular figures on every number. Sizes: 12 · 12.5 · 13.5 (body) · 14 (panel title) · 18–20 (h1, semibold) · 22 · 28–32 (lead figure only). Sentence case; no tracked uppercase labels.

## Shape and space
Radius 4 (controls) / 8 (panels). No resting shadows (only menus and tooltips float). 4px base: panel padding 16/20, grid gap 16, phone margin 20, desktop gutter 28. Sidebar 232 (56 collapsed), top bar 64 (56 on phones).

## Components
`MoneyStrip` (one divided container; the lead figure is larger), `PaydaysSlip` (the signature), `WeekStrip`, `Panel`, `Block` (loading skeleton and error boundary per block), `Money`, `Stamp`, `Pill`, `SegmentedControl` (radiogroup), `TimeBars` (Recharts: one axis, square bars with ≤3px top radius, dashed expected, expenses below the axis, table view), `BarList` (ranked bars instead of pies).

## Motion (emil)
Press feedback `scale(.97)` over 160ms; phone nav sheet 240ms on the drawer curve; nothing that happens many times a day animates (nav, period control, theme). Reduced motion keeps opacity and drops travel. The stamp doesn't animate on load; it may animate when a payment newly arrives (Phase 3).

## Logo
**Period Grid** (selected 2026-11-20): a T assembled from five rounded class-period blocks, three across the school day and two down; the top-right block is stamped violet (periods worked become pay). 24-unit grid, 5.75-unit blocks with 0.875-unit gaps, so it stays legible at 16px. On the tile the stamped block takes the opposite theme's violet (`--logo-stamp`) so it keeps contrast. Editable SVG sources: `brand/`. Variants: tile (app icon, sidebar, favicon) and bare. Wordmark: Public Sans semibold, −1.5% tracking. Shown at every size on `/brand`.

## States
Every block has loading (skeleton, `aria-busy`), error (inside the block: "Nothing was changed or saved", plus retry), empty (a sentence that teaches), and real zeros. Amounts are never truncated (long ones step down in size); names truncate with a tooltip.
