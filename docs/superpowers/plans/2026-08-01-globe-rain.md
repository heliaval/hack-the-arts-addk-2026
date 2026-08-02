# Ambient Globe Rain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a decorative red, water-like rain effect that runs only while the globe is idle (no country selected), with droplets falling toward the globe, wrapping along its visible silhouette, and continuing off the bottom of the screen.

**Architecture:** A new `GlobeRain` component owns a single 2D `<canvas>` overlay driven by its own `requestAnimationFrame` loop (no second WebGL context). It is mounted by `App` only while no country is selected, mirroring how `BeadScene` is mounted only while one is. A small pool of plain-object "drops" is updated with procedural curve math each frame and drawn imperatively — no per-drop React state or elements.

**Tech Stack:** React 19 + TypeScript, Canvas 2D API, Tailwind for layout/positioning classes only (no drawing is done via CSS). No test framework exists in this repo (confirmed: no `*.test.*` files, no test script in `package.json`) — verification for every task is `npx tsc -b` (type check; `noEmit: true` in `tsconfig.app.json`, safe to run repeatedly) plus `npm run lint`, and the final task is verified live in the browser via the dev server, per this project's established pattern for visual/animation work.

## Global Constraints

- Color must come from the same `--accent` CSS custom property the rest of the app uses (`src/index.css:43` light, `:137` dark) — never a hand-picked hex, so it stays correct across theme flips. Resolve it via the canvas-readback technique already proven in `BeadScene.tsx` (`normalizeCssColor`/`resolveBeadColors`, `BeadScene.tsx:167-197`), not `THREE.Color`'s CSS parser, which cannot parse `oklch()`.
- `GlobeRain` and `BeadScene` must never both be mounted at once — `App.tsx` already enforces this shape for `BeadScene` (`{selected && <BeadScene .../>}`); `GlobeRain` uses the exact inverse condition.
- No changes to `BeadScene.tsx` — a separate, concurrent workstream may be actively modifying that file (fast-fill bead burst, `docs/superpowers/specs/2026-08-01-fast-fill-bead-burst-design.md`). All new code lives in new files; `App.tsx` gets only a minimal, additive change.
- `pointer-events-none` on the canvas and its wrapper, matching `BeadScene`'s wrapper (`BeadScene.tsx:904`) — the rain must never block clicks on the globe or the control panel.

---

### Task 1: Shared accent-color resolver

**Files:**
- Create: `src/lib/resolveAccentColor.ts`

**Interfaces:**
- Produces: `resolveAccentColor(): string` — returns the current `--accent` custom property as a `#rrggbb` hex string, resolved against whatever theme class is currently on `<html>`. Consumed by Task 3.

- [ ] **Step 1: Write the resolver**

```typescript
// src/lib/resolveAccentColor.ts

// THREE.Color and CSS.supports-style parsing cannot handle every value a
// browser might return for a custom property, and reading `--accent`
// (a literal hex in src/index.css) back through getComputedStyle is
// already safe — but painting it onto a 1x1 canvas and reading the
// rasterised pixel back is the one technique that is guaranteed correct
// regardless of how the browser chooses to serialise the color, and it's
// the same technique BeadScene.tsx's normalizeCssColor already relies on
// (see that file's comment for the full rationale). Duplicated here
// (not imported from BeadScene.tsx) so this file has no dependency on a
// component that may be under concurrent, unrelated edits.
function normalizeCssColor(value: string, fallback: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return fallback
  ctx.fillStyle = fallback
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Resolves the current --accent custom property to a #rrggbb hex string,
 * reflecting whichever theme class is on <html> right now. */
export function resolveAccentColor(): string {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return normalizeCssColor(accent, '#912f40')
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/resolveAccentColor.ts
git commit -m "Add shared --accent color resolver for canvas-based effects"
```

---

### Task 2: Drop model and pure update/draw math

**Files:**
- Create: `src/components/GlobeRain.tsx` (this task writes the non-React drop logic at the top of the file; Task 3 adds the component around it)

