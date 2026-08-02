# Year-select marble batches + on-globe birth/death counters

## Problem

Selecting a country currently drives `BeadScene` off `birthsPerSecond`/
`deathsPerSecond` forever, in an endless real-time trickle capped at 70 live
beads (oldest evicted as new ones spawn). There's no way to look at a
specific year's numbers, and no on-screen readout of what a marble is
actually worth.

## Goal

Clicking a city pill selects its country and its most recent available
year, drops a finite batch of marbles sized to that year's real birth/death
totals, and shows two large serif numbers over the globe's open space that
count up to the real annual figures as the batch lands. A year `<select>`
in the existing top-left reading panel lets the user pick a different year,
which clears the pile and drops a fresh batch.

## Data layer: `src/lib/historicalDemographics.ts` (new)

- Per-country, lazy-fetched the first time that country is selected (not
  upfront for all ~200 countries — too much data for something most
  countries never need).
- Fetches World Bank `SP.DYN.CBRT.IN` (birth rate/1000), `SP.DYN.CDRT.IN`
  (death rate/1000), and `SP.POP.TOTL` (population) for `date=2000:2022`
  via the per-country indicator endpoint (`/country/{iso3}/indicator/{code}
  ?date=2000:2022`), mirroring `worldbank.ts`'s existing fetch/retry
  pattern.
- Derives `birthsPerYear` / `deathsPerYear` = `(rate / 1000) * population`
  for each year that has all three values present. Countries commonly miss
  the most recent 1–2 years — those years are simply absent from the
  result, not zero-filled.
- Returns (and caches, keyed by iso3) a `Map<number, { births: number;
  deaths: number }>` — year to that year's real annual totals.
- Exposes a loading/error shape consistent with `useDemographics`'s
  existing `{status: 'loading' | 'error' | 'ready', ...}` pattern, as a new
  `useHistoricalDemographics(iso3: string | null)` hook.

## Marble scaling: `src/lib/marbleCount.ts` (new)

- Log-scale mapping (same shape as `beadSpawnRate.ts`'s rate→interval
  curve), applied independently to a year's `birthsPerYear` and
  `deathsPerYear`.
- Each stream maps into `[5, 35]` marbles, clamped at both ends. Combined
  max is `35 + 35 = 70`, deliberately equal to the existing `MAX_BEADS` —
  a full year's batch always finishes landing with nothing evicted
  mid-drop, since eviction only exists for the old endless-trickle mode
  this replaces.
- `marbleCountFor(realAnnualTotal: number): number` — real annual counts
  below the log floor still return the 5-marble minimum (a country with a
  genuinely tiny total still reads as "something happened," matching the
  existing rate mapper's floor behavior).

## Selection flow (`App.tsx`, `GlobeView.tsx`)

- Clicking a city pill selects the country (unchanged) and now also
  triggers `useHistoricalDemographics` for it. Once loaded, the selected
  year defaults to the latest year present in that country's map — so a
  batch drops immediately on selection, matching the current instant
  feedback.
- The top-left reading panel gets a `<select>` under the country name,
  listing that country's available years (2000 through its latest present
  year) in the existing instrument-panel styling (uppercase label, accent
  dot, `font-mono`). Selecting a different year updates `selectedYear`
  state in `App`.
- Changing `selectedIso3` OR `selectedYear` remounts `BeadScene` (extend
  the existing `key={selectedIso3}` to `key={`${selectedIso3}-${selectedYear}`}`),
  which reuses the pile's existing fade-out/unmount path to clear
  everything and start fresh — no new eviction logic needed.

## BeadScene batch-drain (`BeadScene.tsx`)

- Replaces the current continuous per-second spawn loop (driven by
  `spawnIntervalMs(birthsPerSecond)` / `spawnIntervalMs(deathsPerSecond)`,
  which never stops as long as the scene is mounted) with a **finite
  two-queue drain**: given `birthMarbleCount` and `deathMarbleCount` for
  the selected year (from `marbleCountFor`), each queue spawns one marble
  at a fixed, readable cadence (reusing the existing fastest interval,
  120ms, as a constant rate rather than a rate derived from real
  birthsPerSecond/deathsPerSecond — the real-time-rate mapping no longer
  applies once the feature is "show me this year's totals," not "show me
  right now") until its queue is empty, then stops entirely. No further
  spawning happens until a new year/country is selected (new `key`, fresh
  mount).
- `spawnIntervalMs`/`beadSpawnRate.ts` stays as-is (unused by this feature
  going forward but not deleted — it's a documented, self-contained
  module, and removing it isn't required by this change).
- On each spawn, `BeadScene` reports progress upward (`onProgress` prop or
  equivalent) with the cumulative real count so far for that stream
  (`(marblesSpawnedSoFar / totalMarblesInStream) * realAnnualTotal`,
  landing exactly on `realAnnualTotal` when the queue empties) — this
  feeds the on-globe counters below.

## On-globe counters (`App.tsx` or `GlobeView.tsx`)

- Two `NumberFlow` instances (same component already used for the city
  count / rotation speed sliders), styled large and serif (matching the
  existing `AppTitle`'s `font-serif`) — "births" positioned in the globe's
  open upper white space, "deaths" in its lower open white space, both
  absolutely positioned over the globe container, `pointer-events-none`.
- Each starts at 0 when a new year/country batch begins (mount-time reset,
  matching the `BeadScene` remount above) and receives its cumulative
  value from `BeadScene`'s progress reporting, animating up marble-by-
  marble to land exactly on the real annual total.
- Only shown while a country is selected (`selected &&`), same conditional
  as the existing reading panel and `BeadScene`.

## Out of scope

- No change to the existing rate-based `spawnIntervalMs` module or its
  exports (kept for potential future reuse, not deleted).
- No change to which cities/countries are selectable — same click
  hit-testing as today.
- No attempt to backfill years beyond World Bank's 2000–2022 coverage or
  to interpolate missing years.
