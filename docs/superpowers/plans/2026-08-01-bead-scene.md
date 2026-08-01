# Bead Scene (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a country marker on the globe shrinks the globe into the top-right corner and drops physics beads from the top of the viewport — red for that country's real births/second, foreground-colored for deaths/second — which pile up on invisible viewport-sized floor/wall colliders.

**Architecture:** `cobe-globe.tsx` gains a `getElement()` accessor and a `visible` flag on `project()`, letting `GlobeView` hit-test a click's canvas-relative fraction against each visible city marker and finally call the already-plumbed `onSelectCountry`. `App.tsx` toggles `selectedIso3`, CSS-transforms the globe wrapper into a corner, and mounts a new `BeadScene` — a `fixed inset-0`, transparent, `pointer-events-none` react-three-fiber `<Canvas orthographic>` where 1 world unit = 1 CSS pixel, running `@react-three/rapier` physics. Bead spawn cadence comes from a new pure helper `src/lib/beadSpawnRate.ts` that log-rescales real per-second rates into legible millisecond intervals, mirroring how `src/lib/globeSpeed.ts` turns an opaque animation constant into an instrument reading.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, `@react-three/fiber@9.7.0`, `@react-three/rapier@2.2.0` (backed by `@dimforge/rapier3d-compat@0.19.2`), `three@0.185.1`, `cobe@2.0.1`.

## Global Constraints

- **This is Phase 1 only.** Beads use plain opaque `meshStandardMaterial`. `MeshTransmissionMaterial` / glass refraction / environment lighting polish is **Phase 2 and explicitly out of scope** — do not add it.
- **Also out of scope:** physical collision between beads and UI elements (title, control panel, toggles) — deferred per spec. Beads simply render behind those panels.
- **No change to `src/lib/worldbank.ts`.** `CountryDemographics.birthsPerSecond` / `.deathsPerSecond` already exist and are the only data inputs.
- **No new npm packages.** `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier`, `three` are already in `package.json`. Never run `npm install <pkg>`.
- **No test framework exists in this repo.** `package.json` scripts are only `dev` / `build` / `lint` / `preview`; `lint` is `oxlint`. Do NOT write Jest/Vitest tests or reference a test runner. Verification is: `npx tsc --noEmit`, `oxlint src`, and live browser-pane checks.
- **Screenshots do not work in this sandbox.** Verify in the browser pane using `read_console_messages`, `get_page_text`, and `javascript_tool` only. Never call the screenshot action.
- **Known pre-existing noise to ignore when judging "clean":** `npx tsc --noEmit` emits a `baseUrl` deprecation warning; `oxlint src` emits one warning in `src/components/ui/button.tsx`. Both predate this work. Anything else is a regression.
- Birth bead color: the `--accent` token (`#912f40` light / `#c17b8a` dark). Death bead color: the `--foreground` token (`oklch(0.2 0 0)` light / `oklch(0.95 0 0)` dark).
- Live bead cap: **180**.
- Transition duration for the globe shrink: `duration-700 ease-in-out` (matches the existing `LagWarning` transition in `src/App.tsx:189`).
- The dev server is launched via the browser pane with `preview_start({ name: "hourglass-earth-dev" })` (already configured in `.claude/launch.json`, port 5173). Do not start servers with Bash.

---

### Task 1: Click-to-select a country on the globe

**Files:**
- Modify: `src/components/ui/cobe-globe.tsx` (the `GlobeRef` interface at lines 48-53, and the `useImperativeHandle` at lines 582-596)
- Modify: `src/components/GlobeView.tsx` (lines 488-583)
- Modify: `src/App.tsx` (the `handleSelectCountry` callback at lines 316-324)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `GlobeRef.project(location: [number, number]): { x: number; y: number; visible: boolean }` (was `{ x: number; y: number }`)
  - `GlobeRef.getElement(): HTMLCanvasElement | null`
  - `App.tsx`'s `selectedIso3: string | null` state now actually becomes non-null on a marker click, and the derived `selected: CountryDemographics | undefined` (line 343) becomes truthy — Tasks 3 and 4 depend on this.

**Background the implementer needs:**
The globe is `cobe` (a WebGL canvas), which has no scene graph and no hit-testing. `cobe-globe.tsx` re-derives cobe's own marker projection math locally (`projectMarker` / `project`, lines 61-100) to place HTML label pills; `project()` returns *canvas-relative fractions in `[0,1]`* plus a `visible` flag (false when the marker is on the far side of the globe). We reuse exactly that to hit-test clicks. `cobe-globe.tsx` also implements drag-to-rotate via `onPointerDown` on the canvas plus window-level `pointermove`/`pointerup` — it does **not** distinguish a click from a drag, so `GlobeView` must do that itself.

- [ ] **Step 1: Widen `GlobeRef` in `src/components/ui/cobe-globe.tsx`**

Replace the `GlobeRef` interface (currently lines 48-53) with:

```ts
export interface GlobeRef {
  /** Projects a lat/lng to current screen-space fraction (0-1) of the
   * canvas box, using the globe's live rotation — for callers that need to
   * know where something is on screen right now (e.g. to order a sweep
   * animation, or to hit-test a click). `visible` is false when the point
   * is on the far side of the globe. */
  project(location: [number, number]): { x: number; y: number; visible: boolean }
  /** The live <canvas> element. Callers hit-testing pointer events need it
   * to convert clientX/clientY into the same 0-1 fraction space `project()`
   * returns (via getBoundingClientRect). */
  getElement(): HTMLCanvasElement | null
}
```

- [ ] **Step 2: Implement the widened ref in the same file**

Replace the `useImperativeHandle` block (currently lines 582-596) with:

