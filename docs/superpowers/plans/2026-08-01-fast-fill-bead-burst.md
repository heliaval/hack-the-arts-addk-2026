# Fast fill-up bead burst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed `MAX_BEADS = 70` cap in `src/components/BeadScene.tsx` with a viewport-area-computed capacity, and add a fast burst-spawn phase that fills the pile to that capacity on mount (which already happens on every country switch, since `App.tsx` renders `<BeadScene key={selectedIso3} .../>`), before handing off to the existing demographic-paced spawn timers.

**Architecture:** A pure function computes bead capacity from viewport CSS-pixel area (read via a small `useViewportSize` hook, since the component owning spawn state — `BeadScene` — renders the `<Canvas>` itself and sits outside the R3F tree, so it cannot use `useThree`). The existing spawn `useEffect` gains a burst sub-phase: while the live bead count (tracked with a local counter, not by re-reading React state mid-effect) is below capacity, a single fast interval spawns beads alternating birth/death; once the counter reaches capacity, the interval is cleared and the two existing demographic-paced timers (`birthIntervalMs`/`deathIntervalMs`) take over exactly as today.

**Tech Stack:** React 19, TypeScript, @react-three/fiber, @react-three/rapier. No test framework exists in this repo (no vitest/jest, no `test` script) — verification is manual, via `tsc -b` for type-safety and the Browser pane for visual/behavioral/performance checks, matching how every other change in this file has been verified so far.

## Global Constraints

- No test framework is available — do not attempt to add one; verify via type-check + browser, per the spec's own out-of-scope note ("tuning constants happens during implementation by visual inspection").
- Must not introduce noticeable lag: the plan's perf-verification task has a concrete FPS target and a fallback tuning step.
- Follow the spec at `docs/superpowers/specs/2026-08-01-fast-fill-bead-burst-design.md`: capacity replaces `MAX_BEADS` everywhere it's used; burst triggers "on mount" (country switch already remounts `BeadScene` via its `key` prop, so no extra trigger code is needed); kind alternates birth/death during burst, not weighted by real rates.

---

### Task 1: Viewport-based capacity, replacing `MAX_BEADS`

**Files:**
- Modify: `src/components/BeadScene.tsx:26-36` (constants block containing `MAX_BEADS`)
- Modify: `src/components/BeadScene.tsx:812-825` (top of `BeadScene`, to wire in the new hook + computed capacity)
- Modify comments referencing `MAX_BEADS` at lines `44-46`, `124-126`, `141-144`, `756-762`, `858-863` (reword to describe the new computed capacity instead of the old fixed constant)

**Interfaces:**
- Produces: `computeBeadCapacity(width: number, height: number): number` — pure function, module scope. `useViewportSize(): { width: number; height: number }` — hook, module scope, returns CSS-pixel viewport size, updated on window resize. Both consumed by Task 2.
- Consumes: `BEAD_RADIUS` (existing constant, `BeadScene.tsx:18`).

- [ ] **Step 1: Replace the `MAX_BEADS` constant block with capacity constants + the pure capacity function**

Replace this (currently `BeadScene.tsx:26-36`):

```ts
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

With:

```ts
export const SPAWN_JITTER_PX = 200

// The live-bead cap is now computed from the viewport instead of fixed, so
// a bigger window fills with more beads instead of showing the same 70-bead
// pile with more empty space around it — see
// docs/superpowers/specs/2026-08-01-fast-fill-bead-burst-design.md.
//
// PACKING_FACTOR is well under 1: beads pile under gravity against a floor
// and two side walls (see Boundaries below), so they never tile the full
// viewport area the way a grid would — this is a deliberately conservative
// estimate of how much of the screen a settled pile actually covers, not a
// geometric packing constant. Tuned by eye (Task 3) alongside MAX_CAPACITY.
const BEAD_DIAMETER = BEAD_RADIUS * 2
const CAPACITY_PACKING_FACTOR = 0.35
// Clamp guards: MIN_CAPACITY keeps a very narrow window from looking empty,
// MAX_CAPACITY is a hard performance backstop so a very large monitor can't
// push live bead count (and therefore live RigidBody + draw-call count) far
// past what this scene has been shown to run smoothly at. See Task 3 for
// how this was chosen.
const MIN_CAPACITY = 40
const MAX_CAPACITY = 110

/** How many live beads the current viewport should hold before the spawn
 * loop stops bursting and settles into normal demographic-paced spawning.
 * Pure function of viewport CSS-pixel size — no DOM/React access — so it's
 * trivial to sanity-check by hand (see Task 3, Step 1). */
