# Spherical Shockwave Design

## Problem

The current shockwave ring (`Pulse` in `cobe-globe.tsx`) is a flat CSS circle
overlaid on the screen — it scales up in 2D screen-space regardless of the
globe's curvature. The user wants it to actually travel across the sphere's
surface, following the globe's curve, foreshortening near the limb, and
disappearing correctly as it passes over the horizon — "start fast and
strong, fizzle out."

## Approach

Replace the CSS-driven flat circle with a **geodesic ring** computed in real
3D space each animation frame:

1. For a pulse's marker location, take its unit-sphere vector (reusing the
   existing `unitSphere()` helper — same convention already used for markers
   and arcs, so this stays pixel-consistent with everything else on the
   globe).
2. Build an orthonormal tangent basis at that point (two vectors
   perpendicular to the center, via cross products).
3. Sample N points (40) around a circle of *angular radius* θ from the
   center, using the standard spherical-cap parametrization:
   `point(φ) = center·cos(θ) + (t1·cos(φ) + t2·sin(φ))·sin(θ)`.
4. Project each of those 3D points to screen space with the existing
   `project()` function — the same one markers/labels already use — which
   naturally gives correct foreshortening and an occlusion (`visible`) flag
   per point.
5. Render as an SVG `<path>` (not a div): points are connected point-to-point,
   but a point transitioning from visible→invisible starts a new subpath (a
   gap), so the ring correctly breaks apart as it crosses the horizon instead
   of drawing a garbled line across the back of the globe.

θ (angular radius) grows over the pulse's 1.8s lifetime via an ease-out
curve (fast initial growth, slowing down) up to a max of ~1.1 radians
(~63°) — a large, clearly "traveling" distance across the visible globe.
Opacity fades independently on a curve that stays strong early and drops
off increasingly toward the end (the "fizzle").

This requires each pulse to carry a `spawnedAt` timestamp (added to
`PopulationPulse` in `populationPulse.ts`) so the per-frame calculation is
based on real elapsed time, not on when React happened to first render it.

## What's removed

- The old `Pulse` div + CSS `pulse-ring` keyframe (`index.css`) — fully
  superseded, not kept as a fallback.

## What's unchanged

- Threshold (3), tick interval (500ms), 1.8s total pulse lifetime, colors
  (accent red for births, literal black for deaths) — only the shape/motion
  of the ring changes, not the underlying accumulation logic or timing.