```ts
  useImperativeHandle(
    ref,
    () => ({
      project(location) {
        return projectMarker(
          location,
          currentPhiRef.current,
          currentThetaRef.current,
          liveProps.current.markerElevation,
        )
      },
      getElement() {
        return canvasRef.current
      },
    }),
    [],
  )
```

(`projectMarker` already returns `{ x, y, visible }`, so this is just dropping the destructure-and-rebuild.)

- [ ] **Step 3: In `src/components/GlobeView.tsx`, add click-detection constants**

Add just above `export const GlobeView = memo(...)` (i.e. after the `useSweepReveal` hook, around line 482):

```ts
// cobe-globe's canvas handles drag-to-rotate on the same pointer stream and
// doesn't distinguish a click from a drag, so GlobeView does: a pointerup
// only counts as a "click" if the pointer barely moved and the press was
// short. Everything else is a rotation gesture and must not select a
// country. The hit radius is a fraction of the canvas box (the same 0-1
// space GlobeRef.project returns) — ~4.5%, comfortably larger than a
// marker's 0.025 dot but small enough that adjacent cities don't overlap.
const CLICK_MAX_MOVE_PX = 6
const CLICK_MAX_DURATION_MS = 400
const CLICK_HIT_RADIUS_FRACTION = 0.045
```

- [ ] **Step 4: Rewrite the projection callback and derive a single `visibleCities` list**

Inside the `GlobeView` component body, delete these two lines entirely (currently lines 495-498):

```ts
  // onSelectCountry isn't wired into the globe yet -- no click-to-select
  // exists on the cobe-based globe (drag-to-rotate only). demographics IS
  // now used, by usePopulationPulses below.
  void onSelectCountry
```

Then change the `project` callback's fallback (currently lines 505-508) to include the new field:

```ts
  const project = useCallback(
    (location: [number, number]) => globeRef.current?.project(location) ?? { x: 0, y: 0, visible: false },
    [],
  )
```

Then replace the existing `visibleCityIds` memo (lines 517-520) and `markers` memo (lines 530-541) with a single shared `visibleCities` list plus the two derivations, so the click hit-test iterates exactly the same set that's rendered:

```ts
  const visibleCities = useMemo(
    () => CITIES.slice(0, cityCount).filter((city) => revealedIds.has(city.id)),
    [cityCount, revealedIds],
  )
  const visibleCityIds = useMemo(() => new Set(visibleCities.map((c) => c.id)), [visibleCities])
  const populationPulses = usePopulationPulses(CITIES, visibleCityIds, demographics)
```

...and, further down, the markers memo:

```ts
  // Memoized so the marker array reference only changes when the revealed
  // set actually does — cobe-globe's animation loop only re-uploads GPU
  // marker buffers when the reference changes (see its `lastMarkers` check).
  const markers = useMemo(
    () =>
      visibleCities.map((city) => ({
        id: city.id,
        location: city.location,
        label: CITY_LABELS.get(city.id)!,
        size: CITY_MARKER_SIZE,
      })),
    [visibleCities],
  )
```

Keep the `pulses` memo, `visibleRoutes`, `drawProgress`, and `arcs` exactly as they are.

- [ ] **Step 5: Add the pointer handlers**

