# Bead Scene (Phase 2 — Glass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1's opaque `meshStandardMaterial` beads with genuinely refractive glass — real transmission, IOR, dispersion and a local (network-free) environment map — without losing frame rate at a live bead cap, and without changing any of Phase 1's physics, spawn, colour-resolution or exit mechanics.

**Architecture:** Phase 1 gave every bead its own `<sphereGeometry>` and its own `<meshStandardMaterial>`. Phase 2 collapses that to **one module-scope `THREE.SphereGeometry` and exactly two `THREE.MeshPhysicalMaterial` instances** (birth / death), assigned to the bead meshes through the `geometry=` / `material=` props. The glass look comes from three.js's own built-in transmission path (`transmission` + `thickness` + `ior` + `dispersion` + `attenuationColor`), which performs **one** extra scene render per frame regardless of how many transmissive objects exist — not from drei's `MeshTransmissionMaterial`, which allocates two full render targets *and* runs a full `gl.render(scene, camera)` **per material instance, per frame** (see Global Constraints for the source evidence). Reflections come from a `<Environment>` built out of four `<Lightformer>` planes rendered into a 64px cube map locally, so nothing is fetched over the network.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, `three@0.185.1`, `@react-three/fiber@9.7.0`, `@react-three/drei@10.7.7`, `@react-three/rapier@2.2.0`.

## Global Constraints

- **This is Phase 2, visual polish only.** Do not touch `src/lib/beadSpawnRate.ts`, `src/lib/worldbank.ts`, `src/components/GlobeView.tsx`, or `src/components/ui/cobe-globe.tsx`. The only files this plan modifies are `src/components/BeadScene.tsx`, `src/App.tsx` (one className, and only if Task 3 calls for it), and `PROGRESS.md`.
- **Do not use drei's `MeshTransmissionMaterial`.** This was evaluated and rejected on evidence, not taste. In `node_modules/@react-three/drei/core/MeshTransmissionMaterial.js` every instance of the component calls `useFBO(backsideResolution || resolution)` **and** `useFBO(resolution)` unconditionally (two viewport-sized render targets each, since `resolution` is undefined by default), and registers a `useFrame` that does a full `state.gl.setRenderTarget(fboMain); state.gl.render(state.scene, state.camera)`. At the Phase 1 bead cap that is 360 render targets and 180 extra full-scene renders **per frame**. Setting `transmissionSampler` skips the render pass but *not* the FBO allocation. The only viable MTM shape is a single shared instance harvested via a ref off a hidden mesh with `transmissionSampler`, which reduces to "three's built-in transmission pass plus a multi-sample chromatic-aberration loop" — i.e. what `MeshPhysicalMaterial.dispersion` (present in three 0.185, `node_modules/three/src/materials/MeshPhysicalMaterial.js:355`) already gives us with none of the machinery. Use `MeshPhysicalMaterial`.
- **Do not use `<Environment preset="…">` or `files=`.** drei fetches those HDRIs from `https://raw.githack.com/pmndrs/drei-assets/…` at runtime (`node_modules/@react-three/drei/core/useEnvironment.js:8`). A demo machine must not depend on an outbound network call. `<Environment>` **with children** takes drei's `EnvironmentPortal` branch (`Environment.js`, `Environment()` at the bottom of the file) which renders a local virtual scene into a `WebGLCubeRenderTarget` and never touches the network.
- **No runtime capability-detection fallback, and no `USE_GLASS` toggle constant.** Decision made deliberately: this is a single-machine hackathon demo recording, not a product shipping to unknown hardware. A second material path would be a second unverifiable code path in a sandbox that already cannot verify the first one — it would add risk, not remove it. The panic button is `git revert` of this phase's commits, which is why every task below ends in its own commit.
- **No new npm packages.** `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier` are all already in `package.json`. Never run `npm install`.
- **No test framework exists in this repo.** `package.json` scripts are only `dev` / `build` / `lint` / `preview`; `lint` is `oxlint`. Do NOT write Jest/Vitest tests. Verification is `npx tsc --noEmit`, `npx oxlint src`, browser-pane console/network/`javascript_tool` probes, and one explicit human checkpoint (Task 3).
- **The browser-pane sandbox cannot verify rendered pixels.** Confirmed repeatedly during Phase 1: frames are not composited when the pane is unfocused, so screenshots fail; `ResizeObserver` does not fire, so a WebGL canvas can stay stuck at its default 300×150 drawing-buffer size and never match its CSS box; CSS transitions never visibly progress. **Never call the screenshot action.** Never write a verification step that asserts on canvas dimensions, pile position, or appearance. Task 3 exists precisely because of this.
- **Known pre-existing noise to ignore when judging "clean":** `npx tsc --noEmit` emits a `baseUrl` deprecation warning; `npx oxlint src` emits one warning in `src/components/ui/button.tsx`. Both predate this work. Anything else is a regression.
- Birth bead tint: the `--accent` token (`#912f40` light / `#c17b8a` dark). Death bead tint: the `--foreground` token (`oklch(0.2 0 0)` light / `oklch(0.95 0 0)` dark). The existing `resolveBeadColors` / `normalizeCssColor` rasterisation round-trip in `BeadScene.tsx` is the *only* sanctioned way to get these into THREE — do not rewrite it, do not pass `var(--…)` or `oklch()` strings to `THREE.Color`.
- All world units in `BeadScene.tsx` are **CSS pixels** (orthographic camera, no manual frustum override). This is why `thickness`, `attenuationDistance` and the `Lightformer` positions below are two- and three-digit numbers rather than the sub-1 values you would see in a metres-based three.js scene.
- The dev server is launched from the browser pane with `preview_start({ name: "hourglass-earth-dev" })` (already configured in `.claude/launch.json`, port 5173). Do not start servers with Bash.

