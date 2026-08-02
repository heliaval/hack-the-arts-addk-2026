# Leaf Departure Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whenever a marble is evicted from the bead scene, spawn a color-matched leaf that tumbles across the screen and fades out, so departures read as a deliberate visual moment.

**Architecture:** A new DOM overlay component (`LeafOverlay`) renders short-lived CSS-animated SVG leaves above `BeadScene`'s canvas. `BeadScene`'s existing eviction/fade-out mechanism (`BeadFadeOut`) reports the departing marble's on-screen position and color once, at the start of its shrink animation, via a threaded callback. `App.tsx` owns the resulting `leaves` array and wires the two together.

**Tech Stack:** React, TypeScript, Tailwind CSS v4 (CSS-first `@theme`/`@keyframes` in `src/index.css`), existing `src/components/BeadScene.tsx` (react-three-fiber / react-three-rapier).

## Global Constraints

- No raw CSS files, CSS modules, or CSS-in-JS — animation keyframes go in the existing `src/index.css` entry (Tailwind v4 convention), per `CLAUDE.md`.
- New frontend code uses React + TypeScript, matching the rest of the codebase.
- No new dependencies — this is pure DOM/CSS/SVG, no animation library needed.
- Every eviction spawns exactly one leaf; leaf color must be the exact hex the departing marble had (`colors.birth` or `colors.death` from `BeadScene`), not a re-derived value.
- No `useFrame` / per-frame JS driving the leaf motion — CSS `@keyframes` only, per the spec's performance rationale.
- This project has no test runner configured (no `test` script in `package.json`, no existing `*.test.*`/`*.spec.*` files) — verification is via `tsc` type-checking, `oxlint`, and manual browser confirmation with the dev server, matching how the rest of this codebase's UI work is verified.

---

## File Structure

- **Create** `src/components/LeafOverlay.tsx` — owns the `Leaf` type, the `LeafOverlay` container component, and the per-leaf `LeafSprite` renderer (SVG shape + inline animation style). Single responsibility: render and self-prune leaves it's given: no eviction logic, no knowledge of beads.
- **Modify** `src/index.css` — add the `leaf-drift` `@keyframes` rule.
- **Modify** `src/components/BeadScene.tsx` — thread a new `onDeparture` callback from `BeadSceneProps` down through `BeadBody` to `BeadFadeOut`; `BeadFadeOut` computes the departing marble's screen position on its first frame and calls it once.
- **Modify** `src/App.tsx` — own the `leaves` state array, supply `handleDeparture`/`handleLeafDone` callbacks, mount `LeafOverlay` as a sibling above `BeadScene`.

---

### Task 1: Build `LeafOverlay` in isolation

**Files:**
- Create: `src/components/LeafOverlay.tsx`
- Modify: `src/index.css` (add `leaf-drift` keyframes)
- Modify (temporary demo only, reverted in Task 2): `src/App.tsx`

**Interfaces:**
- Produces: `export interface Leaf { id: number; x: number; y: number; color: string; seed: number }`, `export function LeafOverlay({ leaves, onLeafDone }: { leaves: Leaf[]; onLeafDone: (id: number) => void }): JSX.Element`

- [ ] **Step 1: Add the `leaf-drift` keyframes to `src/index.css`**

Add this block after the existing `:root { ... }` block (i.e. right before the `html, body, #root { ... }` rule at line 61):

```css
/* Drives LeafOverlay's per-leaf drift (src/components/LeafOverlay.tsx).
   --leaf-dx/--leaf-sway/--leaf-rot are set per-leaf via inline style so one
   keyframes rule produces varied motion instead of identical clones. */
@keyframes leaf-drift {
  0% {
    transform: translate(-50%, -50%) translate(0, 0) rotate(0deg);
    opacity: 1;
  }
  50% {
    transform: translate(-50%, -50%)
      translate(calc(var(--leaf-dx) * 0.5 + var(--leaf-sway)), 60px)
      rotate(calc(var(--leaf-rot) * 0.5));
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) translate(var(--leaf-dx), 160px) rotate(var(--leaf-rot));
    opacity: 0;
  }
}
```

- [ ] **Step 2: Create `src/components/LeafOverlay.tsx`**

