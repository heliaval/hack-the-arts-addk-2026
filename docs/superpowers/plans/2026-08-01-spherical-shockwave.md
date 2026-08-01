# Spherical Shockwave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat CSS-scaled shockwave ring with a geodesic ring computed each frame in real 3D sphere space, so it visibly travels across the globe's curved surface, foreshortens correctly, and disappears over the horizon.

**Architecture:** `populationPulse.ts` adds a `spawnedAt` timestamp to each pulse. `cobe-globe.tsx` replaces the CSS-driven `Pulse` div with an SVG `<path>` per active pulse; each animation frame, a new `ringPointsOnSphere()` helper samples 40 points around a growing geodesic circle centered at the pulse's marker, projects them with the existing `project()` function, and builds an SVG path string that breaks into subpaths across horizon crossings.

**Tech Stack:** React 19, TypeScript, inline SVG (no new dependencies). No test framework in this project — verification via `npm run build`, `oxlint src`, and manual/DOM inspection.

## Global Constraints

- Ring segments: 40
- Max angular radius: 1.1 radians (~63°)
- Angular-radius growth: `eased = 1 - (1 - p) ** 2` where `p = elapsed / PULSE_DURATION_MS` (fast start, decelerating) — `angularRadius = eased * 1.1`
- Opacity: `(1 - p) ** 1.3` (stays strong early, drops off increasingly toward the end)
- Colors unchanged: `var(--accent)` for births, `#000000` for deaths
- `PULSE_DURATION_MS` (1800) and `PULSE_THRESHOLD` (3) unchanged
- The old CSS `pulse-ring` keyframe and div-based `Pulse` component are removed, not kept as a fallback

---

### Task 1: Add `spawnedAt` to `PopulationPulse`

**Files:**
- Modify: `src/lib/populationPulse.ts`

**Interfaces:**
- Produces: `PopulationPulse.spawnedAt: number`, consumed by Task 2

- [ ] **Step 1: Add the field and set it at spawn time**

In `src/lib/populationPulse.ts`, update the interface:

```ts
export interface PopulationPulse {
  id: string
  cityId: string
  kind: 'birth' | 'death'
  spawnedAt: number
}
```

Find both `newPulses.push({ id: ..., cityId: city.id, kind: 'birth' })` and the matching `kind: 'death'` push, and add `spawnedAt: now` to each (the `now` variable is already in scope from the tick's `const now = Date.now()`):

```ts
        acc.birth += elapsed * (country.birthsPerSecond / divisor)
        while (acc.birth >= PULSE_THRESHOLD) {
          acc.birth -= PULSE_THRESHOLD
          newPulses.push({ id: `pulse-${nextId.current++}`, cityId: city.id, kind: 'birth', spawnedAt: now })
        }

        acc.death += elapsed * (country.deathsPerSecond / divisor)
        while (acc.death >= PULSE_THRESHOLD) {
          acc.death -= PULSE_THRESHOLD
          newPulses.push({ id: `pulse-${nextId.current++}`, cityId: city.id, kind: 'death', spawnedAt: now })
        }
```

- [ ] **Step 2: Build**

Run:
```bash
npm run build
```
Expected: fails (this is fine, expected) — `GlobeView.tsx`'s pulse-mapping and `cobe-globe.tsx`'s `pulses` prop type don't have `spawnedAt` yet. Confirm the error specifically names the missing `spawnedAt` field (not something else), proving this step's own change is correct in isolation before Task 2/3 close the gap.

- [ ] **Step 3: Commit**

```bash
git add src/lib/populationPulse.ts
git commit -m "Add spawnedAt timestamp to PopulationPulse"
```

---

### Task 2: Geodesic ring math + SVG rendering in `cobe-globe.tsx`

**Files:**
- Modify: `src/components/ui/cobe-globe.tsx`
- Modify: `src/index.css` (remove the now-dead `pulse-ring` keyframe)

**Interfaces:**
- Consumes: `PopulationPulse.spawnedAt` from Task 1 (via `GlobeProps.pulses[].spawnedAt`)
- Produces: nothing new consumed elsewhere — `GlobeView.tsx` (Task 3) just needs to pass `spawnedAt` through

- [ ] **Step 1: Add `spawnedAt` to `GlobeProps`' pulses type**

In `src/components/ui/cobe-globe.tsx`, find:

```ts
  pulses?: { id: string; markerId: string; kind: "birth" | "death" }[]
```

Replace with:

```ts
  pulses?: { id: string; markerId: string; kind: "birth" | "death"; spawnedAt: number }[]
```

- [ ] **Step 2: Add the geodesic ring math helpers**

Add these directly after the existing `project()` function (before `projectArcMidpoint`):

```ts
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
  return [v[0] / len, v[1] / len, v[2] / len]
}

// Samples `segments` points evenly around a circle of angular radius
// `angularRadius` (radians) centered at `center` on the unit sphere --
// the standard spherical-cap parametrization. Used to draw a geodesic
// ring that expands outward from a point, following the sphere's actual
// curvature (as opposed to a flat screen-space circle).
function ringPointsOnSphere(
  center: [number, number, number],
  angularRadius: number,
  segments: number,
): [number, number, number][] {
  const ref: [number, number, number] = Math.abs(center[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const t1 = normalize(cross(ref, center))
  const t2 = cross(center, t1)
  const cosR = Math.cos(angularRadius)
  const sinR = Math.sin(angularRadius)
  const points: [number, number, number][] = []
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * Math.PI * 2
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)
    points.push([
      center[0] * cosR + (t1[0] * cosPhi + t2[0] * sinPhi) * sinR,
      center[1] * cosR + (t1[1] * cosPhi + t2[1] * sinPhi) * sinR,
      center[2] * cosR + (t1[2] * cosPhi + t2[2] * sinPhi) * sinR,
    ])
  }
  return points
}

// Builds an SVG path `d` string from a sequence of projected ring points,
// starting a new subpath whenever a point is occluded (crosses the
// horizon) so the ring breaks apart correctly instead of drawing a
// garbled line across the back of the globe.
function buildRingPath(points: { x: number; y: number; visible: boolean }[]): string {
  let d = ""
  let open = false
  for (const p of points) {
    if (!p.visible) {
      open = false
      continue
    }
    d += `${open ? "L" : "M"}${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)} `
    open = true
  }
  return d
}

const PULSE_MAX_ANGULAR_RADIUS = 1.1
const PULSE_RING_SEGMENTS = 40
const PULSE_DURATION_MS = 1800
```

