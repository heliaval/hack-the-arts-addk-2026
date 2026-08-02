import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { computeSweepDelays } from '@/lib/sweep'
import type { GlobeCircle } from '@/components/ui/cobe-globe'

// See docs/superpowers/specs/2026-08-05-tile-flip-transition-design.md.
//
// Covers the hard cut between the globe and BeadScene with a grid of tiles
// that flip open on a right-to-left page-turn motion. Direction is NOT a
// prop -- forward (globe -> beads) and reverse (beads -> globe) play the
// exact same cover/reveal sequence, just triggered by `active` flipping
// either way. The only thing that differs between directions is the
// lead-in duration below.
//
// The lead-in is load-bearing, not cosmetic: BeadScene's "opaque backdrop"
// (see its Backdrop component) is a THREE mesh inside an R3F <Canvas>, not
// an opaque DOM element -- until that canvas paints a first real frame
// (WebGL init + shader compile + Lightformer cubemap bake), the BeadScene
// layer is a transparent hole and the globe shows straight through it.
// LEAD_IN_FORWARD_MS is a starting estimate for that cold-start cost, not
// a measured value -- if a transparent-hole flash is ever visible on a
// cold selection, this is the first constant to raise.
const COLUMNS = 8
const ROWS = 6
const LEAD_IN_FORWARD_MS = 220
const LEAD_IN_REVERSE_MS = 180
const TILE_FLIP_MS = 460
const TILE_PERSPECTIVE_PX = 900
// How long the grid takes to fade to nothing once every tile has finished
// flipping. Without this the last frame is a fully-opaque grid removed in
// a single commit -- fine with today's translucent placeholder tint, but
// once real (opaque) artwork replaces it that pop reintroduces the exact
// hard cut this component exists to soften.
const FADE_OUT_MS = 150
// The last tile to flip (delayMs === maxDelayMs) only finishes its own
// CSS transition TILE_FLIP_MS after `revealing` actually commits+paints,
// not at the nominal schedule instant -- this slack absorbs that so the
// fade-out doesn't start while the slowest tile is still mid-turn.
const TRAILING_SLACK_MS = 80
// A quicker, non-staggered return when the transition is re-triggered
// mid-flight (e.g. beadSceneVisible flips again before a cycle finished)
// -- snapping every tile back to flat uniformly reads better than
// continuing to honor the forward sweep's per-tile delays in reverse.
const RETRIGGER_COVER_MS = 220
// Deliberately NOT cube-flip-toggle's overshoot easing
// (cubic-bezier(0.34, 1.56, 0.64, 1)): backfaceVisibility hides each face
// at 90deg, which that curve only reaches ~45% of the way through the
// duration -- the back half of the animation (including the springy
// settle it exists for) would happen to an already-invisible face.
// Symmetric ease-in-out instead, so the whole visible ramp (0-90deg) is
// spread across the full duration.
const FLIP_EASING = 'cubic-bezier(0.45, 0, 0.55, 1)'
// Fallback half-width (px) used only for the first render before a real
// viewport measurement lands -- TileTransition always returns null before
// that happens (see `phase === 'idle'`), so this value is never actually
// painted; it just needs to exist as a starting default for useState.
const FALLBACK_HALF_WIDTH_PX = 90
// Static per-face lighting (see the 2026-08-06 spec's "Physical tiles:
// lighting"). No per-frame JS -- a fixed gradient per face is enough to
// sell "distinct surfaces catching light differently," the same job the
// front/back faces' differing tints (bg-muted/55 vs bg-muted/40) already
// do, just more legibly. Layered as `background-image` ON TOP of each
// face's existing `bg-muted/*` background-color, so the eventual texture
// swap is still the one-line change the 2026-08-05 spec promised: replace
// this value with `url(/textures/tile.jpg)` and the tint keeps working as
// a fallback underneath it.
const FRONT_HIGHLIGHT = 'linear-gradient(105deg, oklch(1 0 0 / 8%), transparent 60%)'
// Edge faces are the "shadowed side": a flat darken, no gradient. A plain
// black overlay rather than a heavier bg-muted/* class, because --muted is
// LIGHTER than --background in dark mode (see src/index.css) -- raising
// muted's alpha there would make the rim brighter, backwards from what a
// shadowed edge should look like. A neutral black layer darkens correctly
// in both themes. Eyeball-tuned starting point, adjustable later.
const EDGE_SHADE = 'linear-gradient(oklch(0 0 0 / 12%), oklch(0 0 0 / 12%))'

interface Tile {
  id: string
  delayMs: number
}

