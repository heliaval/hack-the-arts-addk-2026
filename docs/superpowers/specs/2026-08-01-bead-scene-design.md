# Bead Scene (Hourglass Replacement)

## Problem

The planned "click a country → 3D hourglass scene" narrative device (per `PRODUCT.md`) was never started (no Rapier/three.js code exists). Building and texturing a literal hourglass 3D model is high-effort and, per discussion, less visually interesting than an alternative: treat the whole viewport as a physics container that glass beads fall into and pile up in, still driven by the same real birth/death data, without needing a custom 3D model at all (beads are primitive spheres).

## Decision

Replace the hourglass scene with a **bead scene**: selecting a country shrinks the globe into a corner and beads fall from top-center, piling up against invisible floor/wall colliders sized to the viewport. Birth-rate and death-rate data (already computed as `birthsPerSecond`/`deathsPerSecond` in `CountryDemographics`, `src/lib/worldbank.ts`) drives two colors of bead spawning in real time.

## Trigger & Exit

- Selecting a country (existing `handleSelectCountry` / `selectedIso3` state in `App.tsx`) shrinks `GlobeView` via a CSS transform (scale + translate to a corner) instead of leaving it full-size, and mounts the new `BeadScene` component.
- Clicking the shrunken globe again clears `selectedIso3` (existing click-to-select logic in `GlobeView`), which unmounts `BeadScene` and restores the globe to full size. Symmetric in/out, no separate close control.
- While the scene is active, existing UI (control panel sliders, language/theme toggles, title) stays visible and fully usable, unchanged.

## Physics & Rendering

- New dependencies: `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier`.
- `BeadScene`: a `fixed inset-0` full-viewport `<Canvas>`, transparent background, `pointer-events-none` on the canvas root so clicks pass through to the sliders/toggles beneath it (the shrunken globe's own click handler, not the canvas, handles exit).
- `<Physics>` (react-three-rapier) with a static floor collider and static left/right wall colliders sized to the current viewport (so beads pile up on-screen instead of falling forever or spilling off the sides); no top wall (open spawn point).
- Beads: `RigidBody type="dynamic"` spheres, spawned at top-center with slight random horizontal jitter so they don't perfectly stack in a single column.
- Live bead count capped (~150-200); once the cap is hit, the oldest bead is removed each time a new one spawns, so performance stays bounded regardless of how long the scene stays open.

## Data Mapping

- Birth bead color: `--accent` (the app's existing red).
- Death bead color: `--foreground` (automatically correct in both themes: near-black light / near-white dark).
- Spawn rate: `birthsPerSecond`/`deathsPerSecond` are real per-second rates but too slow to read for most countries (large countries are still under 1/sec). Rescale for legibility the same way `src/lib/globeSpeed.ts` already turned an arbitrary rotation constant into an "instrument reading" value — smallest and largest real countries both produce a visually legible spawn rate, never near-zero or overwhelming.

## Phased Implementation (explicit, per user request)

**Phase 1 (bare-bones, build and confirm first):** Physics and spawn/exit mechanics only. Beads render as plain opaque `MeshStandardMaterial` spheres (solid accent-red / foreground-color, no refraction). Goal: prove the shrink/spawn/pile/exit mechanics actually work end-to-end and look right before spending time on material polish.

**Phase 2 (glass polish, only after Phase 1 is confirmed working):** Swap the bead material to drei's `MeshTransmissionMaterial` for real-time refraction, add appropriate scene lighting/environment for it to read as glass.

## Scope

- New: `src/components/BeadScene.tsx`, spawn-rate rescaling helper (likely `src/lib/beadSpawnRate.ts`, mirroring `globeSpeed.ts`'s pattern).
- Modified: `App.tsx` (mount `BeadScene` conditionally on `selectedIso3`, shrink `GlobeView` via CSS transform when active).
- Explicitly deferred, not in this pass: physical collision between beads and UI elements (title, control panel, toggles) — noted as a documented future enhancement per earlier discussion.
- No change to the demographics data layer (`worldbank.ts`) — `birthsPerSecond`/`deathsPerSecond` already exist and are sufficient as inputs.
