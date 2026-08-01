# Bead Scene (Phase 3 — Marbles) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 2 glass beads into swirled glass **marbles** — procedurally painted swirl and cat's-eye variants, sharper reflections, and a graceful shrink-out instead of the current instant pop when a bead is evicted at the `MAX_BEADS` cap — while holding a hard 30fps floor at the live cap.

**Architecture:** Three surgical layers on top of Phase 2, none of which changes physics, spawn rate, colour resolution or the click mechanic. (1) Eviction becomes a two-stage state machine: the oldest live bead is flagged `dying` rather than deleted, and a conditionally-rendered `useFrame` companion shrinks its **mesh scale** to zero over 420ms before a callback finally removes it — scale rather than opacity precisely so Phase 2's shared-material invariant is untouched. (2) Colour moves from `material.color` into a `map`: eight `THREE.CanvasTexture`s (3 swirl + 1 cat's-eye, per birth/death tint) painted once at 256×128 in equirectangular layout, so that strokes drawn top-to-bottom in canvas space become pole-converging ribbons on the sphere. `useBeadMaterials` grows from 2 shared materials to 8 shared materials — still shared, still one shader program, still one transmission pass. (3) Reflection quality comes from raising the locally-baked environment cube map from 64px to 256px (a **one-time** bake cost, `frames={1}`) and enabling `clearcoat`, plus rebalancing Beer–Lambert attenuation so the new texture is not crushed back into a single flat hue.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, `three@0.185.1`, `@react-three/fiber@9.7.0`, `@react-three/drei@10.7.7`, `@react-three/rapier@2.2.0`. **No new packages** — canvas 2D texture generation needs nothing that is not already in the browser.

## Global Constraints

- **The only files this plan modifies are `src/components/BeadScene.tsx` and `PROGRESS.md`.** Do not touch `src/lib/beadSpawnRate.ts`, `src/lib/worldbank.ts`, `src/App.tsx`, `src/components/GlobeView.tsx`, or `src/components/ui/cobe-globe.tsx`.
- **Do not change any of these, in any task:** the click-to-select/toggle mechanic; `spawnIntervalMs` / `birthsPerSecond` / `deathsPerSecond` spawn-rate logic; `resolveBeadColors` / `normalizeCssColor` (the two base tints must keep coming from `--accent` and `--foreground` through the existing canvas-rasterisation round-trip); App's `key={selectedIso3}` remount; the canvas's `style={{ pointerEvents: 'none' }}` override and the `pointer-events-none` wrapper; `GRAVITY_PX_PER_S2`, `Boundaries`, `GlobeCollider`, `BEAD_RADIUS`, `SPAWN_JITTER_PX`, the `RigidBody` restitution/friction/damping values.
- **Do not reintroduce drei's `MeshTransmissionMaterial`, and do not switch `<Environment>` to `preset=` or `files=`.** Both were rejected on source evidence in `docs/superpowers/plans/2026-08-02-bead-scene-phase-2.md` (per-instance FBOs and per-instance full scene renders; a 1–2MB runtime HDRI fetch from raw.githack.com). Nothing in this plan changes that reasoning.
- **Do not un-share materials.** Phase 2's central invariant is that a *small fixed set* of materials is shared across all live beads, because three runs `renderTransmissionPass` once per camera per frame for every transmissive object at once (`node_modules/three/src/renderers/WebGLRenderer.js`). This plan takes that set from 2 to 8 — which is still O(1) in bead count, still one compiled program (all eight have identical shader defines), and still one transmission pass. It must never become O(beads).
- **No new npm packages. Never run `npm install`.**
- **No test framework exists in this repo.** `package.json` scripts are only `dev` / `build` / `lint` / `preview`; `lint` is `oxlint`. Do NOT write Jest/Vitest tests. Verification is `npx tsc --noEmit`, `npx oxlint src`, browser-pane console/network/`javascript_tool` probes, and one explicit human checkpoint (Task 4).
- **The browser-pane sandbox cannot verify rendered pixels or timing.** Documented repeatedly in `PROGRESS.md`: frames are not composited when the pane is unfocused, `requestAnimationFrame` does not reliably tick, and a Phase 2 renderer-info probe **never fired** for exactly this reason. **Never call the screenshot action. Never write an in-sandbox FPS probe** — Phase 2's plan contained one and it produced nothing. Anything about appearance or frame rate goes to Task 4's human checkpoint.
- **Known pre-existing noise to ignore when judging "clean":** `npx tsc --noEmit` emits a `baseUrl` deprecation warning; `npx oxlint src` emits one warning in `src/components/ui/button.tsx`; the browser pane's console holds stale HMR "Failed to reload" messages across reloads. All three predate this work. Anything else is a regression.
- **All world units in `BeadScene.tsx` are CSS pixels** (orthographic camera, no manual frustum override).
- **Assign `dispersion` after construction, not in the `MeshPhysicalMaterialParameters` object.** The shipped code already does this because the installed `@types/three` may lag the runtime property list. Keep that shape.
- The dev server is launched from the browser pane with `preview_start({ name: "hourglass-earth-dev" })` (`.claude/launch.json`, port 5173). Do not start servers with Bash.
- **Performance is a hard constraint that outranks every visual in this plan.** If the human checkpoint in Task 4 reports under 30fps, the degrade ladder in Task 4 Step 3 is applied in order until it passes — visuals give way, not the frame rate.

---

### Task 1: Evicted beads shrink out instead of vanishing