function buildTiles(): Tile[] {
  const items: { id: string; x: number; y: number }[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      // computeSweepDelays sorts purely by (x + y) -- a top-left-first
      // diagonal. Mirroring the column axis here turns that same
      // comparator into a top-right-first diagonal instead, with zero
      // changes to the shared util or its other (perf-sensitive) callers
      // in GlobeView/cobe-globe. Coordinates are normalized 0..1 (not raw
      // cell indices) so the wavefront stays proportionally diagonal
      // regardless of the grid's column/row counts.
      items.push({
        id: `${row}-${col}`,
        x: (COLUMNS - 1 - col) / (COLUMNS - 1),
        y: row / (ROWS - 1),
      })
    }
  }
  const delays = computeSweepDelays(items)
  return items.map(({ id }) => ({ id, delayMs: delays.get(id) ?? 0 }))
}

interface TileTransitionProps {
  /** Whether the bead scene is the thing mounted underneath right now.
   * Pass the exact same expression that gates BeadScene's own mount, so
   * the overlay and the new scene land in the same React commit -- every
   * change of this value, either direction, plays one full cover->reveal
   * cycle. */
  active: boolean
  /** The globe's live on-screen circle (viewport CSS px), or null before
   * it's laid out. Used to punch a transparent hole in the grid's mask so
   * the sphere is never visually crossed by a tile -- see the mask-image
   * comment on the grid container below for why this exists instead of a
   * stacking-order trick. */
  circle: GlobeCircle | null
}

type Phase = 'idle' | 'covering' | 'revealing' | 'fadingOut'

