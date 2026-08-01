# Population Shockwave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every city marker on the globe, spawn a brief expanding-ring "shockwave" from that marker's live screen position whenever enough real births or deaths (per the already-live World Bank data) have accumulated for its country — red for births, black for deaths.

**Architecture:** A new `usePopulationPulses` hook (`src/lib/populationPulse.ts`) accumulates real elapsed time × per-city birth/death rate on a `setInterval` (not `requestAnimationFrame` — this must keep advancing in real wall-clock time), emitting `PopulationPulse` events into a state array, self-removing each after its ring animation finishes. `GlobeView.tsx` feeds this hook and passes the resulting pulses down to `Globe` (`cobe-globe.tsx`), which renders one `Pulse` overlay div per active pulse, positioned every animation frame using the same marker-projection math already used for labels.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (CSS keyframe in `src/index.css`). No new dependencies. No test framework exists in this project, so verification is via `npm run build`, `oxlint src`, and manual DOM/browser inspection, consistent with the rest of this project.

## Global Constraints

- Threshold: `PULSE_THRESHOLD = 3` (3 births, or 3 deaths, per shockwave) — shared by both kinds
- Tick interval: 500ms, using real `Date.now()` deltas (not frame-based)
- Ring animation: 1.1s (`PULSE_DURATION_MS = 1100`), CSS-driven (`scale` 0.2 → 1.6, `opacity` 0.9 → 0), `ease-out`
- Colors: births use `var(--accent)` (the app's existing red token); deaths use literal `#000000` (not the theme-adaptive `--foreground` token, which goes near-white in dark mode)
- A city's rate = its country's `birthsPerSecond`/`deathsPerSecond` (from `CountryDemographics`) divided by how many of the 20 `CITIES` entries share that country (a fixed divisor from the full roster, not slider-dependent)
- Only cities currently visible per the city-count slider accumulate; invisible cities hold their accumulator at its current value (no advance, no reset)
- Arc/flight markers never pulse — only city markers
- Missing country data (a city's `country` not in the loaded `demographics` map) → that city's rate is `0`, no error

---

### Task 1: Add `country` field to `CITIES` and the population-pulse data hook

**Files:**
- Modify: `src/components/GlobeView.tsx` (full `CITIES` array replacement, ~lines 33-261)
- Create: `src/lib/populationPulse.ts`

**Interfaces:**
- Produces: `PULSE_THRESHOLD: number`, `PulseCity { id: string; country: string }`, `PopulationPulse { id: string; cityId: string; kind: 'birth' | 'death' }`, `usePopulationPulses(cities: PulseCity[], visibleCityIds: Set<string>, demographics: Map<string, CountryDemographics>): PopulationPulse[]` — all consumed by Task 2

- [ ] **Step 1: Replace the `CITIES` array with one that includes a `country` (ISO3) field per entry**

In `src/components/GlobeView.tsx`, replace the entire `const CITIES = [ ... ]` block (from `const CITIES = [` through its closing `]`, currently around lines 33-261) with:

```tsx
const CITIES = [
  {
    id: 'city-sf',
    location: [37.7595, -122.4367] as [number, number],
    country: 'USA',
    en: 'San Francisco',
    zh: '旧金山',
    ja: 'サンフランシスコ',
    ko: '샌프란시스코',
    fr: 'San Francisco',
    es: 'San Francisco',
    pt: 'San Francisco',
  },
  {
    id: 'city-nyc',
    location: [40.7128, -74.006] as [number, number],
    country: 'USA',
    en: 'New York',
    zh: '纽约',
    ja: 'ニューヨーク',
    ko: '뉴욕',
    fr: 'New York',
    es: 'Nueva York',
    pt: 'Nova York',
  },
  {
    id: 'city-tokyo',
    location: [35.6762, 139.6503] as [number, number],
    country: 'JPN',
    en: 'Tokyo',
    zh: '东京',
    ja: '東京',
    ko: '도쿄',
    fr: 'Tokyo',
    es: 'Tokio',
    pt: 'Tóquio',
  },
  {
    id: 'city-london',
    location: [51.5074, -0.1278] as [number, number],
    country: 'GBR',
    en: 'London',
    zh: '伦敦',
    ja: 'ロンドン',
    ko: '런던',
    fr: 'Londres',
    es: 'Londres',
    pt: 'Londres',
  },
  {
    id: 'city-sydney',
    location: [-33.8688, 151.2093] as [number, number],
    country: 'AUS',
    en: 'Sydney',
    zh: '悉尼',
    ja: 'シドニー',
    ko: '시드니',
    fr: 'Sydney',
    es: 'Sídney',
    pt: 'Sydney',
  },
  {
    id: 'city-capetown',
    location: [-33.9249, 18.4241] as [number, number],
    country: 'ZAF',
    en: 'Cape Town',
    zh: '开普敦',
    ja: 'ケープタウン',
    ko: '케이프타운',
    fr: 'Le Cap',
    es: 'Ciudad del Cabo',
    pt: 'Cidade do Cabo',
  },
  {
    id: 'city-dubai',
    location: [25.2048, 55.2708] as [number, number],
    country: 'ARE',
    en: 'Dubai',
    zh: '迪拜',
    ja: 'ドバイ',
    ko: '두바이',
    fr: 'Dubaï',
    es: 'Dubái',
    pt: 'Dubai',
  },
  {
    id: 'city-paris',
    location: [48.8566, 2.3522] as [number, number],
    country: 'FRA',
    en: 'Paris',
    zh: '巴黎',
    ja: 'パリ',
    ko: '파리',
    fr: 'Paris',
    es: 'París',
    pt: 'Paris',
  },
  {
    id: 'city-saopaulo',
    location: [-23.5505, -46.6333] as [number, number],
    country: 'BRA',
    en: 'São Paulo',
    zh: '圣保罗',
    ja: 'サンパウロ',
    ko: '상파울루',
    fr: 'São Paulo',
    es: 'São Paulo',
    pt: 'São Paulo',
  },
  // Extra cities beyond the original 9-city demo set, added so the city-count
  // slider has room to grow. Appended after the original set rather than
  // interspersed, so the default (min) view is pixel-identical to before.
  {
    id: 'city-moscow',
    location: [55.7558, 37.6173] as [number, number],
    country: 'RUS',
    en: 'Moscow',
    zh: '莫斯科',
    ja: 'モスクワ',
    ko: '모스크바',
    fr: 'Moscou',
    es: 'Moscú',
    pt: 'Moscou',
  },
  {
    id: 'city-beijing',
    location: [39.9042, 116.4074] as [number, number],
    country: 'CHN',
    en: 'Beijing',
    zh: '北京',
    ja: '北京',
    ko: '베이징',
    fr: 'Pékin',
    es: 'Pekín',
    pt: 'Pequim',
  },
  {
    id: 'city-delhi',
    location: [28.6139, 77.209] as [number, number],
    country: 'IND',
    en: 'Delhi',
    zh: '德里',
    ja: 'デリー',
    ko: '델리',
    fr: 'Delhi',
    es: 'Delhi',
    pt: 'Deli',
  },
  {
    id: 'city-cairo',
    location: [30.0444, 31.2357] as [number, number],
    country: 'EGY',
    en: 'Cairo',
    zh: '开罗',
    ja: 'カイロ',
    ko: '카이로',
    fr: 'Le Caire',
    es: 'El Cairo',
    pt: 'Cairo',
  },
  {
    id: 'city-mexicocity',
    location: [19.4326, -99.1332] as [number, number],
    country: 'MEX',
    en: 'Mexico City',
    zh: '墨西哥城',
    ja: 'メキシコシティ',
    ko: '멕시코시티',
    fr: 'Mexico',
    es: 'Ciudad de México',
    pt: 'Cidade do México',
  },
  {
    id: 'city-toronto',
    location: [43.6532, -79.3832] as [number, number],
    country: 'CAN',
    en: 'Toronto',
    zh: '多伦多',
    ja: 'トロント',
    ko: '토론토',
    fr: 'Toronto',
    es: 'Toronto',
    pt: 'Toronto',
  },
  {
    id: 'city-seoul',
    location: [37.5665, 126.978] as [number, number],
    country: 'KOR',
    en: 'Seoul',
    zh: '首尔',
    ja: 'ソウル',
    ko: '서울',
    fr: 'Séoul',
    es: 'Seúl',
    pt: 'Seul',
  },
  {
    id: 'city-mumbai',
    location: [19.076, 72.8777] as [number, number],
    country: 'IND',
    en: 'Mumbai',
    zh: '孟买',
    ja: 'ムンバイ',
    ko: '뭄바이',
    fr: 'Bombay',
    es: 'Bombay',
    pt: 'Mumbai',
  },
  {
    id: 'city-istanbul',
    location: [41.0082, 28.9784] as [number, number],
    country: 'TUR',
    en: 'Istanbul',
    zh: '伊斯坦布尔',
    ja: 'イスタンブール',
    ko: '이스탄불',
    fr: 'Istanbul',
    es: 'Estambul',
    pt: 'Istambul',
  },
  // Lagos and Singapore are deliberately last (indices 18/19) — they're the
  // endpoints of the last two arc routes below, so those routes only
  // appear once their cities have entered the slider's visible slice, and
  // the 4th route only appears at the slider's max.
  {
    id: 'city-lagos',
    location: [6.5244, 3.3792] as [number, number],
    country: 'NGA',
    en: 'Lagos',
    zh: '拉各斯',
    ja: 'ラゴス',
    ko: '라고스',
    fr: 'Lagos',
    es: 'Lagos',
    pt: 'Lagos',
  },
  {
    id: 'city-singapore',
    location: [1.3521, 103.8198] as [number, number],
    country: 'SGP',
    en: 'Singapore',
    zh: '新加坡',
    ja: 'シンガポール',
    ko: '싱가포르',
    fr: 'Singapour',
    es: 'Singapur',
    pt: 'Singapura',
  },
]
```

- [ ] **Step 2: Create `src/lib/populationPulse.ts`**

```ts
import { useEffect, useRef, useState } from 'react'
import type { CountryDemographics } from '@/lib/worldbank'

// Real per-second birth/death rates are all well under 1/s even for the
// most populous countries. A threshold of 3 puts the busiest cities at
// roughly an 8-10s pulse cadence; quiet countries will rarely pulse in a
// short session -- expected, this is literal real-time pacing, not
// artificially sped up.
export const PULSE_THRESHOLD = 3
const TICK_MS = 500
export const PULSE_DURATION_MS = 1100

export interface PulseCity {
  id: string
  country: string
}

export interface PopulationPulse {
  id: string
  cityId: string
  kind: 'birth' | 'death'
}

// Ticks on a plain setInterval rather than requestAnimationFrame (unlike
// most of this app's per-frame work) -- this needs to keep accumulating in
// real wall-clock time regardless of animation-frame availability.
export function usePopulationPulses(
  cities: PulseCity[],
  visibleCityIds: Set<string>,
  demographics: Map<string, CountryDemographics>,
): PopulationPulse[] {
  const [pulses, setPulses] = useState<PopulationPulse[]>([])
  const accumulators = useRef<Map<string, { birth: number; death: number }>>(new Map())
  const nextId = useRef(0)
  const lastTick = useRef(Date.now())

  useEffect(() => {
    const countryCounts = new Map<string, number>()
    for (const c of cities) {
      countryCounts.set(c.country, (countryCounts.get(c.country) ?? 0) + 1)
    }

    lastTick.current = Date.now()
    const interval = window.setInterval(() => {
      const now = Date.now()
      const elapsed = (now - lastTick.current) / 1000
      lastTick.current = now

      const newPulses: PopulationPulse[] = []
      for (const city of cities) {
        if (!visibleCityIds.has(city.id)) continue
        const country = demographics.get(city.country)
        if (!country) continue
        const divisor = countryCounts.get(city.country) ?? 1

        let acc = accumulators.current.get(city.id)
        if (!acc) {
          acc = { birth: 0, death: 0 }
          accumulators.current.set(city.id, acc)
        }

        acc.birth += elapsed * (country.birthsPerSecond / divisor)
        while (acc.birth >= PULSE_THRESHOLD) {
          acc.birth -= PULSE_THRESHOLD
          newPulses.push({ id: `pulse-${nextId.current++}`, cityId: city.id, kind: 'birth' })
        }

        acc.death += elapsed * (country.deathsPerSecond / divisor)
        while (acc.death >= PULSE_THRESHOLD) {
          acc.death -= PULSE_THRESHOLD
          newPulses.push({ id: `pulse-${nextId.current++}`, cityId: city.id, kind: 'death' })
        }
      }

      if (newPulses.length > 0) {
        setPulses((prev) => [...prev, ...newPulses])
        for (const p of newPulses) {
          window.setTimeout(() => {
            setPulses((prev) => prev.filter((x) => x.id !== p.id))
          }, PULSE_DURATION_MS)
        }
      }
    }, TICK_MS)

    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demographics, visibleCityIds])

  return pulses
}
```

- [ ] **Step 3: Build and lint**

Run:
```bash
npm run build
```
Expected: succeeds, no TypeScript errors (confirms every `CITIES` entry now has a valid `country: string` field and `populationPulse.ts` type-checks).

Run:
```bash
npx oxlint src
```
Expected: no new errors (only the pre-existing unrelated `button.tsx` warning).

- [ ] **Step 4: Commit**

```bash
git add src/components/GlobeView.tsx src/lib/populationPulse.ts
git commit -m "$(cat <<'EOF'
Add country field to CITIES + population-pulse accumulation hook

Data layer only -- not wired into any visuals yet. usePopulationPulses
ticks on a real-time setInterval (not rAF) so it keeps accumulating
births/deaths regardless of animation-frame availability.
EOF
)"
```

---

### Task 2: `Pulse` visual component + wiring into `Globe`

**Files:**
- Modify: `src/index.css` (add `@keyframes pulse-ring`)
- Modify: `src/components/ui/cobe-globe.tsx` (add `pulses` prop, `Pulse` component, render + per-frame position update)

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task only adds the rendering plumbing; Task 3 wires real pulse data through)
- Produces: `Globe`'s new `pulses?: { id: string; markerId: string; kind: "birth" | "death" }[]` prop, consumed by Task 3

- [ ] **Step 1: Add the ring keyframe to `src/index.css`**

Add this near the end of the file (after the existing rules, before EOF):

```css
@keyframes pulse-ring {
  from {
    transform: scale(0.2);
    opacity: 0.9;
  }
  to {
    transform: scale(1.6);
    opacity: 0;
  }
}
```

- [ ] **Step 2: Add the `pulses` prop to `GlobeProps` and `liveProps`**

In `src/components/ui/cobe-globe.tsx`, find the `GlobeProps` interface (near the top, alongside `Marker`/`Arc`) and add a new field after `arcs`:

```ts
interface GlobeProps {
  markers?: Marker[]
  arcs?: Arc[]
  pulses?: { id: string; markerId: string; kind: "birth" | "death" }[]
  className?: string
  markerColor?: [number, number, number]
  baseColor?: [number, number, number]
  arcColor?: [number, number, number]
  glowColor?: [number, number, number]
  dark?: number
  mapBrightness?: number
  markerSize?: number
  markerElevation?: number
  arcWidth?: number
  arcHeight?: number
  speed?: number
  theta?: number
  diffuse?: number
  mapSamples?: number
  activeLabelIndex?: number
}
```

In the `Globe` function's destructured props (`export const Globe = forwardRef<GlobeRef, GlobeProps>(function Globe({ markers = [], arcs = [], ... }, ref) {`), add `pulses = [],` right after `arcs = [],`.

Find the `liveProps` ref initialization and its matching reassignment (both blocks list the same fields: `markers, arcs, markerColor, baseColor, ...`). Add `pulses,` right after `arcs,` in **both** the `useRef({ ... })` initializer and the `liveProps.current = { ... }` reassignment that immediately follows it.

- [ ] **Step 3: Add pulse ref tracking, next to the existing label ref tracking**

Find the label ref declarations near the top of `Globe` (`const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())` and its `arcLabelRefs`/`labelRefSetters`/`arcLabelRefSetters` siblings). Add one more pair directly after them:

```ts
  const pulseRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const pulseRefSetters = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
```

- [ ] **Step 4: Add a per-frame position-update function for pulses**

Find the `updateLabels` function defined inside the mount `useEffect`'s `init()` (it loops over `liveProps.current.markers` and `liveProps.current.arcs`, setting each label element's `left`/`top`/`opacity`). Add a new sibling function directly after it, inside the same scope:

```ts
      function updatePulses(currentPhi: number, currentTheta: number, markerElevation: number) {
        for (const pulse of liveProps.current.pulses) {
          const el = pulseRefs.current.get(pulse.id)
          if (!el) continue
          const marker = liveProps.current.markers.find((m) => m.id === pulse.markerId)
          if (!marker) {
            el.style.opacity = "0"
            continue
          }
          const { x, y, visible } = projectMarker(marker.location, currentPhi, currentTheta, markerElevation)
          el.style.left = `${x * 100}%`
          el.style.top = `${y * 100}%`
          el.style.opacity = visible ? "1" : "0"
        }
      }
```

Then find the `animate()` function's call to `updateLabels(currentPhi, currentTheta, p.markerElevation, p.arcHeight)` and add a call to the new function directly after it:

```ts
        updateLabels(currentPhi, currentTheta, p.markerElevation, p.arcHeight)
        updatePulses(currentPhi, currentTheta, p.markerElevation)
```

- [ ] **Step 5: Render `Pulse` elements and add the `Pulse` component**

Find where `LabelPill`s are rendered for arcs (the `{arcs.filter(...).map((a) => (<LabelPill .../>))}` block, near the end of `Globe`'s returned JSX, just before its closing `</div>`). Add a new block directly after it, still inside the same wrapping `<div>`:

```tsx
      {pulses.map((pulse) => (
        <Pulse
          key={pulse.id}
          kind={pulse.kind}
          setRef={getRefSetter(pulseRefSetters, pulseRefs, pulse.id)}
        />
      ))}
```

Then add the `Pulse` component itself directly after `LabelPill` (after its `LabelPill.displayName = "LabelPill"` line):

```tsx
// One-shot expanding ring, spawned by usePopulationPulses (GlobeView.tsx)
// for a single birth/death threshold crossing. Position (left/top) and
// occlusion opacity are imperative, updated every animate() frame like
// labels -- but the ring's own scale/fade is a plain CSS keyframe
// (`pulse-ring` in index.css) on the inner span, so the two don't fight
// over the same `opacity` property.
const Pulse = memo(function Pulse({
  kind,
  setRef,
}: {
  kind: "birth" | "death"
  setRef: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={setRef}
      style={{
        position: "absolute",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        opacity: 0,
      }}
    >
      <span
        className="block size-8 rounded-full border-2 [animation:pulse-ring_1.1s_ease-out_forwards]"
        style={{ borderColor: kind === "birth" ? "var(--accent)" : "#000000" }}
      />
    </div>
  )
})
Pulse.displayName = "Pulse"
```

- [ ] **Step 6: Build and lint**

Run:
```bash
npm run build
```
Expected: succeeds, no TypeScript errors.

Run:
```bash
npx oxlint src
```
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/components/ui/cobe-globe.tsx
git commit -m "$(cat <<'EOF'
Add Pulse ring rendering to Globe (cobe-globe.tsx)

Globe now accepts a pulses prop and renders one expanding-ring div
per active pulse, positioned every animation frame using the same
marker-projection math as labels. Not fed real data yet -- that's
the next task.
EOF
)"
```

---

### Task 3: Wire `usePopulationPulses` into `GlobeView` and un-void `demographics`

**Files:**
- Modify: `src/components/GlobeView.tsx`

**Interfaces:**
- Consumes: `usePopulationPulses` from Task 1, `Globe`'s `pulses` prop from Task 2

- [ ] **Step 1: Import the hook**

In `src/components/GlobeView.tsx`, add to the existing imports block:

```tsx
import { usePopulationPulses } from '@/lib/populationPulse'
```

- [ ] **Step 2: Stop voiding `demographics` and derive `visibleCityIds`**

Find this block inside `GlobeView`:

```tsx
  // Country-level demographics/selection isn't wired into the globe right
  // now — dots are city-only until the per-country marker approach is
  // revisited. See PROGRESS.md.
  void demographics
  void onSelectCountry