```tsx
import type { CSSProperties } from 'react'

/** One in-flight departure leaf. `seed` deterministically derives this
 * leaf's drift distance/sway/rotation/duration so the same leaf never
 * re-rolls its motion across re-renders, but different leaves vary. */
export interface Leaf {
  id: number
  x: number
  y: number
  color: string
  seed: number
}

interface LeafOverlayProps {
  leaves: Leaf[]
  onLeafDone: (id: number) => void
}

const LEAF_SIZE_PX = 22

/** Fixed, full-viewport, pointer-events-none — sits above BeadScene's own
 * `fixed inset-0 z-0` canvas (see App.tsx for the stacking order) so leaves
 * are never blocked by clicks and never block clicks themselves. */
export function LeafOverlay({ leaves, onLeafDone }: LeafOverlayProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
      {leaves.map((leaf) => (
        <LeafSprite key={leaf.id} leaf={leaf} onDone={() => onLeafDone(leaf.id)} />
      ))}
    </div>
  )
}

function LeafSprite({ leaf, onDone }: { leaf: Leaf; onDone: () => void }) {
  // Spread seed into a few independent-looking ranges via different
  // multipliers/moduli, so leaves don't all drift the same distance at the
  // same angle for the same duration even when seeds are close together.
  const dx = 40 + (leaf.seed % 100) // 40-139px horizontal drift
  const sway = 20 + ((leaf.seed * 7) % 40) // 20-59px sway amplitude
  const rot = 180 + ((leaf.seed * 13) % 360) // 180-539deg total rotation
  const dur = 1.6 + ((leaf.seed % 10) / 10) * 0.6 // 1.6-2.2s
  const dir = leaf.seed % 2 === 0 ? 1 : -1

  const style = {
    left: leaf.x,
    top: leaf.y,
    animation: `leaf-drift ${dur}s ease-out forwards`,
    '--leaf-dx': `${(dx * dir).toFixed(1)}px`,
    '--leaf-sway': `${(sway * dir).toFixed(1)}px`,
    '--leaf-rot': `${(rot * dir).toFixed(1)}deg`,
  } as CSSProperties & Record<'--leaf-dx' | '--leaf-sway' | '--leaf-rot', string>

  return (
    <svg
      className="absolute"
      style={style}
      width={LEAF_SIZE_PX}
      height={LEAF_SIZE_PX}
      viewBox="0 0 24 24"
      onAnimationEnd={onDone}
    >
      <path d="M12 2C7 6 3 10 3 15a9 9 0 0 0 9 7 9 9 0 0 0 9-7C21 10 17 6 12 2Z" fill={leaf.color} />
      <path d="M12 4v16" stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" fill="none" />
    </svg>
  )
}
```

- [ ] **Step 3: Temporarily mount `LeafOverlay` in `App.tsx` with hardcoded demo leaves, to verify visually before wiring real eviction data**

Open `src/App.tsx`. Find the import block near the top (after the `BeadScene` import at line 5) and add:

```tsx
import { LeafOverlay, type Leaf } from '@/components/LeafOverlay'
```

Inside the `App` function component, near the top where other `useState` calls live, temporarily add:

```tsx
const [demoLeaves] = useState<Leaf[]>([
  { id: 1, x: 300, y: 200, color: '#912f40', seed: 4 },
  { id: 2, x: 500, y: 350, color: '#333333', seed: 17 },
  { id: 3, x: 700, y: 150, color: '#912f40', seed: 42 },
])
```

Right after the closing `)}` of the `{selected && (<BeadScene ... />)}` block (around line 373), add:

```tsx
<LeafOverlay leaves={demoLeaves} onLeafDone={() => {}} />
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc -b --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manually verify in the browser**

Start the dev server (`npm run dev`), open the app, select any country so the bead scene mounts. Confirm: three leaf shapes appear at the hardcoded positions, tumble outward/downward with rotation and sway, and fade out over roughly 1.6-2.2 seconds, then vanish (no leftover DOM nodes — check via devtools that the `<svg>` elements are gone after the animation, confirming `onAnimationEnd` fired even though `onLeafDone` is a no-op here).

- [ ] **Step 6: Commit**

```bash
git add src/components/LeafOverlay.tsx src/index.css src/App.tsx
git commit -m "Add LeafOverlay component with demo leaves for visual verification"
```

---

### Task 2: Wire real eviction data through `BeadScene` and remove the demo

**Files:**
- Modify: `src/components/BeadScene.tsx` (`BeadFadeOut` ~line 712-743, `BeadBody` ~line 761-786, `BeadSceneProps`/`BeadScene` ~line 788-940)
- Modify: `src/App.tsx` (replace Task 1's demo wiring with real state)

**Interfaces:**
- Consumes: `Leaf` type and `LeafOverlay` from Task 1 (`src/components/LeafOverlay.tsx`).
- Produces: `BeadSceneProps.onDeparture: (x: number, y: number, color: string) => void`, called exactly once per evicted bead, at the start of its fade-out, with its on-screen position and exact color.

- [ ] **Step 1: Add `onDeparture` to `BeadFadeOut`**

In `src/components/BeadScene.tsx`, replace the `BeadFadeOut` function (currently lines 712-743) with:

```tsx
function BeadFadeOut({
  meshRef,
  id,
  color,
  onExpire,
  onDeparture,
}: {
  meshRef: RefObject<THREE.Mesh | null>
  id: number
  color: string
  onExpire: (id: number) => void
  onDeparture: (x: number, y: number, color: string) => void
}) {
  const elapsedRef = useRef(0)
  // onExpire triggers a setState, and React may render one more frame
  // before the removal commits. Without this latch that frame would call
  // onExpire a second time with an id that is already gone.
  const doneRef = useRef(false)
  // Guards onDeparture the same way: it must fire exactly once, on the
  // first frame of the shrink, not on every frame.
  const departedRef = useRef(false)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  useFrame((_, delta) => {
    if (doneRef.current) return
    if (!departedRef.current) {
      departedRef.current = true
      if (meshRef.current) {
        const worldPos = meshRef.current.getWorldPosition(new THREE.Vector3())
        // Orthographic camera, world units == CSS pixels, origin at
        // viewport center, +y up (see this file's top-of-file comment) —
        // flip to DOM screen space (origin top-left, +y down).
        onDeparture(width / 2 + worldPos.x, height / 2 - worldPos.y, color)
      }
    }
    // useFrame's delta is in seconds.
    elapsedRef.current += delta * 1000
    const t = Math.min(elapsedRef.current / BEAD_EXIT_MS, 1)
    // Smoothstep, so the collapse has no jerk at either end.
    const scale = 1 - t * t * (3 - 2 * t)
    // Never exactly 0: a zero scale gives a singular model matrix, which
    // makes three's normal-matrix inverse produce NaNs and can blow out the
    // whole transmission pass for that frame.
    meshRef.current?.scale.setScalar(Math.max(scale, 0.001))
    if (t >= 1) {
      doneRef.current = true
      onExpire(id)
    }
  })
  return null
}
```

- [ ] **Step 2: Thread `color` and `onDeparture` through `BeadBody`**

Replace the `BeadBody` component (currently lines 761-786) with:

```tsx
const BeadBody = memo(function BeadBody({
  bead,
  material,
  color,
  onExpire,
  onDeparture,
}: {
  bead: Bead
  material: THREE.Material
  color: string
  onExpire: (id: number) => void
  onDeparture: (x: number, y: number, color: string) => void
}) {
  const height = useThree((state) => state.size.height)
  const meshRef = useRef<THREE.Mesh>(null)
  return (
    <>
      <RigidBody
        colliders="ball"
        position={[bead.x, height / 2 + BEAD_RADIUS * 2, 0]}
        restitution={0.25}
        friction={0.6}
        linearDamping={0.1}
      >
        <mesh ref={meshRef} geometry={BEAD_GEOMETRY} material={material} dispose={null} />
      </RigidBody>
      {bead.dying && (
        <BeadFadeOut
          meshRef={meshRef}
          id={bead.id}
          color={color}
          onExpire={onExpire}
          onDeparture={onDeparture}
        />
      )}
    </>
  )
})
```

- [ ] **Step 3: Add `onDeparture` to `BeadSceneProps` and pass it (plus each bead's color) into `BeadBody`**

In `src/components/BeadScene.tsx`, update the `BeadSceneProps` interface (currently lines 788-799) by adding one field:

```tsx
interface BeadSceneProps {
  demographics: CountryDemographics
  theme: 'light' | 'dark'
  globeCircle: GlobeCircle | null
  globeElement: HTMLCanvasElement | null
  /** Called once per evicted bead, at the start of its fade-out, with its
   * on-screen position and exact glass color — drives LeafOverlay
   * (src/components/LeafOverlay.tsx). */
  onDeparture: (x: number, y: number, color: string) => void
}
```

Update the function signature:

```tsx
export function BeadScene({ demographics, theme, globeCircle, globeElement, onDeparture }: BeadSceneProps) {
```

Find the bead render loop (currently lines 929-936):

```tsx
{beads.map((bead) => (
  <BeadBody
    key={bead.id}
    bead={bead}
    material={(bead.kind === 'birth' ? materials.birth : materials.death)[bead.variant]}
    onExpire={expireBead}
  />
))}
```

Replace it with:

```tsx
{beads.map((bead) => (
  <BeadBody
    key={bead.id}
    bead={bead}
    material={(bead.kind === 'birth' ? materials.birth : materials.death)[bead.variant]}
    color={bead.kind === 'birth' ? colors.birth : colors.death}
    onExpire={expireBead}
    onDeparture={onDeparture}
  />
))}
```

- [ ] **Step 4: Replace the Task 1 demo wiring in `App.tsx` with real state**

In `src/App.tsx`, remove the `demoLeaves` `useState` block added in Task 1, and the `<LeafOverlay leaves={demoLeaves} onLeafDone={() => {}} />` line.

Add real leaf state near the other `useState`/`useRef` declarations in the `App` component:

```tsx
const [leaves, setLeaves] = useState<Leaf[]>([])
const nextLeafIdRef = useRef(0)

const handleDeparture = useCallback((x: number, y: number, color: string) => {
  const id = nextLeafIdRef.current++
  setLeaves((prev) => [...prev, { id, x, y, color, seed: Math.floor(Math.random() * 10000) }])
}, [])

const handleLeafDone = useCallback((id: number) => {
  setLeaves((prev) => prev.filter((leaf) => leaf.id !== id))
}, [])
```

(If `useCallback` isn't already imported in `App.tsx`, add it to the existing `react` import line.)

Pass `onDeparture={handleDeparture}` to the existing `<BeadScene ... />` element (around line 366-372), and mount the overlay right after it:

```tsx
{selected && (
  <BeadScene
    key={selectedIso3}
    demographics={selected}
    theme={theme}
    globeCircle={globeCircle}
    globeElement={globeElement}
    onDeparture={handleDeparture}
  />
)}
<LeafOverlay leaves={leaves} onLeafDone={handleLeafDone} />
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc -b --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Manually verify end-to-end in the browser**

Start the dev server (`npm run dev`), select a country with a visible birth/death spawn rate, and let the bead pile fill past 70 live beads. Confirm:
- Once the pile is at capacity, each new spawn evicts the oldest bead, and a leaf launches from that bead's exact on-screen position at the moment it starts shrinking.
- Leaf color matches the evicted bead's kind (accent-red for birth beads, dark/foreground for death beads) in both light and dark theme.
- Leaves never appear without a corresponding eviction, and never fail to appear when one happens.
- During a burst of several evictions close together, the leaves' varied drift/rotation/duration reads as one cohesive flurry rather than identical stamped clones or unrelated chaos.
- Leaves don't block clicks on the shrunken globe (the scene's exit control) or the control panel.
- No console errors, and via devtools confirm leaf `<svg>` nodes are removed from the DOM after their animation ends (no accumulation over time).

- [ ] **Step 7: Commit**

```bash
git add src/components/BeadScene.tsx src/App.tsx
git commit -m "Wire marble eviction into LeafOverlay for the departure effect"
```

---

## Self-Review

**Spec coverage:** Trigger & data flow (Task 2, Steps 1-3), leaf state & rendering (Task 1), motion (Task 1 Step 1-2), bounds (no explicit cap needed — self-pruning via `onAnimationEnd` naturally bounds concurrent leaves as the spec describes), scope (both tasks together match the spec's file list exactly: new `LeafOverlay.tsx`, modified `BeadScene.tsx`, modified `App.tsx`; keyframes landed in `index.css` per the Global Constraints). All spec sections are covered.

**Placeholder scan:** No TBD/TODO markers; every step has real, complete code.

**Type consistency:** `Leaf` (id/x/y/color/seed) is defined once in `LeafOverlay.tsx` and consumed identically in `App.tsx`. `onDeparture: (x: number, y: number, color: string) => void` has the same signature everywhere it appears (`BeadSceneProps`, `BeadBody` props, `BeadFadeOut` props, `handleDeparture` in `App.tsx`). `onLeafDone`/`handleLeafDone` both use `(id: number) => void`.
