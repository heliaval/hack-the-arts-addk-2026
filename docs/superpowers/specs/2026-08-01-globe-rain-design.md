# Ambient globe rain

## Problem

The globe currently sits idle (no ambient motion of its own) whenever no
country is selected — the only motion on screen is its own rotation. The user
wants a decorative red, water-like rain effect that falls toward the globe,
wraps around its visible silhouette as it passes, and continues off the
bottom of the screen — running only during this idle state. The instant a
country is selected and the bead burst (`docs/superpowers/specs/2026-08-01-fast-fill-bead-burst-design.md`)
starts filling the screen with marbles, the rain effect stops.

## Approach

### Component and lifecycle

A new component, `GlobeRain`, rendered in `App.tsx` next to `GlobeView`,
mounted only while `!selected` — mirroring how `BeadScene` is mounted only
while `selected` is truthy today (`App.tsx:365-373`). No shared mount window
between the two: the moment `selected` flips, `GlobeRain` unmounts and
`BeadScene` mounts in the same render, so the rain effect and the bead burst
never render together.

`GlobeRain` reads the same `globeCircle` state `App` already tracks
(`App.tsx:282`, currently passed to `BeadScene`) so the rain always tracks
wherever the globe's on-screen circle currently is — no separate
measurement path.

### Rendering: 2D canvas overlay, not a second WebGL scene

`GlobeRain` owns a single `<canvas>` sized to the viewport, driven by its own
`requestAnimationFrame` loop drawing with the 2D context — not a second
Three.js/`@react-three/fiber` `<Canvas>`. The motion here is procedural curve
math over a small drop count, not physics, so a second WebGL context (and
its own transmission/lighting overhead, mirroring what `BeadScene` already
pays for the beads) buys nothing. This also means `GlobeRain` and
`BeadScene` never both hold a live WebGL context, since they're
mount-exclusive.

Layering: same slot convention as `BeadScene` — `pointer-events-none`,
positioned so it sits above the globe but below the UI panels (`z-0`,
matching `BeadScene`'s wrapper in `BeadScene.tsx:904`) — so it never
intercepts clicks on the globe or the control panel/toggles.

### Particle model

Each drop is a small plain object (not a React-rendered element — everything
is drawn imperatively to the canvas each frame):

```
interface Drop {
  x: number          // current x, CSS px, viewport-relative
  y: number           // current y
  speed: number        // px/s, randomized per drop for variety
  width: number         // droplet thickness, randomized per drop
  length: number        // streak length, randomized per drop
  phase: 'fall' | 'wrap' | 'release'
  wrapAngle: number      // current angle around the globe center, only used in 'wrap'
  wrapSide: -1 | 1        // which side of the globe it entered on
}
```

State machine, evaluated per drop per frame:

1. **`fall`** — moves straight down (`y += speed * dt`) at a fixed `x` chosen
   at spawn. Transitions to `wrap` the first frame its straight-line path
   would cross inside the globe's circle (`(x - cx)² + (y - cy)² < r²`, using
   `globeCircle`'s center/radius) — i.e. only drops on a collision course
   ever wrap; the rest fall straight through phase 1 → `release` never
   triggers for them because they simply never enter `wrap` and keep
   `fall`ing until they're recycled off-screen.
2. **`wrap`** — position is computed directly from `wrapAngle` (not from `x`/
   `y` velocity): `x = cx + r * sin(wrapAngle) * wrapSide`, `y = cy -
   r * cos(wrapAngle)`. `wrapAngle` advances each frame proportional to the
   drop's `speed` (arc length ≈ `speed * dt / r`), starting at the angle
   where it crossed into the circle and increasing until it passes the
   bottom of the arc (`wrapAngle >= π`, i.e. past the globe's south pole on
   that side), at which point it transitions to `release`.
3. **`release`** — behaves exactly like `fall` (straight down at `speed`),
   starting from the wrap-exit position. Once `y` exceeds the viewport
   height by a margin, the drop is respawned at a random `x` above the
   viewport with a fresh random `speed`/`width`/`length`, back in `fall`.

This is deliberately not real physics (no gravity acceleration, no
collision response) — it's a scripted curve chosen to read as "water
sheeting over a sphere," matching the reference behavior the user described
rather than simulating one.

### Look: water-like streaks

Each drop draws as a short streak along its direction of travel (vertical
during `fall`/`release`, tangent-to-the-arc during `wrap`, computed from
`wrapAngle`'s derivative):

- A translucent red body (`globalAlpha` in the 0.25–0.4 range) the length of
  `drop.length`, drawn as a thin rounded rectangle or line with
  `lineCap: 'round'`.
- A brighter, more saturated core along the leading (bottom) edge of the
  streak — a shorter, higher-alpha segment — standing in for the specular
  highlight a real droplet would show, so it doesn't read as a flat colored
  line.
- Per-drop `width`/`length` jitter so the stream doesn't look like uniform
  repeated copies.

Color is derived from the same `--accent` custom property the beads already
read (reusing the `normalizeCssColor`/computed-style readback pattern from
`BeadScene.tsx:167-197`, not duplicating a hand-picked hex), with the
highlight core pushed toward white and the body/tail kept in the accent's
hue — the same "keep the tint legible without flattening it" technique the
bead marbles already use. Re-resolved on the same theme-flip `useEffect`
pattern `BeadScene` uses, so light/dark both stay correct.

### Density and spawn

A small fixed pool of drops (tuned by eye during implementation — expect
roughly a dozen to a few dozen concurrent drops, well below `BeadScene`'s
bead counts since this is a much cheaper per-drop draw). On `GlobeRain`
mount, the pool is seeded with drops at randomized `y` positions and phases
(not all starting at the top in `fall`), so the effect looks already
in-progress on mount rather than visibly starting from zero.

## Out of scope

- No exit animation when a country is selected — `GlobeRain` simply unmounts
  and `BeadScene` takes over the same screen space, same as the bead scene
  has no entrance animation today.
- Exact drop count, speed range, width/length ranges, and alpha values are
  tuned by eye during implementation, not fixed here.
- No interaction between rain drops and the bead physics world — they are
  fully separate systems that are never mounted at the same time.
- No sound.
