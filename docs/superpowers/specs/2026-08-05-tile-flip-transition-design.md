# Tile-Flip Scene Transition — Design

## Problem

Selecting a country today is an instant, unanimated cut: `BeadScene` mounts
the moment `selectedIso3` + `yearTotals` both become truthy in `App.tsx` —
no fade, scale, or any other transition. Deselecting (currently: clicking
the already-selected city marker again) is the same abrupt cut in reverse.
The user's own description: "not smooth at all and looks kind of bad."

**Correction (found during implementation planning):** an earlier version
of this doc claimed `BeadScene`'s backdrop is opaque "the instant it
mounts," and that this alone guarantees the globe is never visible through
the new tile overlay. That's wrong. `BeadScene`'s "opaque backdrop" (its
`Backdrop` component) is a pair of THREE `<mesh>`es *inside* its R3F
`<Canvas>`, not an opaque DOM element — until that canvas actually paints a
first real frame (WebGL init, shader compile, its Lightformer cubemap
bake), the `BeadScene` layer is a transparent hole and the globe shows
straight through it. Realistically several hundred ms on a cold selection,
not instant. This means the tile transition's lead-in (see Sequencing
below) isn't a nicety — it's the load-bearing mechanism that actually
prevents a visible "globe → transparent hole → beads" glitch, and it also
means the globe *will* be faintly visible through the translucent tiles
during the brief covering phase, which is fine (it's the outgoing scene at
that moment) — the real requirement is just that the bead scene has
painted *before* tiles start becoming see-through.

## Goal

Cover that instant cut with an animated tile-flip reveal: a grid of
translucent tiles sweeps across the screen and flips away to reveal
whichever scene (globe or bead scene) is now mounted underneath, instead of
the viewer ever seeing the raw pop.

## Reference implementation to reuse

`src/components/ui/cube-flip-toggle.tsx` already implements the exact 3D
flip mechanic this needs, at button scale: a `perspective`-having container,
two faces joined at a shared edge via a rotation + `translateZ` (half the
element's own size on the rotation axis) with `backfaceVisibility: hidden`,
animated via a CSS `transition` (not JS/rAF) on `transform`, with a slight
overshoot easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`). The tile grid is
this same technique tiled across the viewport instead of one button — with
one deliberate difference from the toggle: **the toggle hinges on
`rotateX` (a horizontal edge, top/bottom)**; **tiles hinge on `rotateY` (a
vertical edge, left/right)**, so each tile's own flip motion is
horizontal — the visible face swings away starting from its right edge and
sweeps right-to-left, like a page turning, hinged on the tile's left edge.
(This is a separate axis of control from the grid-level stagger order
below, which is about which tiles start flipping first, not which way any
individual tile rotates.)

## Grid & tiles

- ~8 columns × 6 rows (confirmed as "medium" density), covering the full
  viewport.
- Each tile is translucent — the app's own background (the dot-matrix
  layer) should read through it, not black — using the app's existing
  tokens as a placeholder tint until a texture asset is supplied later (the
  tile surface should be built so swapping in a `background-image` later
  is a one-line change, same pattern as the glass-texture layer in
  `dot-matrix-background.tsx`).
- The real requirement isn't "the globe is never visible" (it's fine, even
  correct, to see it faintly through the tiles while it's still the
  outgoing scene) — it's that the tiles never reveal a *transparent hole*
  where the bead scene should be. See Sequencing below.

## Sequencing (forward: selecting a country)

1. The moment selection commits (`selected && yearTotals` both become
   truthy), the tile overlay mounts covering the full viewport, **and**
   `BeadScene` mounts underneath it in the same render — both driven off
   the same state change, so there is no frame where only one exists.
2. Tiles hold their flat/covering position for a short lead-in — this is
   the mechanism that actually hides `BeadScene`'s WebGL cold-start (see
   the correction above), so it needs to be long enough for a first real
   frame to paint before anything becomes see-through. An implementation
   detail to tune against actual paint timing, not a fixed number to lock
   in here.
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