**Interfaces:**
- Consumes: nothing yet (pure functions, no React).
- Produces (consumed by Task 3):
  - `interface Drop` (fields: `x`, `y`, `speed`, `width`, `length`, `phase`, `wrapAngle`, `wrapSide`)
  - `interface GlobeCircleLike { centerX: number; centerY: number; radius: number }` (structurally compatible with `GlobeCircle` from `cobe-globe.tsx`, declared locally so this file has no import dependency on that module beyond what Task 3 adds)
  - `spawnDropAbove(viewportWidth: number): Drop`
  - `seedDrop(viewportWidth: number, viewportHeight: number, globe: GlobeCircleLike | null): Drop`
  - `updateDrop(drop: Drop, dt: number, globe: GlobeCircleLike | null, viewportWidth: number, viewportHeight: number): void` (mutates `drop` in place)
  - `dropPosition(drop: Drop, globe: GlobeCircleLike | null): { x: number; y: number }`
  - `dropDirection(drop: Drop, globe: GlobeCircleLike | null): { x: number; y: number }` (unit vector, current direction of travel)

- [ ] **Step 1: Write the drop model and math**

```typescript
// src/components/GlobeRain.tsx
import { useEffect, useRef } from 'react'

// Drops respawn this far above/below the viewport rather than exactly at
// its edge, so a drop doesn't visibly pop into existence right at the top
// edge of the screen — it's already off-screen when it (re)starts falling.
const RESPAWN_MARGIN_PX = 60

const MIN_SPEED_PX_S = 220
const MAX_SPEED_PX_S = 420
const MIN_WIDTH_PX = 1.5
const MAX_WIDTH_PX = 3
const MIN_LENGTH_PX = 18
const MAX_LENGTH_PX = 34

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export interface GlobeCircleLike {
  centerX: number
  centerY: number
  radius: number
}

export interface Drop {
  x: number
  y: number
  speed: number
  width: number
  length: number
  phase: 'fall' | 'wrap' | 'release'
  /** Angle in [0, π] around the globe's center, 0 = top (north pole of the
   * visible silhouette), π = bottom. Only meaningful while phase === 'wrap'. */
  wrapAngle: number
  /** Which side of the globe's vertical centerline this drop entered on.
   * Only meaningful while phase === 'wrap'. */
  wrapSide: -1 | 1
}

function randomDrop(x: number, y: number): Drop {
  return {
    x,
    y,
    speed: randomBetween(MIN_SPEED_PX_S, MAX_SPEED_PX_S),
    width: randomBetween(MIN_WIDTH_PX, MAX_WIDTH_PX),
    length: randomBetween(MIN_LENGTH_PX, MAX_LENGTH_PX),
    phase: 'fall',
    wrapAngle: 0,
    wrapSide: 1,
  }
}

/** A fresh drop above the viewport, ready to fall in. Used both for the
 * initial pool (see seedDrop) and to recycle a drop that has fallen past
 * the bottom of the viewport. */
export function spawnDropAbove(viewportWidth: number): Drop {
  const x = Math.random() * viewportWidth
  const y = -RESPAWN_MARGIN_PX - Math.random() * RESPAWN_MARGIN_PX
  return randomDrop(x, y)
}

// Snaps a drop that has just crossed into the globe's circle into the
// 'wrap' phase, deriving wrapAngle/wrapSide from the (x, y) it crossed at.
// y = centerY - radius*cos(angle)  =>  cos(angle) = (centerY - y) / radius
function enterWrap(drop: Drop, x: number, y: number, globe: GlobeCircleLike): void {
  const side: -1 | 1 = x >= globe.centerX ? 1 : -1
  const cosAngle = Math.min(1, Math.max(-1, (globe.centerY - y) / globe.radius))
  drop.phase = 'wrap'
  drop.wrapAngle = Math.acos(cosAngle)
  drop.wrapSide = side
}

function isInsideGlobe(x: number, y: number, globe: GlobeCircleLike): boolean {
  const dx = x - globe.centerX
  const dy = y - globe.centerY
  return dx * dx + dy * dy < globe.radius * globe.radius
}

/** Places a drop at a random position across the FULL viewport height
 * (not just above it), used only to seed the initial pool so the effect
 * looks already in progress on mount instead of starting from zero. If
 * that random position happens to already be inside the globe's
 * silhouette, the drop starts directly in the 'wrap' phase. */
export function seedDrop(viewportWidth: number, viewportHeight: number, globe: GlobeCircleLike | null): Drop {
  const x = Math.random() * viewportWidth
  const y = randomBetween(-RESPAWN_MARGIN_PX, viewportHeight + RESPAWN_MARGIN_PX)
  const drop = randomDrop(x, y)
  if (globe && isInsideGlobe(x, y, globe)) enterWrap(drop, x, y, globe)
  return drop
}

/** Advances a drop by dt seconds, mutating it in place. Recycles it back
 * above the viewport (spawnDropAbove) once it has fallen past the bottom. */
export function updateDrop(
  drop: Drop,
  dt: number,
  globe: GlobeCircleLike | null,
  viewportWidth: number,
  viewportHeight: number,
): void {
  switch (drop.phase) {
    case 'fall': {
      const nextY = drop.y + drop.speed * dt
      if (globe && isInsideGlobe(drop.x, nextY, globe)) {
        enterWrap(drop, drop.x, nextY, globe)
      } else {
        drop.y = nextY
      }
      break
    }
    case 'wrap': {
      if (!globe) {
        // Globe measurement disappeared (e.g. resize mid-frame) — fall
        // straight from the current position rather than getting stuck.
        drop.phase = 'release'
        break
      }
      drop.wrapAngle += (drop.speed * dt) / globe.radius
      if (drop.wrapAngle >= Math.PI) {
        drop.wrapAngle = Math.PI
        drop.x = globe.centerX
        drop.y = globe.centerY + globe.radius
        drop.phase = 'release'
      }
      break
    }
    case 'release': {
      drop.y += drop.speed * dt
      break
    }
  }

  const { y } = dropPosition(drop, globe)
  if (y - drop.length > viewportHeight + RESPAWN_MARGIN_PX) {
    Object.assign(drop, spawnDropAbove(viewportWidth))
  }
}

/** Current on-screen position of a drop, deriving it from wrapAngle while
 * phase === 'wrap' rather than trusting stale x/y fields. */
export function dropPosition(drop: Drop, globe: GlobeCircleLike | null): { x: number; y: number } {
  if (drop.phase === 'wrap' && globe) {
    return {
      x: globe.centerX + globe.radius * Math.sin(drop.wrapAngle) * drop.wrapSide,
      y: globe.centerY - globe.radius * Math.cos(drop.wrapAngle),
    }
  }
  return { x: drop.x, y: drop.y }
}

/** Current unit direction of travel, used to orient the drawn streak. */
export function dropDirection(drop: Drop, globe: GlobeCircleLike | null): { x: number; y: number } {
  if (drop.phase === 'wrap' && globe) {
    // d/dangle of (centerX + r*sin(a)*side, centerY - r*cos(a)) is
    // (r*cos(a)*side, r*sin(a)) — the radius factor cancels out on
    // normalization, so it's omitted here.
    const dx = Math.cos(drop.wrapAngle) * drop.wrapSide
    const dy = Math.sin(drop.wrapAngle)
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }
  return { x: 0, y: 1 }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: errors about unused imports (`useEffect`, `useRef` are imported but not used yet) — that's expected at this point since Task 3 uses them. Confirm the ONLY errors are `'useEffect' is declared but its value is never read` (and same for `useRef`), nothing else.

- [ ] **Step 3: Commit**

```bash
git add src/components/GlobeRain.tsx
git commit -m "Add pure drop model and update math for the globe rain effect"
```

---

### Task 3: Color mixing helpers and the GlobeRain React component

**Files:**
- Modify: `src/components/GlobeRain.tsx` (append to the file from Task 2)

**Interfaces:**
- Consumes: `resolveAccentColor` (Task 1, `src/lib/resolveAccentColor.ts`); `Drop`, `spawnDropAbove`, `seedDrop`, `updateDrop`, `dropPosition`, `dropDirection`, `GlobeCircleLike` (Task 2, same file).
- Produces (consumed by Task 4): `GlobeRainProps { globeCircle: GlobeCircle | null; theme: 'light' | 'dark' }`, `export function GlobeRain(props: GlobeRainProps): JSX.Element`.

- [ ] **Step 1: Add color-mixing helpers, the draw function, and the component**

Append to `src/components/GlobeRain.tsx` (also update the top import line to add the two new imports):

```typescript
// Add to the existing import block at the top of the file:
import type { GlobeCircle } from '@/components/ui/cobe-globe'
import { resolveAccentColor } from '@/lib/resolveAccentColor'
```

```typescript
// Append below the code from Task 2.

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface RainColors {
  /** Translucent body/tail color, drawn as a wider, lower-alpha stroke. */
  body: string
  /** Brighter core along the streak's leading edge, standing in for a
   * droplet's specular highlight — pushed toward white so it doesn't just
   * read as a second copy of the body color. */
  highlight: string
}

