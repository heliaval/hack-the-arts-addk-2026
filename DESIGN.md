# Design

<!-- impeccable:design-schema 1 -->

## Direction

"Tide gauge / harbor flow-station" — population data read like a civic
measuring instrument taking a reading, not a dashboard card. Chosen via
`impeccable` new-work (seed `909ae7cd`, grounded direction 3 of 7), approved
by the user with the constraint: green + orange, 2-3 colors max, light and
dark mode.

Explicitly refused: the literal ornate antique hourglass (brass/sepia
curio-shop look), and near-black-with-one-neon-accent (the AI-slop pattern
named directly in the calibration guidance — both runner-up directions,
oscilloscope-signal-bench and bioluminescent-night-sea, fell into this rut
and lost to the assigned direction on that basis).

## Color Strategy

Committed: one structural marine-green plus one warm amber-orange accent
("the active reading" — used for the growth signal, the hourglass sand/glow,
and interactive accents), on a warm cream ground in light mode / ink-black
ground in dark mode. Not pure neutrals — both grounds carry a slight green
undertone to stay in the instrument-plate world rather than reading as
generic gray UI.

Tokens live in `src/index.css` as OKLCH custom properties, wired through
shadcn's `--color-*` theme layer. `--radius` was tightened from shadcn's
default `0.625rem` to `0.3rem` — sharper, more rectilinear, closer to a
riveted instrument plate than a soft app-shell card.

## Typography

- `Geist Variable` (already in use) for body/UI — a workhorse geometric
  sans, no change needed here.
- `Geist Mono Variable` (newly added, `@fontsource-variable/geist-mono`) for
  numeric/data readouts (country names in the reading panel, and future
  population/growth-rate figures) — functionally justified by the
  instrument-readout metaphor, not decorative, and stays in the same type
  family as the existing body face.

## Components Touched

- `src/index.css` — full token replacement (light + dark), tightened
  radius, direction contract recorded as the file's opening comment.
- `src/lib/useTheme.ts` (new) — light/dark toggle, `localStorage` +
  `prefers-color-scheme` initial value.
- `src/App.tsx` — theme toggle button (top-right), restyled the
  selected-country panel to use theme tokens instead of hardcoded
  white/red text; labeled it "reading" per the instrument metaphor.

## Known Exceptions / Deferred

- `src/components/GlobeView.tsx`'s `growthColor()` choropleth gradient
  (red→green, raw RGB) was **not** re-themed in this pass — it's tied to
  `react-globe.gl`, which is being swapped for `cobe` next (data-mapping
  decision still open with the user). Re-theme it in the amber/green
  palette when that swap happens, not before, to avoid throwaway work.
- No visual QA screenshot was possible this session — the browser preview
  pane didn't composite frames (same limitation noted in `PROGRESS.md` for
  the previous session). Verified instead via: production build succeeds,
  `oxlint` clean on project source, `impeccable`'s slop detector clean on
  changed files, and computed-style checks confirming both light and dark
  token sets resolve correctly in a live page. **A human should do a quick
  visual pass before recording the demo video.**

## Detector

`node .claude/skills/impeccable/scripts/detect.mjs --json` run on
`src/index.css` and `src/App.tsx`: one finding (side-tab accent border on
the reading panel), fixed by dropping the colored left border in favor of a
small accent dot next to the "reading" label. Clean on re-run.
