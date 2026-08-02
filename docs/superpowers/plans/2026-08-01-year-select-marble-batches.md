# Year-select marble batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `BeadScene`'s endless real-time trickle with a finite, year-scoped batch of marbles sized to a selected country's real annual birth/death totals, add a year `<select>` to switch years, and show two on-globe counters that count up to the real totals as the batch lands.

**Architecture:** A new lazy per-country data layer (`historicalDemographics.ts`) fetches World Bank birth-rate/death-rate/population series and derives real annual totals per year. A new pure mapper (`marbleCount.ts`) turns a real annual total into a marble count on a log scale. `BeadScene`'s spawn effect is rewritten from an endless capacity-with-eviction loop into a finite two-queue drain that spawns a fixed marble count per stream at a constant cadence and reports cumulative progress upward. `App`/`GlobeView` gain year-selection state that remounts `BeadScene` (extending its existing `key` prop) and drive two `NumberFlow` counters positioned over the globe's open space.

**Tech Stack:** React 19, TypeScript, `@react-three/fiber`, `@react-three/rapier`, `@number-flow/react`. No test framework exists in this repo (no vitest/jest, no `test` script) — verification is manual: `tsc -b` for type-safety, `oxlint` for lint, and the Browser pane for visual/behavioral checks, matching every prior change in this file/repo.

## Global Constraints