export function TileTransition({ active, circle }: TileTransitionProps) {
  const tiles = useMemo(buildTiles, [])
  const maxDelayMs = useMemo(() => Math.max(...tiles.map((t) => t.delayMs)), [tiles])

  const [phase, setPhase] = useState<Phase>('idle')
  const [retriggered, setRetriggered] = useState(false)
  // Half of a real tile's rendered width, in px -- translateZ needs an
  // absolute length, and a mismatch here means the two cube faces don't
  // actually meet at a shared edge (a visible slit/overlap at every
  // tile's leading corner). Measured fresh at the start of each cycle
  // rather than tracked via ResizeObserver, since the overlay only exists
  // for ~1.1s and a mid-transition resize isn't worth handling.
  const [halfWidthPx, setHalfWidthPx] = useState(FALLBACK_HALF_WIDTH_PX)
  const prevActiveRef = useRef(active)
  // Latest `phase`, read (not depended on) inside the layout effect below
  // to detect a mid-flight retrigger -- a plain dependency would rerun
  // that effect on every phase change the effect itself causes.
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // useLayoutEffect, not useEffect: this hook is what actually makes the
  // overlay appear/disappear. A passive effect runs AFTER the browser has
  // already painted the commit that flips `active` -- which is the exact
  // commit where BeadScene mounts/unmounts -- so a plain useEffect
  // guarantees at least one painted frame of the raw, uncovered cut
  // before the overlay shows up. useLayoutEffect flushes synchronously
  // before paint instead.
  useLayoutEffect(() => {
    if (prevActiveRef.current === active) return
    const forward = active
    const wasMidFlight = phaseRef.current !== 'idle'
    prevActiveRef.current = active
    setRetriggered(wasMidFlight)
    setHalfWidthPx(window.innerWidth / COLUMNS / 2)
    setPhase('covering')
    const leadIn = wasMidFlight ? RETRIGGER_COVER_MS : forward ? LEAD_IN_FORWARD_MS : LEAD_IN_REVERSE_MS
    const t1 = window.setTimeout(() => setPhase('revealing'), leadIn)
    const t2 = window.setTimeout(
      () => setPhase('fadingOut'),
      leadIn + maxDelayMs + TILE_FLIP_MS + TRAILING_SLACK_MS,
    )
    const t3 = window.setTimeout(
      () => setPhase('idle'),
      leadIn + maxDelayMs + TILE_FLIP_MS + TRAILING_SLACK_MS + FADE_OUT_MS,
    )
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [active, maxDelayMs])

  if (phase === 'idle') return null

  const reduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Punches a transparent hole in the grid exactly where the globe's sphere
  // renders, so the grid can stay the TOPMOST layer (z-40, covering both
  // GlobeView and BeadScene -- both are needed: BeadScene's opaque backdrop
  // must stay covered until the reveal, see the lead-in comment above) while
  // never visually crossing the visible sphere. A prior version tried to
  // achieve "never crosses the sphere" via stacking order instead (sitting
  // BELOW GlobeView) -- diagnosed by Opus 2026-08-06 as the cause of a
  // regression where the entire flip became invisible: BeadScene's `z-0`
  // `fixed inset-0` backdrop (BeadScene.tsx) is later in the DOM than
  // GlobeView and was never accounted for, so it silently painted over the
  // whole grid the instant its first WebGL frame landed. Masking a hole
  // avoids the stacking conflict entirely -- the grid can be simultaneously
  // "above everything" (so nothing occludes the animation) and "never over
  // the sphere" (so the globe reads as uninterrupted) because those are
  // orthogonal properties once expressed as a hole instead of a z-order.
  // `#000`/transparent stops (not percentages) so the hole's exact pixel
  // radius matches `circle.radius` regardless of viewport size; a 1px hard
  // edge, not a soft fade, since a blurred edge would show a visible seam
  // where the grid's own border-radius-less square tiles meet a round cut.
  const maskImage = circle
    ? `radial-gradient(circle at ${circle.centerX}px ${circle.centerY}px, transparent ${circle.radius}px, black ${circle.radius + 1}px)`
    : undefined

  return (
    // No pointer-events-none: the overlay intentionally swallows clicks for
    // its ~1.1s lifetime -- the entire answer to "user clicks a different
    // city while the transition is still mid-flight" is this one CSS
    // property (plus the mid-flight retrigger path below for when it
    // happens anyway via a non-pointer trigger). Restored 2026-08-06 along
    // with z-40 -- see the maskImage comment above for why topmost is
    // correct again.
    <div
      aria-hidden="true"
      className="fixed inset-0 z-40 grid border-l border-t border-border transition-opacity ease-out"
      style={{
        gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        opacity: phase === 'fadingOut' ? 0 : 1,
        transitionDuration: `${FADE_OUT_MS}ms`,
        maskImage,
        WebkitMaskImage: maskImage,
      }}
    >
      {tiles.map((tile) => {
        // rotateY endpoints, so the signs don't get "simplified" back to
        // something plausible-looking but wrong: the wrapper rotates
        // 0deg -> +90deg. Front face's own transform is just translateZ
        // (no pre-rotation), so its total rotation is 0+wrapper -- it
        // starts facing the viewer and reaches exactly 90deg (edge-on,
        // hidden by backfaceVisibility) right as the wrapper finishes.
        // Back face's own transform is rotateY(-90deg) translateZ(...) --
        // a FIXED -90deg offset -- so its total rotation is -90+wrapper,
        // starting hidden and reaching exactly 0deg (facing the viewer)
        // at the same moment the front face passes edge-on. Both faces
        // are simultaneously front-facing somewhere in between (that's
        // correct cube behaviour, not a bug). Positive rotateY moves a
        // point at +x toward -z, i.e. the RIGHT edge recedes into the
        // screen first -- for a rigid, centre-pivot face (there's no
        // fixed hinge edge the way a door has one) that's what makes the
        // turn read as sweeping right-to-left. The leading
        // `translateZ(-halfWidthPx)` on the wrapper re-centers the whole
        // cube on the cell: without it, both faces sit `halfWidthPx`
        // toward the viewer at rest, which under `perspective` magnifies
        // them (~11% at these values) so every tile overflows into its
        // neighbors. Flipping any of these signs independently breaks
        // either the front/back handoff, the sweep direction, or the
        // resting scale -- change together and re-derive, don't guess.
        const restTransform = `translateZ(-${halfWidthPx}px) rotateY(0deg)`
        const openTransform = `translateZ(-${halfWidthPx}px) rotateY(90deg)`
        const isCoveringBack = phase === 'covering' && retriggered
        return (
          // Perspective lives on each cell, not the grid as a whole -- a
          // shared ancestor perspective would give every tile a different
          // vanishing point and skew the edge tiles hard (same choice
          // cube-flip-toggle makes: perspective on the button itself).
          <div key={tile.id} className="relative" style={{ perspective: `${TILE_PERSPECTIVE_PX}px` }}>
            {/* Rotating wrapper -- this is cube-flip-toggle's actual
                two-face cube construction (translateZ, backfaceVisibility,
                a shared rotation axis), not a single hinged pane. A door
                hinge (one face, transform-origin: left, no translateZ) was
                tried first and read as flat/2D; a real cube turn -- you
                glimpse a second surface mid-rotation -- is what gives the
                toggle its solid, mechanical feel, and that's what this is
                going for. Axis changed to rotateY (horizontal, cube-flip-
                toggle uses rotateX/vertical) so the motion reads
                left-right instead of top-bottom. */}
            <div
              className="absolute inset-0"
              style={{
                transformStyle: 'preserve-3d',
                willChange: 'transform',
                transform: phase === 'revealing' || isCoveringBack ? openTransform : restTransform,
                transitionProperty: reduced ? 'none' : 'transform',
                transitionDuration: isCoveringBack ? `${RETRIGGER_COVER_MS}ms` : `${TILE_FLIP_MS}ms`,
                transitionTimingFunction: FLIP_EASING,
                transitionDelay: phase === 'revealing' && !isCoveringBack ? `${tile.delayMs}ms` : '0ms',
              }}
            >
              {/* Front face: what's visible before the flip starts.
                  border-r/border-b only (not all four sides) -- with no
                  grid gap, adjacent tiles sit flush, and a border on
                  every side of every face would double up into a 2px
                  line at each internal seam instead of a 1px one. The
                  grid container's own border-l/border-t above closes off
                  the two edges this leaves open on the overlay's outer
                  boundary. Placeholder tint only (--muted/--border
                  tokens) -- real artwork is a one-line swap here, same
                  pattern as dot-matrix-background.tsx's glass layer:
                  backgroundImage: 'url(/textures/tile.jpg)',
                  backgroundSize: 'cover', backgroundPosition: 'center'. */}
              <div
                className="absolute inset-0 border-r border-b border-border bg-muted/55"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: `translateZ(${halfWidthPx}px)`,
                  backgroundImage: FRONT_HIGHLIGHT,
                }}
              />
              {/* Back face: briefly visible as the tile turns, settles
                  facing the viewer once the flip completes -- still a
                  plain tinted surface, not different content (the actual
                  reveal of the scene underneath happens when the grid
                  fades out at the end of the sequence, not from this face
                  being transparent). Slightly different opacity than the
                  front face so the two faces read as distinct surfaces
                  catching light differently, like a real card. */}
              {/* Geometry note (verified 2026-08-06): `rotateY(-90deg)
                  translateZ(h)` maps this div's own x-axis onto the world
                  Z axis, so it lands on the plane x = -h spanning
                  z in [-h, +h] -- i.e. this is the tile's full-depth LEFT
                  SIDE, not a plane parallel to the front face. Combined
                  with the front face it forms an L-shaped quarter-prism,
                  and since a positive rotateY recedes the right edge,
                  these two are the only planes that can ever face the
                  viewer through a 0deg -> +90deg turn. There is no gap
                  between them to fill; the rim thickness the tile reads
                  with IS this face. */}
              <div
                className="absolute inset-0 border-r border-b border-border bg-muted/40"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: `rotateY(-90deg) translateZ(${halfWidthPx}px)`,
                }}
              />
              {/* Edge faces -- the rim of the same rigid assembly (inside
                  the rotating wrapper, so they turn with it), closing the
                  prism's two remaining sides so the tile is a solid box
                  rather than an open L. Own pre-transform width is the
                  tile's full depth (2 * halfWidthPx), height is 100%;
                  after the local rotateY(90deg) that width axis maps onto
                  the world Z axis. Centered via left/marginLeft (layout,
                  not transform) so transform-origin stays the cell center.

                  Both are correct-but-invisible for THIS animation, and
                  that's expected, not a bug: the right plane's outward
                  normal points away from the per-cell perspective origin
                  at every angle in 0..90deg, and the left plane is already
                  occupied by the back face above (which carries the
                  outward-facing normal there). They exist so the solid is
                  actually closed -- if the flip range or rotation sign
                  ever changes, these are what keep it from showing a
                  hollow interior. See the 2026-08-06 spec, "Physical
                  tiles: real edge thickness." */}
              <div
                className="absolute inset-y-0 bg-muted/70"
                style={{
                  left: '50%',
                  marginLeft: `-${halfWidthPx}px`,
                  width: `${halfWidthPx * 2}px`,
                  backfaceVisibility: 'hidden',
                  transform: `rotateY(90deg) translateZ(${halfWidthPx}px)`,
                  backgroundImage: EDGE_SHADE,
                }}
              />
              <div
                className="absolute inset-y-0 bg-muted/70"
                style={{
                  left: '50%',
                  marginLeft: `-${halfWidthPx}px`,
                  width: `${halfWidthPx * 2}px`,
                  backfaceVisibility: 'hidden',
                  transform: `rotateY(90deg) translateZ(-${halfWidthPx}px)`,
                  backgroundImage: EDGE_SHADE,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
