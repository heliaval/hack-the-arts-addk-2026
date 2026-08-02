# Tile Transition: Behind-the-Globe Stacking + Physical Tiles — Design

## Problem

The tile-flip transition shipped in `TileTransition.tsx` (see
`docs/superpowers/specs/2026-08-05-tile-flip-transition-design.md`) is a
full-viewport `z-40` overlay — the topmost layer in the app. Visually this
means the flipping tile grid slices directly across the visible globe
sphere itself: chunky panels cut through the circle rather than staying
out of its way. User's own description, with a sketch showing two panels
meeting at a "mid" seam and a circled note reading "physical 3D
animation": "the transition is there, but not what I want... it should be
a truly 3d transition that occurs behind the globe."

Clarified through discussion:
- "Behind the globe" means the transition layer sits behind the globe in
  the visual stack — the globe itself doesn't move, shrink, or animate;
  it stays exactly as it is today, and the tile grid animates in the
  margins/background around it.
- Keep the existing 8×6 grid and sweep mechanic (not the 2-panel count
  shown literally in the sketch) — the ask is about depth/stacking and
  physicality, not panel count.
- The tiles should read as physically solid — real edge thickness and a
  lighting gradient — not flat opposing planes with a gap between them.

## Why this is achievable without masking logic

`GlobeView`'s rendering surface is not a full-viewport opaque layer:

- Its outer wrapper (`App.tsx`) is `absolute inset-0`, but internally
  (`GlobeView.tsx`) the actual `<canvas>` is constrained to
  `aspect-square w-full max-w-[min(80vh,48rem)]`, centered by a
  transparent `flex items-center justify-center p-8` wrapper.
- The canvas itself (`cobe-globe.tsx`) only paints the sphere (plus dots,
  markers, arcs) — cobe does not paint an opaque background; everything
  outside the sphere's silhouette, both within and outside the canvas's
  own square bounding box, is transparent.

So: if the tile grid paints *underneath* `GlobeView` in stacking order,
the sphere masks it automatically — no clip-path, no canvas readback, no
per-pixel logic. This is purely a DOM-order / z-index change.

## Stacking change

Current DOM order (all auto z-index except where noted; auto z-index
elements paint in document order within the same stacking context):

```
DotMatrixBackground
GlobeView            (in .absolute.inset-0, auto)
BeadScene             (auto — currently paints ON TOP of GlobeView)
LeafOverlay           (auto)
GlobeRain             (auto)
YearCounters          (z-[5])
... UI chrome ...     (z-10 / z-20)
TileTransition        (z-40 — currently topmost)
```

New order (bottom to top):

```
DotMatrixBackground
BeadScene             (unchanged trigger: beadSceneVisible)
TileTransition        (moved here; z-index dropped to sit just above
                        BeadScene, well below YearCounters' z-[5])
GlobeView             (unchanged trigger; now painted after the above)
LeafOverlay
GlobeRain
YearCounters
... UI chrome (unchanged) ...
```

Concretely: move the `TileTransition` render call in `App.tsx` to just
before the `GlobeView` div, and change its overlay `div`'s class from
`z-40` to a value under 5 (e.g. drop the explicit z-index entirely and
rely on DOM order, or use a small value like `z-[2]` for clarity against
`BeadScene`'s implicit 0) — whichever reads more clearly in the existing
z-index scheme this file already uses (`z-[5]`, `z-10`, `z-20`).

**Consequence, accepted deliberately:** with `GlobeView` now painting on
top, a click during the transition hits the globe's own marker/canvas
hit-testing instead of being swallowed by the (formerly topmost) overlay.
`TileTransition` already has mid-flight-retrigger handling
(`retriggered` / `isCoveringBack`) built for exactly this case — a
second selection change while a cycle is in flight snaps tiles back
uniformly rather than continuing the interrupted sweep. No new
click-blocking layer is needed; this existing machinery already produces
reasonable behavior if a user clicks through mid-transition.

**Nothing else in the sequencing changes.** Lead-in timing, sweep order,
per-tile flip duration/easing, fade-out — all as specced and built
2026-08-05. This document only changes (a) where the grid sits in the
stack and (b) what each tile looks like, below.

## Physical tiles: real edge thickness

Today's tile is two opposing flat faces — front (`translateZ(+half)`)
and back (`rotateY(-90deg) translateZ(+half)`), each with
`backfaceVisibility: hidden`. Nothing fills the space between them, so a
tile mid-rotation looks like a flat card edge-on (a hairline), not a
solid block turning.

Add two edge faces per tile, forming the rim of the same rigid rotating
assembly (they live inside the same rotating wrapper as the front/back
faces, so they turn together):

- **Right edge:** `transform: rotateY(90deg) translateZ(${halfWidthPx}px)`
- **Left edge:** `transform: rotateY(90deg) translateZ(-${halfWidthPx}px)`

Each edge div's own (pre-transform) width must equal the tile's full
depth, `2 * halfWidthPx`, and height 100% (matching the tile's own
height) — after the local `rotateY(90deg)`, that width axis now spans
the world Z axis (front-to-back), which is exactly the gap the front/back
faces leave open. `backfaceVisibility: hidden` again, so only the edge
facing the viewer at any given rotation angle renders.

These edges become visible precisely when they should — as the front
face rotates away and before the back face arrives — giving the
turn real, continuous surface coverage instead of a moment of "nothing
there."

## Physical tiles: lighting

No per-frame JS — a static gradient per face is enough to sell "distinct
surfaces catching light differently," consistent with how the front/back
faces already differ slightly today (`bg-muted/55` vs `bg-muted/40`):

- Front face: brightest — keep existing `bg-muted/55` tint, add a subtle
  linear-gradient highlight (e.g. `linear-gradient(105deg, oklch(1 0 0 /
  8%), transparent 60%)` layered via `background-image` on top of the
  existing tint) so it doesn't read as a flat, uniform fill.
- Edge faces: darkest — a plain darker/desaturated tint (e.g.
  `bg-muted/70` or a `oklch` value with lower lightness than either front
  or back), no gradient needed — a flat "shadowed side" reads correctly
  since these are the narrow rim strips, not the primary viewing surface.
- Back face: mid-tone — keep existing `bg-muted/40`, no gradient change
  needed (it's already the "secondary" surface).

This is a placeholder treatment, same as before — the eventual texture
swap (mentioned as "I will also later provide you with a different
texture you can use") replaces the `background-image`/tint values
directly; the gradient approach here doesn't block that swap, it's just
one more `backgroundImage`/`background` layer to replace at that time.

## Non-goals / explicitly deferred

- No change to sweep timing, lead-in durations, fade-out, or grid density
  (still 8×6) — this document is scoped to stacking + physical tile
  construction only.
- No dedicated click-blocking overlay during the transition — accepted
  consequence above, existing retrigger handling covers it.
- No per-frame/JS-driven lighting (e.g. tracking rotation angle to
  compute a live highlight position) — static per-face gradients only.
- Texture asset swap — still deferred, unchanged from the prior spec.

## Open implementation questions (for the plan, not blocking this spec)

- Exact z-index value for `TileTransition`'s container once it's no
  longer topmost (`z-[2]` vs. relying purely on DOM order with no
  explicit z-index) — plan should pick one and note why, consistent with
  the rest of `App.tsx`'s existing z-index usage.
- Exact edge-face tint/gradient values — the ones above are a reasonable
  starting point tuned against the existing front/back tint scheme, not
  measured/pixel-picked; fine to adjust during implementation if they
  read wrong once actually rendered.