function resolveRainColors(): RainColors {
  const accent = resolveAccentColor()
  return {
    body: hexToRgba(accent, 0.32),
    highlight: hexToRgba(mixHex(accent, '#ffffff', 0.65), 0.75),
  }
}

const DROP_COUNT = 30
// Capped like BeadScene's Canvas dpr (see BeadScene.tsx's <Canvas dpr={[1, 1.5]}>)
// for the same reason: crisp lines without paying for a full 2-3x device
// pixel ratio's worth of fragments on every frame.
const MAX_DEVICE_PIXEL_RATIO = 1.5

function resizeCanvasToViewport(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
  const width = window.innerWidth
  const height = window.innerHeight
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  // Every subsequent draw call can then be written in CSS pixels, matching
  // how the rest of this file's coordinate math (viewportWidth/Height,
  // globeCircle) is already expressed.
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function drawDrop(ctx: CanvasRenderingContext2D, drop: Drop, globe: GlobeCircleLike | null, colors: RainColors): void {
  const head = dropPosition(drop, globe)
  const dir = dropDirection(drop, globe)
  const tail = { x: head.x - dir.x * drop.length, y: head.y - dir.y * drop.length }

  ctx.lineCap = 'round'
  ctx.strokeStyle = colors.body
  ctx.lineWidth = drop.width
  ctx.beginPath()
  ctx.moveTo(tail.x, tail.y)
  ctx.lineTo(head.x, head.y)
  ctx.stroke()

  // Highlight core: the leading third of the streak, thinner and brighter.
  const coreStart = { x: head.x - dir.x * drop.length * 0.3, y: head.y - dir.y * drop.length * 0.3 }
  ctx.strokeStyle = colors.highlight
  ctx.lineWidth = Math.max(1, drop.width * 0.5)
  ctx.beginPath()
  ctx.moveTo(coreStart.x, coreStart.y)
  ctx.lineTo(head.x, head.y)
  ctx.stroke()
}

export interface GlobeRainProps {
  globeCircle: GlobeCircle | null
  theme: 'light' | 'dark'
}

// Plain 2D canvas, not a second react-three-fiber <Canvas>: this effect is
// procedural curve math over ~30 drops, not physics, so a second WebGL
// context (and its own render overhead, mirroring what BeadScene already
// pays for the beads) would buy nothing. GlobeRain and BeadScene are
// mount-exclusive (see App.tsx), so they never compete for a GPU context
// anyway.
export function GlobeRain({ globeCircle, theme }: GlobeRainProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dropsRef = useRef<Drop[]>([])
  const globeRef = useRef<GlobeCircleLike | null>(globeCircle)
  globeRef.current = globeCircle

  // Re-resolved on theme flip via a rAF, same reasoning as BeadScene's
  // resolveBeadColors effect: the `.dark` class toggle happens in a
  // sibling effect, and child effects run before parent effects, so
  // reading computed style synchronously here could observe the OLD
  // theme's value. One rAF is enough to guarantee the class is applied.
  const colorsRef = useRef<RainColors>(resolveRainColors())
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      colorsRef.current = resolveRainColors()
    })
    return () => cancelAnimationFrame(id)
  }, [theme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    resizeCanvasToViewport(canvas)
    dropsRef.current = Array.from({ length: DROP_COUNT }, () =>
      seedDrop(window.innerWidth, window.innerHeight, globeRef.current),
    )

    function handleResize() {
      if (canvas) resizeCanvasToViewport(canvas)
    }
    window.addEventListener('resize', handleResize)

    let rafId: number
    let lastTime = performance.now()
    function tick(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 1 / 30)
      lastTime = now
      const ctx = canvas?.getContext('2d')
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const globe = globeRef.current
        for (const drop of dropsRef.current) {
          updateDrop(drop, dt, globe, window.innerWidth, window.innerHeight)
          drawDrop(ctx, drop, globe, colorsRef.current)
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors on `src/components/GlobeRain.tsx` or `src/lib/resolveAccentColor.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/components/GlobeRain.tsx
git commit -m "Add GlobeRain component: water-like drops that wrap the globe's silhouette"
```

---

### Task 4: Mount GlobeRain in App, idle-only

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `GlobeRain`, `GlobeRainProps` (Task 3, `src/components/GlobeRain.tsx`); existing `App` state `selected`, `globeCircle`, `theme` (`App.tsx:282,298,346`).

- [ ] **Step 1: Import GlobeRain**

In `src/App.tsx`, add to the import block (after the `BeadScene` import at line 5):

```typescript
import { GlobeRain } from '@/components/GlobeRain'
```

- [ ] **Step 2: Mount it under the inverse of BeadScene's condition**

In `src/App.tsx`, immediately after the existing `{selected && <BeadScene ... />}` block (`App.tsx:365-373`), add:

```typescript
      {!selected && <GlobeRain globeCircle={globeCircle} theme={theme} />}
```

So the two blocks read as a matched pair:

```typescript
      {selected && (
        <BeadScene
          key={selectedIso3}
          demographics={selected}
          theme={theme}
          globeCircle={globeCircle}
          globeElement={globeElement}
        />
      )}
      {!selected && <GlobeRain globeCircle={globeCircle} theme={theme} />}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "Mount GlobeRain while idle, matching BeadScene's selected-only mount"
```

- [ ] **Step 6: Manual verification in the browser**

Run the dev server (`npm run dev`, or via the project's preview tooling) and check, for both light and dark theme:

1. On load, with no country selected: red water-like streaks fall from above, bend along the globe's visible circular edge as they pass it, and continue straight down off the bottom of the screen. Drops that don't cross the globe's silhouette just fall straight through.
2. The pool already looks "in progress" on first paint — not all drops starting stacked at the very top.
3. Click a country marker to select it: the rain disappears and the bead scene's marble burst appears in its place, with no overlap frame where both are visible.
4. Click the same marker again to deselect: the rain resumes (a fresh `GlobeRain` mount, so it reseeds — expected, not a bug).
5. Toggle light/dark theme while idle: the rain's color updates to the new theme's `--accent` within a frame or two, same as the beads do.
6. Resize the browser window while idle: the canvas resizes with it and drops continue tracking the globe's (re-measured) position without visual glitches.
7. Confirm clicks on the globe and on the control panel/sliders/toggles still work while the rain is visible (i.e. `pointer-events-none` is actually taking effect).

## Out of scope (carried from the design spec)

- No exit animation when a country is selected.
- Exact drop count, speed/width/length ranges, and alpha values may be tuned by eye after step 6 above if they don't look right — adjust the constants at the top of `GlobeRain.tsx` (`DROP_COUNT`, `MIN_SPEED_PX_S`/`MAX_SPEED_PX_S`, etc.) and re-verify visually; no architectural change needed for such tuning.
- No interaction between rain drops and the bead physics world.
- No sound.
