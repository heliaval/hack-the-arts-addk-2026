# Tile-Flip Scene Transition — Design

## Problem

Selecting a country today is an instant, unanimated cut: `BeadScene` mounts
with its own fully opaque backdrop (see `src/components/BeadScene.tsx`'s
`Backdrop`), which pops in front of the globe the moment `selectedIso3` +
`yearTotals` both become truthy in `App.tsx`. `GlobeView`'s `obscured` prop
exists specifically because the globe is *already* fully hidden behind that
backdrop the instant this happens — there is no fade, scale, or any other
transition today. Deselecting (currently: clicking the same city marker
again) is the same abrupt cut in reverse. The user's own description:
"not smooth at all and looks kind of bad."

## Goal

Cover that instant cut with an animated tile-flip reveal: a grid of
translucent tiles sweeps across the screen and flips away to reveal
whichever scene (globe or bead scene) is now mounted underneath, instead of
the viewer ever seeing the raw pop.

## Reference implementation to reuse

`src/components/ui/cube-flip-toggle.tsx` already implements the exact 3D
flip mechanic this needs, at button scale: a `perspective`-having container,
two faces joined at a shared edge via `rotateX` + `translateZ` (half the
element's own size on the rotation axis) with `backfaceVisibility: hidden`,
animated via a CSS `transition` (not JS/rAF) on `transform`, with a slight
overshoot easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`). The tile grid is
this same technique tiled across the viewport instead of one button.

## Grid & tiles

- ~8 columns × 6 rows (confirmed as "medium" density), covering the full
  viewport.
- Each tile is translucent — the app's own background (the dot-matrix
  layer) should read through it, not black — using the app's existing
  tokens as a placeholder tint until a texture asset is supplied later (the
  tile surface should be built so swapping in a `background-image` later
  is a one-line change, same pattern as the glass-texture layer in
  `dot-matrix-background.tsx`).
- Tiles must never let the *previous* scene (specifically the globe) show
  through mid-transition — see Sequencing below for how this is guaranteed
  structurally rather than by making the tiles opaque (which would
  contradict "translucent").

## Sequencing (forward: selecting a country)

1. The moment selection commits (`selected && yearTotals` both become
   truthy), the tile overlay mounts covering the full viewport, **and**
   `BeadScene` mounts underneath it in the same render — both driven off
   the same state change, so there is no frame where only one exists.
   `BeadScene`'s own backdrop is already opaque, so as soon as it mounts,
   whatever is behind the tile grid is the bead scene's backdrop, not the
   globe — this is what actually satisfies "no globe visible through the
   tiles," not tile opacity.
2. Tiles hold their flat/covering position for a short lead-in (long
   enough for `BeadScene`'s WebGL canvas to paint at least one real frame
   before anything becomes see-through — an implementation detail to tune
   against actual paint timing, not a fixed number to lock in now).
3. Tiles flip away in a staggered sweep, ordered **top-right to
   bottom-left** (reusing `src/lib/sweep.ts`'s `computeSweepDelays`, which
   currently sorts by `x + y` for a top-left-to-bottom-right sweep — this
   needs the sort key inverted/adapted for the opposite diagonal, not a
   new utility).
4. Total duration budget (lead-in + full stagger spread + each tile's own
   flip animation) targets **900ms–1.2s** end to end.

## Sequencing (reverse: deselecting)

Symmetric: tile overlay mounts covering the (still-visible) bead scene,
brief lead-in, `BeadScene` unmounts and the globe becomes visible
underneath (already handled by existing state), tiles flip away in the
same top-right-to-bottom-left sweep to reveal the globe.

Note: deselecting today only happens by clicking the already-selected
city's marker again. A dedicated deselect button/control is planned
separately (out of scope here) — this transition triggers off the
selection-state change itself, whatever UI ends up causing it.

## Non-goals / explicitly deferred

- The tile surface's actual texture/artwork — a placeholder tint ships
  first, texture asset to be supplied and swapped in later.
- A dedicated deselect control — unrelated, separate piece of work.
- Live-captured scene content on the tile faces (e.g. each tile showing an
  actual snapshot of the globe/marbles) — explicitly rejected in favor of
  plain translucent covering tiles, which are far simpler and avoid
  needing to capture the WebGL canvas into a DOM grid.

## Open implementation questions (for the plan, not blocking this spec)

- Exact lead-in duration before tiles start flipping, tuned against how
  long `BeadScene`'s canvas actually takes to paint a first frame on a
  representative machine.
- Whether `computeSweepDelays` should gain a general "sort key" parameter
  (reusable for both diagonals) or whether the tile transition should
  locally pre-transform tile coordinates before calling the existing
  function — either is fine, plan should pick one.