Add these two plain functions (not `useCallback` — they close over `visibleCities`, and the wrapper `div` they attach to isn't memoized, so re-creating them each render is free and avoids a stale-closure bug) immediately after the `arcs` memo, before the `return`:

```ts
  const pointerDownRef = useRef<{ x: number; y: number; t: number } | null>(null)

  function handlePointerDown(e: React.PointerEvent) {
    pointerDownRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const down = pointerDownRef.current
    pointerDownRef.current = null
    if (!down) return
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_MAX_MOVE_PX) return
    if (performance.now() - down.t > CLICK_MAX_DURATION_MS) return

    const canvas = globeRef.current?.getElement()
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    // Same 0-1 canvas-box fraction space that GlobeRef.project() returns.
    // getBoundingClientRect already accounts for any CSS transform on an
    // ancestor (App shrinks the globe into a corner once a country is
    // selected), so this stays correct in both the full and shrunken states.
    const fx = (e.clientX - rect.left) / rect.width
    const fy = (e.clientY - rect.top) / rect.height

    let bestCountry: string | null = null
    let bestDistance = CLICK_HIT_RADIUS_FRACTION
    for (const city of visibleCities) {
      const p = project(city.location)
      // Far-side markers project onto the same 2D disc as near-side ones;
      // without this they'd be selectable "through" the globe.
      if (!p.visible) continue
      const d = Math.hypot(fx - p.x, fy - p.y)
      if (d <= bestDistance) {
        bestDistance = d
        bestCountry = city.country
      }
    }
    if (bestCountry) onSelectCountry(bestCountry)
  }
```

Then attach them to the existing wrapper `div` in the JSX return:

```tsx
    <div
      className="flex h-full w-full items-center justify-center p-8"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
```

Leave the `<Globe ... />` element itself unchanged.

- [ ] **Step 6: Make selection toggle off in `src/App.tsx`**

Replace `handleSelectCountry` (currently lines 316-324) with:

```ts
  // Clicking the already-selected country deselects it — that's the only
  // exit from the bead scene (clicking the shrunken globe again), per the
  // design: symmetric in/out, no separate close control. No `demographics`
  // dependency, so this reference is stable for GlobeView's React.memo.
  const handleSelectCountry = useCallback(
    (iso3: string) => setSelectedIso3((prev) => (prev === iso3 ? null : iso3)),
    [],
  )
```

- [ ] **Step 7: Typecheck and lint**

Run:
```bash
npx tsc --noEmit && npx oxlint src
```
Expected: no errors. Only the pre-existing `baseUrl` deprecation warning and the pre-existing `button.tsx` oxlint warning (see Global Constraints). If `demographics` is now reported as unused in `App.tsx`, that's wrong — it's still used by `useDemographics`, the loading/error branches, and the `selected` derivation; re-read the file.

- [ ] **Step 8: Verify live in the browser**

Start the dev server: `preview_start({ name: "hourglass-earth-dev" })`.

Wait for the globe to render (labels fade in over ~1.2s), then run `javascript_tool` with:

```js
(() => {
  const pills = [...document.querySelectorAll('div[style*="translate(-50%"]')]
    .filter((el) => el.style.opacity === '1')
  if (!pills.length) return 'FAIL: no visible label pill yet'
  const r = pills[0].getBoundingClientRect()
  // LabelPill is transformed translate(-50%, calc(-100% - 10px)) from its
  // marker anchor, so the marker dot sits 10px below the pill's bottom edge.
  const x = r.left + r.width / 2
  const y = r.bottom + 10
  const target = document.elementFromPoint(x, y)
  if (!target) return 'FAIL: nothing at marker point'
  for (const type of ['pointerdown', 'pointerup']) {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }))
  }
  return 'dispatched at ' + Math.round(x) + ',' + Math.round(y)
})()
```

Then call `get_page_text` and assert the word `reading` now appears (the top-left reading panel, `src/App.tsx:369-377`, renders only when `selected` is truthy). Run the same JS snippet a second time and call `get_page_text` again — `reading` must be **gone**, proving the toggle-off works.

Then call `read_console_messages` and assert there are no errors.

Finally, verify a drag does NOT select: run `javascript_tool` with

```js
(() => {
  const c = document.querySelector('canvas')
  if (!c) return 'FAIL: no canvas'
  const r = c.getBoundingClientRect()
  const x = r.left + r.width / 2, y = r.top + r.height / 2
  c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }))
  c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 60, clientY: y, pointerId: 1 }))
  return 'drag dispatched'
})()
```

and confirm via `get_page_text` that `reading` still does not appear.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/cobe-globe.tsx src/components/GlobeView.tsx src/App.tsx
git commit -m "Add click-to-select country markers on the globe"
```

---

### Task 2: `beadSpawnRate.ts` — real per-second rates to legible spawn intervals

**Files:**
- Create: `src/lib/beadSpawnRate.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `spawnIntervalMs(ratePerSecond: number): number` — milliseconds between bead spawns. Consumed by Task 4.

**Background:** `CountryDemographics.birthsPerSecond` / `.deathsPerSecond` (`src/lib/worldbank.ts:106-107`) are genuine rates, but they span ~5 orders of magnitude (a micro-state is around `1e-5`/s; India is around `0.75`/s). Spawning literally would give either nothing on screen or nothing readable. `src/lib/globeSpeed.ts` is the existing precedent in this codebase for this move — an honest, documented rescaling into an "instrument reading". Match its comment style: explain *why* the constants are what they are.

- [ ] **Step 1: Create `src/lib/beadSpawnRate.ts`**

```ts
// Real birth/death rates (CountryDemographics.birthsPerSecond /
// .deathsPerSecond) span roughly five orders of magnitude: a micro-state
// sits near 1e-5 births/second, India near 0.75. Spawning a bead per real
// event would leave most countries showing nothing at all and the largest
// showing less than one bead per second — legible for neither. So we do
// the same thing src/lib/globeSpeed.ts does for rotation: keep the real
// figure as the input, and map it onto a scale you can actually read.
//
// The map is logarithmic (each 10x in real rate is an equal step in
// interval) and clamped at both ends, so the smallest and largest real
// countries land at a steady trickle and a busy-but-countable stream
// respectively, and nothing ever produces an invisible or overwhelming
// spawn rate.
const MIN_RATE_PER_SECOND = 1e-5
const MAX_RATE_PER_SECOND = 1
const SLOWEST_SPAWN_INTERVAL_MS = 1400
const FASTEST_SPAWN_INTERVAL_MS = 120

const LOG_MIN = Math.log10(MIN_RATE_PER_SECOND)
const LOG_RANGE = Math.log10(MAX_RATE_PER_SECOND) - LOG_MIN

/** Milliseconds to wait between bead spawns for a given real per-second
 * rate. Non-finite or non-positive rates (missing data) fall back to the
 * slowest interval rather than spawning nothing, so a country with a
 * partial record still reads as alive. */
export function spawnIntervalMs(ratePerSecond: number): number {
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) return SLOWEST_SPAWN_INTERVAL_MS
  const clamped = Math.min(MAX_RATE_PER_SECOND, Math.max(MIN_RATE_PER_SECOND, ratePerSecond))
  const t = (Math.log10(clamped) - LOG_MIN) / LOG_RANGE
  return Math.round(
    SLOWEST_SPAWN_INTERVAL_MS + t * (FASTEST_SPAWN_INTERVAL_MS - SLOWEST_SPAWN_INTERVAL_MS),
  )
}
```

- [ ] **Step 2: Verify the numbers by evaluating the same math in Node**

There is no test runner in this repo (see Global Constraints), so check the curve directly. Run:

```bash
node -e "const A=1e-5,B=1,S=1400,F=120,L=Math.log10(A),R=Math.log10(B)-L;const f=r=>(!Number.isFinite(r)||r<=0)?S:Math.round(S+((Math.log10(Math.min(B,Math.max(A,r)))-L)/R)*(F-S));for(const r of [0,1e-7,1e-5,6.3e-5,0.114,0.75,5]) console.log(r, f(r))"
```

Expected output (exact):
```
0 1400
1e-7 1400
0.00001 1400
0.000063 1195
0.114 362
0.75 152
5 120
```

Sanity read: a tiny country trickles a bead roughly every 1.4s; the USA (~0.114 births/s) is about every 0.36s; India (~0.75/s) about every 0.15s. Both ends legible, neither invisible nor a firehose. If your numbers differ, your implementation diverged from the spec above — fix it, don't adjust the expectations.

- [ ] **Step 3: Typecheck and lint**

Run:
```bash
npx tsc --noEmit && npx oxlint src
```
Expected: no new errors or warnings beyond the two pre-existing ones.

- [ ] **Step 4: Commit**

```bash
git add src/lib/beadSpawnRate.ts
git commit -m "Add beadSpawnRate helper rescaling real per-second rates to spawn intervals"
```

---

### Task 3: `BeadScene` physics container + globe shrink

**Files:**
- Create: `src/components/BeadScene.tsx`
- Modify: `src/App.tsx` (imports; the `GlobeView` render at lines 347-353)

**Interfaces:**
- Consumes: `App.tsx`'s `selected: CountryDemographics | undefined` and `theme: 'light' | 'dark'` (both already exist; `selected` only becomes truthy thanks to Task 1).
- Produces:
  - `export function BeadScene(props: { theme: 'light' | 'dark' }): JSX.Element` from `src/components/BeadScene.tsx`
  - Module-internal, extended by Task 4: `interface Bead { id: number; kind: 'birth' | 'death'; x: number }`; `resolveBeadColors(): { birth: string; death: string }`; constants `BEAD_RADIUS`, `MAX_BEADS`, `SPAWN_JITTER_PX`; the `beads` state array and its `setBeads` setter.

**Background the implementer needs — read all four points before writing code:**

1. **Nothing in `src/` has ever imported `@react-three/fiber` or `@react-three/rapier` before.** That's why this task deliberately renders three hardcoded beads and stops: it proves the whole R3F + Rapier + WASM pipeline actually boots in this Vite app before Task 4 layers a spawn loop on top. Do not skip the live verification.

2. **Orthographic camera = pixel units.** With `<Canvas orthographic>` and no `camera.left/right/top/bottom` override (and `camera.manual` left falsy), react-three-fiber recomputes the frustum on every resize as `left = -width/2, right = width/2, top = height/2, bottom = -height/2` from the canvas's **CSS pixel** size (verified in `node_modules/@react-three/fiber/dist/events-156d8d12.esm.js`, function `updateCamera`). So 1 world unit = 1 CSS pixel, origin at canvas center, +y up, +x right. All positions and collider half-extents below are in pixels.

3. **Gravity must be rescaled too.** Rapier's default `-9.81` is 9.81 *pixels* per second squared here — beads would drift like feathers. Use `-2000`, which reads as roughly earth-like at this pixel scale.

4. **`<Physics>` suspends.** `@react-three/rapier` loads the Rapier WASM via `suspend-react` (`react-three-rapier.esm.js:784`), so `<Physics>` must be wrapped in `<Suspense fallback={null}>` or React will throw.

- [ ] **Step 1: Create `src/components/BeadScene.tsx`**

```tsx
import { Suspense, useEffect, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier'

// With <Canvas orthographic> and no manual frustum override, react-three-
// fiber sizes the camera frustum to the canvas's CSS pixel dimensions on
// every resize (see its updateCamera). So every number in this file is in
// CSS pixels, with the origin at the centre of the viewport, +y up.
// Rapier's default -9.81 gravity would therefore be 9.81 px/s^2 — beads
// would float. -2000 px/s^2 reads as roughly earth-like at this scale.
const GRAVITY_PX_PER_S2 = 2000
const BEAD_RADIUS = 14
const WALL_THICKNESS = 40
// Half-width of the horizontal band beads spawn across. Without jitter
// every bead would stack in one perfect column.
const SPAWN_JITTER_PX = 90
// Live bead cap. Past this, the oldest bead is dropped as each new one
// spawns, so performance stays bounded however long the scene stays open.
const MAX_BEADS = 180

interface Bead {
  id: number
  kind: 'birth' | 'death'
  x: number
}

interface BeadColors {
  birth: string
  death: string
}

// THREE.Color cannot parse `oklch(...)` — which is exactly how --foreground
// is declared in src/index.css — and cannot parse a raw `var(--…)`
// reference at all. Round-tripping a colour through a 2D canvas's fillStyle
// setter normalises whatever CSS colour syntax the stylesheet used into a
// plain `#rrggbb` string, which THREE.Color does parse. If the browser
// can't parse the value either, fillStyle keeps the fallback we primed it
// with, so we never hand THREE something it will choke on.
function normalizeCssColor(value: string, fallback: string): string {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return fallback
  ctx.fillStyle = fallback
  ctx.fillStyle = value
  return typeof ctx.fillStyle === 'string' ? ctx.fillStyle : fallback
}

// --accent is already a literal hex in index.css so it can be read straight
// off the root element. --foreground is oklch(), so instead of reading the
// custom property's raw text we read the *computed* colour off a real
// element carrying Tailwind's `text-foreground` class — the browser has
// already resolved it there — and then normalise it through the canvas.
function resolveBeadColors(): BeadColors {
  const probe = document.createElement('span')
  probe.className = 'text-foreground'
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const foreground = getComputedStyle(probe).color
  probe.remove()
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return {
    birth: normalizeCssColor(accent, '#912f40'),
    death: normalizeCssColor(foreground, '#333333'),
  }
}

// Invisible static colliders sized to the current viewport: a floor, two
// side walls, and a front/back pair that pins beads to the z=0 plane so the
// pile stays readable from a flat orthographic camera. No ceiling — the
// spawn point is above the top edge.
function Boundaries() {
  const { width, height } = useThree((state) => state.size)
  const halfW = width / 2
  const halfH = height / 2
  const half = WALL_THICKNESS / 2
  // CuboidCollider args are HALF-extents.
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, -halfH - half, 0]}>
        <CuboidCollider args={[halfW + WALL_THICKNESS, half, WALL_THICKNESS]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[-halfW - half, 0, 0]}>
        <CuboidCollider args={[half, halfH * 2, WALL_THICKNESS]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[halfW + half, 0, 0]}>
        <CuboidCollider args={[half, halfH * 2, WALL_THICKNESS]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[0, 0, BEAD_RADIUS + half]}>
        <CuboidCollider args={[halfW + WALL_THICKNESS, halfH * 2, half]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[0, 0, -BEAD_RADIUS - half]}>
        <CuboidCollider args={[halfW + WALL_THICKNESS, halfH * 2, half]} />
      </RigidBody>
    </>
  )
}