```

Replace it with:

```tsx
  // onSelectCountry isn't wired into the globe yet -- no click-to-select
  // exists on the cobe-based globe (drag-to-rotate only). demographics IS
  // now used, by usePopulationPulses below.
  void onSelectCountry
```

- [ ] **Step 3: Call the hook and pass its result to `Globe`**

Find where `revealedIds` is computed (`const revealedIds = useSweepReveal(...)`) and add directly after it:

```tsx
  const visibleCityIds = useMemo(
    () => new Set(CITIES.slice(0, cityCount).filter((c) => revealedIds.has(c.id)).map((c) => c.id)),
    [cityCount, revealedIds],
  )
  const populationPulses = usePopulationPulses(CITIES, visibleCityIds, demographics)
  const pulses = useMemo(
    () => populationPulses.map((p) => ({ id: p.id, markerId: p.cityId, kind: p.kind })),
    [populationPulses],
  )
```

Then find the `<Globe ... />` JSX and add the new prop after `arcs={arcs}`:

```tsx
      <Globe
        ref={globeRef}
        className="aspect-square w-full max-w-[min(80vh,48rem)]"
        markers={markers}
        arcs={arcs}
        pulses={pulses}
        activeLabelIndex={LANGUAGES.indexOf(lang)}
        speed={kmPerSecToPhiSpeed(rotationSpeedKmS)}
        {...GLOBE_COLORS}
      />