**Files:**
- Modify: `src/components/BeadScene.tsx` (import line 1; constants block after line 35; `BeadBody` at lines 288–311; the `BeadScene` body's `Bead` interface at lines 76–80, the spawn effect at lines 349–369, and the bead map at lines 423–429)

**Interfaces:**
- Consumes: the shipped `Bead`, `BEAD_GEOMETRY`, `MAX_BEADS`, `SPAWN_JITTER_PX`, `BeadBody`, `useBeadMaterials`.
- Produces (consumed by Tasks 2 and 3):
  - `interface Bead { id: number; kind: 'birth' | 'death'; x: number; dying: boolean }` (Task 2 adds one more field)
  - `const BEAD_EXIT_MS: number`
  - `function BeadFadeOut(props: { meshRef: RefObject<THREE.Mesh | null>; id: number; onExpire: (id: number) => void }): null`
  - `BeadBody` prop shape becomes `{ bead: Bead; material: THREE.Material; onExpire: (id: number) => void }`

**Background the implementer needs — read all four points before writing code:**

1. **What the bug actually is.** The current spawn reducer is `const kept = prev.length >= MAX_BEADS ? prev.slice(prev.length - MAX_BEADS + 1) : prev.slice()`. The instant the array hits the cap, element 0 is dropped from the React tree, and react-three-rapier tears its `RigidBody` out of the physics world on the very next commit. Element 0 is the *oldest* bead, which after ~10 seconds is almost always one that has already settled at the bottom of the pile. So the user sees a settled bead blink out of existence at the exact moment a new one appears at the top. Nothing is random about it and nothing is broken in the physics — it is an animation that was never written.

2. **Why scale and not opacity.** Fading `MeshPhysicalMaterial.opacity` requires `transparent: true` **and** a per-bead `opacity` value, and `opacity` lives on the material. With eight shared materials (Task 2) that would mean either cloning a material per dying bead — reintroducing exactly the per-bead material allocation Phase 2 removed, and worse, forcing three to re-evaluate its transmissive-object sort — or an `onBeforeCompile` uniform hack, which cannot vary per mesh through a shared program anyway. On top of that, a transmissive material's alpha is already computed by three (`material.transmissionAlpha = mix(1.0, transmitted.a, material.transmission)` in `transmission_fragment.glsl.js`) and setting `transparent: true` on top of it changes the render queue the bead sits in. **`Object3D.scale` lives on the mesh, not the material**, so it is per-bead by construction and touches zero shared state. It also looks better: a shrinking sphere of glass keeps refracting all the way down, so it reads as receding rather than dissolving.

3. **The collider is deliberately not resized.** Rapier reads collider arguments once, at body creation. Resizing would mean recreating the body, which teleports the bead back to its spawn position (the existing comment on `BeadBody` says exactly this). So for the ~420ms of the shrink, the bead draws smaller than it collides. The visible consequence is that the pile settles into the gap a moment *after* the bead has gone, which is the correct reading anyway — and 420ms is short enough that nobody parses the intermediate frames as a floating neighbour.

4. **`useFrame` must not be subscribed by every bead.** Hooks cannot be called conditionally, so putting `useFrame` directly in `BeadBody` would put ~70 callbacks on the render loop every frame so that at most a handful can do anything. Rendering a separate, null-returning companion component **conditionally** moves that cost to exactly the beads that need it. Peak dying count is bounded: the fastest `spawnIntervalMs` is 120ms per stream (`src/lib/beadSpawnRate.ts`), two streams, so ≤16.7 evictions/second × 0.42s ≈ **7** dying beads at the absolute worst case, on top of the 70 live ones.

- [ ] **Step 1: Extend the React import**

Replace line 1 of `src/components/BeadScene.tsx`:

```tsx
import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react'
```

with:

```tsx
import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
```

and add `useFrame` to the react-three-fiber import (currently line 3):

```tsx
import { Canvas, useFrame, useThree } from '@react-three/fiber'
```

- [ ] **Step 2: Add the exit-duration constant**

Immediately after the `export const MAX_BEADS = 70` line (currently line 35), add:

```tsx
// How long an evicted bead takes to shrink away before it is actually
// removed from the array — and therefore from the physics world, since a
// removed <RigidBody> is torn out of Rapier on the next commit.
//
// Long enough to read as a deliberate exit, short enough that the pile's
// collapse into the gap still feels causally connected to it. It also
// bounds how far the array can exceed MAX_BEADS: the fastest spawn
// interval is 120ms per stream (src/lib/beadSpawnRate.ts) across two
// streams, so at most ~7 beads are mid-exit at any moment.
const BEAD_EXIT_MS = 420
```

- [ ] **Step 3: Add `dying` to the `Bead` interface**

Replace the `Bead` interface (currently lines 76–80) with:

```tsx
interface Bead {
  id: number
  kind: 'birth' | 'death'
  x: number
  /** Set by the spawn loop when this bead is evicted at the MAX_BEADS cap.
   * The bead stays in the array — and in the physics world — until
   * BeadFadeOut has shrunk it away and called onExpire. */
  dying: boolean
}
```

- [ ] **Step 4: Add the `BeadFadeOut` companion component**

Add immediately before the `BeadBody` declaration (i.e. before the comment block currently starting at line 288):

```tsx
// Drives the shrink-out of an evicted bead, and is the thing that finally
// removes it. Rendered only while `bead.dying` is true, deliberately:
// useFrame cannot be called conditionally, so subscribing all ~70 live
// beads to the render loop just so that a couple of them can animate would
// put 70 callbacks on every frame for nothing. A conditionally rendered
// companion moves that cost onto exactly the beads that need it.
//
// Scale, not opacity. Fading a MeshPhysicalMaterial needs transparent:true
// and a per-bead `opacity`, and opacity lives on the material — with the
// shared materials this file is built around (see useBeadMaterials) that
// would mean cloning a material per dying bead, which is precisely the
// per-bead allocation Phase 2 removed. Scale lives on the mesh's own
// Object3D, so it is per-bead by nature and touches no material state at
// all. It also simply looks better: a shrinking sphere of glass keeps
// refracting the whole way down, so it reads as receding rather than as
// dissolving.
//
// The collider is NOT resized. Rapier reads collider args once, at body
// creation, so resizing means recreating the body — which would teleport a
// settled bead back to the spawn point. For these ~420ms the bead
// therefore occupies slightly more space than it draws, and the pile
// visibly settles into the gap just after it has gone. That is the correct
// reading, and at this duration nobody parses the in-between frames.
function BeadFadeOut({
  meshRef,
  id,
  onExpire,
}: {
  meshRef: RefObject<THREE.Mesh | null>
  id: number
  onExpire: (id: number) => void
}) {
  const elapsedRef = useRef(0)
  // onExpire triggers a setState, and React may render one more frame
  // before the removal commits. Without this latch that frame would call
  // onExpire a second time with an id that is already gone.
  const doneRef = useRef(false)
  useFrame((_, delta) => {
    if (doneRef.current) return
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

- [ ] **Step 5: Rewrite `BeadBody` to hold a mesh ref and mount the companion**

Replace the whole `BeadBody` block (currently lines 288–311, comment included) with:

```tsx
// Beads share one geometry and one of a small fixed set of materials (see
// BEAD_GEOMETRY and useBeadMaterials), passed in as a prop rather than
// declared as a child element — declaring it as a child is what would give
// every bead its own copy. `dispose={null}` tells react-three-fiber not to
// dispose these shared objects when an individual bead is culled by the
// MAX_BEADS cap; their lifetimes are owned by the module and by
// useBeadMaterials.
//
// RigidBody `position` is only read when the body is created, so stable
// React keys matter: a changing key would recreate the body and teleport a
// settled bead back to the spawn point.
//
// BeadFadeOut sits OUTSIDE the RigidBody on purpose. It renders null, so
// it is inert either way, but keeping it out of the RigidBody's subtree
// keeps react-three-rapier's child traversal (which is what derives the
// ball collider from the mesh) looking at exactly one child, as before.
const BeadBody = memo(function BeadBody({
  bead,
  material,
  onExpire,
}: {
  bead: Bead
  material: THREE.Material
  onExpire: (id: number) => void
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
      {bead.dying && <BeadFadeOut meshRef={meshRef} id={bead.id} onExpire={onExpire} />}
    </>
  )
})
```

- [ ] **Step 6: Rewrite the spawn reducer to mark rather than delete, and add the expiry callback**

Replace the whole spawn `useEffect` (currently lines 349–369) with:

```tsx
  // Stable identity: BeadBody is memo()'d, so a fresh callback on every
  // render would defeat that memo for all ~70 beads on every spawn tick.
  // The functional setState means it never needs to close over `beads`.
  const expireBead = useCallback((id: number) => {
    setBeads((prev) => prev.filter((bead) => bead.id !== id))
  }, [])

  useEffect(() => {
    function spawn(kind: 'birth' | 'death') {
      setBeads((prev) => {
        // Evicting the oldest bead is what keeps the scene bounded, but
        // deleting it outright is what made beads appear to blink out of
        // existence: after a few seconds the oldest bead is almost always
        // one that has already settled at the bottom of the pile, so the
        // eviction reads as a settled bead vanishing at the exact instant a
        // new one appears at the top. Instead the oldest LIVE bead is
        // flagged `dying`; BeadFadeOut shrinks it over BEAD_EXIT_MS and
        // then calls expireBead, which is what finally removes it.
        //
        // MAX_BEADS therefore caps live beads, not array length — a handful
        // of dying beads ride along for under half a second each (see the
        // bound in BEAD_EXIT_MS's comment).
        const live = prev.reduce((count, bead) => (bead.dying ? count : count + 1), 0)
        let next = prev
        if (live >= MAX_BEADS) {
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
            dying: false,
          },
        ]
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

- [ ] **Step 7: Pass `onExpire` at the call site**

Replace the bead map (currently lines 423–429) with:

```tsx
            {beads.map((bead) => (
              <BeadBody
                key={bead.id}
                bead={bead}
                material={bead.kind === 'birth' ? materials.birth : materials.death}
                onExpire={expireBead}
              />
            ))}
```

(The `material` expression is replaced again in Task 2 Step 6; leave it as-is for now so this task ends in a working, committable state.)

- [ ] **Step 8: Typecheck and lint**

```bash
npx tsc --noEmit && npx oxlint src
```

Expected: clean apart from the two known pre-existing warnings. If `RefObject<THREE.Mesh | null>` is rejected, the installed React types are pre-19 — in that case use `RefObject<THREE.Mesh>` and keep the `?.` in `BeadFadeOut`; do not add a cast.

- [ ] **Step 9: Verify in the browser what the sandbox can actually verify**

`preview_start({ name: "hourglass-earth-dev" })`, then select a country with the click-dispatch snippet from `docs/superpowers/plans/2026-08-01-bead-scene.md` (Task 1, Step 8).

1. `read_console_messages` — assert no **new** errors beyond the documented stale HMR noise. In particular no `Cannot read properties of null`, no React "Maximum update depth exceeded" (which is what an `expireBead` loop would look like), and no Rapier errors.
2. Wait ~60 seconds so the cap is well past, then `javascript_tool`:

```js
(() => {
  const c = [...document.querySelectorAll('canvas')].find((el) => el.parentElement?.parentElement?.classList.contains('pointer-events-none'))
  if (!c) return 'FAIL: bead canvas not found'
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  return JSON.stringify({ found: true, contextLost: gl ? gl.isContextLost() : 'no-context' })
})()
```
   Expected `found: true`, `contextLost: false`. Do **not** assert on `c.width`/`c.height` — `ResizeObserver` does not fire in this pane.
3. Re-run `read_console_messages` after that 60 seconds. **This is the load-bearing check for this task:** the failure mode of a broken expiry path is unbounded array growth, and unbounded growth in a React tree of `RigidBody`s surfaces as either a memory warning or a "Too many active WebGL contexts" message here. Silence over 60s at the fastest realistic spawn rate is real evidence the two-stage eviction closes.
4. Deselect (run the click snippet again) and re-run `read_console_messages`. Assert no errors on unmount — this is the path where a `useFrame` callback could outlive its mesh.

**What this step deliberately does not claim:** it cannot tell you whether the shrink-out is visible or whether it looks graceful. `requestAnimationFrame` does not reliably tick in this pane, so `useFrame` may not run here at all. That goes to Task 4.

- [ ] **Step 10: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "Shrink evicted beads out over 420ms instead of removing them instantly"
```

---

### Task 2: Procedural marble textures

**Files:**
- Modify: `src/components/BeadScene.tsx` (constants block after `BEAD_EXIT_MS`; `Bead` interface; `useBeadMaterials` at lines 134–181; the bead map in `BeadScene`'s JSX; the spawn reducer's bead literal from Task 1 Step 6)

**Interfaces:**
- Consumes from Task 1: `Bead` (gains a field), `BEAD_EXIT_MS`, `BeadBody({ bead, material, onExpire })`, `expireBead`.
- Produces (consumed by Task 3):
  - `const MARBLE_TEXTURE_WIDTH: number`, `MARBLE_TEXTURE_HEIGHT: number`, `MARBLE_SWIRL_VARIANTS: number`, `MARBLE_CATSEYE_VARIANTS: number`, `export const MARBLE_VARIANTS: number`
  - `interface MarblePalette { base: string; ribbons: string[] }`
  - `function mulberry32(seed: number): () => number`
  - `function marblePalette(tint: string): MarblePalette`
  - `function paintSwirl(ctx: CanvasRenderingContext2D, palette: MarblePalette, rand: () => number): void`
  - `function paintCatseye(ctx: CanvasRenderingContext2D, palette: MarblePalette, rand: () => number): void`
  - `function createMarbleTextures(tint: string, seed: number): (THREE.CanvasTexture | null)[]`
  - `useBeadMaterials(colors: BeadColors)` return type changes from `{ birth: MeshPhysicalMaterial; death: MeshPhysicalMaterial }` to `{ birth: THREE.MeshPhysicalMaterial[]; death: THREE.MeshPhysicalMaterial[]; textures: THREE.CanvasTexture[] }`
  - `Bead` gains `variant: number`

**Background the implementer needs — read all six points before writing code. Point 1 is the single riskiest assumption in this plan and it has been checked against the installed source:**

1. **A `map` DOES survive `transmission: 0.9` — it is not washed out, because three multiplies the *refracted* light by the diffuse colour.** This is the one thing that had to be true for this whole task to work, and the shader path in the installed `three@0.185.1` is explicit about it. In `node_modules/three/src/renderers/shaders/ShaderChunk/map_fragment.glsl.js`, `diffuseColor *= sampledDiffuseColor` — so `map` multiplies into `diffuseColor`. In `lights_physical_fragment.glsl.js` line 4, `material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor )`, and metalness is 0 here so that is `diffuseColor` untouched. In `transmission_fragment.glsl.js`, `material.diffuseContribution` is passed as the `diffuseColor` argument of `getIBLVolumeRefraction`. And inside that function (`transmission_pars_fragment.glsl.js` lines 199 and 218):

   ```glsl
   transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
   ...
   vec3 attenuatedColor = transmittance * transmittedLight.rgb;
   return vec4( ( 1.0 - F ) * attenuatedColor, ... );
   ```

   So the marble texture modulates **both** the 10% of the diffuse term that `BEAD_TRANSMISSION = 0.9` holds back **and** the 90% that comes back as refracted light. There is no washing-out term. This is exactly the "colour trapped inside glass" technique the web glass-marble demos use, and it is why `map` is the right integration point rather than an emissive layer or a second nested sphere.

2. **The consequence: `attenuationColor` must be pulled back, or it will crush the swirl into one flat hue.** `volumeAttenuation` is Beer–Lambert, `exp(-(-log(attenuationColor)/attenuationDistance) * dist)`, and it multiplies the *same* term the map does. The shipped setup is `attenuationColor = tint` at `attenuationDistance = BEAD_RADIUS`, which is aggressive on purpose — it was the only colour carrier before. With the map carrying colour, leaving that as-is would multiply every ribbon by a strong red (or a strong near-black, in the light theme's death tint) and the swirl would be invisible. Task 3 owns the exact rebalance; this task must set `color` to white where a map exists, so the tint is not applied twice.

3. **`SphereGeometry` UVs are equirectangular, and that is a feature here, not a problem.** A stroke drawn top-to-bottom in canvas space (v = 0 → 1) maps to a band that converges to a point at both poles of the bead. That is *exactly* how the ribbons in a real swirl marble and the vanes in a real cat's-eye marble are arranged. The usual equirectangular complaint — pole pinching — is the effect we want. Strokes that cross the u = 0 seam are handled by drawing each stroke three times at x−W, x, x+W with `wrapS = RepeatWrapping`.

4. **What a cat's-eye marble actually is, since it must be visibly distinct from the swirls.** Clear glass with a single flattened fan of coloured vanes suspended in the middle — hard-edged, few, symmetric, on an otherwise colourless body. Not ribbons. It is painted with `fill()`ed lens/leaf paths (wide at the equator, tapering to a point at both poles) on a near-white base, versus the swirls' many soft blurred `stroke()`s on a tinted base.

5. **Eight shared materials is still O(1), not O(beads).** Materials with identical shader defines compile to one program in three's program cache — all eight have `USE_MAP`, `USE_TRANSMISSION`, `USE_DISPERSION`, `USE_ENVMAP` set identically, so `gl.info.programs.length` stays single-digit. Draw calls are unchanged (still one per bead). `renderTransmissionPass` is still called once per camera per frame. The only thing that grows is eight small uniform sets and eight textures. This does not contradict the Phase 2 plan's shared-material reasoning; it is that reasoning applied at a slightly larger constant.

6. **Textures are painted once per theme, never per bead and never per frame.** Generation lives inside `useBeadMaterials`'s existing `useMemo([colors])`, which already only re-runs on a theme flip. Total cost: 8 canvases × ~20 blurred bezier strokes.

- [ ] **Step 1: Add the marble constants**

Immediately after the `BEAD_EXIT_MS` block from Task 1 Step 2, add:

```tsx
// Marble textures. Each is an equirectangular canvas painted once per
// theme and handed to one shared material as its `map`.
//
// 256x128 because SphereGeometry's UVs are equirectangular (2:1) and
// because a bead is at most ~68 CSS pixels across on screen — a texel
// density well past what refraction through a 1.52-IOR sphere can resolve.
// All eight textures together are 8 * 256 * 128 * 4 bytes ~= 1.0MB, ~1.4MB
// once three has built the mipmap chain. Negligible next to the
// environment cube map.
const MARBLE_TEXTURE_WIDTH = 256
const MARBLE_TEXTURE_HEIGHT = 128
// Three swirl variants and one catseye, per tint. Four is enough that a
// 70-bead pile does not read as 70 copies of one object, and few enough
// that generation stays a handful of milliseconds on a theme flip. The
// catseye is deliberately a minority: it is the distinctive one, and it
// reads as special precisely because roughly a quarter of the pile has it.
const MARBLE_SWIRL_VARIANTS = 3
const MARBLE_CATSEYE_VARIANTS = 1
export const MARBLE_VARIANTS = MARBLE_SWIRL_VARIANTS + MARBLE_CATSEYE_VARIANTS
```

- [ ] **Step 2: Add the deterministic PRNG and the palette derivation**

Add immediately after `resolveBeadColors` (currently ends at line 132), before `useBeadMaterials`:

```tsx
// Deterministic PRNG (mulberry32). Math.random() would repaint different
// marbles on every reload and every theme flip, which makes the human
// visual checkpoint impossible to reason about — "the catseye variant
// looked wrong" has to mean the same thing twice in a row.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface MarblePalette {
  /** The clear body of the glass. Near-white, because it multiplies the
   * refracted light everywhere the ribbons are not (see the shader note on
   * useBeadMaterials) — anything dark here reads as a hole, not as glass. */
  base: string
  /** Ribbon / vane colours, most saturated first. */
  ribbons: string[]
}

// Every colour in a marble is derived from one of the two resolved tints,
// so a birth marble is still unmistakably the accent red and a death
// marble unmistakably the foreground tone. The birth/death distinction is
// the entire point of the feature and the swirls must not blur it; what
// the extra hues buy is that a bead reads as *swirled glass* rather than
// as a flat coloured ball.
//
// HSL is read and written in explicit SRGBColorSpace. three's default
// working colour space is Linear-sRGB (Color.getHSL/setHSL default to
// ColorManagement.workingColorSpace, node_modules/three/src/math/Color.js
// lines 248 and 567), so an unqualified round-trip would rotate hue and
// scale lightness in linear light and produce visibly darker, differently
// hued results than the CSS-style colours the rest of this file deals in.
function marblePalette(tint: string): MarblePalette {
  const hsl = { h: 0, s: 0, l: 0 }
  new THREE.Color(tint).getHSL(hsl, THREE.SRGBColorSpace)
  const shade = (dh: number, s: number, l: number) =>
    `#${new THREE.Color()
      .setHSL(
        (hsl.h + dh + 1) % 1,
        THREE.MathUtils.clamp(s, 0, 1),
        THREE.MathUtils.clamp(l, 0, 1),
        THREE.SRGBColorSpace,
      )
      .getHexString(THREE.SRGBColorSpace)}`
  // Lightness floor. The light theme's --foreground is oklch(0.2 0 0),
  // i.e. very nearly black, and a near-black texel does not read as "dark
  // glass" — it multiplies the refracted light to zero and reads as a hole
  // punched in the bead.
  const l = Math.max(hsl.l, 0.16)
  return {
    base: shade(0, hsl.s * 0.25, Math.min(0.92, l + (1 - l) * 0.82)),
    ribbons: [
      shade(0, hsl.s, l),
      shade(0.055, hsl.s * 0.85, Math.min(0.85, l + 0.22)),
      shade(-0.055, Math.min(1, hsl.s * 1.15), Math.max(0.16, l - 0.06)),
      shade(0, hsl.s * 0.4, Math.min(0.95, l + 0.42)),
    ],
  }
}
```

Note for the implementer: the death tint is a pure grey (`oklch(x 0 0)`), so `hsl.s` is ~0 and the hue rotations above are no-ops for it. Death marbles come out as smoke-grey swirls rather than rainbow ones. **That is the correct outcome, not a bug** — the death colour must stay the foreground colour. Do not "fix" it by injecting an arbitrary hue.

- [ ] **Step 3: Add the two painters**

Add immediately after `marblePalette`:

```tsx
// Swirl variant: soft ribbons running pole to pole.
//
// SphereGeometry's UVs are equirectangular, so a stroke that runs
// top-to-bottom in this canvas maps to a band that converges to a point at
// both poles of the bead — which is exactly how the ribbons in a real
// swirl marble are arranged. The notorious equirectangular pole pinch
// works FOR us here rather than against us.
//
// Each ribbon is drawn three times, offset by -W, 0 and +W, so a stroke
// that crosses the u = 0 seam appears on both sides of it and the texture
// wraps without a visible join. The texture's wrapS is RepeatWrapping for
// the same reason.
function paintSwirl(ctx: CanvasRenderingContext2D, palette: MarblePalette, rand: () => number) {
  const w = MARBLE_TEXTURE_WIDTH
  const h = MARBLE_TEXTURE_HEIGHT
  ctx.fillStyle = palette.base
  ctx.fillRect(0, 0, w, h)
  // Canvas 2D's own blur is what sells "suspended inside the glass";
  // hard-edged strokes read as paint on the surface instead. This runs
  // once per texture, not per frame, so its cost is irrelevant.
  ctx.filter = 'blur(3px)'
  ctx.lineCap = 'round'
  const ribbons = 5
  for (let i = 0; i < ribbons; i++) {
    const x = ((i + 0.5 + (rand() - 0.5) * 0.6) / ribbons) * w
    const sway = (0.1 + rand() * 0.22) * w * (rand() < 0.5 ? -1 : 1)
    ctx.strokeStyle = palette.ribbons[i % palette.ribbons.length]
    ctx.lineWidth = (0.045 + rand() * 0.075) * w
    for (const dx of [-w, 0, w]) {
      ctx.beginPath()
      // Start above and end below the canvas so the stroke's round cap is
      // never visible as a blunt end at the poles.
      ctx.moveTo(x + dx, -0.1 * h)
      ctx.bezierCurveTo(x + dx + sway, 0.3 * h, x + dx - sway, 0.7 * h, x + dx, 1.1 * h)
      ctx.stroke()
    }
  }
  ctx.filter = 'none'
}

// Catseye variant: a real cat's-eye marble is clear glass with a single
// flattened fan of coloured vanes suspended in the middle of it — hard
// edges, few of them, symmetric, on an otherwise colourless body. It is
// NOT a swirl, and the whole reason the user asked for it is that it reads
// as a different object.
//
// Each vane is a filled lens/leaf: widest at the equator, tapering to a
// point at both poles, which under equirectangular UVs is exactly the
// shape a real vane has. Much less blur than paintSwirl, because the edge
// of a cat's-eye vane is genuinely sharp.
function paintCatseye(ctx: CanvasRenderingContext2D, palette: MarblePalette, rand: () => number) {
  const w = MARBLE_TEXTURE_WIDTH
  const h = MARBLE_TEXTURE_HEIGHT
  ctx.fillStyle = palette.base
  ctx.fillRect(0, 0, w, h)
  ctx.filter = 'blur(1.5px)'
  const vanes = 3
  for (let i = 0; i < vanes; i++) {
    const x = ((i + 0.5) / vanes) * w + (rand() - 0.5) * 0.05 * w
    const halfWidth = (0.055 + rand() * 0.03) * w
    ctx.fillStyle = palette.ribbons[i % palette.ribbons.length]
    for (const dx of [-w, 0, w]) {
      ctx.beginPath()
      ctx.moveTo(x + dx, 0)
      ctx.quadraticCurveTo(x + dx + halfWidth, h * 0.5, x + dx, h)
      ctx.quadraticCurveTo(x + dx - halfWidth, h * 0.5, x + dx, 0)
      ctx.fill()
    }
  }
  ctx.filter = 'none'
}
```

- [ ] **Step 4: Add the texture factory**

Add immediately after `paintCatseye`:

```tsx
// One THREE.CanvasTexture per variant, for one tint. Called twice (birth,
// death) from inside useBeadMaterials' useMemo, so it runs on mount and
// then only on a theme flip — never per bead, never per frame.
//
// Returns a fixed-length array with a null wherever a 2D context could not
// be obtained. That is the same defensive shape normalizeCssColor already
// uses in this file, and it degrades honestly: a null map makes
// useBeadMaterials fall back to exactly the flat-tint glass this file
// shipped before marbles existed, rather than producing a black bead.
function createMarbleTextures(tint: string, seed: number): (THREE.CanvasTexture | null)[] {
  const palette = marblePalette(tint)
  const textures: (THREE.CanvasTexture | null)[] = []
  for (let variant = 0; variant < MARBLE_VARIANTS; variant++) {
    const canvas = document.createElement('canvas')
    canvas.width = MARBLE_TEXTURE_WIDTH
    canvas.height = MARBLE_TEXTURE_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      textures.push(null)
      continue
    }
    // A distinct but stable stream per variant. 7919 is just a prime
    // stride, so variant 0 and variant 1 do not start from adjacent seeds
    // and come out looking like each other.
    const rand = mulberry32(seed + variant * 7919)
    if (variant < MARBLE_SWIRL_VARIANTS) paintSwirl(ctx, palette, rand)
    else paintCatseye(ctx, palette, rand)
    const texture = new THREE.CanvasTexture(canvas)
    // The canvas holds CSS colours, i.e. sRGB. Without this three treats
    // the bytes as already-linear and every marble comes out pale and
    // washed out — the classic silent colour-space bug, with no warning.
    texture.colorSpace = THREE.SRGBColorSpace
    // u wraps around the bead (paintSwirl draws seam-crossing strokes on
    // both sides for this to be seamless); v runs pole to pole and must
    // clamp, or the north pole would sample the south pole's texels.
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    // Beads are viewed at a grazing angle around their silhouette, which
    // is where the ribbons are most compressed. 4x is the cheap end of
    // anisotropic filtering and is what stops the edge ribbons aliasing
    // into shimmer as a bead rolls.
    texture.anisotropy = 4
    textures.push(texture)
  }
  return textures
}
```

- [ ] **Step 5: Rewrite `useBeadMaterials` to build one material per variant**

Replace the whole `useBeadMaterials` block (currently lines 134–181, comment included) with:

```tsx
// A small FIXED set of materials for the entire scene — MARBLE_VARIANTS
// per kind, eight in total — not one per bead. This is the invariant the
// glass conversion is built on: three runs its transmission pass once per
// camera per frame for every transmissive object at once
// (renderTransmissionPass in WebGLRenderer), so the marginal cost of the
// Nth glass bead is one more draw call, not one more render target. Eight
// materials rather than two does not weaken that at all: all eight compile
// to a single shader program (identical defines), draw calls are unchanged
// at one per bead, and the transmission pass is still called once. What
// must never happen is this set becoming a function of the bead count.
//
// The marble texture is the material's `map`, and that is not decorative:
// three multiplies the REFRACTED light by the diffuse colour —
// map_fragment.glsl.js does `diffuseColor *= sampledDiffuseColor`,
// lights_physical_fragment.glsl.js sets `material.diffuseContribution =
// diffuseColor.rgb * (1 - metalness)`, and
// transmission_pars_fragment.glsl.js line 218 does `transmittance =
// diffuseColor * volumeAttenuation(...)` before `attenuatedColor =
// transmittance * transmittedLight.rgb`. So the swirl survives
// transmission at full strength instead of being mixed out by it, which is
// the whole reason a flat `map` behind a transmissive surface is the
// standard "colour trapped inside glass" technique.
//
// Recreated only when the resolved colours change, i.e. on a theme flip.
// The cleanup disposes the previous materials AND their canvas textures;
// by the time it runs React has already committed the render in which
// every mesh points at the new set, so nothing is disposed while in use.
function useBeadMaterials(colors: BeadColors) {
  const materials = useMemo(() => {
    function glass(tint: string, map: THREE.CanvasTexture | null) {
      const material = new THREE.MeshPhysicalMaterial({
        // White where a marble texture exists: the map already carries
        // every colour in the bead, including the tint it was derived
        // from, so a tinted `color` would apply that tint twice and crush
        // the ribbons back into one flat hue. Where no texture could be
        // built (see createMarbleTextures), this falls back to exactly the
        // flat-tint glass this file shipped before marbles existed.
        color: new THREE.Color(map ? 0xffffff : tint),
        map,
        attenuationColor: new THREE.Color(tint),
        attenuationDistance: BEAD_ATTENUATION_DISTANCE,
        transmission: BEAD_TRANSMISSION,
        thickness: BEAD_THICKNESS,
        ior: BEAD_IOR,
        roughness: BEAD_ROUGHNESS,
        metalness: 0,
        envMapIntensity: 1.4,
      })
      // Assigned after construction rather than in the constructor object:
      // the installed @types/three's MeshPhysicalMaterialParameters may lag
      // behind the runtime three version and reject `dispersion` there even
      // though the runtime property exists (three 0.185+).
      material.dispersion = BEAD_DISPERSION
      return material
    }
    // Fixed seeds, not Date.now() or Math.random(): the same country in
    // the same theme must produce the same marbles on every reload, or the
    // human visual checkpoint has nothing stable to judge.
    const birthMaps = createMarbleTextures(colors.birth, 0x9e3779b1)
    const deathMaps = createMarbleTextures(colors.death, 0x85ebca77)
    return {
      birth: birthMaps.map((map) => glass(colors.birth, map)),
      death: deathMaps.map((map) => glass(colors.death, map)),
      textures: [...birthMaps, ...deathMaps].filter((map): map is THREE.CanvasTexture => map !== null),
    }
  }, [colors])

  useEffect(
    () => () => {
      for (const material of materials.birth) material.dispose()
      for (const material of materials.death) material.dispose()
      // Materials do not dispose their maps, so the canvas textures have
      // to be released explicitly or a theme flip leaks 1MB of VRAM.
      for (const texture of materials.textures) texture.dispose()
    },
    [materials],
  )

  return materials
}
```

- [ ] **Step 6: Assign a variant at spawn and index into the material arrays**

In the `Bead` interface (Task 1 Step 3), add one field before `dying`:

```tsx
  /** Which marble texture this bead got, in [0, MARBLE_VARIANTS). Chosen
   * once at spawn and never changed, so a bead does not swap appearance
   * mid-fall. */
  variant: number
```

In the spawn reducer (Task 1 Step 6), change the appended bead literal to:

```tsx
          {
            id: nextIdRef.current++,
            kind,
            x: (Math.random() - 0.5) * 2 * SPAWN_JITTER_PX,
            variant: Math.floor(Math.random() * MARBLE_VARIANTS),
            dying: false,
          },
```

And in the bead map (Task 1 Step 7), change the `material` prop to:

```tsx
                material={(bead.kind === 'birth' ? materials.birth : materials.death)[bead.variant]}
```

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit && npx oxlint src
```

Expected: clean apart from the two known pre-existing warnings. If TypeScript rejects the fourth argument to `setHSL`/`getHSL` or the argument to `getHexString`, the installed `@types/three` lags the runtime (the runtime signatures are at `node_modules/three/src/math/Color.js:248`, `:553`, `:567`) — in that case drop the explicit `THREE.SRGBColorSpace` arguments, and **note in the commit message that the palette is being derived in linear working space**, because the human checkpoint will then need to check for over-dark ribbons specifically.

- [ ] **Step 8: Verify in the browser what the sandbox can actually verify**

Refresh the dev server page and select a country.

1. `read_console_messages` — assert no new errors. Specifically no `THREE.WebGLProgram: Shader Error`, no `Program Info Log`, and no `THREE.Texture` warnings. A shader-compile failure caused by adding `USE_MAP` to a transmissive material is the most likely way this task fails, and it *is* visible here.
2. `read_network_requests` with `urlPattern` `hdr`, then again with `githack` — both must still be **zero**. This task adds textures and must not have added a fetch.
3. Wait ~30 seconds, then `javascript_tool`:

```js
(() => {
  const c = [...document.querySelectorAll('canvas')].filter((el) => el.width && el.height)
  return JSON.stringify({ canvasCount: document.querySelectorAll('canvas').length, sized: c.length })
})()
```
   Informational only — `createMarbleTextures` creates detached canvases that are never appended to the DOM, so this count must **not** have grown by 8. If it did, someone appended them.
4. Toggle the theme (`javascript_tool`: `document.querySelector('[aria-label^="Switch to"]').click()`), wait, re-run `read_console_messages`. Assert no errors — this is the path that disposes eight materials and eight textures and rebuilds them, and a use-after-dispose surfaces as a WebGL warning here.
5. Deselect and re-run `read_console_messages`. Assert no errors on unmount.

**What this step deliberately does not claim:** whether the swirls are visible through the refraction, whether the cat's-eye variant reads as a cat's-eye, whether the birth/death distinction survived, or what the frame rate is. All four go to Task 4. Do **not** substitute your own judgement for them.

- [ ] **Step 9: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "Paint procedural swirl and catseye marble textures into the bead glass"
```

---

### Task 3: Sharper reflections and refraction

**Files:**
- Modify: `src/components/BeadScene.tsx` (the glass tuning constants at lines 37–65; `useBeadMaterials`'s `glass()` from Task 2 Step 5; `BeadEnvironment` at lines 183–207; the `<BeadEnvironment>` element in `BeadScene`'s JSX)

**Interfaces:**
- Consumes from Task 2: `useBeadMaterials`'s `glass(tint, map)` factory, `MARBLE_VARIANTS`.
- Produces (consumed by Task 4): `const BEAD_CLEARCOAT: number`, `const BEAD_CLEARCOAT_ROUGHNESS: number`, `const BEAD_ENV_RESOLUTION: number`, `const BEAD_ENV_INTENSITY: number`; `BEAD_ATTENUATION_DISTANCE` changes value; `BeadEnvironment`'s props become `{ intensity: number; resolution: number }`.

**Background the implementer needs — read all four points before writing code:**

1. **The 64px environment map is the bottleneck, and three's own source says so.** `lights_physical_fragment.glsl.js` line 10 reads `material.roughness = max( roughnessFactor, 0.0525 );// 0.0525 corresponds to the base mip of a 256 cubemap`. three's roughness floor is calibrated against a **256px** cube map. `BEAD_ROUGHNESS = 0.08` therefore asks the IBL for a near-mirror reflection — and a 64px cube map physically has no such detail to give. The result is that every specular highlight is a soft undifferentiated blob, which is precisely the "flat / rendered in 2003" read the user is reacting to. Raising the resolution to 256 is not a marginal tweak; it is giving the shader something to reflect. It is also drei's own default (`node_modules/@react-three/drei/core/Environment.js:90`).

2. **This costs nothing per frame.** `<Environment frames={1}>` bakes once and stops (`Environment.js`'s `useLayoutEffect` calls `camera.current.update(gl, virtualScene)` exactly once when `frames === 1`). The bake is 6 faces at 256² plus a PMREM chain — a few milliseconds, once, on mount and again on a theme flip. The only ongoing cost is VRAM: the target is `HalfFloatType` (`Environment.js:112`), so 6 × 256² × 8 bytes ≈ 3.1MB, plus roughly 1.4MB for the PMREM chain. ~4.5MB is nothing on any GPU that can run this scene at all, and it buys the single largest visual improvement available.

3. **Clearcoat is the cheapest "does this look raytraced" cue there is.** `MeshPhysicalMaterial` supports it natively and three composites it over everything else, transmission included — `meshphysical.glsl.js:212`: `outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat`. What it adds visually is a **second, much sharper specular layer** that is not tinted by the glass body and not blurred by the base roughness, i.e. a crisp white rim and hot-spot sitting on top of a coloured interior — exactly the layered look real glass has and a single-lobe material cannot fake. What it costs is one extra cube-map sample plus a GGX direct term and a Fresnel per fragment, with **no extra material texture** (no `clearcoatNormalMap`, so three uses the geometry normal for free). Roughly a 15-20% increase in the bead's fragment shader cost, against a fragment count that Task 4 shows is nowhere near the budget.

4. **Attenuation has to come back now that the map carries the colour.** With `attenuationColor = tint` at `attenuationDistance = BEAD_RADIUS`, Beer–Lambert multiplies the *same* transmitted term the marble texture multiplies (see Task 2's Background point 1), so every ribbon in a birth marble would be multiplied by a strong red and every ribbon in a light-theme death marble by a near-black. The swirl would be technically present and visually gone. Tripling the distance and desaturating the attenuation colour toward white keeps a residual body tint — which still helps birth/death legibility at a glance across a full pile — while letting the texture be the thing you actually see.

- [ ] **Step 1: Rewrite the glass tuning constants block**

Replace `const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS` (currently line 54) with:

```tsx
// Beer-Lambert attenuation. Deliberately weak now: it multiplies the same
// transmitted term the marble texture does (see the shader trace on
// useBeadMaterials), so the tight one-radius distance this used to have
// would multiply every ribbon by a full-strength tint and flatten the
// swirl back into a single hue — technically present, visually gone.
// Three radii leaves a residual body tint, which is what still separates a
// red pile from a grey one at a glance, and lets the texture be the thing
// you actually look at.
const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS * 3
```

Then, immediately after `const BEAD_DISPERSION = 2.5` (currently line 65), add:

```tsx
// A second, much sharper specular layer on top of the glass body.
// MeshPhysicalMaterial composites it over everything else, transmission
// included (three's meshphysical.glsl.js:212: `outgoingLight =
// outgoingLight * (1 - clearcoat * Fcc) + (clearcoatSpecularDirect +
// clearcoatSpecularIndirect) * clearcoat`). What it buys is a crisp white
// rim and hot-spot that is neither tinted by the glass nor blurred by
// BEAD_ROUGHNESS — the layered look real glass has and a single specular
// lobe cannot fake, and the cheapest "does this look raytraced" cue
// available. What it costs is one more cube-map sample plus a GGX term per
// fragment; there is no clearcoatNormalMap, so three uses the geometry
// normal for free.
const BEAD_CLEARCOAT = 1
// Lower than BEAD_ROUGHNESS on purpose: the whole point of the layer is
// that it is sharper than the surface underneath it.
const BEAD_CLEARCOAT_ROUGHNESS = 0.04

// Environment cube map resolution. 64 was the bottleneck on how convincing
// the reflections could be, and three's own source says why:
// lights_physical_fragment.glsl.js clamps roughness with the comment
// "0.0525 corresponds to the base mip of a 256 cubemap". BEAD_ROUGHNESS is
// 0.08, i.e. the shader asks the IBL for a near-mirror reflection, and a
// 64px cube map has no such detail to give — every highlight comes back as
// an undifferentiated blob. This is also drei's own default.
//
// It costs nothing per frame: <Environment frames={1}> bakes once and
// stops. The only ongoing cost is VRAM — 6 faces * 256^2 * 8 bytes
// (HalfFloatType) ~= 3.1MB plus ~1.4MB of PMREM chain.
const BEAD_ENV_RESOLUTION = 256
// Lowered from 1.4 with the move to a 256px map and a clearcoat layer:
// both add specular energy, and the previous value blows the highlights
// out into white discs.
const BEAD_ENV_INTENSITY = 1.15
```

- [ ] **Step 2: Add clearcoat and desaturate the attenuation colour in `glass()`**

Inside `useBeadMaterials`'s `glass()` (Task 2 Step 5), replace the `attenuationColor` and `envMapIntensity` entries and add the two clearcoat entries, so the constructor object reads:

```tsx
      const material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(map ? 0xffffff : tint),
        map,
        // Pulled 60% toward white where a marble texture exists. Beer-Lambert
        // multiplies the same transmitted light the map does, so a
        // full-strength attenuation colour on top of a textured bead is the
        // tint applied twice. Without a texture the tint is the only colour
        // the bead has, so it stays at full strength there.
        attenuationColor: map
          ? new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.6)
          : new THREE.Color(tint),
        attenuationDistance: BEAD_ATTENUATION_DISTANCE,
        transmission: BEAD_TRANSMISSION,
        thickness: BEAD_THICKNESS,
        ior: BEAD_IOR,
        roughness: BEAD_ROUGHNESS,
        clearcoat: BEAD_CLEARCOAT,
        clearcoatRoughness: BEAD_CLEARCOAT_ROUGHNESS,
        metalness: 0,
        envMapIntensity: BEAD_ENV_INTENSITY,
      })
```

- [ ] **Step 3: Raise the environment resolution and give it a shape worth reflecting**

Replace the `BeadEnvironment` component (currently lines 183–207, comment included) with:

```tsx
// A lighting rig built from emissive planes and baked locally into a cube
// map. Two reasons it is shaped this way rather than <Environment
// preset="studio">: drei's presets fetch a 1-2MB HDRI from
// raw.githack.com at runtime, which is an outbound network dependency on a
// demo machine; and a locally baked map is deterministic and, with
// frames={1}, costs nothing after the first frame.
//
// memo() is load-bearing, not hygiene. drei's <Environment> re-runs its
// layout effect — and with frames={1} that effect re-renders the whole
// cube map — whenever its `children` element identity changes. BeadScene
// re-renders on every spawn (up to ~8/second), so without this memo the
// cube map would be re-baked several times a second forever. That was
// already true at 64px; at 256px it would be catastrophic.
//
// The fifth lightformer is new and is there for a specific reason:
// reflections read as *real* when the viewer can identify the shape being
// reflected. Four broad soft sources give a bead an even sheen; one small,
// bright, clearly rectangular "window" gives it a recognisable hard
// highlight that slides across the surface as the bead rolls, which is the
// single most convincing raytracing cue at this scale. It is bright and
// small rather than large and dim so it survives the PMREM blur.
//
// Positions are CSS pixels from the viewport centre; drei's Lightformer
// geometries are unit-sized, so `scale` is the light's size in pixels.
const BeadEnvironment = memo(function BeadEnvironment({
  intensity,
  resolution,
}: {
  intensity: number
  resolution: number
}) {
  return (
    <Environment resolution={resolution} frames={1} environmentIntensity={intensity}>
      <Lightformer form="rect" intensity={5} color="#ffffff" position={[0, 320, 140]} scale={[700, 320, 1]} />
      <Lightformer form="circle" intensity={3} color="#ffd9c4" position={[-360, 60, 220]} scale={[260, 260, 1]} />
      <Lightformer form="circle" intensity={2.4} color="#c7ddff" position={[360, -40, 220]} scale={[260, 260, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#ffffff" position={[0, -320, 180]} scale={[700, 260, 1]} />
      <Lightformer
        form="rect"
        intensity={9}
        color="#ffffff"
        position={[-150, 190, 300]}
        rotation={[0, 0.45, 0]}
        scale={[110, 190, 1]}
      />
    </Environment>
  )
})
```

- [ ] **Step 4: Pass the resolution at the call site**

In `BeadScene`'s JSX, replace:

```tsx
        <BeadEnvironment intensity={theme === 'dark' ? 1 : 1.5} />
```

with:

```tsx
        <BeadEnvironment intensity={theme === 'dark' ? 1 : 1.5} resolution={BEAD_ENV_RESOLUTION} />
```

Leave the `<directionalLight position={[200, 400, 300]} intensity={1.4} />` beneath it unchanged — it supplies the one crisp direct specular hot-spot, and it is now also what feeds `clearcoatSpecularDirect`.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit && npx oxlint src
```

Expected: clean apart from the two known pre-existing warnings.

- [ ] **Step 6: Verify in the browser what the sandbox can actually verify**

Refresh and select a country.

1. `read_console_messages` — assert no new errors, and specifically no `THREE.WebGLProgram: Shader Error`. Adding `USE_CLEARCOAT` recompiles the program; if it fails, it fails loudly here.
2. `read_network_requests` with `urlPattern` `hdr`, then `githack` — both still zero. Raising the resolution must not have switched the environment onto a fetched asset.
3. `read_console_messages` again after ~30 seconds — assert no `WEBGL_lose_context`, no "Too many active WebGL contexts", and no out-of-memory warning. A 4.5MB cube map is safe, but the negative evidence is worth having.

**What this step deliberately does not claim:** whether the reflections actually look sharper, whether the clearcoat rim reads, or whether the highlights are now blown out. Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "Sharpen bead reflections: 256px environment, clearcoat layer, softer attenuation"
```

---

### Task 4: Frame-rate floor, human checkpoint, and documentation

**Files:**
- Modify (conditionally, only if the checkpoint calls for it): `src/components/BeadScene.tsx`
- Modify (always): `PROGRESS.md`

**Interfaces:**
- Consumes: everything from Tasks 1–3 — `BEAD_EXIT_MS`, `MARBLE_VARIANTS`, `MARBLE_TEXTURE_WIDTH`, `MARBLE_TEXTURE_HEIGHT`, `BEAD_CLEARCOAT`, `BEAD_ENV_RESOLUTION`, `BEAD_ENV_INTENSITY`, `BEAD_ATTENUATION_DISTANCE`, `MAX_BEADS`.
- Produces: nothing consumed by later tasks. This is the last task.

**Why this task exists and why it is not automated:** every remaining acceptance criterion is either a pixel judgement or a timing measurement, and this sandbox provably cannot do either. `PROGRESS.md` already records that a Phase 2 renderer-info probe **never fired**, because `requestAnimationFrame` does not tick reliably in an unfocused browser pane. Writing an in-sandbox FPS check here would produce a number that means nothing and would then have to be argued away. So the frame-rate constraint is met by a **reasoned budget** plus **one human measurement**, and neither is optional.

- [ ] **Step 1: Read the budget before you present the checkpoint**

This is the reasoning the plan is standing on. Do not present it to the human; use it to decide whether their answer is plausible and which rung of the degrade ladder to reach for.

*Per-frame draw calls.* 70 live beads + ≤7 dying (bounded in `BEAD_EXIT_MS`'s comment) = ≤77 mesh draws. The five `Boundaries` colliders and the `GlobeCollider` render nothing. `renderTransmissionPass` renders only **opaque** objects, and every visible object in this scene is transmissive, so that pass draws approximately nothing — its cost is the target clear, the blit and the mipmap chain, not geometry. The environment is baked once. **Total ≈ 77 draw calls per frame**, which is an order of magnitude below where draw-call overhead becomes the limiter on any desktop GPU.

*Per-frame fragments.* At `dpr` capped to 1.5 on a 1280×800 viewport the drawing buffer is 1920×1200 ≈ 2.3M pixels. A bead is r=34 CSS px → r=51 device px → ~8200 px, and 77 of them with the pile's typical overlap covers well under 15% of the buffer, call it 350k bead fragments (worst case, pile fully filled). Each such fragment now does: 3 mipmapped samples of the transmission target (the dispersion loop), 2 PMREM cube samples for the base IBL, **1 more** for clearcoat, **1 more** for the marble `map`, plus GGX/Fresnel ALU. That is ~7 texture fetches and a few hundred ALU ops on 350k fragments — comfortably under a millisecond of a 33ms budget on integrated graphics from the last five years, let alone a discrete GPU.

*Texture memory.* 8 marble textures at 256×128 RGBA with mipmaps ≈ 1.4MB. Environment cube map at 256² HalfFloat × 6 faces ≈ 3.1MB + ~1.4MB PMREM. Transmission target at `transmissionResolutionScale = 0.5` on 1920×1200 = 960×600 plus its mip chain ≈ 3MB. **Under 10MB total.** Not a factor.

*Shader programs.* All eight bead materials have identical defines (`USE_MAP`, `USE_TRANSMISSION`, `USE_DISPERSION`, `USE_CLEARCOAT`, `USE_ENVMAP`), so three's program cache compiles **one** program for the beads. Going from 2 materials to 8 did not add a program, and therefore added no shader-switch state changes beyond uniform uploads.

*The realistic risk is not the GPU.* It is (a) the per-frame transmission-target mipmap regeneration, which is fixed cost and already halved by `transmissionResolutionScale = 0.5`; (b) Rapier stepping ≤77 dynamic balls, which is trivial; and (c) React reconciling a 77-element list up to ~16 times a second at the fastest spawn rate. Note that Task 1's `expireBead` adds a second `setState` path — at the fastest rate that is up to ~16 extra renders/second, each reconciling 77 memo'd children. That is the one number in this plan I would actually watch, and it is why `expireBead` is `useCallback`'d and `BeadBody` is `memo`'d.

*Conclusion:* the 30fps floor has substantial headroom by this reasoning, but reasoning is not measurement, which is what Step 2 is for.

- [ ] **Step 2: Present the human checkpoint**

Stop. Ask the human to do this, in exactly these words:

> Please open **http://localhost:5173 in a real Chrome window** (not the sandbox pane), click it so it is focused, and click a city marker to start the beads.
>
> **First, the frame rate — this is the one that outranks everything else.**
> 1. Open DevTools (F12), press **Ctrl+Shift+P**, type **"Show frames per second (FPS) meter"** and hit Enter. (If that command is not there, use DevTools → the three-dot menu → More tools → **Rendering** → tick **Frame Rendering Stats**.) A small overlay appears in the top-left of the page showing live FPS.
> 2. Wait about 40 seconds, until the pile has completely filled and beads are visibly being replaced.
> 3. **Watch the FPS number for a full 10 seconds** and tell me the lowest value you see, not the average.
>
> Then, six things to look at:
> 1. Do beads still **blink out of existence**, or do the ones being replaced visibly **shrink away** first?
> 2. Do the beads read as **swirled glass marbles** — coloured ribbons visibly suspended *inside* the glass — or as flat coloured balls / plain glass with no pattern?
> 3. Can you find the **cat's-eye** ones (a few narrow, hard-edged vanes in otherwise clear glass, distinct from the multi-ribbon swirls)? Roughly a quarter of the beads should be that variant.
> 4. Can you still tell the **red (birth)** beads from the **foreground-coloured (death)** beads at a glance in a settled pile? Check in **both** themes (toggle top-right).
> 5. Do the **reflections** look sharper than before — a crisp bright rim and a small hard highlight that slides across a bead as it rolls — or still soft and blobby? And are any beads **blown out to white discs**?
> 6. Anything that looks outright broken: black beads, holes, seams running pole-to-pole down a bead, shimmering/crawling patterns as beads roll.

- [ ] **Step 3: Apply the degrade ladder — ONLY if the reported low FPS is under 30, and strictly in this order, one rung at a time, re-measuring after each**

Every rung is a direct edit to a constant added in Tasks 2–3. Stop at the first rung that clears 30fps. The ordering is cheapest-visual-loss first.

| Rung | Edit in `src/components/BeadScene.tsx` | What it costs visually |
|---|---|---|
| 1 | `const BEAD_ENV_RESOLUTION = 128` | Softer reflections. Still far better than the 64 this started at. |
| 2 | `const BEAD_CLEARCOAT = 0` | Loses the sharp second specular layer; the glass body is unchanged. |
| 3 | `dpr={[1, 1.5]}` → `dpr={1}` on `<Canvas>` | Slightly softer bead silhouettes on a HiDPI screen. |
| 4 | `const BEAD_DISPERSION = 0` (and, in `glass()`, this removes the shader's 3-sample dispersion loop entirely) | Loses chromatic fringing; cuts the transmission-target sample count from 3 to 1 per fragment, the largest single per-fragment saving available. |
| 5 | `export const MAX_BEADS = 50` | A smaller pile. Last resort, because the pile size is the feature. |

Do **not** reach for lowering `MARBLE_TEXTURE_WIDTH`/`HEIGHT` — at ~1.4MB total they are not the problem and shrinking them only makes the swirls mushy.

- [ ] **Step 4: Apply at most one or two visual dials, based on the answers to questions 1–6**

| Answer | Edit |
|---|---|
| Q1 "still blinks out" | `const BEAD_EXIT_MS = 700`. If it *still* pops, `BeadFadeOut`'s `useFrame` is not running — check that `useFrame` is imported from `@react-three/fiber` and that `BeadFadeOut` is rendered as a sibling of `RigidBody`, not swallowed by it. |
| Q2 "no pattern visible / plain glass" | `const BEAD_TRANSMISSION = 0.8` and `const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS * 6`. Both raise how much of the diffuse/attenuation-free term reaches the eye. |
| Q2 "pattern visible but muddy" | In `paintSwirl`, `ctx.filter = 'blur(1.5px)'` and `const ribbons = 4` (fewer, crisper ribbons). |
| Q3 "can't find the catseye" | `const MARBLE_SWIRL_VARIANTS = 2` and `const MARBLE_CATSEYE_VARIANTS = 2` (half the pile becomes catseye). |
| Q4 "can't tell birth from death" | In `glass()`, change the attenuation lerp from `0.6` to `0.3`; and in `marblePalette`, change `base` to `shade(0, hsl.s * 0.45, Math.min(0.86, l + (1 - l) * 0.7))` so the glass body carries more tint. |
| Q5 "still soft and blobby" | `const BEAD_ROUGHNESS = 0.03` and `const BEAD_CLEARCOAT_ROUGHNESS = 0.015`. |
| Q5 "blown out to white discs" | `const BEAD_ENV_INTENSITY = 0.85`, and change `<BeadEnvironment intensity={theme === 'dark' ? 1 : 1.5} …>` to `intensity={theme === 'dark' ? 0.7 : 1.15}`. |
| Q6 "a seam running pole to pole" | The three-copy seam handling in `paintSwirl`/`paintCatseye` is not working — verify `texture.wrapS = THREE.RepeatWrapping` is set in `createMarbleTextures` and that both painters loop over `[-w, 0, w]`. |
| Q6 "shimmering / crawling as beads roll" | `texture.anisotropy = 8` in `createMarbleTextures`. |
| Q6 "black beads or holes" | The lightness floor in `marblePalette` is not doing its job — raise `const l = Math.max(hsl.l, 0.16)` to `0.26`. |

Change one thing, reload, re-ask. Do not stack four changes at once. **After any visual dial, re-run the Step 2 FPS measurement** — the ladder in Step 3 outranks this table.

- [ ] **Step 5: Confirm the checkpoint passed**

Ask the human directly: **"Is this at 30fps or better at the full pile, and is it good enough to record the demo with?"** Do not proceed on your own assessment. If the answer is no and no rung or dial addresses it, stop and report — `git revert` of this phase's three commits is a legitimate outcome, and it is why each task committed separately.

- [ ] **Step 6: Typecheck, lint, and commit any tuning**

```bash
npx tsc --noEmit && npx oxlint src
git add src/components/BeadScene.tsx
git commit -m "Tune bead marbles after visual and frame-rate review"
```

Skip the commit if Steps 3 and 4 changed nothing.

- [ ] **Step 7: Append the `PROGRESS.md` entry**

Match the existing prose style (plain paragraphs, rationale, then a verification paragraph, then a `Status:` line). Append:

```markdown
## Bead scene, phase 3 — marbles

Three changes on top of the glass work, none of which touches physics,
spawn rates, colour resolution or the click-to-select mechanic.

Evicted beads no longer vanish. The cap-trim used to delete the oldest
bead the instant a new one spawned, and after a few seconds the oldest
bead is one that has already settled at the bottom of the pile — so the
eviction read as a settled bead blinking out of existence. Now the oldest
live bead is flagged `dying` and a conditionally-mounted `useFrame`
companion (`BeadFadeOut`) shrinks its mesh scale to nothing over 420ms
before a callback finally removes it. Scale rather than opacity,
deliberately: opacity lives on the material, and fading it would mean
cloning a material per dying bead — exactly the per-bead allocation the
glass phase removed. Scale lives on the mesh's own Object3D, so it is
per-bead by nature and touches no shared state. `MAX_BEADS` now caps live
beads rather than array length; at the fastest spawn interval at most
about seven dying beads ride along at a time.

Beads are swirled marbles. Eight `CanvasTexture`s — three swirl variants
and one catseye, per tint — are painted once per theme at 256x128 and used
as each material's `map`. Canvas 2D, no assets and no new packages. The
layout is equirectangular because `SphereGeometry`'s UVs are: a stroke
drawn top-to-bottom in the canvas becomes a ribbon converging at both
poles of the bead, which is how the ribbons in a real swirl marble and the
vanes in a real cat's eye are actually arranged, so the usual
equirectangular pole pinch works for us here. The one thing that had to be
true for any of this to work is that a `map` survives `transmission: 0.9`
instead of being mixed out by it, and three's shader is explicit: the map
multiplies into `diffuseColor`, which is passed to
`getIBLVolumeRefraction` and multiplied into the *refracted* light
(`transmittance = diffuseColor * volumeAttenuation(...)`), not just into
the 10% of the diffuse term transmission holds back. Beer-Lambert
attenuation had to be pulled back — it multiplies the same term, so at its
previous one-radius, full-tint strength it flattened the swirl back into a
single hue. All colours are still derived from `--accent` and
`--foreground` through the existing rasterisation round-trip, so the
birth/death distinction is intact; the death tint is a pure grey, so those
marbles come out as smoke swirls rather than rainbow ones, which is
correct. Eight materials rather than two does not weaken the sharing
argument: identical shader defines means one compiled program, one draw
call per bead, and still one transmission pass per frame.

Reflections got sharper for very little. The environment cube map went
from 64px to 256px, which is not a marginal tweak — three's own roughness
clamp carries the comment "0.0525 corresponds to the base mip of a 256
cubemap", and at `roughness = 0.08` the shader was asking a 64px map for
near-mirror detail it did not have, so every highlight came back as a
blob. With `frames={1}` the bake happens once, so the whole cost is about
4.5MB of VRAM. A `clearcoat` layer adds a second, sharper specular lobe
that is neither tinted by the glass nor blurred by the base roughness —
the cheapest "looks raytraced" cue there is, one extra cube sample per
fragment and no extra texture. And a fifth, small, bright, clearly
rectangular lightformer was added, because a reflection reads as real when
you can identify the shape being reflected.

Performance was treated as the hard constraint it is. The reasoned budget:
about 77 draw calls per frame (the transmission pass renders only opaque
objects, and nothing here is opaque); under 400k bead fragments at the
capped 1.5 dpr, each doing roughly seven texture fetches; one compiled
program for all eight materials; under 10MB of texture memory all in. The
sandbox cannot measure frame rate — `requestAnimationFrame` does not tick
reliably in an unfocused browser pane, as the phase-2 entry above already
records — so the floor was verified by a human with Chrome's own FPS meter
watching the low value for ten seconds at a full pile, and a documented
degrade ladder (environment 256 -> 128, then clearcoat off, then dpr 1,
then dispersion off, then a smaller cap) exists for if it ever stops
clearing 30.

`npx tsc --noEmit` and `oxlint src` clean apart from the pre-existing
`baseUrl` deprecation and `button.tsx` warnings. Verified in the sandbox:
no console or shader-compile errors on select, on theme toggle (which
disposes and rebuilds eight materials and eight canvas textures), during a
60s soak, or on deselect; still zero network requests to raw.githack.com
or any `.hdr` URL; the WebGL context never lost and never exhausted.
Everything that is a pixel judgement or a timing measurement — whether the
swirls read through the refraction, whether the catseye variant is
recognisable, whether the shrink-out is visible, whether the highlights
blew out, and the frame rate itself — was checked by a human in a real
focused browser window, for the reasons already documented above.

Bead-vs-UI collision is still deliberately open.

Status: done.
```

Adjust the last two paragraphs if Steps 3 or 4 changed any dials — say which and why.

- [ ] **Step 8: Commit**

```bash
git add PROGRESS.md
git commit -m "Document bead scene phase 3"
```

---

## Self-Review

**1. Spec coverage.**

| Requirement | Task |
|---|---|
| Fix "beads disappear" — fade/animate the evicted bead instead of an instant pop | Task 1 in full |
| Pick a concrete mechanism and justify it against the shared-material architecture | Task 1, Background points 2–3 and the `BeadFadeOut` comment: **mesh scale**, chosen precisely because opacity would force per-bead materials; the phase-2 sharing rationale is quoted, not contradicted |
| Procedural marble textures, canvas 2D, no assets | Task 2, Steps 2–4 (`mulberry32`, `marblePalette`, `paintSwirl`, `paintCatseye`, `createMarbleTextures`) |
| A small number of shared variants, randomly assigned per bead | Task 2, Step 1 (`MARBLE_VARIANTS`) and Step 6 (`variant` chosen at spawn, indexed at the call site) |
| Concrete count and swirl/catseye split | Task 2, Step 1 — **3 swirl + 1 catseye per tint = 8 textures**, with the reasoning for why catseye is the minority |
| At least one catseye variant, correctly understood as a flattened vane in clear glass, not a swirl | Task 2, Background point 4 and `paintCatseye` — filled lens/leaf paths, near-white base, minimal blur, explicitly contrasted with the swirls |
| Uses the existing birth/death colour resolution | Task 2, `marblePalette` derives everything from the two tints returned by the untouched `resolveBeadColors`; Global Constraints forbids changing it |
| Does `map` combine correctly with `transmission`? — treated as the riskiest unknown | Task 2, Background point 1 — traced through four installed shader chunks with file and line, answer is **yes, the map multiplies the refracted light**; Background point 2 records the consequence (attenuation must be pulled back), and Task 3 Step 1 acts on it |
| Exact material properties specified | Task 2 Step 5 and Task 3 Step 2 give the complete `MeshPhysicalMaterial` constructor object |
| Texture resolution / generation cost kept cheap | Task 2 Step 1 constants with the memory arithmetic; Task 4 Step 1 budget |
| Better reflections/refraction via the existing shader approach, not a new pipeline | Task 3 in full — resolution, clearcoat, lightformer shape, attenuation rebalance; no new rendering technique anywhere |
| Is 64px the bottleneck? | Task 3, Background point 1 — yes, with three's own source comment as the evidence, and the fix costs nothing per frame because `frames={1}` |
| Clearcoat considered concretely, with why it helps and what it costs | Task 3, Background point 3 and the `BEAD_CLEARCOAT` comment, citing `meshphysical.glsl.js:212` |
| Does `envMapIntensity`/roughness/lighting need revisiting once textures land? | Task 3 Step 1 — yes: `BEAD_ENV_INTENSITY` 1.4 → 1.15, `BEAD_ATTENUATION_DISTANCE` ×3, attenuation colour desaturated; roughness deliberately unchanged, with the reason |
| Hard 30fps floor, visuals degrade rather than stutter | Global Constraints (stated as outranking every visual) + Task 4 Step 3's ordered degrade ladder |
| Reasoned budget rather than a sandbox benchmark that will fail | Task 4 Step 1 — draw calls, fragments, texture fetches, memory, program count, and an honest naming of React reconciliation as the real risk. No in-sandbox FPS probe anywhere in this plan, deliberately, because phase 2's never fired |
| A very clear, simple manual FPS verification instruction for a human | Task 4 Step 2 — exact Chrome DevTools command string, both menu paths, "wait 40s, watch for 10s, report the **lowest** value" |
| Every check that genuinely needs a human is flagged as such | Each of Tasks 1/2/3 ends its browser step with an explicit "what this step deliberately does not claim" paragraph naming what it cannot verify |
| Nothing in the "must not change" list is touched | Global Constraints enumerates them; the only files modified are `BeadScene.tsx` and `PROGRESS.md` |

**2. Placeholder scan.** No "TBD"/"TODO"/"add error handling"/"similar to Task N". Every code step contains literal, complete code. The two conditional paths — Task 4's degrade ladder and its tuning table — are each a table of exact constant values, not descriptions. No temporary debug probes are introduced at all this time (phase 2's `__beadGl` probe never fired in this sandbox, so adding another would be adding a step that is known in advance to produce nothing).

**3. Type consistency.**
- `Bead` is `{ id; kind; x; dying }` after Task 1 Step 3 and gains `variant: number` in Task 2 Step 6; the spawn reducer's bead literal is updated in the same step, so no window exists where the interface and its only producer disagree.
- `BeadBody`'s props go from `{ bead, material }` to `{ bead, material, onExpire }` in Task 1 Step 5, and its single call site is updated in Task 1 Step 7 — same task.
- `expireBead: (id: number) => void` is declared in Task 1 Step 6, consumed as `onExpire` by `BeadBody` (Step 5) and forwarded to `BeadFadeOut` (Step 5) whose prop is the same signature.
- `BeadFadeOut`'s `meshRef: RefObject<THREE.Mesh | null>` matches `useRef<THREE.Mesh>(null)` under React 19 types; Task 1 Step 8 names the pre-19 fallback explicitly.
- `useBeadMaterials` returns `{ birth: MeshPhysicalMaterial[]; death: MeshPhysicalMaterial[]; textures: CanvasTexture[] }` after Task 2 Step 5; the call site indexes `[bead.variant]` in the same task's Step 6, and `bead.variant` is bounded by `Math.floor(Math.random() * MARBLE_VARIANTS)` against arrays of exactly `MARBLE_VARIANTS` length (`createMarbleTextures` always pushes once per variant, including the null branch). No out-of-range index is possible.
- `glass(tint: string, map: THREE.CanvasTexture | null)` is defined in Task 2 Step 5 and its constructor object is extended — not re-signatured — in Task 3 Step 2.
- `BeadEnvironment` goes from `{ intensity }` to `{ intensity, resolution }` in Task 3 Step 3 and its single call site is updated in Task 3 Step 4.
- `MarblePalette`, `mulberry32`, `marblePalette`, `paintSwirl`, `paintCatseye`, `createMarbleTextures`, `MARBLE_VARIANTS`, `MARBLE_SWIRL_VARIANTS`, `MARBLE_CATSEYE_VARIANTS`, `MARBLE_TEXTURE_WIDTH`, `MARBLE_TEXTURE_HEIGHT`, `BEAD_EXIT_MS`, `BEAD_CLEARCOAT`, `BEAD_CLEARCOAT_ROUGHNESS`, `BEAD_ENV_RESOLUTION`, `BEAD_ENV_INTENSITY` are referenced under exactly those names in Task 4's tables.

---

## Notes for the orchestrator

**The `map` + `transmission` question is answered, not guessed.** I traced the installed `three@0.185.1` shader chunks: `map_fragment` multiplies the texture into `diffuseColor`, `lights_physical_fragment` forwards it as `diffuseContribution`, and `transmission_pars_fragment:218` does `transmittance = diffuseColor * volumeAttenuation(...)` before multiplying the refracted sample. So the swirl modulates the *refracted* light at full strength — it will read, not wash out. The real trap I found downstream is that `attenuationColor` multiplies that same term, so the shipped full-tint-at-one-radius attenuation would have flattened the swirl; Task 3 fixes it.

**Biggest remaining uncertainties, all pixel-level:** whether refraction through a 1.52-IOR sphere warps the ribbons into something legible or into mush, and whether the equirectangular pole convergence looks like a marble or like a pinch. I believe both work — pole convergence is genuinely how real vanes are arranged — but only a human can confirm.

**The 30fps budget is reasoning, not measurement,** by necessity: `requestAnimationFrame` does not tick in this pane and phase 2's probe never fired. I deliberately wrote no in-sandbox FPS check. Run Tasks 1–3 automated; stop at Task 4 and look.