// Phase 1 deliberately uses a plain opaque material — glass refraction
// (drei's MeshTransmissionMaterial) is Phase 2, after the mechanics are
// confirmed. RigidBody `position` is only read when the body is created, so
// stable React keys matter: a changing key would recreate the body and
// teleport a settled bead back to the spawn point.
function BeadBody({ bead, colors }: { bead: Bead; colors: BeadColors }) {
  const height = useThree((state) => state.size.height)
  return (
    <RigidBody
      colliders="ball"
      position={[bead.x, height / 2 + BEAD_RADIUS * 2, 0]}
      restitution={0.25}
      friction={0.6}
      linearDamping={0.1}
    >
      <mesh>
        <sphereGeometry args={[BEAD_RADIUS, 20, 20]} />
        <meshStandardMaterial
          color={bead.kind === 'birth' ? colors.birth : colors.death}
          roughness={0.35}
          metalness={0.05}
        />
      </mesh>
    </RigidBody>
  )
}

interface BeadSceneProps {
  theme: 'light' | 'dark'
}

export function BeadScene({ theme }: BeadSceneProps) {
  // Re-resolved whenever the theme flips. Deliberately inside a rAF: the
  // `.dark` class is toggled by App's own useTheme effect, and child
  // effects run BEFORE parent effects in React — reading the computed
  // colour synchronously here would pick up the OLD theme's values. Waiting
  // one frame guarantees the class is on the document first.
  const [colors, setColors] = useState<BeadColors>(resolveBeadColors)
  useEffect(() => {
    const id = requestAnimationFrame(() => setColors(resolveBeadColors()))
    return () => cancelAnimationFrame(id)
  }, [theme])

  // Seeded with three static beads so this task is verifiable on its own:
  // it proves the R3F + Rapier pipeline boots, the pixel-unit camera is
  // right, the floor catches things, and both colours resolve. Task 4
  // replaces this initial value with [] and drives spawning from data.
  const [beads] = useState<Bead[]>(() => [
    { id: -1, kind: 'birth', x: -60 },
    { id: -2, kind: 'death', x: 0 },
    { id: -3, kind: 'birth', x: 60 },
  ])

  return (
    // pointer-events-none so the sliders and toggles underneath stay fully
    // usable — the shrunken globe's own handler, not this canvas, is the
    // exit. z-0 keeps beads above the globe (earlier in the DOM) but below
    // every z-10/z-20 panel.
    <div className="pointer-events-none fixed inset-0 z-0">
      <Canvas orthographic camera={{ position: [0, 0, 600], zoom: 1, near: 0.1, far: 2000 }}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[200, 400, 300]} intensity={2.2} />
        {/* Rapier's WASM is loaded via suspend-react, so Physics suspends. */}
        <Suspense fallback={null}>
          <Physics gravity={[0, -GRAVITY_PX_PER_S2, 0]}>
            <Boundaries />
            {beads.map((bead) => (
              <BeadBody key={bead.id} bead={bead} colors={colors} />
            ))}
          </Physics>
        </Suspense>
      </Canvas>
    </div>
  )
}
```

- [ ] **Step 2: Wire the shrink + mount into `src/App.tsx`**

Add the import alongside the other component imports near the top:

```ts
import { BeadScene } from '@/components/BeadScene'
```

Then replace the bare `<GlobeView ... />` element (currently lines 347-353) with a transformed wrapper plus the conditional scene:

```tsx
      {/* Selecting a country shrinks the globe into the top-right corner —
          clear of the toggles above it, the control panel bottom-left and
          the title/reading panel top-left — and hands the viewport to the
          bead scene. Clicking the shrunken globe again deselects (see
          handleSelectCountry), which reverses both. */}
      <div
        className={`absolute inset-0 transition-transform duration-700 ease-in-out ${
          selected ? 'translate-x-[33%] -translate-y-[22%] scale-[0.3]' : ''
        }`}
      >
        <GlobeView
          demographics={demographics.data}
          lang={lang}
          onSelectCountry={handleSelectCountry}
          cityCount={cityCount}
          rotationSpeedKmS={rotationSpeedKmS}
        />
      </div>
      {selected && <BeadScene theme={theme} />}
