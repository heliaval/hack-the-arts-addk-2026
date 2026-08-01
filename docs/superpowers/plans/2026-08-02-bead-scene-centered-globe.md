# Centered Globe + Bead Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a country no longer shrinks the globe into a corner — the globe stays centered and full-size, beads grow to ~2.4x their old radius, and an invisible static sphere collider matched to the globe's rendered circle makes the beads bounce off it and pile up around it.

**Architecture:** `cobe-globe.tsx` gains a `getCircle()` ref method returning the globe's rendered circle in viewport CSS pixels — crucially using the fact that cobe's sphere occupies only 80% of its square canvas (silhouette radius = `0.4 × canvas width`), which the file's own `projectMarker` math already encodes as the literal `0.8`. `GlobeView` observes that canvas with a `ResizeObserver` + window `resize` listener and reports the circle upward through a new `onCircleChange` prop; `App` holds it in state and hands it to `BeadScene`, which converts it into its own pixel-unit world space (`worldX = centerX - viewportWidth/2`, `worldY = viewportHeight/2 - centerY`) and mounts a fixed `RigidBody` + `BallCollider` there. `BEAD_RADIUS` goes 14 → 34, with `MAX_BEADS` and `SPAWN_JITTER_PX` rescaled to match.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, `@react-three/fiber@9.7.0`, `@react-three/rapier@2.2.0` (`@dimforge/rapier3d-compat@0.19.2`), `three@0.185.1`, `cobe@2.0.1`.

## Global Constraints

- **No new npm packages.** Everything needed is already installed. Never run `npm install <pkg>`.
- **No test framework exists in this repo.** `package.json` scripts are only `dev` / `build` / `lint` / `preview`; `lint` is `oxlint`. Do NOT write Jest/Vitest tests or reference a test runner. Verification is: `npx tsc --noEmit`, `npx oxlint src`, and live browser-pane checks.
- **Screenshots do not work in this sandbox, and rendered pixel quality cannot be judged.** Verify with `read_console_messages`, `get_page_text`, and `javascript_tool` only. Never call the screenshot action. WebGL canvases in this pane can also get stuck at a stale intrinsic size because `ResizeObserver` does not fire while the pane is unfocused — do not treat a stale canvas size as a code bug without corroborating evidence.
- **Known pre-existing noise to ignore when judging "clean":** `npx tsc --noEmit` emits a `baseUrl` deprecation warning; `npx oxlint src` emits one warning in `src/components/ui/button.tsx`. Both predate this work. Anything else is a regression.
- **Must not change:** the click-to-select/toggle mechanic; bead colors; `spawnIntervalMs` / `birthsPerSecond` / `deathsPerSecond` spawn-rate logic; the `resolveBeadColors` / `normalizeCssColor` color-resolution strategy (deliberately not using CSS variables in three.js materials — keep it); the `key={selectedIso3}` remount-on-country-switch on `<BeadScene>`; `pointer-events: none` on `BeadScene`'s canvas.
- **Still out of scope:** glass/refraction materials (`MeshTransmissionMaterial`), and physical collision between beads and the HTML UI panels. Beads still render behind every `z-10`/`z-20` panel.
- The dev server is launched via the browser pane with `preview_start({ name: "hourglass-earth-dev" })` (already in `.claude/launch.json`, port 5173). Do not start servers with Bash.

---

### Task 1: Stop shrinking the globe, and publish its on-screen circle