Note: `PULSE_DURATION_MS` here is a local constant matching the one already exported from `populationPulse.ts` — kept separate rather than imported, since `cobe-globe.tsx` is a generic UI primitive that shouldn't import from an app-specific data-layer file. If they ever drift apart, the ring's fade timing and the pulse's removal-from-state timing would desync; add a comment noting this coupling.

- [ ] **Step 3: Add a per-frame ripple-update function**

Find `updatePulses` (added in the previous shockwave task) inside `init()`, and replace its entire body with the geodesic version:

```ts
      function updateRipples(currentPhi: number, currentTheta: number, markerElevation: number) {
        const now = Date.now()
        for (const pulse of liveProps.current.pulses) {
          const el = pulseRefs.current.get(pulse.id)
          if (!el) continue
          const marker = liveProps.current.markers.find((m) => m.id === pulse.markerId)
          if (!marker) {
            el.setAttribute("d", "")
            continue
          }
          const p = Math.min(1, Math.max(0, (now - pulse.spawnedAt) / PULSE_DURATION_MS))
          const eased = 1 - (1 - p) ** 2
          const angularRadius = eased * PULSE_MAX_ANGULAR_RADIUS
          const opacity = (1 - p) ** 1.3
          const r = 0.8 + markerElevation
          const center = unitSphere(marker.location)
          const projected = ringPointsOnSphere(center, angularRadius, PULSE_RING_SEGMENTS).map((pt) =>
            project([pt[0] * r, pt[1] * r, pt[2] * r], currentPhi, currentTheta),
          )
          el.setAttribute("d", buildRingPath(projected))
          el.style.opacity = String(opacity)
        }
      }
```

Rename the function's call site in `animate()` to match:

```ts
        updateLabels(currentPhi, currentTheta, p.markerElevation, p.arcHeight)
        updateRipples(currentPhi, currentTheta, p.markerElevation)
```

- [ ] **Step 4: Change `pulseRefs`/`pulseRefSetters` to track `SVGPathElement`**

Find:

```ts
  const pulseRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const pulseRefSetters = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
```

Replace with:

```ts
  const pulseRefs = useRef<Map<string, SVGPathElement>>(new Map())
  const pulseRefSetters = useRef<Map<string, (el: SVGPathElement | null) => void>>(new Map())
```

Find the `getRefSetter` function (used for labels and, until now, pulses too) and generalize it from `HTMLDivElement` to a generic element type, so it still works for both:

```ts
  function getRefSetter<T extends Element>(
    cache: MutableRefObject<Map<string, (el: T | null) => void>>,
    target: MutableRefObject<Map<string, T>>,
    id: string,
  ) {
    let setter = cache.current.get(id)
    if (!setter) {
      setter = (el) => {
        if (el) target.current.set(id, el)
        else target.current.delete(id)
      }
      cache.current.set(id, setter)
    }
    return setter
  }
```