```

Leave every other element in the return (`LanguageToggle`/`ThemeToggle` row, hints, `LagWarning`, `ControlPanel`, title/reading panel) exactly where it is.

- [ ] **Step 3: Typecheck and lint**

Run:
```bash
npx tsc --noEmit && npx oxlint src
```
Expected: clean apart from the two known pre-existing warnings. If TypeScript complains that intrinsic elements like `mesh` / `sphereGeometry` / `meshStandardMaterial` don't exist, the R3F JSX types aren't being picked up — confirm `@react-three/fiber` is imported in this file (it is, via `Canvas`), which is what registers the `ThreeElements` JSX namespace augmentation.

- [ ] **Step 4: Verify live in the browser**

Restart/refresh the dev server (`preview_start({ name: "hourglass-earth-dev" })`), then:

1. Select a country using the exact click-dispatch snippet from Task 1 Step 8.
2. `read_console_messages` — assert **no errors**. A Rapier WASM instantiation failure or a `THREE.Color: Unknown color` warning here is a hard failure of this task, not noise.
3. `javascript_tool`:

```js
(() => {
  const canvases = [...document.querySelectorAll('canvas')]
  const wrap = document.querySelector('.fixed.inset-0.pointer-events-none, .pointer-events-none.fixed.inset-0')
  return JSON.stringify({
    canvasCount: canvases.length,
    beadCanvasPointerEvents: wrap ? getComputedStyle(wrap).pointerEvents : null,
    globeTransform: getComputedStyle(document.querySelector('.transition-transform')).transform,
  })
})()
```
   Expected: `canvasCount` is 2 (the cobe globe plus the R3F canvas), `beadCanvasPointerEvents` is `"none"`, and `globeTransform` is a matrix whose scale components are ~0.3 (i.e. NOT `"none"`).
4. `javascript_tool` to confirm both bead colours resolved to something THREE can consume:

```js
(() => {
  const probe = document.createElement('span')
  probe.className = 'text-foreground'
  probe.style.cssText = 'position:absolute;visibility:hidden'
  document.body.appendChild(probe)
  const fg = getComputedStyle(probe).color
  probe.remove()
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.fillStyle = '#333333'; ctx.fillStyle = fg
  const fgHex = ctx.fillStyle
  ctx.fillStyle = '#912f40'
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return JSON.stringify({ rawForeground: fg, normalizedForeground: fgHex, normalizedAccent: ctx.fillStyle })
})()
```
   Expected: `normalizedForeground` and `normalizedAccent` are both `#rrggbb` strings, and `normalizedForeground` is NOT the `#333333` fallback (which would mean the browser failed to parse and the death beads would be silently wrong).