```

- [ ] **Step 4: Build and lint**

Run:
```bash
npm run build
```
Expected: succeeds, no TypeScript errors.

Run:
```bash
npx oxlint src
```
Expected: no new errors.

- [ ] **Step 5: Manual verification in the Browser pane**

1. Navigate to `http://localhost:5173`.
2. Check console for errors via `read_console_messages`.
3. Inspect the DOM for pulse elements once one has fired: `document.querySelectorAll('[style*="pulse-ring"], span.rounded-full.border-2')` — note this environment's known `requestAnimationFrame` limitation (documented repeatedly in `PROGRESS.md`) means pulses may take a long time to become visible here since the 500ms `setInterval` accumulation itself is NOT rAF-gated and should work, but confirming a ring's *position* update depends on the animate() loop, which does not run in this sandboxed pane. Confirm what CAN be confirmed here: no console errors, and (after waiting at least one 500ms tick) that `usePopulationPulses`' internal state is advancing (e.g. via a temporary breakpoint/log if needed, removed before commit).
4. **This is fundamentally a live-verification item** — ask the user to check in their own browser: drag the city slider up, wait, and confirm red/black rings periodically expand from city markers (most reliably visible on Beijing, Delhi, Mumbai, or Lagos, which have the highest combined rates per the design doc's math).

- [ ] **Step 6: Commit**

```bash
git add src/components/GlobeView.tsx
git commit -m "$(cat <<'EOF'
Wire population pulses into GlobeView

demographics is no longer voided -- feeds usePopulationPulses, whose
output is passed to Globe's new pulses prop. First real connection
between the live World Bank data and anything visible on the globe.
EOF
)"
git push
```