export function computeBeadCapacity(width: number, height: number): number {
  if (width <= 0 || height <= 0) return MIN_CAPACITY
  const raw = Math.floor(
    ((width * height) / (BEAD_DIAMETER * BEAD_DIAMETER)) * CAPACITY_PACKING_FACTOR,
  )
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, raw))
}
```

- [ ] **Step 2: Add the `useViewportSize` hook**

`BeadScene` (the exported function, `BeadScene.tsx:812`) renders the `<Canvas>` itself rather than living inside one, so it cannot call `useThree` the way `Boundaries`/`Backdrop`/`MouseLight` do. Add this hook directly above `export function BeadScene` (i.e. just before line 812):

```ts
// BeadScene owns spawn state and renders <Canvas> itself, so it sits
// outside the R3F tree and can't use useThree() the way the components
// rendered *inside* <Canvas> (Boundaries, Backdrop, MouseLight) do. The
// canvas is `fixed inset-0` (full viewport, see BeadScene's returned JSX),
// so window size is the same thing useThree's `size` would report.
function useViewportSize() {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  useEffect(() => {
    function handleResize() {
      setSize({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return size
}
```

- [ ] **Step 3: Wire capacity into `BeadScene`**

At the top of `BeadScene` (`BeadScene.tsx:812`, right after the `useBeadMaterials(colors)` line and before `const [beads, setBeads] = ...`), add:

```ts
const { width: viewportWidth, height: viewportHeight } = useViewportSize()
const capacity = useMemo(
  () => computeBeadCapacity(viewportWidth, viewportHeight),
  [viewportWidth, viewportHeight],
)
```

- [ ] **Step 4: Update the eviction check to use `capacity` instead of `MAX_BEADS`**

In the `spawn` function inside the existing `useEffect` (`BeadScene.tsx:863`), change:

```ts
if (live >= MAX_BEADS) {
```

to:

```ts
if (live >= capacity) {
```

Also add `capacity` to that effect's dependency array (currently `[birthIntervalMs, deathIntervalMs]` at `BeadScene.tsx:887`) — full replacement:

```ts
}, [birthIntervalMs, deathIntervalMs, capacity])
```

(Task 2 rewrites this effect's body further, so this step only needs to compile — it does not need to be the final form.)

- [ ] **Step 5: Reword the stale `MAX_BEADS` comments**

Five comments reference `MAX_BEADS` by name; update each to describe "the computed live-bead cap" generically instead (no code changes, comments only):

- `BeadScene.tsx:44-46` ("It also bounds how far the array can exceed MAX_BEADS...") → "...bounds how far the array can exceed the live-bead cap..."
- `BeadScene.tsx:124-126` ("up to MAX_BEADS byte-identical vertex buffers") → "up to MAX_CAPACITY byte-identical vertex buffers"
- `BeadScene.tsx:141-144` (Bead.dying doc comment, "evicted at the MAX_BEADS cap") → "evicted at the live-bead cap"
- `BeadScene.tsx:756-762` ("MAX_BEADS cap; their lifetimes...") → "live-bead cap; their lifetimes..."
- `BeadScene.tsx:858-863` ("MAX_BEADS therefore caps live beads...") → "The computed capacity therefore caps live beads..."

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: no errors. (There will be one expected dangling reference: nothing else in the repo imports `MAX_BEADS` — confirmed via `grep -rn "MAX_BEADS" src` returning only `BeadScene.tsx` before this change — so removing the export is safe.)

- [ ] **Step 7: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "$(cat <<'EOF'
Replace fixed MAX_BEADS with viewport-computed bead capacity

A hardcoded 70-bead cap meant a bigger window just showed more empty
space around the same-size pile. computeBeadCapacity derives the cap
from viewport area instead, clamped to a perf-safe range.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Burst-spawn phase

**Files:**
- Modify: `src/components/BeadScene.tsx:846-887` (the spawn `useEffect`)
- Modify: `src/components/BeadScene.tsx:825` area (add `beadsRef` mirror next to `const [beads, setBeads] = useState<Bead[]>([])`)

**Interfaces:**
- Consumes: `computeBeadCapacity`, `capacity` (from Task 1). `Bead` interface (existing, `BeadScene.tsx:133-145`). `SPAWN_JITTER_PX`, `MARBLE_VARIANTS` (existing constants).
- Produces: no new exports — this task only changes `BeadScene`'s internal spawn effect.

- [ ] **Step 1: Mirror `beads` into a ref**

Directly below `const [beads, setBeads] = useState<Bead[]>([])` (`BeadScene.tsx:825`), add:

```ts
// Read inside the burst-spawn effect below to seed its live-count estimate
// without a stale closure — mirrors the same "ref updated every render"
// pattern cobe-globe.tsx uses for liveProps (see its comment at that ref's
// declaration).
const beadsRef = useRef<Bead[]>(beads)
beadsRef.current = beads
```

- [ ] **Step 2: Add the burst spawn interval constant**

Add near the other timing constants — directly below `const BEAD_EXIT_MS = 420` (`BeadScene.tsx:47`) — is a reasonable spot; add:

```ts
// Burst-phase spawn interval: fast enough to visibly fill the screen in a
// few seconds even at MAX_CAPACITY (110 beads * 40ms = 4.4s worst case),
// comparable to the fastest single-stream demographic rate this scene
// already exercises today (FASTEST_SPAWN_INTERVAL_MS = 120ms in
// src/lib/beadSpawnRate.ts) rather than an order of magnitude faster —
// kept conservative here specifically because new-body-creation rate is
// itself a performance variable (see Task 3).
const BURST_SPAWN_INTERVAL_MS = 40
```

- [ ] **Step 3: Rewrite the spawn effect with a burst sub-phase**

Replace the full `useEffect` at `BeadScene.tsx:846-887` (the version after Task 1's Step 4 edit, i.e. already using `capacity` instead of `MAX_BEADS` and already depending on `capacity`):

```ts
useEffect(() => {
  function countLive(list: Bead[]): number {
    return list.reduce((count, bead) => (bead.dying ? count : count + 1), 0)
  }

  function spawn(kind: 'birth' | 'death') {
    setBeads((prev) => {
      const live = countLive(prev)
      let next = prev
      if (live >= capacity) {
        // find() returns the first non-dying entry, i.e. the oldest one,
        // because the array is append-ordered.
        const oldest = prev.find((bead) => !bead.dying)
        if (oldest) next = prev.map((bead) => (bead === oldest ? { ...bead, dying: true } : bead))
      }
      return [
        ...next,
        {
          id: nextIdRef.current++,
          kind,
          x: (Math.random() - 0.5) * 2 * SPAWN_JITTER_PX,
          variant: Math.floor(Math.random() * MARBLE_VARIANTS),
          dying: false,
        },
      ]
    })
  }

  let burstTimer: number | null = null
  let birthTimer: number | null = null
  let deathTimer: number | null = null

  function startNormalTimers() {
    birthTimer = window.setInterval(() => spawn('birth'), birthIntervalMs)
    deathTimer = window.setInterval(() => spawn('death'), deathIntervalMs)
  }

  // Burst phase: fill up to `capacity` fast, alternating kind, before
  // falling back to the normal demographic-paced timers. liveEstimate is a
  // local counter, not a re-read of React state — setBeads is async, so
  // beadsRef.current would still show the pre-spawn count on the very next
  // tick. Safe to count this way because eviction only happens once
  // `live >= capacity`, which by construction can't happen while
  // liveEstimate is still below capacity — so no bead this loop spawns can
  // trigger an eviction.
  let liveEstimate = countLive(beadsRef.current)
  let burstKind: 'birth' | 'death' = 'birth'
  if (liveEstimate < capacity) {
    burstTimer = window.setInterval(() => {
      spawn(burstKind)
      burstKind = burstKind === 'birth' ? 'death' : 'birth'
      liveEstimate += 1
      if (liveEstimate >= capacity && burstTimer !== null) {
        window.clearInterval(burstTimer)
        burstTimer = null
        startNormalTimers()
      }
    }, BURST_SPAWN_INTERVAL_MS)
  } else {
    startNormalTimers()
  }

  return () => {
    if (burstTimer) window.clearInterval(burstTimer)
    if (birthTimer) window.clearInterval(birthTimer)
    if (deathTimer) window.clearInterval(deathTimer)
  }
}, [birthIntervalMs, deathIntervalMs, capacity])
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Manual smoke test in the browser**

Start the dev server (see Task 3, Step 1 for the exact preview commands — reuse the same server rather than starting a second one) and confirm, just by watching:

- On first load with a country selected, beads spawn rapidly (visibly faster than before) until the pile looks full, then visibly slow to the normal trickle.
- Selecting a different country (which remounts `BeadScene` via its `key` prop) re-triggers the fast fill.
- No console errors (`read_console_messages`).

- [ ] **Step 6: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "$(cat <<'EOF'
Add fast burst-spawn phase to fill the screen on mount

Beads now spawn on a fast fixed interval (alternating birth/death)
until the computed viewport capacity is reached, instead of trickling
in at demographic pace from an empty scene — which at the slowest
country rate could take up to ~98 seconds to fill. Normal
demographic-paced spawning takes over once the screen is full.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Performance verification and tuning

**Files:**
- Modify (only if tuning is needed): `src/components/BeadScene.tsx` (`CAPACITY_PACKING_FACTOR`, `MIN_CAPACITY`, `MAX_CAPACITY` from Task 1, Step 1)

**Interfaces:**
- Consumes: the fully implemented burst + capacity logic from Tasks 1–2.
- Produces: nothing new — this task validates and, if needed, retunes existing constants.

- [ ] **Step 1: Start the dev server preview**

This repo's dev server is configured in `.claude/launch.json` as `hourglass-earth-dev`. Start it and open the preview:

```
preview_start({ name: "hourglass-earth-dev" })
```

If port 5173 is already in use by another session, `.claude/launch.json` already has `"autoPort": true` set (added in an earlier session) — `preview_start` will pick a free port automatically; use the `port` it returns for the rest of this task.

- [ ] **Step 2: Select a country and confirm no build/runtime errors**

```
navigate({ url: "http://localhost:<port>" })
```

Click a country marker on the globe (or use whatever selection UI is present). Then:

```
read_console_messages({ onlyErrors: true })
```

Expected: no errors related to `BeadScene`, Rapier, or Three.js.

- [ ] **Step 3: Measure sustained FPS during the burst**

Immediately after selecting a country (while the pile is still visibly filling fast), run via `javascript_tool`:

```js
window.__fpsResult = null;
(function () {
  let frames = 0
  const start = performance.now()
  function tick() {
    frames++
    const elapsed = performance.now() - start
    if (elapsed < 2000) {
      requestAnimationFrame(tick)
    } else {
      window.__fpsResult = { frames, elapsedMs: Math.round(elapsed), fps: Math.round((frames / elapsed) * 1000) }
    }
  }
  requestAnimationFrame(tick)
})();
'measuring'
```

Wait about 2.5 seconds (the measurement runs for 2000ms), then read the result:

```js
window.__fpsResult
```

Record the `fps` value.

- [ ] **Step 4: Measure sustained FPS once the pile is full (post-burst, normal trickle)**

Wait until the pile has clearly stopped growing fast (a few seconds, or `MAX_CAPACITY * BURST_SPAWN_INTERVAL_MS` = 110 * 40ms ≈ 4.4s worst case — wait at least 6s to be safe), then repeat Step 3's two scripts and record this second `fps` value.

- [ ] **Step 5: Evaluate against the target**

Target: both measurements should be **≥ 50 fps** on whatever display this is run on (a conservative bar — well below the 60fps ceiling most displays render at, leaving headroom for a slower machine than the one used to verify).

- If both measurements meet the target: capacity constants are fine as shipped in Task 1. No changes needed — proceed to Step 6.
- If either measurement is below target: reduce `MAX_CAPACITY` (`BeadScene.tsx`, Task 1's constants block) by 20 — e.g. `110 → 90` — save, let Vite hot-reload, and repeat Steps 2–4 at the new value. Repeat until both measurements clear 50fps. If `MAX_CAPACITY` drops below `MIN_CAPACITY + 20` (i.e. below 60) without clearing the target, also reduce `CAPACITY_PACKING_FACTOR` (e.g. `0.35 → 0.25`) and retest, since the bottleneck may be typical-viewport capacity rather than just the worst-case clamp.

- [ ] **Step 6: Resize the window and confirm capacity recomputes sensibly**

```
resize_window({ width: 800, height: 600 })
```

Confirm (visually, via screenshot) that the pile is noticeably smaller/sparser than at the default size — capacity should have dropped since `computeBeadCapacity` is a function of viewport area. Then:

```
resize_window({ preset: "desktop" })
```

Confirm the pile fills back in (a fresh burst should visibly run, since the resize changes `capacity` and re-triggers the effect from Task 2).

- [ ] **Step 7: If any constants were changed in Step 5, commit**

Write the commit body from the actual numbers gathered in Steps 3–5: which
constant(s) changed and their old/new values (e.g. `MAX_CAPACITY: 110 → 90`),
and the measured fps before and after the change. For example, if
`MAX_CAPACITY` was lowered from 110 to 90 after measuring 38fps at 110 and
54fps at 90:

```bash
git add src/components/BeadScene.tsx
git commit -m "$(cat <<'EOF'
Tune bead capacity constants for sustained frame rate

MAX_CAPACITY 110 -> 90: 110 sustained ~38fps during the burst on the
verification display, below the 50fps target; 90 sustained ~54fps.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

If no constants were changed in Step 5, skip this commit — Task 2's commit already covers the shipped state.