5. Toggle the theme in the UI (`javascript_tool`: `document.querySelector('[aria-label^="Switch to"]').click()`), wait a moment, re-run check 4, and confirm `normalizedForeground` flipped to the other end of the scale (near-black `#33…` region in light mode vs near-white `#f…` in dark).
6. Deselect (run the Task 1 click snippet again) and confirm via `javascript_tool` that `document.querySelectorAll('canvas').length` is back to 1 and `getComputedStyle(document.querySelector('.transition-transform')).transform` returns to `"none"` (or an identity matrix).

- [ ] **Step 5: Commit**

```bash
git add src/components/BeadScene.tsx src/App.tsx
git commit -m "Add BeadScene physics container and shrink the globe on selection"
```

---

### Task 4: Data-driven bead spawning, colouring, and the live cap

**Files:**
- Modify: `src/components/BeadScene.tsx`
- Modify: `src/App.tsx` (the `<BeadScene ... />` element added in Task 3)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes:
  - `spawnIntervalMs(ratePerSecond: number): number` from `src/lib/beadSpawnRate.ts` (Task 2)
  - `Bead`, `BeadColors`, `resolveBeadColors`, `BeadBody`, `Boundaries`, `MAX_BEADS`, `SPAWN_JITTER_PX` from `src/components/BeadScene.tsx` (Task 3)
  - `CountryDemographics` from `src/lib/worldbank.ts` (fields used: `birthsPerSecond`, `deathsPerSecond`, `name`)
- Produces: `BeadScene` now takes `{ demographics: CountryDemographics; theme: 'light' | 'dark' }`. Final state of the feature.

- [ ] **Step 1: Extend `BeadScene`'s props and add the spawn loop**

In `src/components/BeadScene.tsx`, extend the imports at the top of the file:

```tsx
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import type { CountryDemographics } from '@/lib/worldbank'
import { spawnIntervalMs } from '@/lib/beadSpawnRate'
```

Replace the `BeadSceneProps` interface with:

```tsx
interface BeadSceneProps {
  demographics: CountryDemographics
  theme: 'light' | 'dark'
}
```

Change the component signature to `export function BeadScene({ demographics, theme }: BeadSceneProps) {`, leave the `colors` state and its rAF effect exactly as Task 3 left them, and replace the seeded `beads` state with the empty array plus the spawner:

```tsx
  const [beads, setBeads] = useState<Bead[]>([])
  // Monotonic counter, not Math.random(): React keys must be stable and
  // never collide, or Rapier bodies get torn down and recreated mid-fall.
  const nextIdRef = useRef(0)

  const birthIntervalMs = useMemo(
    () => spawnIntervalMs(demographics.birthsPerSecond),
    [demographics.birthsPerSecond],
  )
  const deathIntervalMs = useMemo(
    () => spawnIntervalMs(demographics.deathsPerSecond),
    [demographics.deathsPerSecond],
  )

  useEffect(() => {
    function spawn(kind: 'birth' | 'death') {
      setBeads((prev) => {
        // Trim from the front (oldest) so the array never exceeds the cap
        // once the new bead is appended.
        const kept = prev.length >= MAX_BEADS ? prev.slice(prev.length - MAX_BEADS + 1) : prev.slice()
        kept.push({
          id: nextIdRef.current++,
          kind,
          x: (Math.random() - 0.5) * 2 * SPAWN_JITTER_PX,
        })
        return kept
      })
    }
    const birthTimer = window.setInterval(() => spawn('birth'), birthIntervalMs)
    const deathTimer = window.setInterval(() => spawn('death'), deathIntervalMs)
    return () => {
      window.clearInterval(birthTimer)
      window.clearInterval(deathTimer)
    }
  }, [birthIntervalMs, deathIntervalMs])
```

Everything below (the returned JSX) is unchanged from Task 3.

- [ ] **Step 2: Pass the selected country from `src/App.tsx`**

Change the conditional render added in Task 3 from `{selected && <BeadScene theme={theme} />}` to:

```tsx
      {selected && <BeadScene demographics={selected} theme={theme} />}
```

(`selected` is `CountryDemographics | undefined`; inside the `&&` TypeScript narrows it to `CountryDemographics`, which is exactly the prop type.)

