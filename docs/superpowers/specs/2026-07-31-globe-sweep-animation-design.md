# Globe sweep animation + arc draw-in fix

## Problem

1. When the city-count slider adds several cities/routes at once, and when
   the language toggle flips every visible label at once, everything
   changes simultaneously — visually chaotic and (previously) laggy.
2. The existing arc "draw-in" animation (endpoint lerped linearly in
   lat/lng space from `from` toward `to`) makes the flight line look like
   it's *scaling* — the whole curve grows in both length and height
   together — rather than looking like a fixed line being progressively
   drawn/traced.

## Goals

- New cities, new routes, and language-toggle label swaps should animate
  in a left-to-right, top-to-bottom sweep across the globe, ordered by
  each item's *current on-screen position* (not fixed geography — the
  sweep should always read correctly regardless of how the globe is
  currently rotated).
- The sweep should complete within a bounded time window regardless of
  how many items are involved (2 or 20) — no fixed per-item delay that
  could make a full-range slider drag take seconds to finish animating.
- Arc draw-in should look like a line tracing along its real path, not a
  shape scaling up.

## Design

### Screen-position projection exposed from `Globe`

`Globe` (`cobe-globe.tsx`) is the only place with live phi/theta. It
becomes a `forwardRef` component exposing:

```ts
interface GlobeRef {
  project(location: [number, number]): { x: number; y: number }
}
```

Implemented by reusing the existing `projectMarker` math against a
`currentPhiRef`/`currentThetaRef` pair that the per-frame `animate()` loop
already computes and now also stores (previously `phi` was a closure-local
variable inside the effect; it becomes a ref so it's readable from the
exposed method between frames).

### Sweep ordering + timing (shared shape, used in 3 places)

For any batch of N items entering together: project each item's location
to screen space, sort ascending by `x + y` (top-left first), then assign
each item a start-delay evenly spread across a capped total window:

```
delay(i) = (i / max(1, N - 1)) * min(MAX_SWEEP_MS, N * PER_ITEM_MS)
```

This bounds total sweep duration (~150–450ms) regardless of N.

### Three application sites

1. **New markers** (`GlobeView.tsx`): a `revealedIds` state set gains
   newly-eligible city ids one at a time per the sweep schedule (via
   staggered `setTimeout`s) instead of all at once. `markers` memo filters
   `CITIES.slice(0, cityCount)` down to `revealedIds`. Each reveal mounts
   that city's `LabelPill`, which already fades in via its existing 1.4s
   CSS opacity transition — no new fade code needed, just staggered mount
   timing.
2. **Arc draw-in stagger** (`GlobeView.tsx`): `useArcDrawProgress`'s
   existing per-route stagger (currently array-order, 150ms fixed step)
   switches to sweep order or a route's projected midpoint, using the
   shared capped-window formula.
3. **Language toggle** (`cobe-globe.tsx`, self-contained): on
   `activeLabelIndex` change, snapshot every visible label's current
   projected position (already computed each frame for label placement),
   compute sweep delays, and have each `LabelPill` call
   `TextRotate.jumpTo()` after its own delay instead of immediately.

### Arc draw-in: scaling → tracing fix

Root cause (confirmed against user's description "it's like the curve
scales instead of being drawn"): the endpoint is lerped *linearly in
lat/lng space*, which does not follow the great-circle path cobe itself
draws for the final `(from, to)` pair. Because the moving partial arc
isn't a true sub-segment of the final curve, its bulge shape doesn't grow
the way a partial reveal of a fixed curve would — it reads as an
unrelated, independently-scaling shape.

Fix: replace the lat/lng lerp with a proper spherical **slerp** along the
great-circle geodesic (convert both endpoints to 3D unit vectors, slerp,
convert back to lat/lng). Any two points that lie on the true final great
circle define *the same* great circle, so cobe's own bulge-height
calculation for the partial arc becomes a genuine sub-segment of the final
curve's shape — small near the start, growing correctly — instead of an
approximation that can bulge inconsistently. This also incidentally fixes
a latent bug where long east-west routes near the antimeridian (e.g.
SF↔Tokyo) could animate via the "wrong side" of the globe, since slerp
always takes the shorter geodesic.

## Out of scope

- No changes to rotation-speed slider (not reported as laggy/weird).
- No change to which cities/routes exist or their thresholds.
- No profiling harness — verified via build/lint clean + manual browser
  check, consistent with the previous perf-fix session.
