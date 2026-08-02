# Leaf Departure Effect

## Problem

When a marble is evicted at the `MAX_BEADS` cap (`src/components/BeadScene.tsx`), it shrinks away via `BeadFadeOut` and is removed — a quiet visual event with no other feedback. The ask: whenever a marble disappears, a leaf matching its color should fly across the screen, so departures read as a deliberate, aesthetic moment rather than beads simply vanishing.

## Decision

Add a DOM/CSS overlay layer, sibling to `BeadScene`'s canvas, that renders short-lived animated leaf shapes. Each eviction spawns exactly one leaf, tinted to the departing marble's exact color, at the marble's on-screen position, drifting off with an "autumn leaf" tumble.

Rendering approach: plain DOM + CSS `@keyframes`, not a Three.js in-scene sprite. This is cheaper (GPU-compositor-driven, zero per-frame JS) and matches this codebase's existing performance discipline (see `BeadFadeOut`'s comments on avoiding per-bead render-loop cost). A Three.js sprite route was considered and rejected: it would need per-leaf geometry/material or an instanced batch, a texture for the leaf shape, and a `useFrame` subscription, for a purely decorative effect.

## Trigger & Data Flow

- `BeadFadeOut` (`src/components/BeadScene.tsx`) already runs a `useFrame` loop for each dying bead, shrinking it over `BEAD_EXIT_MS`. On the *first* tick of that loop (guarded the same way `doneRef` already guards the eventual `onExpire` call, so this fires exactly once), read the mesh's live world position via `meshRef.current.getWorldPosition()`.
- Convert that Three.js world position to DOM screen coordinates using the same mapping the file's own top-of-file comment already documents for this orthographic camera setup: `screenX = width/2 + worldX`, `screenY = height/2 - worldY` (`width`/`height` from `useThree((state) => state.size)`, as `BeadBody` already does for `height`).
- Call a new `onDeparture(screenX, screenY, color)` callback, threaded as a prop: `App.tsx` → `BeadScene` → `BeadBody` → `BeadFadeOut`. `color` is `colors.birth` or `colors.death` (already resolved as hex strings in `BeadScene` via `resolveBeadColors`), selected by `bead.kind` at the `BeadBody` call site — so the leaf always matches the marble's exact glass tint, not a re-derived approximation.
- This fires at the *start* of the shrink (when the departure visually begins), not at final removal, so the leaf's launch is causally simultaneous with the marble beginning to vanish.

## Leaf State & Rendering

- `App.tsx` owns a small `leaves: Leaf[]` state array, `{id, x, y, color, seed}` per entry, appended to by `onDeparture` (monotonic id counter, same pattern `BeadScene` already uses for bead ids).
- New component `LeafOverlay` (`src/components/LeafOverlay.tsx`): plain DOM, `absolute inset-0 pointer-events-none`, mounted as a sibling to `BeadScene` in `App.tsx`'s layout, stacked above it in z-order.
- Each leaf renders as one inline SVG: a single stylized leaf silhouette (tapered tip, one center vein line), `fill` set to the leaf's `color`. One shared shape definition, reused across all leaves — no per-leaf SVG variation beyond color/transform, so the effect reads as one consistent visual language.
- No `useFrame`, no `requestAnimationFrame`, no per-frame React state updates for motion.

## Motion

- Pure CSS `@keyframes` "drift" animation per leaf: launches from the marble's exact `(x, y)`, tumbles with rotation, sways horizontally across 2–3 keyframe stops (a wobble, not a straight line), drifts downward, and fades opacity to 0 near the end.
- Per-leaf CSS custom properties (`--dx`, `--rot`, `--dur`, `--sway`), seeded from `seed` (a small random spread computed once at spawn time), give each leaf a slightly different drift distance, rotation, duration (~1.6–2.2s), and sway amplitude/direction.
- This is what makes bursts of near-simultaneous evictions (up to ~7 can be mid-exit concurrently, per `BEAD_EXIT_MS`'s existing bound comment) read as one cohesive flurry — shared shape and motion family, varied enough per-leaf to avoid looking like identical stamped clones or unrelated chaos.
- On `animationend`, the leaf removes itself from the `leaves` array (event handler calls back into `App`'s state setter) — self-pruning, no timers.

## Bounds

- Eviction rate is capped by the existing spawn-interval logic (`src/lib/beadSpawnRate.ts`; fastest combined interval ~60ms across both birth/death streams at extreme demographics). With leaf lifetime ~2s, expect at most roughly 30 leaves concurrently in flight at the extreme end — cheap for CSS-compositor-driven DOM nodes.

## Scope

- New: `src/components/LeafOverlay.tsx` (leaf state consumer, SVG shape, CSS keyframes).
- Modified: `src/components/BeadScene.tsx` (thread `onDeparture` callback through `BeadScene` → `BeadBody` → `BeadFadeOut`; compute screen position on first fade-out tick).
- Modified: `App.tsx` (own `leaves` state, wire `onDeparture` into it, mount `LeafOverlay` as a sibling above `BeadScene`).
- No change to physics, spawn/eviction logic, or bead materials — this is purely an additive departure effect layered on top of the existing eviction mechanism.
- Explicitly out of scope: leaves reacting to physics/collision, leaf shape variation beyond color, any change to how/when evictions themselves occur.