- [ ] **Step 3: Typecheck and lint**

Run:
```bash
npx tsc --noEmit && npx oxlint src
```
Expected: clean apart from the two known pre-existing warnings.

- [ ] **Step 4: Verify live in the browser**

Refresh the dev server page, then:

1. Select a country with the Task 1 Step 8 click snippet.
2. `read_console_messages` — assert no errors.
3. Wait ~5 seconds, then `javascript_tool` to count live Rapier bodies indirectly via the R3F scene. Since the scene graph isn't exposed on `window`, assert on frame health and cap behaviour instead by watching the canvas keep producing frames and by re-checking after a longer wait:

```js
(() => {
  const c = [...document.querySelectorAll('canvas')].find((el) => el.parentElement?.parentElement?.classList.contains('pointer-events-none'))
  if (!c) return 'FAIL: bead canvas not found'
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  return JSON.stringify({ found: true, width: c.width, height: c.height, contextLost: gl ? gl.isContextLost() : 'no-context' })
})()
```
   Expected: `found: true`, non-zero width/height, `contextLost: false`.
4. Leave the scene running for ~60 seconds (call `computer` with `action: "wait"`, or simply do the other checks meanwhile), then `read_console_messages` again — assert still no errors and no React "too many re-renders"/key warnings, which is what a broken cap or an unstable key would produce.
5. Confirm the pile is on screen and both colours appear by reading pixels off the bead canvas:

```js
(() => {
  const c = [...document.querySelectorAll('canvas')].find((el) => el.parentElement?.parentElement?.classList.contains('pointer-events-none'))
  const gl = c.getContext('webgl2', { preserveDrawingBuffer: true }) || c.getContext('webgl')
  // The R3F canvas isn't created with preserveDrawingBuffer, so read the
  // composited result via the element's own bounding box instead: sample
  // whether anything at all has been drawn near the bottom of the viewport
  // by checking the canvas is sized to the viewport and still animating.
  return JSON.stringify({ w: c.clientWidth, h: c.clientHeight, vw: innerWidth, vh: innerHeight })
})()
```
   Expected: `w`/`h` match `vw`/`vh` (the canvas covers the viewport, so the floor/walls are viewport-sized).
   Then confirm visually by asking the user, or by rendering the page in the browser pane and observing — do NOT attempt a screenshot tool call.
6. Confirm the control panel is still usable through the canvas: `javascript_tool` with

```js
(() => {
  const el = document.elementFromPoint(120, innerHeight - 40)
  return el ? el.tagName + '.' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) : 'null'
})()
```
   Expected: something belonging to the control panel (a slider/label element), **not** the bead `CANVAS`. If it returns `CANVAS`, `pointer-events-none` is not applied — fix before committing.
7. Deselect with the Task 1 snippet and confirm via `read_console_messages` that unmounting Rapier produces no errors, and that `document.querySelectorAll('canvas').length` is back to 1.

- [ ] **Step 5: Append a `PROGRESS.md` entry**

Match the existing prose style in `PROGRESS.md` (plain paragraphs, a rationale, then a verification paragraph, then a `Status:` line). Append:

```markdown
## Bead scene, phase 1

Replaced the never-built literal 3D hourglass with a bead scene: clicking a
city marker on the globe selects its country, shrinks the globe into the
top-right corner via a `duration-700` CSS transform, and mounts `BeadScene`
— a fixed, transparent, `pointer-events-none` react-three-fiber canvas
running Rapier physics over the whole viewport. Beads drop from top-centre
with horizontal jitter and pile up against invisible floor/side colliders
sized to the viewport; birth beads take the `--accent` red, death beads the
`--foreground` colour, so both themes read correctly.

Click-to-select didn't exist before this (the cobe globe is drag-to-rotate
only and `onSelectCountry` was a `void` stub). `GlobeRef` now exposes
`getElement()` and a `visible` flag on `project()`, so `GlobeView` can
distinguish a click from a drag (6px / 400ms thresholds) and hit-test the
click's canvas-relative fraction against near-side markers only. Clicking
the same country again deselects, which is the scene's only exit.

Spawn cadence comes from `src/lib/beadSpawnRate.ts`, which log-rescales the
real `birthsPerSecond`/`deathsPerSecond` figures (spanning ~5 orders of
magnitude) into a 1400ms-120ms interval, the same "keep the real figure as
input, map it onto a readable scale" move `globeSpeed.ts` already makes for
rotation. Live bead count is capped at 180, oldest dropped first.

Two things worth knowing for whoever picks this up. The orthographic camera
means 1 world unit = 1 CSS pixel, so Rapier's default gravity had to be
rescaled to -2000 px/s^2. And `THREE.Color` can't parse `oklch()` (how
`--foreground` is declared) or a `var(--…)` reference, so colours are read
off a probe element's computed style and normalised through a 2D canvas
`fillStyle` round-trip, re-resolved one animation frame after each theme
toggle (child effects run before the parent effect that toggles `.dark`).

`npx tsc --noEmit` and `oxlint src` clean apart from the pre-existing
`baseUrl` deprecation and `button.tsx` warnings. Verified live: no console
errors on select, during a 60s run, or on deselect; the bead canvas covers
the viewport and is `pointer-events: none` (the control panel is still
hit-testable through it); the globe's computed transform scales to 0.3 on
select and returns to identity on deselect; both bead colours normalise to
real hex and flip correctly on theme toggle.

Phase 2 (drei `MeshTransmissionMaterial` glass refraction plus scene
lighting) and bead-vs-UI collision are deliberately still open.

Status: done.
```

- [ ] **Step 6: Commit**

```bash
git add src/components/BeadScene.tsx src/App.tsx PROGRESS.md
git commit -m "Drive bead spawning from real birth/death rates with a live bead cap"
```