**Files:**
- Modify: `src/components/ui/cobe-globe.tsx` (the `GlobeRef` interface at lines 48-59; `projectMarker` at lines 67-76; the ripple radius at line 469; the `useImperativeHandle` at lines 588-604)
- Modify: `src/components/GlobeView.tsx` (the `GlobeViewProps` interface at lines 9-15; the component signature at lines 499-505; the stale shrink comment at lines 591-594; a new effect before the `return`)
- Modify: `src/App.tsx` (state block around line 280; the globe wrapper + `BeadScene` render at lines 347-365; the stale `handleSelectCountry` comment at lines 317-320)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export const GLOBE_SURFACE_RADIUS_FRACTION: number` from `src/components/ui/cobe-globe.tsx` (value `0.4`)
  - `export interface GlobeCircle { centerX: number; centerY: number; radius: number }` from `src/components/ui/cobe-globe.tsx`
  - `GlobeRef.getCircle(): GlobeCircle | null`
  - `GlobeViewProps.onCircleChange: (circle: GlobeCircle | null) => void`
  - `App`'s `globeCircle: GlobeCircle | null` state — Task 3 passes this to `BeadScene`.

**Background the implementer needs:**

The cobe sphere does **not** fill its square canvas. `cobe-globe.tsx`'s `projectMarker` (line 73) places a surface marker at radius `0.8 + elevation` in cobe's own projection space, and `project` (line 102) maps that space's `[-1, 1]` onto the canvas box's `[0, 1]`. So the globe's rendered silhouette radius is `0.8 / 2 = 0.4` of the canvas box — there is a ~10% margin on every side. Assuming the sphere fills its canvas would make the physics collider ~25% too big and beads would visibly float off the globe's edge.

- [ ] **Step 1: Name the 0.8 base radius in `src/components/ui/cobe-globe.tsx`**

Insert immediately above `function projectMarker(` (currently line 67):

```ts
// cobe draws the globe's surface at radius 0.8 in the same projection space
// project() below maps onto the canvas box's 0-1 range via (c + 1) / 2 — so
// the rendered sphere's silhouette radius is 0.8 / 2 = 0.4 of the canvas
// box, NOT 0.5. There is a ~10% margin on every side. Anything outside this
// file that needs to know where the globe physically is on screen (the bead
// scene's collider, for one) must use GLOBE_SURFACE_RADIUS_FRACTION rather
// than assuming the sphere fills its square canvas.
const GLOBE_BASE_RADIUS = 0.8
export const GLOBE_SURFACE_RADIUS_FRACTION = GLOBE_BASE_RADIUS / 2

/** The globe's rendered circle in viewport CSS pixels — the same coordinate
 * space getBoundingClientRect() reports in, with the origin at the viewport's
 * top-left. */
export interface GlobeCircle {
  centerX: number
  centerY: number
  radius: number
}
```

Then replace the body's first line of `projectMarker` (currently line 73):

```ts
  const r = GLOBE_BASE_RADIUS + elevation
```

and the identical literal inside `updateRipples` (currently line 469):

```ts
          const r = GLOBE_BASE_RADIUS + markerElevation
```

Leave `project()`'s `c * c + s * s >= 0.64` visibility test alone — `0.64` is `GLOBE_BASE_RADIUS ** 2` but it lives in a squared-distance comparison and rewriting it adds noise, not clarity.

- [ ] **Step 2: Add `getCircle()` to `GlobeRef` in the same file**

Append this member to the `GlobeRef` interface (currently lines 48-59), after `getElement()`:

```ts
  /** The globe's rendered circle in viewport CSS pixels. Null before the
   * canvas has been laid out (zero-sized). The radius is derived from
   * GLOBE_SURFACE_RADIUS_FRACTION, not from half the canvas box — the
   * sphere does not fill its canvas. */
  getCircle(): GlobeCircle | null
```

and implement it in the `useImperativeHandle` (currently lines 588-604), after `getElement`:

```ts
      getCircle() {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return null
        // The canvas box is aspect-square, so width and height agree; min()
        // is just insurance against a transient non-square layout pass.
        return {
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          radius: Math.min(rect.width, rect.height) * GLOBE_SURFACE_RADIUS_FRACTION,
        }
      },
```

- [ ] **Step 3: Report the circle upward from `src/components/GlobeView.tsx`**

Change the import on line 2 to bring the new type along:

```ts
import { Globe, type GlobeCircle, type GlobeRef } from '@/components/ui/cobe-globe'
```

Add the prop to `GlobeViewProps` (currently lines 9-15), after `onSelectCountry`:

```ts
  /** Called whenever the globe's on-screen circle changes (mount, resize).
   * BeadScene needs it to place a physics collider over the globe. Pass a
   * stable reference — a plain useState setter is ideal — or this
   * component's React.memo stops working. */
  onCircleChange: (circle: GlobeCircle | null) => void
```

and to the destructured signature (currently lines 499-505):

```ts
export const GlobeView = memo(function GlobeView({
  demographics,
  lang,
  onSelectCountry,
  onCircleChange,
  cityCount,
  rotationSpeedKmS,
}: GlobeViewProps) {
```

Then add this effect immediately after `handlePointerUp` and before the `return`:

```ts
  // The globe canvas is responsive (aspect-square, w-full, capped at
  // min(80vh, 48rem)), so its on-screen circle changes with the viewport.
  // A resize-triggered recalculation is enough — page layout is otherwise
  // static, so the circle does not move between resizes, and re-measuring
  // per frame would force a layout flush every frame for a value that never
  // changes. ResizeObserver alone would do it in a normal browser; the
  // window listener is a cheap belt-and-braces fallback for environments
  // where the observer is throttled or suppressed (headless/unfocused
  // panes). Both funnel through the same dedupe so App only re-renders on
  // an actual change.
  useEffect(() => {
    const canvas = globeRef.current?.getElement()
    if (!canvas) return
    let last = ''
    function report() {
      const circle = globeRef.current?.getCircle() ?? null
      const key = circle ? `${circle.centerX}|${circle.centerY}|${circle.radius}` : 'null'
      if (key === last) return
      last = key
      onCircleChange(circle)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(canvas)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [onCircleChange])
```

Finally, correct the now-false comment inside `handlePointerUp` (currently lines 591-594) — the globe no longer transforms:

```ts
    // Same 0-1 canvas-box fraction space that GlobeRef.project() returns.
    // getBoundingClientRect is used (rather than the canvas's intrinsic
    // size) so this stays correct under device pixel ratio and any future
    // CSS sizing of the globe wrapper.
```

- [ ] **Step 4: Remove the shrink and hold the circle in `src/App.tsx`**

Add the type import alongside the existing component imports near the top:

```ts
import type { GlobeCircle } from '@/components/ui/cobe-globe'
```

Add the state next to `selectedIso3` (currently line 280):

```ts
  const [globeCircle, setGlobeCircle] = useState<GlobeCircle | null>(null)
```

(`setGlobeCircle` is a stable useState setter, so it can be passed straight to `GlobeView` without breaking its `React.memo`.)

Replace the stale comment above `handleSelectCountry` (currently lines 317-320) with:

```ts
  // Clicking the already-selected country deselects it — that's the only
  // exit from the bead scene, per the design: symmetric in/out, no separate
  // close control. No `demographics` dependency, so this reference is
  // stable for GlobeView's React.memo.
```

Then replace the whole globe wrapper block (currently lines 347-365) with:

```tsx
      {/* The globe stays centered and full-size while a country is selected
          — it IS the obstacle the beads fall onto (see BeadScene's
          GlobeCollider), so it must never move or shrink out from under the
          physics collider that mirrors it. */}
      <div className="absolute inset-0">
        <GlobeView
          demographics={demographics.data}
          lang={lang}
          onSelectCountry={handleSelectCountry}
          onCircleChange={setGlobeCircle}
          cityCount={cityCount}
          rotationSpeedKmS={rotationSpeedKmS}
        />
      </div>
      {selected && <BeadScene key={selectedIso3} demographics={selected} theme={theme} />}
```

`globeCircle` is deliberately unused for one task — Task 3 wires it into `BeadScene`. TypeScript will not complain about an unused state variable, but if `oxlint` does, leave it and fix it in Task 3 rather than deleting the state.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit && npx oxlint src
```

Expected: clean apart from the two known pre-existing warnings (see Global Constraints).

- [ ] **Step 6: Verify the geometry live in the browser**

Start the dev server: `preview_start({ name: "hourglass-earth-dev" })`. Wait for label pills to fade in (~1.5s).

First confirm the globe no longer transforms and the reported circle is viewport-centered — `javascript_tool`:

```js
(() => {
  const cobe = [...document.querySelectorAll('canvas')].find(
    (c) => c.style.cursor === 'grab' || c.style.cursor === 'grabbing',
  )
  if (!cobe) return 'FAIL: cobe canvas not found'
  const r = cobe.getBoundingClientRect()
  const wrapper = cobe.closest('.absolute.inset-0')
  return JSON.stringify({
    box: [Math.round(r.width), Math.round(r.height)],
    center: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
    viewportCenter: [Math.round(innerWidth / 2), Math.round(innerHeight / 2)],
    expectedRadius: Math.round(Math.min(r.width, r.height) * 0.4),
    wrapperTransform: wrapper ? getComputedStyle(wrapper).transform : 'no wrapper',
  })
})()
```

Expected: `box` is square; `center` matches `viewportCenter` within ~2px; `wrapperTransform` is `"none"` (or an identity matrix) — **not** a 0.3-scale matrix.

Now confirm the `0.4` fraction empirically. City markers sit exactly on the globe's surface, so as the globe rotates their projected distance from the canvas center approaches — but never exceeds — the silhouette radius. Start a sampler (`javascript_tool`):

```js
(() => {
  const cobe = [...document.querySelectorAll('canvas')].find((c) => c.style.cursor === 'grab')
  if (!cobe) return 'FAIL: cobe canvas not found'
  const r = cobe.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  window.__probe = { max: 0, done: false }
  const t0 = performance.now()
  ;(function tick() {
    for (const el of document.querySelectorAll('div[style*="translate(-50%"]')) {
      if (el.style.opacity !== '1') continue
      const b = el.getBoundingClientRect()
      // LabelPill is translate(-50%, calc(-100% - 10px)) from its marker
      // anchor, so the marker dot is 10px below the pill's bottom edge.
      const d = Math.hypot(b.left + b.width / 2 - cx, b.bottom + 10 - cy)
      if (d / r.width > window.__probe.max) window.__probe.max = d / r.width
    }
    if (performance.now() - t0 < 10000) requestAnimationFrame(tick)
    else window.__probe.done = true
  })()
  return 'sampling for 10s'
})()
```

Then wait (`computer` with `action: "wait"`, ~11s) and read it back:

```js
JSON.stringify(window.__probe)
```

Expected: `done: true` and `max` in the range **0.36 – 0.41**. A value near 0.5 means the `0.4` fraction is wrong and `GLOBE_SURFACE_RADIUS_FRACTION` must be corrected before Task 3 — do not proceed. (A value well below 0.36 just means no marker happened to swing near the limb during the sample; re-run the sampler for another 10s before concluding anything.)

Finally, `read_console_messages` — assert no errors, and specifically no `ResizeObserver loop` warnings (which would mean the report/setState cycle is re-triggering layout).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/cobe-globe.tsx src/components/GlobeView.tsx src/App.tsx
git commit -m "Keep the globe centered on selection and publish its on-screen circle"
```

---

### Task 2: Scale the beads up

**Files:**
- Modify: `src/components/BeadScene.tsx` (constants at lines 14-21; `sphereGeometry` args at line 133)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `BEAD_RADIUS = 34`, `MAX_BEADS = 70`, `SPAWN_JITTER_PX = 200` in `src/components/BeadScene.tsx`. Task 3 reads `BEAD_RADIUS` for its verification assertion.

**Background the implementer needs:**

Bead area scales with the square of the radius. Going 14 → 34 makes each bead **5.9x** larger in screen area, and the globe (Task 1) now permanently occupies a disc of roughly 200,000 px² in the middle of a ~1,000,000 px² viewport. The old 180-bead cap covered about 12% of the viewport; at r=34, matching that coverage would take only ~31 beads, which reads as a scatter rather than a pile. 70 covers roughly 28% of the area the globe leaves free — a pile that visibly fills the two lanes beside the globe without climbing past the spawn point or overrunning the whole screen.

`SPAWN_JITTER_PX` widens by the same ratio as the radius (90 × 34/14 ≈ 200) so consecutive spawns are no more likely to interpenetrate at birth than before. 200 also stays inside the globe's on-screen radius at common viewport sizes (a 1280×800 viewport gives a 640px canvas → a 256px globe radius), so most beads land on the globe rather than bypassing it.

Everything else in the file already derives from `BEAD_RADIUS` and needs no edit — verify this yourself before assuming it: the spawn height is `height / 2 + BEAD_RADIUS * 2` (line 127), and the front/back z-plane colliders sit at `±(BEAD_RADIUS + half)` (lines 107, 110), which puts their inner faces exactly `BEAD_RADIUS` from the origin and therefore pins every bead's center to `z = 0` at any radius. The floor and side walls are sized from `WALL_THICKNESS` and the viewport only, which is correct — they do not scale with bead size.

- [ ] **Step 1: Update the constants**

In `src/components/BeadScene.tsx`, replace lines 14-21 (`const BEAD_RADIUS = 14` through `export const MAX_BEADS = 180`) with:

```ts
const BEAD_RADIUS = 34
const WALL_THICKNESS = 40
// Half-width of the horizontal band beads spawn across. Without jitter
// every bead would stack in one perfect column. Scaled with BEAD_RADIUS
// (was 90 at r=14) so consecutive spawns are no more likely to overlap at
// birth than before, and kept below the globe's typical on-screen radius
// (a 1280x800 viewport gives a 640px globe canvas => a 256px sphere) so
// most beads land ON the globe rather than falling past it.
export const SPAWN_JITTER_PX = 200
// Live bead cap. Past this, the oldest bead is dropped as each new one
// spawns, so performance stays bounded however long the scene stays open.
// Bead area scales with the square of the radius, so 14 -> 34 makes each
// bead 5.9x larger on screen; the old cap of 180 would bury the viewport.
// The previous 180-at-r=14 pile covered ~12% of the screen — matching that
// coverage would take only ~31 beads, which reads as a scatter, not a pile.
// 70 covers roughly 28% of the area the (now permanently centered) globe
// leaves free, filling the lanes either side of it without climbing back up
// to the spawn point.
export const MAX_BEADS = 70
```

- [ ] **Step 2: Raise the sphere tessellation**

At r=34 a 20-segment sphere reads as visibly faceted. Replace line 133:

```tsx
        <sphereGeometry args={[BEAD_RADIUS, 32, 32]} />
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit && npx oxlint src
```

Expected: clean apart from the two known pre-existing warnings.

- [ ] **Step 4: Verify live in the browser**

Refresh the dev server page. Select a country by dispatching a click at a visible marker (`javascript_tool`):

```js
(() => {
  const pills = [...document.querySelectorAll('div[style*="translate(-50%"]')]
    .filter((el) => el.style.opacity === '1')
  if (!pills.length) return 'FAIL: no visible label pill yet'
  const r = pills[0].getBoundingClientRect()
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

Confirm with `get_page_text` that the word `reading` now appears. Wait ~30 seconds, then `read_console_messages` — assert no errors and no React key warnings. Then confirm the bead canvas is alive and still click-through (`javascript_tool`):

```js
(() => {
  const c = [...document.querySelectorAll('canvas')].find((el) => el.style.cursor !== 'grab')
  if (!c) return 'FAIL: bead canvas not found'
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  const hit = document.elementFromPoint(120, innerHeight - 40)
  return JSON.stringify({
    contextLost: gl ? gl.isContextLost() : 'no-context',
    canvasCoversViewport: c.clientWidth === innerWidth && c.clientHeight === innerHeight,
    elementUnderControlPanel: hit ? hit.tagName : 'null',
  })
})()
```

Expected: `contextLost: false`, `canvasCoversViewport: true`, and `elementUnderControlPanel` is **not** `"CANVAS"` (the control panel must stay hit-testable through the bead canvas).

- [ ] **Step 5: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "Scale beads to 34px radius and rebalance the cap and spawn spread"
```

---

### Task 3: Give the globe a physics collider

**Files:**
- Modify: `src/components/BeadScene.tsx` (imports at lines 1-5; a new `GlobeCollider` component; `BeadSceneProps` at lines 144-147; the component signature at line 149; the stale wrapper comment at lines 198-210; the `<Physics>` children at lines 221-226)
- Modify: `src/App.tsx` (the `<BeadScene ... />` element)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: `GlobeCircle` from `src/components/ui/cobe-globe.tsx` and `App`'s `globeCircle: GlobeCircle | null` state (Task 1); `BEAD_RADIUS` and `MAX_BEADS` from `src/components/BeadScene.tsx` (Task 2).
- Produces: `BeadScene` now takes `{ demographics: CountryDemographics; theme: 'light' | 'dark'; globeCircle: GlobeCircle | null }`. Final state of the feature.

**Background the implementer needs — read all three points before writing code:**

1. **Coordinate conversion.** `BeadScene`'s `<Canvas orthographic>` has no manual frustum override, so react-three-fiber sizes the frustum to the canvas's CSS pixel dimensions: 1 world unit = 1 CSS pixel, origin at the canvas's own center, +y up, +x right. The canvas is `fixed inset-0`, so its center is the viewport's center. `GlobeCircle` is in viewport coordinates from `getBoundingClientRect()` (origin top-left, +y down). Therefore `worldX = centerX - viewportWidth / 2` and `worldY = viewportHeight / 2 - centerY`. Get the viewport dimensions from `useThree((state) => state.size)`, not `window.innerWidth` — that is the size R3F actually built the frustum from, so the two can never disagree.

2. **A true `BallCollider`, not a flat disc or box.** The globe is drawn on a flat 2D canvas, but the existing `Boundaries` front/back z-plane colliders pin every bead's *center* to exactly `z = 0` (their inner faces sit at `±BEAD_RADIUS`, and a bead of radius `BEAD_RADIUS` touching one has its center at `0`). A ball collider intersected with the `z = 0` plane is exactly a circle of the same radius — so the sphere gives precisely the circular silhouette the user sees, with correct curved contact normals that let beads roll off the shoulders, and it costs nothing extra over a flattened alternative. It also stays correct if the z-band is ever widened. There is no reason to prefer a cuboid: a box would give beads flat facets and hard corners where the visual has a smooth curve, and this project's whole aesthetic is the mechanism matching the visual.

3. **Rapier reads `position` and collider `args` at body/collider creation time.** Resizing the window changes both. Give the `RigidBody` a `key` derived from the rounded values so a resize cleanly recreates it rather than relying on `@react-three/rapier` to diff collider shape arguments in place. Resizes are rare, so the remount cost is irrelevant.

- [ ] **Step 1: Add the collider component to `src/components/BeadScene.tsx`**

Extend the imports at the top of the file:

```tsx
import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { BallCollider, CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import type { CountryDemographics } from '@/lib/worldbank'
import type { GlobeCircle } from '@/components/ui/cobe-globe'
import { spawnIntervalMs } from '@/lib/beadSpawnRate'
```

Insert this component immediately after the `Boundaries` function (i.e. after line 115, before the `BeadBody` comment block):

```tsx
// An invisible static sphere standing in for the globe, so beads bounce off
// it and pile up around it instead of passing through the image of it.
//
// The globe is a flat 2D <canvas> (cobe is a shader drawing a sphere
// illusion — there is no 3D mesh to collide with), and it lives in a
// completely separate DOM layer from this physics canvas. So its geometry
// has to be measured on the DOM side and handed across: `circle` is in
// viewport CSS pixels (origin top-left, +y down), which converts into this
// canvas's world space (origin at the viewport's centre, +y up, 1 unit =
// 1 CSS pixel) by the two lines below.
//
// A true BallCollider, not a flattened disc: Boundaries' front/back planes
// already pin every bead's centre to exactly z = 0, and a sphere cut by the
// z = 0 plane IS a circle of the same radius — so this gives exactly the
// silhouette the user sees, with real curved contact normals that let beads
// roll off the shoulders rather than skid down a facet.
//
// Lower friction than the beads' own 0.6 so they actually shed off the
// crown instead of parking on top of it; low restitution so they roll away
// rather than ping across the screen.
function GlobeCollider({ circle }: { circle: GlobeCircle }) {
  const { width, height } = useThree((state) => state.size)
  const x = circle.centerX - width / 2
  const y = height / 2 - circle.centerY
  // Rapier reads position and collider args once, at creation. A window
  // resize moves and resizes the globe, so key the body on those values to
  // force a clean recreate rather than trusting an in-place shape diff.
  return (
    <RigidBody
      key={`${Math.round(x)}:${Math.round(y)}:${Math.round(circle.radius)}`}
      type="fixed"
      colliders={false}
      position={[x, y, 0]}
    >
      <BallCollider args={[circle.radius]} friction={0.3} restitution={0.2} />
    </RigidBody>
  )
}
```

- [ ] **Step 2: Take the circle as a prop and mount the collider**

Replace `BeadSceneProps` (currently lines 144-147) with:

```tsx
interface BeadSceneProps {
  demographics: CountryDemographics
  theme: 'light' | 'dark'
  /** The globe's on-screen circle, measured by GlobeView. Null until the
   * globe canvas has been laid out — the scene simply runs without the
   * globe obstacle until it arrives. */
  globeCircle: GlobeCircle | null
}
```

and the component signature (currently line 149) with:

```tsx
export function BeadScene({ demographics, theme, globeCircle }: BeadSceneProps) {
```

Replace the now-stale wrapper comment (currently lines 198-210, the block starting `// pointer-events-none so the sliders`) with:

```tsx
    // pointer-events-none so the sliders and toggles underneath stay fully
    // usable — and so clicks still reach the globe underneath, which is the
    // scene's only exit (clicking the selected country's marker again).
    // z-0 keeps beads above the globe (earlier in the DOM) but below every
    // z-10/z-20 panel, so the beads read as falling in FRONT of the globe.
    //
    // R3F's <Canvas> unconditionally injects its own wrapper <div> with an
    // inline `pointer-events: auto` (react-three-fiber.esm.js's CanvasImpl,
    // to make sure its own pointer/orbit event handling works by default).
    // That inline style beats our ancestor's `pointer-events-none` class —
    // without overriding it here, this canvas would silently swallow every
    // click over the full viewport, including the globe's own deselect
    // click. Canvas spreads its `style` prop after its own defaults, so this
    // override wins.
```

Then, inside `<Physics>` (currently lines 221-226), add the collider directly after `<Boundaries />`:

```tsx
          <Physics gravity={[0, -GRAVITY_PX_PER_S2, 0]}>
            <Boundaries />
            {globeCircle && <GlobeCollider circle={globeCircle} />}
            {beads.map((bead) => (
              <BeadBody key={bead.id} bead={bead} colors={colors} />
            ))}
          </Physics>
```

- [ ] **Step 3: Pass the circle from `src/App.tsx`**

Change the `BeadScene` render line to:

```tsx
      {selected && (
        <BeadScene
          key={selectedIso3}
          demographics={selected}
          theme={theme}
          globeCircle={globeCircle}
        />
      )}
```

The `key={selectedIso3}` must stay — it is what cleanly resets the bead pile when switching countries.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit && npx oxlint src
```

Expected: clean apart from the two known pre-existing warnings.

- [ ] **Step 5: Add a temporary scene handle for verification**

There is no way to observe Rapier body positions from the page otherwise, and "do the beads actually rest on the globe" is the whole point of this task. Add this prop to the `<Canvas>` element in `BeadScene` — it is **temporary and reverted in Step 7**:

```tsx
      <Canvas
        orthographic
        camera={{ position: [0, 0, 600], zoom: 1, near: 0.1, far: 2000 }}
        style={{ pointerEvents: 'none' }}
        onCreated={(state) => {
          // TEMPORARY verification hook — removed before commit.
          ;(window as unknown as { __beadState?: unknown }).__beadState = state
        }}
      >
```

- [ ] **Step 6: Verify the physics live in the browser**

Refresh the dev server page and select a country with the click-dispatch snippet from Task 2 Step 4. Confirm `reading` appears via `get_page_text`, then wait ~25 seconds (`computer` with `action: "wait"`) so a real pile forms.

`read_console_messages` — assert no errors.

Then `javascript_tool`:

```js
(() => {
  const state = window.__beadState
  if (!state) return 'FAIL: __beadState missing (onCreated hook not applied?)'
  const cobe = [...document.querySelectorAll('canvas')].find((c) => c.style.cursor === 'grab')
  const r = cobe.getBoundingClientRect()
  const gr = Math.min(r.width, r.height) * 0.4
  // Globe centre in BeadScene world space: +y up, origin at viewport centre.
  const gx = r.left + r.width / 2 - state.size.width / 2
  const gy = state.size.height / 2 - (r.top + r.height / 2)
  const BEAD_RADIUS = 34
  let count = 0
  let minGap = Infinity
  let minY = Infinity
  state.scene.traverse((o) => {
    if (!o.isMesh || o.geometry?.type !== 'SphereGeometry') return
    count++
    const e = o.matrixWorld.elements
    const d = Math.hypot(e[12] - gx, e[13] - gy)
    minGap = Math.min(minGap, d - (gr + BEAD_RADIUS))
    minY = Math.min(minY, e[13])
  })
  return JSON.stringify({
    beadCount: count,
    globeRadius: Math.round(gr),
    globeCentre: [Math.round(gx), Math.round(gy)],
    minSurfaceGapPx: Math.round(minGap),
    lowestBeadY: Math.round(minY),
    floorY: Math.round(-state.size.height / 2),
  })
})()
```

Expected, all four together:
- `beadCount` is greater than 0 and **at most 70** (`MAX_BEADS` — this is also the first real proof the cap holds).
- `globeCentre` is approximately `[0, 0]`.
- `minSurfaceGapPx` is **>= -3**. This is the load-bearing assertion: no bead's center is closer to the globe's center than `globeRadius + BEAD_RADIUS`, i.e. nothing has tunneled into or through the globe. A small negative value is normal Rapier contact softness; a value near `-globeRadius` means the collider is missing, mispositioned, or the wrong size.
- `lowestBeadY` is at or just above `floorY` — beads are still reaching the floor, so the globe has not become a lid that suspends the entire pile.

If `minSurfaceGapPx` is deeply negative, print `globeCentre` and `globeRadius` and compare them against Task 1 Step 6's reported circle before changing any physics parameters — the fault is almost certainly the coordinate conversion or a stale `globeCircle`, not Rapier.

Then verify the resize path (`javascript_tool`, then re-run the snippet above after ~10s):

```js
(() => {
  window.dispatchEvent(new Event('resize'))
  return 'resize dispatched'
})()
```

Expected: no console errors, and `globeRadius` / `globeCentre` still agree with the current canvas rect. (In this sandbox the pane may not actually resize; this only proves the listener path does not throw.)

Finally, deselect by re-running the click-dispatch snippet, and confirm via `get_page_text` that `reading` is gone and via `read_console_messages` that unmounting Rapier produced no errors.

- [ ] **Step 7: Remove the temporary verification hook**

Revert Step 5 — the `<Canvas>` element must go back to exactly:

```tsx
      <Canvas
        orthographic
        camera={{ position: [0, 0, 600], zoom: 1, near: 0.1, far: 2000 }}
        style={{ pointerEvents: 'none' }}
      >
```

Re-run `npx tsc --noEmit && npx oxlint src` and confirm `git diff src/components/BeadScene.tsx` contains no `__beadState` or `onCreated`.

- [ ] **Step 8: Append a `PROGRESS.md` entry**

Match the existing prose style (plain paragraphs, rationale, verification paragraph, then a `Status:` line). Append:

```markdown
## Bead scene: centered globe, larger beads

Selecting a country no longer shrinks the globe into the top-right corner.
It stays centered and full-size, and the beads now physically collide with
it — falling onto its crown, rolling off the shoulders, and piling up in the
lanes either side. The old `translate/scale` shrink transform on the globe
wrapper is gone entirely; the wrapper is a plain `absolute inset-0`.

The hard part is that the globe is a flat 2D canvas. cobe is a shader that
draws a sphere illusion; there is no 3D mesh, and it lives in a different
DOM layer from `BeadScene`'s react-three-fiber canvas. So the geometry is
measured on the DOM side and handed across: `cobe-globe.tsx` gained a
`getCircle()` ref method returning the globe's circle in viewport CSS
pixels, `GlobeView` watches the canvas with a `ResizeObserver` plus a window
`resize` listener and reports changes up through a new `onCircleChange`
prop, and `App` holds the result in state and passes it to `BeadScene`,
which converts it into its own pixel-unit world space and mounts a fixed
`RigidBody` + `BallCollider` there. Resize-triggered rather than per-frame:
page layout is otherwise static, so re-measuring every frame would force a
layout flush for a value that never changes.

One detail that would have been an easy silent bug: cobe's sphere does not
fill its square canvas. `projectMarker` places surface markers at radius
`0.8` in a space `project()` maps onto the canvas box's 0-1 range, so the
rendered silhouette radius is `0.4` of the canvas box, not `0.5` — there is
a ~10% margin on every side. That literal is now named
(`GLOBE_SURFACE_RADIUS_FRACTION`) and exported, and it was checked
empirically by sampling how far marker labels swing from the canvas centre
as the globe rotates.

A true `BallCollider` rather than a flattened disc, because `Boundaries`'
front/back planes already pin every bead's centre to exactly `z = 0`, and a
sphere cut by that plane is precisely a circle of the same radius — same
silhouette, but with real curved contact normals so beads shed off the crown
instead of skidding down a facet. Its friction is 0.3 (below the beads' own
0.6) so nothing parks on the apex.

Beads went from 14px to 34px radius, which is 5.9x the screen area each. The
cap came down 180 -> 70 to compensate (matching the old ~12% screen coverage
would have taken only ~31 beads, too sparse to read as a pile; 70 covers
about 28% of what the globe leaves free), and `SPAWN_JITTER_PX` widened
90 -> 200 by the same ratio as the radius, staying inside the globe's typical
on-screen radius so most beads land on it. Sphere tessellation went 20 -> 32
segments, since 20 is visibly faceted at this size. Everything else in the
file already derived from `BEAD_RADIUS` and needed no edit.

`npx tsc --noEmit` and `oxlint src` clean apart from the pre-existing
`baseUrl` deprecation and `button.tsx` warnings. Verified live via a
temporary `onCreated` scene handle (removed before commit): with a settled
pile, no bead's centre came closer to the globe's centre than
`globeRadius + BEAD_RADIUS`, the live bead count stayed at or under 70, and
beads still reached the floor. No console errors on select, during a 25s
run, on a dispatched resize, or on deselect; the control panel is still
hit-testable through the bead canvas.

Status: done.
```

- [ ] **Step 9: Commit**

```bash
git add src/components/BeadScene.tsx src/App.tsx PROGRESS.md
git commit -m "Collide beads with a sphere collider matched to the centered globe"
```

---

## Self-Review

**1. Spec coverage.**

| Requirement | Task |
|---|---|
| Beads 2-3x larger | Task 2, Step 1 (`BEAD_RADIUS` 14 → 34, 2.43x) |
| Globe stays centered, full-size, no shrink | Task 1, Step 4 |
| Beads physically interact with the globe | Task 3, Steps 1-3 |
| How `BeadScene` learns the circle in real time | Task 1, Steps 2-4 (measured DOM-side, pushed down as a prop) |
| Updates on resize; not per-frame | Task 1, Step 3 (`ResizeObserver` + window `resize`, with justification comment) |
| Collider is `type="fixed"` + `BallCollider`, always present while mounted | Task 3, Step 1 |
| Depth question decided and justified | Task 3, Background point 2 (true sphere; the z-band pins beads to `z = 0`, so a sphere's cross-section is exactly the visual circle) |
| Z-order: beads in front of the globe | Task 3, Step 2 (rewritten wrapper comment; `z-0` on a later DOM sibling than the `z-auto` globe wrapper already paints above it — no change needed, verified in the comment) |
| `MAX_BEADS` reconsidered | Task 2, Step 1 (180 → 70, with the area arithmetic) |
| `SPAWN_JITTER_PX` reconsidered | Task 2, Step 1 (90 → 200) |
| Constants that implicitly assume the old radius | Task 2, Background (spawn height and front/back planes both derive from `BEAD_RADIUS`; floor and side walls correctly do not) |
| Must-not-change list | Global Constraints; `key={selectedIso3}` restated explicitly in Task 3 Step 3; `pointerEvents: 'none'` preserved in Task 3 Step 2 and checked in Task 2 Step 4 |

**2. Placeholder scan.** No "TBD"/"TODO"/"similar to Task N"/"add error handling". Every code step contains literal code. The one deliberately temporary edit (Task 3 Step 5's `onCreated` hook) is justified, and its exact removal is Step 7, with a `git diff` check.

**3. Type consistency.**
- `GlobeCircle { centerX: number; centerY: number; radius: number }` — declared in Task 1 Step 1, returned by `getCircle()` in Step 2, is the parameter type of `onCircleChange` in Step 3, the type of App's `globeCircle` state in Step 4, and the `circle` prop of `GlobeCollider` and the `globeCircle` prop of `BeadScene` in Task 3. Same field names throughout.
- `GLOBE_SURFACE_RADIUS_FRACTION` — defined and used inside `cobe-globe.tsx` only; the verification snippets hardcode `0.4` and say so.
- `GlobeRef` gains `getCircle()` alongside the existing `project()`/`getElement()`; both existing members are untouched, so `GlobeView`'s existing `project` callback and `handlePointerUp` keep compiling.
- `onCircleChange` is required (not optional) on `GlobeViewProps`, and `App` is the only call site, updated in the same task — no window where the signature and call site disagree.
- `BEAD_RADIUS` / `MAX_BEADS` / `SPAWN_JITTER_PX` keep their existing names and export status; only values change.

---

## Notes for the orchestrator

- **The `0.4` fraction is my biggest uncertainty.** It follows from `projectMarker`'s `0.8` and `project`'s `(c+1)/2`, and those are load-bearing for label placement that already works — but I could not confirm it against rendered pixels. Task 1 Step 6's marker-swing sampler is the check; if `max` comes back near 0.5, fix the constant before Task 3 or the collider will be ~25% oversized.
- **`MAX_BEADS = 70` and `SPAWN_JITTER_PX = 200` are taste knobs.** The arithmetic is sound but assumes a ~1280×800 viewport. If the pile buries the screen, drop the cap to 50-60; that is a one-line change, not a redesign.
- **I chose push-down (measure in `GlobeView`, prop to `BeadScene`) over `document.querySelector`** because two canvases now coexist and distinguishing them by DOM position is brittle. Cost is one new prop on a memoized component.
- **Z-order needs no code change** — I verified `z-0` on the later DOM sibling already paints above the globe wrapper's `z-auto`. Worth a second look if beads appear behind the globe.
- Beads will now visually cover the globe's HTML label pills. Not addressed; flag it if it looks wrong.