---

### Task 1: Shared glass material, shared geometry, local environment

**Files:**
- Modify: `src/components/BeadScene.tsx` (imports at lines 1-5; the constants block at lines 13-21; `BeadBody` at lines 117-142; the `BeadScene` body at lines 149-231)

**Interfaces:**
- Consumes: nothing from earlier tasks. Uses the already-shipped `Bead`, `BeadColors`, `resolveBeadColors`, `normalizeCssColor`, `Boundaries`, `BEAD_RADIUS`, `MAX_BEADS`, `SPAWN_JITTER_PX` from `src/components/BeadScene.tsx`.
- Produces (module-internal, consumed by Tasks 2 and 3):
  - `const BEAD_GEOMETRY: THREE.SphereGeometry`
  - `function useBeadMaterials(colors: BeadColors): { birth: THREE.MeshPhysicalMaterial; death: THREE.MeshPhysicalMaterial }`
  - `const BeadEnvironment: React.MemoExoticComponent<(props: { intensity: number }) => JSX.Element>`
  - `BeadBody` prop shape changes from `{ bead: Bead; colors: BeadColors }` to `{ bead: Bead; material: THREE.Material }`
  - tuning constants `BEAD_THICKNESS`, `BEAD_ATTENUATION_DISTANCE`, `BEAD_IOR`, `BEAD_ROUGHNESS`, `BEAD_DISPERSION`, `BEAD_TRANSMISSION`

**Background the implementer needs — read all five points before writing code:**

1. **three does the transmission pass once, not once per object.** `renderTransmissionPass(opaqueObjects, transmissiveObjects, scene, camera)` is called a single time per camera per frame (`node_modules/three/src/renderers/WebGLRenderer.js:1753`). It renders only the **opaque** objects into a shared render target that every transmissive material then samples. So 120 or 180 glass beads cost the same one extra pass as a single one. This is the entire reason the plan uses `MeshPhysicalMaterial` rather than per-instance drei materials.

2. **The scene is transparent, and three already handles that.** In `renderTransmissionPass` (`WebGLRenderer.js:2021-2025`) three reads the clear alpha and, `if ( _currentClearAlpha < 1 ) _this.setClearColor( 0xffffff, 0.5 )` before clearing the transmission target. R3F's canvas is `alpha: true` with clear alpha 0, so the beads refract a **half-strength white**, not black. Without this the beads would be black blobs; with it they read as lit glass. Do not "fix" the transparency — leave the canvas exactly as Phase 1 left it.

3. **Nothing opaque is in the scene, so beads do not refract each other.** All bead materials are transmissive and the Rapier colliders are invisible. The glass therefore reads through IBL specular + fresnel + dispersion fringing + Beer–Lambert attenuation tint, not through visible warping of a background. That is expected and is what the tuning table in Task 3 is calibrated around. Do not add a backdrop plane in this task; Task 3 owns that decision.

4. **`transmission` mixes the diffuse colour out.** three's shader ends with `totalDiffuse = mix( totalDiffuse, transmission.rgb, material.transmission )`. At `transmission: 1` a bead's `color` is entirely gone and only `attenuationColor` tints it. This plan uses `transmission: 0.9` so ~10% of the diffuse tint survives — that residue is what keeps a red bead legibly red against a near-white page. This is the single most important dial; it is named `BEAD_TRANSMISSION` for exactly that reason.

5. **drei's `<Environment>` re-renders its cube map whenever its `children` element identity changes** (`Environment.js`, the `useLayoutEffect` whose dependency array includes `children`, which with `frames === 1` calls `camera.current.update(gl, virtualScene)`). `BeadScene` re-renders on every bead spawn — up to ~8 times a second — so the environment **must** be wrapped in its own `memo()`'d component or the cube map is needlessly re-rendered on every spawn. That is why `BeadEnvironment` exists.

- [ ] **Step 1: Replace the import block at the top of `src/components/BeadScene.tsx`**

Replace lines 1-5 with:

```tsx
import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { BallCollider, CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import type { CountryDemographics } from '@/lib/worldbank'
import { spawnIntervalMs } from '@/lib/beadSpawnRate'
```

- [ ] **Step 2: Add the glass tuning constants and the shared geometry**

Immediately after the existing `export const MAX_BEADS = 180` line (currently line 21), add:

```tsx
// Glass tuning. Every length here is in the scene's CSS-pixel world units
// (see the orthographic-camera note above), which is why thickness and
// attenuationDistance are bead-sized two-digit numbers rather than the
// sub-1 values a metres-based three.js scene would use.
//
// BEAD_TRANSMISSION is deliberately not 1.0. three's transmission shader
// ends with `totalDiffuse = mix(totalDiffuse, transmission.rgb,
// material.transmission)`, so at 1.0 the bead's own colour is entirely
// replaced by the refracted sample and only attenuationColor tints it —
// which, against a near-white page in the light theme, loses the
// birth/death colour distinction the whole feature is built on. Holding
// back 10% of the diffuse term keeps a red bead legibly red without
// making it look painted.
const BEAD_TRANSMISSION = 0.9
// Beer-Lambert attenuation: the shorter the distance, the more saturated
// the glass. One bead radius means a bead is fully tinted by the time
// light has crossed half of it.
const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS
const BEAD_THICKNESS = BEAD_RADIUS * 2
// 1.52 is soda-lime glass. 1.0 would be air (no bending at all), 2.4
// diamond (comically warped at this size).
const BEAD_IOR = 1.52
// Low but not zero: a perfectly smooth sphere at 28px reads as a flat
// disc, a slightly rough one catches a readable highlight.
const BEAD_ROUGHNESS = 0.08
// three's native chromatic aberration (MeshPhysicalMaterial.dispersion,
// requires transmission > 0). This is what drei's MeshTransmissionMaterial
// used to be needed for.
const BEAD_DISPERSION = 2.5

// One geometry for every bead, built once at module scope. Phase 1 gave
// each bead its own <sphereGeometry> element, i.e. up to 180 byte-identical
// vertex buffers uploaded to the GPU. App renders <BeadScene
// key={selectedIso3} />, so the whole component remounts on every country
// switch — module scope means this buffer survives those remounts instead
// of being rebuilt each time. Never disposed: there is exactly one, for the
// lifetime of the page.
const BEAD_GEOMETRY = new THREE.SphereGeometry(BEAD_RADIUS, 24, 16)
```

- [ ] **Step 3: Add the shared-material hook**

Add immediately after `resolveBeadColors` (i.e. after the current line 79, before `function Boundaries()`):

```tsx
// Two materials for the entire scene, not two per bead. Beyond the obvious
// allocation saving, this is what makes glass affordable at all: three
// runs its transmission pass once per camera per frame for every
// transmissive object at once (renderTransmissionPass in WebGLRenderer),
// so the marginal cost of the 120th glass bead is one more draw call, not
// one more render target.
//
// Recreated only when the resolved colours change, i.e. on a theme flip.
// The cleanup disposes the previous pair; by the time it runs, React has
// already committed the render in which every mesh points at the new pair,
// so nothing is disposed while still in use.
function useBeadMaterials(colors: BeadColors) {
  const materials = useMemo(() => {
    function glass(tint: string) {
      const color = new THREE.Color(tint)
      return new THREE.MeshPhysicalMaterial({
        color,
        attenuationColor: color.clone(),
        attenuationDistance: BEAD_ATTENUATION_DISTANCE,
        transmission: BEAD_TRANSMISSION,
        thickness: BEAD_THICKNESS,
        ior: BEAD_IOR,
        dispersion: BEAD_DISPERSION,
        roughness: BEAD_ROUGHNESS,
        metalness: 0,
        envMapIntensity: 1.4,
      })
    }
    return { birth: glass(colors.birth), death: glass(colors.death) }
  }, [colors])

  useEffect(
    () => () => {
      materials.birth.dispose()
      materials.death.dispose()
    },
    [materials],
  )

  return materials
}
```

- [ ] **Step 4: Add the local environment component**

Add immediately after `useBeadMaterials`, still before `function Boundaries()`:

```tsx
// A lighting rig built from four emissive planes and baked locally into a
// 64px cube map. Two reasons it is shaped this way rather than
// <Environment preset="studio">: drei's presets fetch a 1-2MB HDRI from
// raw.githack.com at runtime (CUBEMAP_ROOT in drei's useEnvironment.js),
// which is an outbound network dependency on a demo machine; and a cube
// map this small is free, blurs beautifully at bead scale, and is
// deterministic.
//
// memo() is load-bearing, not hygiene. drei's <Environment> re-runs its
// layout effect — and with frames={1} that effect re-renders the whole
// cube map — whenever its `children` element identity changes. BeadScene
// re-renders on every spawn (up to ~8/second), so without this memo the
// cube map would be re-baked several times a second forever.
//
// Positions are CSS pixels from the viewport centre; drei's Lightformer
// geometries are unit-sized, so `scale` is the light's size in pixels.
// Everything sits inside the cube camera's default near=1 / far=1000.
const BeadEnvironment = memo(function BeadEnvironment({ intensity }: { intensity: number }) {
  return (
    <Environment resolution={64} frames={1} environmentIntensity={intensity}>
      <Lightformer form="rect" intensity={5} color="#ffffff" position={[0, 320, 140]} scale={[700, 320, 1]} />
      <Lightformer form="circle" intensity={3} color="#ffd9c4" position={[-360, 60, 220]} scale={[260, 260, 1]} />
      <Lightformer form="circle" intensity={2.4} color="#c7ddff" position={[360, -40, 220]} scale={[260, 260, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#ffffff" position={[0, -320, 180]} scale={[700, 260, 1]} />
    </Environment>
  )
})
```

- [ ] **Step 5: Rewrite `BeadBody` to take a shared material and an explicit collider**

Replace the whole `BeadBody` block (currently lines 117-142, comment included) with:

```tsx
// Beads share one geometry and one of two materials (see BEAD_GEOMETRY and
// useBeadMaterials), passed in as props rather than declared as child
// elements — declaring them as children is what would give every bead its
// own copy. `dispose={null}` tells react-three-fiber not to dispose these
// shared objects when an individual bead is culled by the MAX_BEADS cap;
// their lifetimes are owned by the module and by useBeadMaterials.
//
// Phase 1 used colliders="ball", which asks react-three-rapier to derive
// the shape from the child mesh's geometry. Now that the geometry arrives
// as a prop, an explicit BallCollider removes any dependence on that
// traversal — it is the same sphere, stated outright.
//
// RigidBody `position` is only read when the body is created, so stable
// React keys matter: a changing key would recreate the body and teleport a
// settled bead back to the spawn point.
const BeadBody = memo(function BeadBody({ bead, material }: { bead: Bead; material: THREE.Material }) {
  const height = useThree((state) => state.size.height)
  return (
    <RigidBody
      colliders={false}
      position={[bead.x, height / 2 + BEAD_RADIUS * 2, 0]}
      restitution={0.25}
      friction={0.6}
      linearDamping={0.1}
    >
      <BallCollider args={[BEAD_RADIUS]} />
      <mesh geometry={BEAD_GEOMETRY} material={material} dispose={null} />
    </RigidBody>
  )
})
```

- [ ] **Step 6: Wire the materials and environment into `BeadScene`'s body**

In the `BeadScene` component, add one line immediately after the `colors` state's `useEffect` (i.e. after the current line 159, before `const [beads, setBeads] = useState<Bead[]>([])`):

```tsx
  const materials = useBeadMaterials(colors)
```

Leave `beads`, `nextIdRef`, `birthIntervalMs`, `deathIntervalMs` and the spawn `useEffect` **completely unchanged**.

Then, inside the returned JSX, replace the two light elements (currently lines 217-218):

```tsx
        <ambientLight intensity={1.1} />
        <directionalLight position={[200, 400, 300]} intensity={2.2} />
```

with:

```tsx
        {/* Phase 1's ambientLight is deliberately gone: a transmissive
            material mixes its diffuse term out, so flat ambient light only
            washes out the highlights that make a bead read as glass. The
            directional light stays — it supplies the one crisp specular
            hot-spot per bead that separates "glass" from "fogged plastic" —
            at a lower intensity now that the environment map handles the
            rest. environmentIntensity is the only theme-dependent dial: the
            dark theme needs less lift or the pile blows out against a
            near-black page. */}
        <BeadEnvironment intensity={theme === 'dark' ? 1 : 1.5} />
        <directionalLight position={[200, 400, 300]} intensity={1.4} />
```

And change the bead map (currently lines 223-225) from passing `colors` to passing the resolved material:

```tsx
            {beads.map((bead) => (
              <BeadBody
                key={bead.id}
                bead={bead}
                material={bead.kind === 'birth' ? materials.birth : materials.death}
              />
            ))}
```

Everything else in the return — the wrapper `div`'s classes, the `<Canvas>` props, the `style={{ pointerEvents: 'none' }}` override, `<Suspense>`, `<Physics>`, `<Boundaries />` — stays byte-identical.

- [ ] **Step 7: Typecheck and lint**

Run:
```bash
npx tsc --noEmit && npx oxlint src
```
Expected: no errors. Only the pre-existing `baseUrl` deprecation warning and the pre-existing `button.tsx` oxlint warning (see Global Constraints).

If TypeScript rejects `dispersion` on the `MeshPhysicalMaterialParameters` object, the installed `@types/three` is older than the runtime `three` — do **not** cast it away; drop `dispersion` from the constructor object and assign it on the next line as `material.dispersion = BEAD_DISPERSION` inside `glass()`, and note it in the commit message.

- [ ] **Step 8: Verify in the browser what the sandbox can actually verify**

Start the dev server: `preview_start({ name: "hourglass-earth-dev" })`.

Select a country using the click-dispatch snippet from the Phase 1 plan (Task 1, Step 8 of `docs/superpowers/plans/2026-08-01-bead-scene.md`), then:

1. `read_console_messages`. Assert **no errors**. In particular there must be no `THREE.WebGLProgram: Shader Error`, no `Program Info Log`, no `THREE.WebGLRenderer: Context Lost`, and no `THREE.Color: Unknown color`. A shader-compile failure is the single most likely way this task fails, and it *is* visible here — this check is doing real work.
2. `read_network_requests` with `urlPattern` set to `hdr`. Assert **zero** matching requests. Then run it again with `urlPattern` set to `githack`. Also zero. This proves the environment is built locally and the demo has no runtime network dependency — one of the two hard requirements this task carries.
3. `javascript_tool`:

```js
(() => {
  const c = [...document.querySelectorAll('canvas')].find((el) => el.parentElement?.parentElement?.classList.contains('pointer-events-none'))
  if (!c) return 'FAIL: bead canvas not found'
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  return JSON.stringify({ found: true, contextLost: gl ? gl.isContextLost() : 'no-context' })
})()
```
   Expected: `found: true`, `contextLost: false`. Do **not** assert anything about `c.width`/`c.height` — the sandbox's `ResizeObserver` does not fire and the buffer is frequently stuck at 300×150 (Global Constraints).
4. Toggle the theme (`javascript_tool`: `document.querySelector('[aria-label^="Switch to"]').click()`), wait a beat, and re-run `read_console_messages`. Assert still no errors — this is the path that disposes the old material pair and builds a new one, and a use-after-dispose would surface as a WebGL warning here.
5. Deselect (run the click snippet again) and re-run `read_console_messages`. Assert no errors on unmount — this exercises the `useBeadMaterials` cleanup and the `dispose={null}` meshes.

**What this step deliberately does not claim:** it does not tell you whether the beads look like glass, whether the red reads as red, or what the frame rate is. See Task 3.

- [ ] **Step 9: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "Render beads as refractive glass with a shared material and local environment"
```

---

### Task 2: Performance envelope

**Files:**
- Modify: `src/components/BeadScene.tsx` (the `MAX_BEADS` constant; the `Boundaries` component declaration; the `<Canvas>` element)

**Interfaces:**
- Consumes: `BEAD_GEOMETRY`, `useBeadMaterials`, `BeadEnvironment`, `BeadBody({ bead, material })` from Task 1.
- Produces: no new exports. `MAX_BEADS` changes value from `180` to `120` (it is already `export`ed; nothing outside this file reads it today, but keep the export).

**Background:** Task 1 removed the two costs that scale with bead count (per-bead geometry, per-bead material). What is left that scales is draw calls and Rapier bodies, plus two costs that scale with *pixels*: the transmission pass and the glass fragment shader. This task caps the pixel-scaled costs, which is where the remaining headroom is.

- [ ] **Step 1: Lower the live bead cap**

In `src/components/BeadScene.tsx`, replace the `MAX_BEADS` declaration and its comment with:

```tsx
// Live bead cap. Past this, the oldest bead is dropped as each new one
// spawns, so performance stays bounded however long the scene stays open.
//
// Lowered from Phase 1's 180 with the move to glass. Two reasons, one
// technical and one aesthetic. Technical: a transmissive fragment costs
// several mipmapped samples of the transmission target plus a dispersion
// triple-sample, so the per-pixel cost went up roughly an order of
// magnitude even though the per-object cost went down. Aesthetic: past
// ~120 the pile is dense enough that individual beads stop reading as
// discrete objects at all, which is precisely the thing glass is here to
// show off. Fewer, more legible beads is the better picture.
export const MAX_BEADS = 120
```

The spawn loop already reads `MAX_BEADS` and needs no change.

- [ ] **Step 2: Memoize `Boundaries`**

`Boundaries` re-renders on every bead spawn today for no reason — it has no props and depends only on the viewport size, which it reads from `useThree`. Change its declaration from:

```tsx
function Boundaries() {
```

to:

```tsx
// memo() with no props means this re-renders only when its own useThree
// size subscription fires, not on every one of BeadScene's ~8/second
// spawn re-renders. Five fixed RigidBodies is not much to reconcile, but
// it is exactly zero work to avoid.
const Boundaries = memo(function Boundaries() {
```

and close it with `})` instead of `}` (the existing closing brace of the function, currently line 115).

- [ ] **Step 3: Cap device pixel ratio and downscale the transmission pass**

Replace the `<Canvas>` opening tag (currently lines 212-216) with:

```tsx
      <Canvas
        orthographic
        camera={{ position: [0, 0, 600], zoom: 1, near: 0.1, far: 2000 }}
        // The glass shader and three's transmission pass both scale with
        // pixel count, and react-three-fiber otherwise renders at the full
        // device pixel ratio — 2 or 3 on the kind of laptop a demo gets
        // recorded on, i.e. 4-9x the fragments. Capping at 1.5 keeps bead
        // silhouettes smooth while bounding the worst case.
        dpr={[1, 1.5]}
        style={{ pointerEvents: 'none' }}
        onCreated={({ gl }) => {
          // three sizes its transmission render target to viewport *
          // transmissionResolutionScale (WebGLRenderer's
          // renderTransmissionPass). Nothing opaque is in this scene, so
          // that target holds a flat clear colour and downscaling it is
          // visually free while quartering the pass's fill cost and its
          // mipmap chain.
          gl.transmissionResolutionScale = 0.5
        }}
      >
```

- [ ] **Step 4: Add a temporary renderer probe (removed in Step 7)**

Verifying that the geometry/material sharing actually took effect is the one thing this sandbox *can* do well, but it needs a handle on the renderer. Add this line inside the `onCreated` callback you just wrote, directly after the `transmissionResolutionScale` assignment:

```tsx
          // TEMPORARY verification hook — removed in this task's Step 7.
          ;(window as unknown as { __beadGl?: unknown }).__beadGl = gl
```

- [ ] **Step 5: Typecheck and lint**

Run:
```bash
npx tsc --noEmit && npx oxlint src
```
Expected: clean apart from the two known pre-existing warnings.

- [ ] **Step 6: Verify in the browser**

Refresh the dev server page and select a country with the Phase 1 click snippet. Wait ~20 seconds so the cap is reached, then:

1. `javascript_tool`:

```js
(() => {
  const gl = window.__beadGl
  if (!gl) return 'FAIL: renderer probe missing'
  return JSON.stringify({
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
    programs: gl.info.programs.length,
    drawCalls: gl.info.render.calls,
  })
})()
```
   Expected: **`geometries` under 12.** This is the whole point of the check — Phase 1 would report 180+ here (one sphere buffer per bead), so anything in the 100s means the shared-geometry prop wiring did not take and Task 1 Step 5 must be re-read. The handful that do exist are the shared sphere plus the four Lightformer planes/rings in the environment portal. `programs` should likewise be single-digit (proof that the two shared materials compile two programs, not 120). `textures` single-digit. `drawCalls` is informational.
2. Start a frame-rate probe with `javascript_tool`:

```js
(() => {
  window.__fpsProbe = { frames: 0, start: performance.now(), id: 0 }
  const tick = () => { window.__fpsProbe.frames++; window.__fpsProbe.id = requestAnimationFrame(tick) }
  window.__fpsProbe.id = requestAnimationFrame(tick)
  return 'probe started'
})()
```
   Wait ~5 seconds (`computer` with `action: "wait"`), then read it:

```js
(() => {
  const p = window.__fpsProbe
  cancelAnimationFrame(p.id)
  const seconds = (performance.now() - p.start) / 1000
  return JSON.stringify({ seconds: +seconds.toFixed(2), frames: p.frames, fps: +(p.frames / seconds).toFixed(1) })
})()
```
   **Read this number with the sandbox caveat in mind.** The pane does not composite when unfocused, and `requestAnimationFrame` can be throttled or coalesced as a result, so a low number here is *not* evidence of a performance problem and must not trigger a redesign. Treat it as a one-way signal: a number at or near display rate (≈60) is meaningful positive evidence; anything below that is inconclusive and gets resolved by the human checkpoint in Task 3, not here.
3. `read_console_messages` — assert no errors, and specifically no `WEBGL_lose_context` / "Too many active WebGL contexts" message. If that message appears, the shared-material approach did not take and something is still allocating render targets per bead.
4. Leave the scene running for 60 seconds, then re-run check 1. `geometries`, `textures` and `programs` must be **unchanged** — a monotonically growing count is a leak in the bead cull path.
5. Confirm the control panel is still reachable through the canvas (unchanged from Phase 1, but this task touched `<Canvas>` props):

```js
(() => {
  const el = document.elementFromPoint(120, innerHeight - 40)
  return el ? el.tagName : 'null'
})()
```
   Expected: anything **except** `CANVAS`.

- [ ] **Step 7: Remove the temporary probe**

Delete the `;(window as unknown as { __beadGl?: unknown }).__beadGl = gl` line added in Step 4. Re-run:

```bash
npx tsc --noEmit && npx oxlint src
```
Expected: still clean. Then `grep -n "__beadGl" src/components/BeadScene.tsx` — expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/components/BeadScene.tsx
git commit -m "Bound bead scene cost: cap live beads at 120, cap dpr, halve the transmission pass"
```

---

### Task 3: Human visual checkpoint and tuning

**Files:**
- Modify (conditionally, only if the checkpoint calls for it): `src/components/BeadScene.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: the tuning constants from Task 1 (`BEAD_TRANSMISSION`, `BEAD_ATTENUATION_DISTANCE`, `BEAD_THICKNESS`, `BEAD_IOR`, `BEAD_ROUGHNESS`, `BEAD_DISPERSION`), `BEAD_RADIUS`, `MAX_BEADS`, `resolveBeadColors`, `BeadColors`.
- Produces: either no code change, or one of the fully-specified edits below. Task 4 depends on knowing which.

**Why this task exists:** every remaining acceptance criterion for this feature is a pixel judgement — "does it read as glass", "can you tell a birth bead from a death bead", "is the frame rate acceptable while recording" — and the browser-pane sandbox provably cannot answer any of them (Global Constraints). Rather than write verification steps that pretend otherwise, this task hands off once, with a precise script and a precise set of dials. **An agent must not skip this task or substitute its own judgement for the human's answer.**

- [ ] **Step 1: Present the checkpoint**

Stop and ask the human to open the app in a **real, focused browser window** (not the sandbox pane) at `http://localhost:5173`, click a city marker, and answer these six questions. Give them exactly this list:

1. Do the beads read as **glass** — bright specular highlight, visible edge/fresnel brightening, a sense of depth — or as **fogged plastic / flat discs**?
2. In the **light** theme, can you tell the red (birth) beads from the foreground-coloured (death) beads at a glance, in a settled pile?
3. In the **dark** theme, same question. (Toggle with the theme button top-right.)
4. Is there any visible **colour fringing** at bead silhouettes (the dispersion effect), or is it absent?
5. Do the beads look **ghostly / washed out / semi-transparent against the page**, as if you can see the page through them in a way that looks wrong rather than glassy?
6. Watch the pile fill for ~30 seconds. Is the motion **smooth**, or does it visibly stutter or slow as bead count rises?

- [ ] **Step 2: Apply at most one or two dials from this table, based on the answers**

Every value below is a direct edit to an existing constant in `src/components/BeadScene.tsx`. Change one thing, reload, re-ask. Do not stack four changes at once.

| Answer | Edit |
|---|---|
| Q1 "fogged plastic" | `const BEAD_ROUGHNESS = 0.02` and `envMapIntensity: 2.2` inside `useBeadMaterials`'s `glass()` |
| Q1 "flat discs, too small to see anything" | `const BEAD_RADIUS = 18` and `export const MAX_BEADS = 90` (physics, colliders, thickness and attenuation all derive from `BEAD_RADIUS`, so nothing else needs touching) |
| Q2 or Q3 "can't tell them apart" | `const BEAD_TRANSMISSION = 0.75` and `const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS / 2` |
| Q2 "beads look almost black in light theme" | `const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS * 2` |
| Q3 "beads blow out / too bright in dark theme" | change `<BeadEnvironment intensity={theme === 'dark' ? 1 : 1.5} />` to `intensity={theme === 'dark' ? 0.6 : 1.5}` |
| Q4 "no fringing" | `const BEAD_DISPERSION = 5` |
| Q5 "ghostly" | apply the backdrop remedy in Step 3 |
| Q6 "stutters" | `export const MAX_BEADS = 80`, and change `dpr={[1, 1.5]}` to `dpr={1}` |

- [ ] **Step 3: The backdrop remedy — apply only if the answer to Q5 was "ghostly"**

Explanation of the cause, so the implementer knows what they are fixing: three clears its transmission render target to white at **0.5 alpha** when the renderer's clear alpha is below 1 (`WebGLRenderer.js:2023`). The bead's output alpha is then `mix(1, sample.a, transmission)` ≈ 0.55, and since the material is not `transparent` that alpha is written straight to an `alpha: true` canvas whose contents the browser composites as premultiplied. The result is beads that let ~45% of the page through, un-premultiplied. Putting one opaque object in the scene fills the transmission target with real colour, drives the bead alpha to 1, and removes the whole class of problem.

First, extend the colour resolution in `src/components/BeadScene.tsx`. Change the `BeadColors` interface to:

```tsx
interface BeadColors {
  birth: string
  death: string
  backdrop: string
}
```

and change the `return` of `resolveBeadColors` to:

```tsx
  const background = getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
  return {
    birth: normalizeCssColor(accent, '#912f40'),
    death: normalizeCssColor(foreground, '#333333'),
    backdrop: normalizeCssColor(background, '#fffffa'),
  }
```

(`--background` is `#fffffa` in `:root` and `oklch(0.16 0 0)` in `.dark`, so it goes through the same rasterisation round-trip as `--foreground` for the same reason.)

Then add the component, immediately after `BeadEnvironment`:

```tsx
// A full-viewport unlit plane behind everything, painted the exact
// --background token. Two jobs. It fills three's transmission render
// target with a real opaque colour — without it the target is cleared to
// white at 50% alpha (renderTransmissionPass in three's WebGLRenderer) and
// the beads inherit that alpha, compositing semi-transparently over the
// DOM. And it makes bead colours exact rather than page-dependent. Because
// it is the page's own background colour, the canvas going opaque is
// invisible — the one thing it does hide is the shrunken globe, which is
// why App raises the globe wrapper above this canvas.
const Backdrop = memo(function Backdrop({ color }: { color: string }) {
  const { width, height } = useThree((state) => state.size)
  return (
    <mesh position={[0, 0, -500]} renderOrder={-1}>
      <planeGeometry args={[width * 2, height * 2]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  )
})
```

Then render it inside the `<Canvas>`, as the first child, immediately before `<BeadEnvironment ... />`:

```tsx
        <Backdrop color={colors.backdrop} />
```

Finally, in `src/App.tsx`, raise the globe above the now-opaque bead canvas. Change the globe wrapper's className from:

```tsx
        className={`absolute inset-0 transition-transform duration-700 ease-in-out ${
```

to:

```tsx
        // z-10 because BeadScene's canvas (z-0) now paints an opaque
        // backdrop; without this the shrunken globe would be hidden behind
        // it. The control panel and the toggle row are also z-10 but come
        // later in the DOM, so they still paint above this wrapper.
        className={`absolute inset-0 z-10 transition-transform duration-700 ease-in-out ${
```

After applying, re-run `npx tsc --noEmit && npx oxlint src`, and re-ask the human Q1, Q2, Q3 and Q5 — the backdrop changes bead appearance in both themes, so the earlier answers no longer hold.

- [ ] **Step 4: Confirm the checkpoint passed**

Ask the human directly: "Is this good enough to record the demo with?" Do not proceed to Task 4 on your own assessment. If the answer is no and no dial in the table addresses it, stop and report rather than inventing a new approach — `git revert` back to the Phase 1 material is a legitimate outcome and is why every task committed separately.

- [ ] **Step 5: Commit (only if Step 2 or Step 3 changed anything)**

```bash
git add src/components/BeadScene.tsx src/App.tsx
git commit -m "Tune bead glass after visual review"
```

If nothing changed, skip this step — there is nothing to commit.

---

### Task 4: Document the phase

**Files:**
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: the final state of `src/components/BeadScene.tsx` after Tasks 1-3, and the human's answers from Task 3.
- Produces: nothing consumed by later tasks. This is the last task.

- [ ] **Step 1: Append the entry to `PROGRESS.md`**

Match the existing prose style (plain paragraphs, a rationale, then a verification paragraph, then a `Status:` line). Append:

```markdown
## Bead scene, phase 2 — glass

Beads are refractive glass now: `MeshPhysicalMaterial` with transmission,
a 1.52 IOR, dispersion, and Beer-Lambert attenuation carrying the
birth/death tint, lit by an environment map. Phase 1's flat
`meshStandardMaterial` spheres are gone.

The obvious route was drei's `MeshTransmissionMaterial`, and it was
rejected on inspection rather than on taste. Every instance of that
component allocates two viewport-sized render targets and runs a full
`gl.render(scene, camera)` of its own inside `useFrame` — per instance,
per frame. At any bead count worth looking at, that is hundreds of render
targets and hundreds of extra scene renders. three.js's own transmission
path does the equivalent work **once per frame for every transmissive
object at once**, and since three 0.185 `MeshPhysicalMaterial.dispersion`
provides the chromatic aberration that used to be the drei material's main
reason to exist. So the beads share exactly two materials and one sphere
geometry — Phase 1 allocated a geometry and a material per bead, which the
Phase 1 review had already flagged — and glass costs one extra pass total.

Lighting is local on purpose. `<Environment preset="…">` fetches a 1-2MB
HDRI from raw.githack.com at runtime; a demo machine should not need the
network to look right. `<Environment>` with children instead bakes four
`Lightformer` planes into a 64px cube map in-process. It is wrapped in its
own `memo()` because drei re-bakes that cube map whenever its children's
element identity changes, and `BeadScene` re-renders on every spawn.

Remaining cost is bounded by three dials rather than by hope: the live cap
came down from 180 to 120 (glass fragments are roughly an order of
magnitude dearer, and past ~120 the pile stops reading as individual beads
anyway), device pixel ratio is capped at 1.5, and three's transmission
render target is rendered at half resolution — free here, since nothing
opaque is in the scene for it to capture.

`npx tsc --noEmit` and `oxlint src` clean apart from the pre-existing
`baseUrl` deprecation and `button.tsx` warnings. Verified in the sandbox:
no console errors on select, on theme toggle, during a 60s soak, or on
deselect; no shader-compile errors; zero network requests for `.hdr` or
raw.githack.com; WebGL context never lost; the renderer reports
single-digit geometry, texture and program counts that stay flat over a
60s run, which is the direct evidence that geometry and material sharing
took effect. Everything that is actually a pixel judgement — whether the
beads read as glass, whether the two colours stay distinguishable in both
themes, whether dispersion is visible, frame rate under load — was checked
by a human in a real focused browser window, because the browser-pane
sandbox does not composite frames when unfocused and cannot answer any of
those questions.

Bead-vs-UI collision is still deliberately open.

Status: done.
```

Adjust the last verification paragraph if Task 3 changed any dials — say which and why.

- [ ] **Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "Document bead scene phase 2"
```

---

## Self-Review

**1. Spec coverage.**

| Requirement (from the Phase 2 brief and the design spec's Phase 2 section) | Task |
|---|---|
| Swap beads to a genuinely refractive glass material | Task 1, Steps 2-6 |
| Exact material props specified concretely | Task 1, Step 2 (constants) + Step 3 (`useBeadMaterials`) |
| Birth/death colour distinction carries over to a see-through material | Task 1, Step 3 (`attenuationColor` = tint, `color` = tint, `BEAD_TRANSMISSION = 0.9` holding back diffuse so the tint survives); Task 3 Q2/Q3 verify it |
| Lighting/environment: preset vs custom, decided | Task 1, Step 4 — custom local `Lightformer` rig, presets explicitly rejected with source citation |
| How the environment composes with the existing lights | Task 1, Step 6 — `ambientLight` removed with reason, `directionalLight` kept at 2.2 → 1.4 |
| Performance addressed with a real approach, not hand-waving | Global Constraints (MTM rejection with source evidence) + Task 1 (shared geometry/material) + Task 2 (cap 180→120, dpr cap, `transmissionResolutionScale`, `memo(Boundaries)`) |
| Phase 1's flagged per-bead geometry/material allocation fixed | Task 1, Steps 2 and 5; verified by Task 2 Step 6 check 1 |
| Fallback/safety: a real call, not a listed option | Global Constraints — explicitly **no** runtime fallback and **no** toggle constant, with the reasoning; per-task commits are the revert granularity |
| Verification strategy that does not pretend the sandbox works | Task 1 Step 8, Task 2 Step 6 (each with an explicit "what this cannot tell you"), and Task 3 in its entirety |
| Build on Phase 1's architecture, not redesign it | Physics, gravity, colliders, spawn loop, `spawnIntervalMs`, `resolveBeadColors`, the `pointerEvents: 'none'` override, the `key={selectedIso3}` remount and the rAF theme re-resolution are all untouched; only the material/geometry/lighting layer changes |

One requirement in the brief has no task and that is deliberate: the "hybrid — only some beads get the expensive material" option is not implemented. It is unnecessary once the material is shared (the expensive-per-instance problem it was meant to solve does not exist), and it would look like a bug — settled beads visually different from falling ones — while requiring per-frame Rapier velocity reads. Noted here so its absence is a decision, not an omission.

**2. Placeholder scan.** No "TBD"/"TODO"/"add error handling"/"similar to Task N". Every code step contains literal, complete code. The two conditional paths — Task 3's tuning table and its backdrop remedy — are each written out in full (including the `BeadColors` interface change, the `resolveBeadColors` return, the `Backdrop` component, and the exact `App.tsx` className edit) rather than described. The one temporary line in the plan (Task 2 Step 4's `__beadGl` probe) has an explicit removal step, an explicit `grep` to confirm removal, and a stated reason for existing.

**3. Type consistency.**
- `BeadColors` is `{ birth: string; death: string }` in Tasks 1-2 and only gains `backdrop: string` in Task 3 Step 3, where `resolveBeadColors`'s return literal is updated in the same step. No window where the interface and its producer disagree.
- `useBeadMaterials(colors: BeadColors)` returns `{ birth: THREE.MeshPhysicalMaterial; death: THREE.MeshPhysicalMaterial }`; `BeadScene` stores it as `materials` and indexes `materials.birth` / `materials.death`; `BeadBody` accepts `material: THREE.Material`, which `MeshPhysicalMaterial` satisfies.
- `BeadBody`'s props change from `{ bead, colors }` to `{ bead, material }` in Task 1 Step 5, and its only call site is updated in Task 1 Step 6 — same task, no intermediate broken state.
- `BeadEnvironment({ intensity }: { intensity: number })` is declared in Task 1 Step 4 and called with `intensity={theme === 'dark' ? 1 : 1.5}` in Step 6; Task 3's dark-theme dial edits that same expression.
- `Backdrop({ color }: { color: string })` is declared and called with `colors.backdrop` in the same step (Task 3 Step 3).
- `BEAD_GEOMETRY`, `BEAD_RADIUS`, `MAX_BEADS`, `BEAD_TRANSMISSION`, `BEAD_ATTENUATION_DISTANCE`, `BEAD_THICKNESS`, `BEAD_IOR`, `BEAD_ROUGHNESS`, `BEAD_DISPERSION` are used under exactly those names in every task that references them. `Bead`, `SPAWN_JITTER_PX`, `spawnIntervalMs` and `Boundaries`'s collider maths are inherited unchanged from Phase 1.
- `Boundaries` becomes `const Boundaries = memo(function Boundaries() {…})` in Task 2 Step 2; its JSX usage `<Boundaries />` is unchanged, so no call site needs updating.

---

## Notes for the orchestrator

**Biggest judgment call: I did not use `MeshTransmissionMaterial`.** Reading drei's source, each instance allocates two viewport-sized FBOs and runs its own full `gl.render(scene, camera)` every frame — at 180 beads that is unrunnable, and `transmissionSampler` only removes the render, not the FBOs. three 0.185's `MeshPhysicalMaterial` has `transmission`, `ior`, `thickness`, `attenuationColor` **and** `dispersion` (native chromatic aberration), does the transmission pass once per frame for all objects, and can be one shared instance. It is the same visual family for ~1/100th the cost. The plan cites file and line for all of this so you can check me.

**Second call: no capability fallback.** A hackathon demo on one known machine; a second unverifiable path adds risk. Per-task commits are the revert granularity instead.

**Realistic to attempt in an automated pipeline?** Tasks 1, 2 and 4 — yes. They are mechanical, and Task 2's renderer-`info` probe (geometry/program counts) is genuinely strong in-sandbox evidence that the sharing worked, independent of compositing. **Task 3 is not automatable and I would not let an agent self-certify it.** Everything that makes this phase worth doing is a pixel judgement, and one specific outcome is genuinely uncertain without eyes: with a transparent canvas, three clears the transmission target to white-at-0.5-alpha, so bead alpha lands near 0.55 and composites oddly over the page. I gave a fully-specified deterministic remedy (opaque backdrop + one `z-10` class), but whether it is needed, and whether it helps or hurts the dark theme, only a human can say. Run Tasks 1-2 automated, then stop at Task 3 and look.