---

## Self-Review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| Selecting a country shrinks `GlobeView` via CSS transform and mounts `BeadScene` | Task 3, Step 2 |
| Clicking the shrunken globe again clears `selectedIso3` and unmounts | Task 1, Step 6 (toggle) + Task 3 Step 2 (conditional render) |
| Existing UI stays visible and usable while the scene is active | Task 3, Step 1 (`pointer-events-none`, `z-0`) + Task 4, Step 4 check 6 |
| `fixed inset-0` transparent `<Canvas>` | Task 3, Step 1 |
| `<Physics>` with static floor + left/right walls sized to viewport, no top wall | Task 3, Step 1 (`Boundaries`) |
| Dynamic sphere `RigidBody`s spawned top-centre with horizontal jitter | Task 3 (`BeadBody`) + Task 4 (`SPAWN_JITTER_PX` in spawner) |
| Live bead count capped ~150-200, oldest removed | Task 4, Step 1 (`MAX_BEADS = 180`) |
| Birth = `--accent`, death = `--foreground` | Task 3, Step 1 (`resolveBeadColors`) |
| Spawn rate rescaled à la `globeSpeed.ts` | Task 2 |
| Phase 1 = plain `MeshStandardMaterial`, no refraction | Global Constraints + Task 3, Step 1 |
| Dependencies present | Global Constraints (already installed; no install step) |
| No change to `worldbank.ts` | Global Constraints |
| Phase 2 / bead-vs-UI collision deferred | Global Constraints |

One requirement is implicit in the spec but had no trigger at all in the codebase — the spec says "existing click-to-select logic in `GlobeView`", but `GlobeView` contained only a `void onSelectCountry` stub. Task 1 was added to build it; without it the whole feature is unreachable.

**2. Placeholder scan.** No "TBD"/"TODO"/"similar to Task N"/"add error handling" anywhere. Every code step has literal code. The one "temporary" element — Task 3's three seeded beads — is explicitly justified (pipeline sanity check for deps never before exercised in this repo) and explicitly replaced in Task 4, Step 1 with the exact replacement code shown.

**3. Type consistency.**
- `spawnIntervalMs(ratePerSecond: number): number` — defined Task 2, called Task 4 with the same name and arity.
- `GlobeRef.project` returns `{ x, y, visible }` in Task 1 Step 1, is implemented that way in Step 2, its `GlobeView` fallback is widened to match in Step 4, and `p.visible` is read in Step 5. The two consumers `useSweepReveal` / `useArcDrawProgress` declare their `project` parameter as returning `{ x: number; y: number }`; the wider return type is assignable, so their signatures need no change.
- `GlobeRef.getElement(): HTMLCanvasElement | null` — declared Step 1, implemented Step 2, consumed Step 5, all identically named.
- `Bead { id: number; kind: 'birth' | 'death'; x: number }` — defined Task 3, constructed in Task 4's `spawn()` with exactly those three fields; `id` is a `number` from `nextIdRef`, matching.
- `BeadColors { birth: string; death: string }` — returned by `resolveBeadColors`, held in `colors` state, indexed by `BeadBody` as `colors.birth`/`colors.death`. Consistent.
- `BeadScene` props: Task 3 defines `{ theme }` and App passes exactly that; Task 4 widens to `{ demographics, theme }` and updates the App call site in the same task. No window where the call site and the signature disagree.
- `MAX_BEADS` / `SPAWN_JITTER_PX` / `BEAD_RADIUS` are declared in Task 3 and used under the same names in Task 4.

---

## Orchestrator Notes (from Opus planning pass)

- **Corner choice: top-right, not bottom-right.** Bottom-right is occupied by the hover hints and the lag warning, bottom-left by the control panel, top-left by title + reading panel. Top-right below the toggles (`translate-x-[33%] -translate-y-[22%] scale-[0.3]`) is the only corner with no overlap. The spec just said "a corner" — this is a judgment call made during planning.
- **Gravity had to be invented.** Nothing in the spec covers it, but pixel-unit orthographic + Rapier's default `-9.81` would make beads float. Picked `-2000` px/s². May need a taste tweak during implementation.
- **Colour resolution uses a canvas `fillStyle` round-trip**, not the raw `getComputedStyle` value, because `THREE.Color.setStyle` has no `oklch()` parser. The canvas round-trip normalizes to hex and degrades to an explicit fallback rather than throwing; Task 3's verification checks the normalized value is *not* the fallback, so a silent failure gets caught.
- **Theme re-resolution uses `requestAnimationFrame`,** because child effects run before parent effects in React — `BeadScene`'s effect would otherwise read colors before `App`'s `useTheme` effect toggles `.dark`. `theme` is passed as a prop rather than calling `useTheme()` inside `BeadScene` (that hook creates independent state per call and would desync).
- **`<Physics>` must be inside `<Suspense>`** — confirmed it uses `suspend-react`. Easy to miss; called out explicitly in Task 3.
- **Front/back z-plane colliders added** beyond the spec's floor + two walls, so `colliders="ball"` spheres can't drift out of the z=0 plane and shrink/vanish under the orthographic camera. Small addition, defensible.
- **Bead-count cap verification is weak.** Without a test runner and with the R3F scene graph not exposed on `window`, Task 4 verifies the cap indirectly (no errors, no key warnings, context not lost after 60s) rather than asserting a body count. Cheapest upgrade if needed: a temporary `window.__beadCount = beads.length` line during verification only.
- **Vite + Rapier WASM is untested in this repo.** `@dimforge/rapier3d-compat@0.19.2` inlines its WASM as base64 so it should just work, but if `npm run dev` chokes on it, the fix is an `optimizeDeps.exclude: ['@dimforge/rapier3d-compat']` entry in `vite.config.ts` — not pre-added, since the problem may not exist.