- No test framework — do not add one. Verify via `npx tsc -b`, `npx oxlint src`, and live browser checks.
- World Bank fetches must reuse `src/lib/worldbank.ts`'s existing retry pattern (`FETCH_RETRIES = 2`, `RETRY_DELAY_MS = 500`) — do not invent a second fetch helper.
- Historical data is lazy per-country (fetched on first selection of that country), not upfront for all countries — per the spec's explicit rationale (most countries never get selected in a session).
- A year is present in a country's result map only if population, birth rate, AND death rate are all non-null for that year — missing years are simply absent, never zero-filled.
- Marble counts: this repo's current live-bead ceiling is `MAX_CAPACITY = 55` (`src/components/BeadScene.tsx`), lowered from an earlier 70 during a later perf pass that predates this feature's spec (which cites the old 70). To stay inside the perf backstop that later work established, each stream (births/deaths) maps into `[5, 25]` marbles (not the spec's literal `[5, 35]`), so the combined max is 50 ≤ 55. This is a deliberate deviation from the spec's literal numbers to honor its own stated intent ("combined max... equal to MAX_BEADS... a full year's batch always finishes landing with nothing evicted") against the capacity value that is actually live today.
- `spawnIntervalMs`/`beadSpawnRate.ts` stays as-is, unused by this feature going forward — do not delete it (self-contained, documented module; spec explicitly keeps it).
- Changing `selectedIso3` OR `selectedYear` must remount `BeadScene` (extend the existing `key={selectedIso3}` to `key={`${selectedIso3}-${selectedYear}`}`) — this is what clears the pile, no new eviction logic needed.

---

### Task 1: Historical demographics data layer

**Files:**
- Create: `src/lib/historicalDemographics.ts`

**Interfaces:**
- Consumes: nothing project-local (fetches World Bank API directly, mirroring `src/lib/worldbank.ts`'s `fetchJson` pattern).
- Produces: `useHistoricalDemographics(iso3: string | null): HistoricalState` where
  ```ts
  export type HistoricalState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; error: Error }
    | { status: 'ready'; years: Map<number, { births: number; deaths: number }> }
  ```
  Consumed by Task 4 (`App.tsx`).

- [ ] **Step 1: Write the module**

Create `src/lib/historicalDemographics.ts`:

```ts
import { useEffect, useState } from 'react'

const WB_BASE = 'https://api.worldbank.org/v2'
const YEAR_RANGE = '2000:2022'

const INDICATORS = {
  birthRatePer1000: 'SP.DYN.CBRT.IN',
  deathRatePer1000: 'SP.DYN.CDRT.IN',
  population: 'SP.POP.TOTL',
} as const

export interface YearTotals {
  births: number
  deaths: number
}

// Same retry rationale as src/lib/worldbank.ts's fetchJson: the World Bank
// API has no SLA and occasionally blips, but a persistent failure should
// still surface as a real error rather than being masked forever.
const FETCH_RETRIES = 2
const RETRY_DELAY_MS = 500

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`World Bank API request failed: ${url}`)
      return (await res.json()) as T
    } catch (err) {
      if (attempt >= FETCH_RETRIES) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

interface WbIndicatorEntry {
  date: string
  value: number | null
}

async function fetchYearSeries(iso3: string, code: string): Promise<Map<number, number>> {
  const [, entries] = await fetchJson<[unknown, WbIndicatorEntry[] | null]>(
    `${WB_BASE}/country/${iso3}/indicator/${code}?format=json&per_page=100&date=${YEAR_RANGE}`,
  )
  const map = new Map<number, number>()
  for (const entry of entries ?? []) {
    if (entry.value !== null) map.set(Number(entry.date), entry.value)
  }
  return map
}

// Keyed by iso3 — each country's series is fetched at most once per page
// load, the first time it's selected.
const cache = new Map<string, Promise<Map<number, YearTotals>>>()

export function loadHistoricalDemographics(iso3: string): Promise<Map<number, YearTotals>> {
  let cached = cache.get(iso3)
  if (!cached) {
    cached = buildYearTotals(iso3).catch((err) => {
      cache.delete(iso3)
      throw err
    })
    cache.set(iso3, cached)
  }
  return cached
}

async function buildYearTotals(iso3: string): Promise<Map<number, YearTotals>> {
  const [birthRate, deathRate, population] = await Promise.all([
    fetchYearSeries(iso3, INDICATORS.birthRatePer1000),
    fetchYearSeries(iso3, INDICATORS.deathRatePer1000),
    fetchYearSeries(iso3, INDICATORS.population),
  ])

  const result = new Map<number, YearTotals>()
  for (const [year, pop] of population) {
    const births = birthRate.get(year)
    const deaths = deathRate.get(year)
    if (births === undefined || deaths === undefined) continue
    result.set(year, {
      births: (births / 1000) * pop,
      deaths: (deaths / 1000) * pop,
    })
  }
  return result
}

export type HistoricalState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; years: Map<number, YearTotals> }

/** Lazy per-country historical totals, fetched the first time `iso3` is
 * non-null (or changes to a new country) and cached across future
 * selections of the same country for the lifetime of the page. */
export function useHistoricalDemographics(iso3: string | null): HistoricalState {
  const [state, setState] = useState<HistoricalState>({ status: 'idle' })

  useEffect(() => {
    if (!iso3) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    loadHistoricalDemographics(iso3).then(
      (years) => {
        if (!cancelled) setState({ status: 'ready', years })
      },
      (error: Error) => {
        if (!cancelled) setState({ status: 'error', error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [iso3])

  return state
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Manual data sanity check**

In the Browser pane, with the dev server running, open the console and run (replace `USA` with any real ISO3):

```js
const { loadHistoricalDemographics } = await import('/src/lib/historicalDemographics.ts')
const years = await loadHistoricalDemographics('USA')
;[...years.entries()].slice(-3)
```

Expected: an array of `[year, { births, deaths }]` pairs for the most recent years with data, both `births` and `deaths` in the tens-of-millions range for a country the size of the US (sanity-check against `SP.DYN.CBRT.IN`/`SP.DYN.CDRT.IN` being per-1000 rates, not raw counts).

- [ ] **Step 4: Commit**

```bash
git add src/lib/historicalDemographics.ts
git commit -m "$(cat <<'EOF'
Add lazy per-country historical demographics data layer

Fetches World Bank birth-rate/death-rate/population series
(2000-2022) per country on first selection, deriving real annual
birth/death totals per year. Cached per iso3 so re-selecting a
country never re-fetches.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Marble count mapping

**Files:**
- Create: `src/lib/marbleCount.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `marbleCountFor(realAnnualTotal: number): number`. Consumed by Task 4 (`App.tsx`, to compute `birthMarbleCount`/`deathMarbleCount` before passing to `BeadScene`).

- [ ] **Step 1: Write the module**

Create `src/lib/marbleCount.ts`:

```ts
// Real annual birth/death totals span many orders of magnitude — a
// micro-state has a few hundred births a year, a large country tens of
// millions. Mapping raw counts 1:1 to marbles would make the small end
// invisible (0-1 marbles) and the large end absurd (millions of marbles).
// Log-scale mapping, same shape as src/lib/beadSpawnRate.ts's rate-to-
// interval curve: each 10x in real total is an equal step in marble count.
//
// [5, 25] per stream (not a literal reading of births+deaths capped at 70
// from the original design spec) — see the Global Constraints note in
// docs/superpowers/plans/2026-08-01-year-select-marble-batches.md: this
// repo's live bead-capacity backstop is MAX_CAPACITY = 55
// (src/components/BeadScene.tsx), set by a later perf pass, so keeping the
// combined max at 50 stays under it with margin.
const MIN_TOTAL = 1
const MAX_TOTAL = 5e7
const MIN_MARBLES = 5
const MAX_MARBLES = 25

const LOG_MIN = Math.log10(MIN_TOTAL)
const LOG_RANGE = Math.log10(MAX_TOTAL) - LOG_MIN

/** Maps a real annual birth or death total to a marble count in
 * [MIN_MARBLES, MAX_MARBLES]. Totals at or below the log floor (including
 * non-finite/non-positive values) still return MIN_MARBLES — a country
 * with a genuinely tiny total still reads as "something happened" rather
 * than showing nothing. */
export function marbleCountFor(realAnnualTotal: number): number {
  if (!Number.isFinite(realAnnualTotal) || realAnnualTotal <= MIN_TOTAL) return MIN_MARBLES
  const clamped = Math.min(MAX_TOTAL, realAnnualTotal)
  const t = (Math.log10(clamped) - LOG_MIN) / LOG_RANGE
  return Math.round(MIN_MARBLES + t * (MAX_MARBLES - MIN_MARBLES))
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Manual sanity check**

In the browser console:

```js
const { marbleCountFor } = await import('/src/lib/marbleCount.ts')
;[marbleCountFor(0), marbleCountFor(500), marbleCountFor(3.7e6), marbleCountFor(5e7), marbleCountFor(1e9)]
```

Expected: `[5, 5-ish, somewhere in the middle, 25, 25]` — monotonically non-decreasing, clamped at both ends.

- [ ] **Step 4: Commit**

```bash
git add src/lib/marbleCount.ts
git commit -m "$(cat <<'EOF'
Add log-scale marble count mapping for year batches

Maps a real annual birth/death total to a marble count in [5, 25]
per stream, log-scaled so both tiny and huge countries read as a
legible pile. Combined max of 50 stays under BeadScene's current
55-live-bead capacity backstop.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: BeadScene finite batch-drain rewrite

**Files:**
- Modify: `src/components/BeadScene.tsx`

**Interfaces:**
- Consumes: `marbleCountFor` is NOT called inside `BeadScene` — `birthMarbleCount`/`deathMarbleCount` are computed by the caller (Task 4) and passed as props, keeping `BeadScene` itself agnostic to how counts are derived.
- Produces: new `BeadSceneProps` shape:
  ```ts
  interface BeadSceneProps {
    demographics: CountryDemographics // kept only for birth/death color resolution if needed elsewhere; no longer drives spawn rate
    birthMarbleCount: number
    deathMarbleCount: number
    birthAnnualTotal: number
    deathAnnualTotal: number
    onProgress: (progress: { births: number; deaths: number }) => void
    theme: 'light' | 'dark'
    globeCircle: GlobeCircle | null
    globeElement: HTMLCanvasElement | null
  }
  ```
  `onProgress` is consumed by Task 4 (`App.tsx`) to drive the two `NumberFlow` counters.

This task removes the eviction/burst machinery entirely (capacity-based endless spawning no longer applies — every batch is finite and BeadScene remounts via `key` for a fresh batch) and replaces it with a fixed-cadence two-queue drain.

- [ ] **Step 1: Remove capacity/eviction/burst constants and the `dying` field**

In `src/components/BeadScene.tsx`, delete these (no longer used once spawning is finite and remount-driven):
- `MIN_CAPACITY`, `MAX_CAPACITY`, `BEAD_DIAMETER`, `CAPACITY_PACKING_FACTOR`, `computeBeadCapacity` (lines ~28-64) — but see Step 1a, `computeBeadCapacity` is also exported and used by `useViewportSize`'s caller; check `grep -rn computeBeadCapacity src` first and remove all call sites together.
- `BURST_SPAWN_INTERVAL_MS` (line ~73)
- `BEAD_EXIT_MS` and `BeadFadeOut` component (the whole "Drives the shrink-out of an evicted bead" block) — dying beads no longer exist once eviction is gone.
- `dying: boolean` field on the `Bead` interface, and the `bead.dying && <BeadFadeOut .../>` line in `BeadBody`.

Before deleting, run:

```bash
grep -rn "computeBeadCapacity\|MAX_CAPACITY\|MIN_CAPACITY\|BeadFadeOut\|BEAD_EXIT_MS\|\.dying" src
```

Confirm every hit is inside `BeadScene.tsx` (nothing else imports these) before removing.

- [ ] **Step 2: Add the fixed spawn cadence constant**

In place of the removed `BURST_SPAWN_INTERVAL_MS`, add:

```ts
// Fixed cadence for the year-batch drain — reuses beadSpawnRate.ts's
// FASTEST_SPAWN_INTERVAL_MS value as a constant rate rather than a rate
// derived from real births/deathsPerSecond, since this feature shows "this
// year's totals landing," not "right now" — see
// docs/superpowers/specs/2026-08-01-year-select-marble-batches-design.md.
const BATCH_SPAWN_INTERVAL_MS = 120
```

- [ ] **Step 3: Update `BeadSceneProps` and drop the old rate-based intervals**

Replace the `BeadSceneProps` interface (currently ~`848-859`) with:

```ts
interface BeadSceneProps {
  demographics: CountryDemographics
  birthMarbleCount: number
  deathMarbleCount: number
  birthAnnualTotal: number
  deathAnnualTotal: number
  onProgress: (progress: { births: number; deaths: number }) => void
  theme: 'light' | 'dark'
  globeCircle: GlobeCircle | null
  globeElement: HTMLCanvasElement | null
}
```

Update the `BeadScene` function signature to destructure the new props:

```ts
export function BeadScene({
  demographics,
  birthMarbleCount,
  deathMarbleCount,
  birthAnnualTotal,
  deathAnnualTotal,
  onProgress,
  theme,
  globeCircle,
  globeElement,
}: BeadSceneProps) {
```

Remove the now-unused `birthIntervalMs`/`deathIntervalMs` `useMemo`s and their `spawnIntervalMs` import (`import { spawnIntervalMs } from '@/lib/beadSpawnRate'`) — `beadSpawnRate.ts` itself stays in the repo unused, per the Global Constraints note.

- [ ] **Step 4: Remove the `useViewportSize` hook and its call site**

It existed solely to compute `computeBeadCapacity`. Delete the `useViewportSize` function and the `const { width: viewportWidth, height: viewportHeight } = useViewportSize()` / `const capacity = useMemo(...)` lines inside `BeadScene`.

- [ ] **Step 5: Replace the spawn effect with the two-queue drain**

Replace the entire spawn `useEffect` (previously the burst+eviction effect, now missing `capacity`/burst references after Steps 1-4) with:

```ts
useEffect(() => {
  function spawn(kind: 'birth' | 'death') {
    setBeads((prev) => [
      ...prev,
      {
        id: nextIdRef.current++,
        kind,
        x: (Math.random() - 0.5) * 2 * SPAWN_JITTER_PX,
        variant: Math.floor(Math.random() * MARBLE_VARIANTS),
      },
    ])
  }

  let birthsSpawned = 0
  let deathsSpawned = 0
  let birthTimer: number | null = null
  let deathTimer: number | null = null

  function reportProgress() {
    onProgress({
      births: birthMarbleCount > 0 ? (birthsSpawned / birthMarbleCount) * birthAnnualTotal : 0,
      deaths: deathMarbleCount > 0 ? (deathsSpawned / deathMarbleCount) * deathAnnualTotal : 0,
    })
  }

  if (birthMarbleCount > 0) {
    birthTimer = window.setInterval(() => {
      spawn('birth')
      birthsSpawned += 1
      reportProgress()
      if (birthsSpawned >= birthMarbleCount && birthTimer !== null) {
        window.clearInterval(birthTimer)
        birthTimer = null
      }
    }, BATCH_SPAWN_INTERVAL_MS)
  }

  if (deathMarbleCount > 0) {
    deathTimer = window.setInterval(() => {
      spawn('death')
      deathsSpawned += 1
      reportProgress()
      if (deathsSpawned >= deathMarbleCount && deathTimer !== null) {
        window.clearInterval(deathTimer)
        deathTimer = null
      }
    }, BATCH_SPAWN_INTERVAL_MS)
  }

  // Both counters start at 0 immediately (a batch of 0 for either stream —
  // e.g. missing death-rate data for the year — should still report 0
  // rather than leaving the previous batch's last value on screen).
  reportProgress()

  return () => {
    if (birthTimer) window.clearInterval(birthTimer)
    if (deathTimer) window.clearInterval(deathTimer)
  }
}, [birthMarbleCount, deathMarbleCount, birthAnnualTotal, deathAnnualTotal, onProgress])
```

Note: `demographics` is no longer read inside this effect. Confirm the `demographics` prop is still used elsewhere in the file (bead colors are keyed by `kind`, not by `demographics`, per the existing `useBeadMaterials`/`colors` code — if `demographics` ends up completely unused after this task, remove it from `BeadSceneProps` and its destructure instead of leaving a dead prop; check with `grep -n "demographics" src/components/BeadScene.tsx` after this step).

- [ ] **Step 6: Remove the `dying` reference in `BeadBody`'s render**

`BeadBody` (the `memo()`'d component rendering each `<RigidBody>`) currently renders `{bead.dying && <BeadFadeOut .../>}` — delete that line entirely (the whole `BeadFadeOut` component was removed in Step 1). `BeadBody`'s `onExpire` prop and `expireBead` callback also become unused once nothing ever sets `dying` — remove `expireBead`, the `onExpire` prop from `BeadBody`, and the `onExpire={expireBead}` call site in the `beads.map(...)` render. Confirm with `grep -n "onExpire\|expireBead" src/components/BeadScene.tsx` returning nothing.

- [ ] **Step 7: Type-check**

Run: `npx tsc -b`
Expected: no errors. Fix any remaining unused-import/unused-variable errors surfaced by the removals above (this project's `tsconfig` has `noUnusedLocals` — see the `cobe-globe.tsx` history in `PROGRESS.md` for precedent).

- [ ] **Step 8: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "$(cat <<'EOF'
Replace endless capacity/eviction spawn with a finite batch drain

BeadScene now takes explicit birthMarbleCount/deathMarbleCount and
spawns exactly that many marbles per stream at a fixed 120ms cadence,
then stops — no more endless real-time trickle, no eviction, no
viewport-computed capacity. Reports cumulative real-total progress
upward via onProgress as each marble lands, for the on-globe
counters. Callers (App.tsx) are responsible for supplying counts and
remounting the scene per year/country via `key`.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(This commit will not build in isolation until Task 4 updates `App.tsx`'s `<BeadScene>` call site — that's expected; Task 4 follows immediately and the two are meant to land together in one working tree state. If `tsc -b` from Step 7 already fails because `App.tsx` still passes old props, that's fine — Task 4's own type-check is the real gate.)

---

### Task 4: Year selection, counters, and wiring (`App.tsx`, `GlobeView.tsx`)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/GlobeView.tsx` (only if the globe container needs a ref/size to position the counters — see Step 4)

**Interfaces:**
- Consumes: `useHistoricalDemographics` (Task 1), `marbleCountFor` (Task 2), `BeadSceneProps` (Task 3).
- Produces: nothing new for later tasks — this is the final integration task.

- [ ] **Step 1: Add year-selection state to `App`**

In `src/App.tsx`, alongside the existing `selectedIso3` state (~line 281), add:

```ts
const historical = useHistoricalDemographics(selectedIso3)
const [selectedYear, setSelectedYear] = useState<number | null>(null)
const [progress, setProgress] = useState({ births: 0, deaths: 0 })
```

Import at the top of the file:

```ts
import { useHistoricalDemographics } from '@/lib/historicalDemographics'
import { marbleCountFor } from '@/lib/marbleCount'
```

- [ ] **Step 2: Default the year to the latest available once historical data loads**

Add an effect right after the state declarations from Step 1:

```ts
useEffect(() => {
  if (historical.status !== 'ready') return
  const latestYear = Math.max(...historical.years.keys())
  setSelectedYear((prev) => (prev !== null && historical.years.has(prev) ? prev : latestYear))
}, [historical])
```

This also handles switching countries: `historical` changes identity when `selectedIso3` changes (new fetch), so this effect re-runs and resets to that country's latest year unless the previously selected year happens to also exist in the new country's map (rare coincidence, harmless either way).

Also reset `selectedYear` to `null` when no country is selected, so a stale year number doesn't leak into the next selection before the effect above re-fires:

```ts
useEffect(() => {
  if (!selectedIso3) setSelectedYear(null)
}, [selectedIso3])
```

- [ ] **Step 3: Compute marble counts and annual totals for the selected year**

After the `const selected = ...` line (~line 346), add:

```ts
const yearTotals =
  historical.status === 'ready' && selectedYear !== null
    ? historical.years.get(selectedYear)
    : undefined
const birthAnnualTotal = yearTotals?.births ?? 0
const deathAnnualTotal = yearTotals?.deaths ?? 0
const birthMarbleCount = yearTotals ? marbleCountFor(yearTotals.births) : 0
const deathMarbleCount = yearTotals ? marbleCountFor(yearTotals.deaths) : 0
```

Add a stable `onProgress` callback (needed for `BeadScene`'s effect dependency array from Task 3 to stay stable across re-renders):

```ts
const handleProgress = useCallback((p: { births: number; deaths: number }) => setProgress(p), [])
```

Reset `progress` to `{ births: 0, deaths: 0 }` whenever a fresh batch starts (new `selectedIso3`/`selectedYear`), mirroring `BeadScene`'s own remount:

```ts
useEffect(() => {
  setProgress({ births: 0, deaths: 0 })
}, [selectedIso3, selectedYear])
```

- [ ] **Step 4: Update the `<BeadScene>` call site**

Replace (~lines 365-373):

```tsx
{selected && (
  <BeadScene
    key={selectedIso3}
    demographics={selected}
    theme={theme}
    globeCircle={globeCircle}
    globeElement={globeElement}
  />
)}
```

With:

```tsx
{selected && yearTotals && (
  <BeadScene
    key={`${selectedIso3}-${selectedYear}`}
    demographics={selected}
    birthMarbleCount={birthMarbleCount}
    deathMarbleCount={deathMarbleCount}
    birthAnnualTotal={birthAnnualTotal}
    deathAnnualTotal={deathAnnualTotal}
    onProgress={handleProgress}
    theme={theme}
    globeCircle={globeCircle}
    globeElement={globeElement}
  />
)}
```

Gating on `yearTotals` (not just `selected`) means the marble pile only appears once a year's real data has actually loaded — matching the spec's "a batch drops immediately on selection, matching current instant feedback" once `useHistoricalDemographics` resolves, rather than flashing an empty/zero-count scene during the loading gap.

- [ ] **Step 5: Add the year `<select>` to the top-left panel**

Replace the existing selected-country readout block (~lines 389-394):

```tsx
{selected && (
  <div className="pointer-events-none flex items-center gap-1.5 font-mono text-sm font-medium text-foreground">
    <span className="inline-block size-1.5 shrink-0 rounded-full bg-accent" />
    {selected.name}
  </div>
)}
```

With:

```tsx
{selected && (
  <div className="flex flex-col gap-1.5">
    <div className="pointer-events-none flex items-center gap-1.5 font-mono text-sm font-medium text-foreground">
      <span className="inline-block size-1.5 shrink-0 rounded-full bg-accent" />
      {selected.name}
    </div>
    {historical.status === 'ready' && selectedYear !== null && (
      <label className="flex items-center gap-1.5 pl-3 text-[0.65rem] uppercase tracking-widest text-muted-foreground">
        year
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="rounded-sm border border-border bg-transparent px-1 py-0.5 font-mono text-xs text-foreground"
        >
          {[...historical.years.keys()]
            .sort((a, b) => b - a)
            .map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
        </select>
      </label>
    )}
  </div>
)}
```

- [ ] **Step 6: Add the on-globe counters**

Add a new memoized component in `App.tsx`, above the `App` function:

```tsx
// Two large serif readouts over the globe's own open space — upper for
// births, lower for deaths. pointer-events-none so they never intercept
// the globe's own drag/click handling; absolutely positioned against the
// same full-viewport container GlobeView renders into.
const YearCounters = memo(function YearCounters({
  births,
  deaths,
}: {
  births: number
  deaths: number
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-between py-24">
      <div className="flex flex-col items-center gap-1">
        <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          births
        </span>
        <NumberFlow
          value={Math.round(births)}
          className="font-serif text-4xl font-medium text-accent"
        />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          deaths
        </span>
        <NumberFlow
          value={Math.round(deaths)}
          className="font-serif text-4xl font-medium text-foreground"
        />
      </div>
    </div>
  )
})
```

Render it in `App`'s returned JSX, immediately after the `<BeadScene>` block from Step 4:

```tsx
{selected && yearTotals && <YearCounters births={progress.births} deaths={progress.deaths} />}
```

`z-[5]` sits above the globe (`z-0`/unlayered) and the beads canvas (`z-0`, but later in paint order) yet below the `z-10`/`z-20` interactive panels, matching the existing z-index scheme documented in `BeadScene.tsx`'s own canvas comment.

- [ ] **Step 7: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 8: Lint**

Run: `npx oxlint src`
Expected: no new warnings beyond the pre-existing unrelated `button.tsx` fast-refresh warning noted throughout `PROGRESS.md`.

- [ ] **Step 9: Manual browser verification**

Start the dev server and open the preview:

```
preview_start({ name: "hourglass-earth-dev" })
navigate({ url: "http://localhost:<port>" })
```

- Click a city marker to select a country. Confirm: the top-left panel shows the country name and a year `<select>` populated with descending years; a finite batch of marbles drops and settles (does not keep spawning forever); the births/deaths counters count up smoothly and land exactly on the values shown by evaluating `historical.years.get(selectedYear)` in the console for that country/year.
- Change the year via the `<select>`. Confirm: the existing pile clears (fresh mount) and a new batch drops sized to the new year's totals; counters reset to 0 and count back up.
- Select a different country entirely. Confirm: year resets to that country's latest available year, batch and counters behave the same way.
- `read_console_messages({ onlyErrors: true })` — expect no errors.
- Screenshot the loaded state for a visual check (`computer({action: "screenshot"})`).

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
Add year-select marble batches and on-globe birth/death counters

Selecting a country now defaults to its latest available year and
drops a finite batch of marbles sized to that year's real World
Bank birth/death totals, instead of an endless real-time trickle. A
year <select> in the top-left panel lets the user pick a different
year, which clears the pile and drops a fresh batch (via BeadScene's
extended key={iso3-year}). Two on-globe NumberFlow counters count up
to the real annual totals as the batch lands.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage**: data layer (Task 1) ✓, marble scaling (Task 2, with a disclosed numeric deviation from the spec's literal `[5,35]`) ✓, selection flow / year `<select>` / remount-on-key-change (Task 4, Steps 1-5) ✓, BeadScene batch-drain + progress reporting (Task 3) ✓, on-globe counters (Task 4, Step 6) ✓, out-of-scope items (no change to `spawnIntervalMs`, no change to click hit-testing, no backfill beyond 2000-2022) all honored — nothing in Tasks 1-4 touches those.
- **Placeholder scan**: every step has complete, pasteable code; no "TBD"/"handle appropriately" language.
- **Type consistency**: `HistoricalState` (Task 1) → consumed by `App.tsx` via `historical.status`/`historical.years` (Task 4) — names match. `marbleCountFor` (Task 2) → called in Task 4 exactly as declared. `BeadSceneProps` (Task 3) → `<BeadScene>` call site in Task 4 passes exactly those prop names/types.