(This is a drop-in generalization — the existing label call sites still infer `HTMLDivElement` correctly from their own ref types, no changes needed there.)

- [ ] **Step 5: Replace the `Pulse` div rendering with an SVG overlay**

Find where pulses are rendered (`{pulses.map((pulse) => (<Pulse key={pulse.id} kind={pulse.kind} setRef={...} />))}`, near the end of `Globe`'s JSX) and replace the whole block with:

```tsx
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      >
        {pulses.map((pulse) => (
          <path
            key={pulse.id}
            ref={getRefSetter(pulseRefSetters, pulseRefs, pulse.id)}
            fill="none"
            stroke={pulse.kind === "birth" ? "var(--accent)" : "#000000"}
            strokeWidth={0.5}
            opacity={0}
          />
        ))}
      </svg>
```

- [ ] **Step 6: Delete the old `Pulse` component**

Find and delete the entire `Pulse` component definition (from its explanatory comment through `Pulse.displayName = "Pulse"`):

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
        className="block size-8 rounded-full border-2 [animation:pulse-ring_1.8s_ease-out_forwards]"
        style={{ borderColor: kind === "birth" ? "var(--accent)" : "#000000" }}
      />
    </div>
  )
})
Pulse.displayName = "Pulse"
```

Delete this whole block entirely (do not leave it commented out).

- [ ] **Step 7: Remove the now-dead `pulse-ring` keyframe from `src/index.css`**

Find and delete:

```css
@keyframes pulse-ring {
  0% {
    transform: scale(0.15);
    opacity: 1;
  }
  15% {
    transform: scale(2.4);
    opacity: 0.85;
  }
  100% {
    transform: scale(9);
    opacity: 0;
  }
}
```

- [ ] **Step 8: Build and lint**

Run:
```bash
npm run build
```
Expected: fails until Task 3 adds `spawnedAt` to `GlobeView.tsx`'s pulse mapping (the `pulses` prop now requires it). Confirm the error is specifically about the missing `spawnedAt` field on the object passed to `Globe`'s `pulses` prop — this proves everything in this task type-checks correctly on its own.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/cobe-globe.tsx src/index.css
git commit -m "$(cat <<'EOF'
Replace flat CSS pulse ring with a real geodesic ripple

Ring points are now computed in 3D sphere space each frame
(ringPointsOnSphere) and projected with the same project() function
markers/labels use, rendered as an SVG path that breaks into
subpaths across horizon crossings. Old CSS-scaled div/keyframe
removed. Build intentionally fails until GlobeView.tsx (next task)
supplies spawnedAt.
EOF
)"
```

---

### Task 3: Wire `spawnedAt` through `GlobeView.tsx`

**Files:**
- Modify: `src/components/GlobeView.tsx`

**Interfaces:**
- Consumes: `PopulationPulse.spawnedAt` (Task 1), `Globe`'s `pulses[].spawnedAt` (Task 2)

- [ ] **Step 1: Pass `spawnedAt` through the pulse mapping**

Find:

```tsx
  const pulses = useMemo(
    () => populationPulses.map((p) => ({ id: p.id, markerId: p.cityId, kind: p.kind })),
    [populationPulses],
  )
```

Replace with:

```tsx
  const pulses = useMemo(
    () => populationPulses.map((p) => ({ id: p.id, markerId: p.cityId, kind: p.kind, spawnedAt: p.spawnedAt })),
    [populationPulses],
  )
```

- [ ] **Step 2: Build and lint**

Run:
```bash
npm run build
```
Expected: succeeds now, no TypeScript errors.

Run:
```bash
npx oxlint src
```
Expected: no new errors (only the pre-existing unrelated `button.tsx` warning).

- [ ] **Step 3: Manual verification**

1. Navigate to `http://localhost:5173`, check console for errors.
2. Since this environment's `requestAnimationFrame` doesn't fire (documented sandbox limitation, same as all prior animation work here), the ring's `d`/`opacity` attributes won't update live in this pane. Confirm what CAN be checked: no console/type errors, and that a `<path>` element appears in the DOM once a pulse spawns (reuse the same ~50s wait technique as the previous shockwave verification, checking `document.querySelectorAll('svg path')`).
3. **This is fundamentally a live-verification item.** Ask the user to confirm in their own browser that the ring visibly expands along the globe's curved surface (not as a flat screen circle), foreshortens near the edge, and breaks apart correctly as it crosses the horizon.

- [ ] **Step 4: Commit and push**

```bash
git add src/components/GlobeView.tsx
git commit -m "Pass spawnedAt through to Globe's pulses prop"
git push
```

