import { useEffect, useMemo, useRef, useState } from 'react'
import { computeSweepDelays } from '@/lib/sweep'

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
const FLIP_END_DEG = 92 // 90deg = edge-on/invisible (backfaceVisibility); 2deg margin
const TILE_PERSPECTIVE_PX = 900
// Deliberately NOT cube-flip-toggle's overshoot easing
// (cubic-bezier(0.34, 1.56, 0.64, 1)): backfaceVisibility hides each tile
// at 90deg, which that curve only reaches ~45% of the way through the
// duration -- the back half of the animation (including the springy
// settle it exists for) would happen to an already-invisible tile.
// Symmetric ease-in-out instead, so the whole visible ramp (0-90deg) is
// spread across the full duration.
const FLIP_EASING = 'cubic-bezier(0.45, 0, 0.55, 1)'

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
}

type Phase = 'idle' | 'covering' | 'revealing'

export function TileTransition({ active }: TileTransitionProps) {
  const tiles = useMemo(buildTiles, [])
  const maxDelayMs = useMemo(() => Math.max(...tiles.map((t) => t.delayMs)), [tiles])

  const [phase, setPhase] = useState<Phase>('idle')
  const prevActiveRef = useRef(active)

  useEffect(() => {
    if (prevActiveRef.current === active) return
    const forward = active
    prevActiveRef.current = active
    setPhase('covering')
    const leadIn = forward ? LEAD_IN_FORWARD_MS : LEAD_IN_REVERSE_MS
    const t1 = window.setTimeout(() => setPhase('revealing'), leadIn)
    const t2 = window.setTimeout(() => setPhase('idle'), leadIn + maxDelayMs + TILE_FLIP_MS)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [active, maxDelayMs])

  if (phase === 'idle') return null

  return (
    // No pointer-events-none: the overlay intentionally swallows clicks
    // for its ~1.1s lifetime -- that's the entire answer to "user clicks a
    // different city while the transition is still mid-flight," for one
    // CSS property. See the design spec's open questions.
    <div
      aria-hidden="true"
      className="fixed inset-0 z-40 grid"
      style={{
        gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
      }}
    >
      {tiles.map((tile) => (
        // Perspective lives on each cell, not the grid as a whole -- a
        // shared ancestor perspective would give every tile a different
        // vanishing point and skew the edge tiles hard (same choice
        // cube-flip-toggle makes: perspective on the button itself).
        <div key={tile.id} className="relative" style={{ perspective: `${TILE_PERSPECTIVE_PX}px` }}>
          <div
            className="absolute inset-0 border border-border bg-muted/55 motion-reduce:transition-none"
            style={{
              // Hinged on the tile's OWN left edge -- a door/page, not
              // cube-flip-toggle's centre-axis cube (which is why there's
              // no translateZ here: a cube turn needs two faces pushed out
              // to translateZ(half-size) so they meet at a shared edge;
              // this is a single face rotating about its own edge).
              transformOrigin: 'left center',
              backfaceVisibility: 'hidden',
              willChange: 'transform',
              // Positive rotateY sends the right edge away from the
              // viewer, so the tile shrinks toward its hinge and stays
              // inside its own grid cell. Negative would lift it toward
              // the camera and overflow into neighboring cells.
              transform: phase === 'revealing' ? `rotateY(${FLIP_END_DEG}deg)` : 'rotateY(0deg)',
              transitionProperty: phase === 'revealing' ? 'transform' : 'none',
              transitionDuration: `${TILE_FLIP_MS}ms`,
              transitionTimingFunction: FLIP_EASING,
              transitionDelay: `${tile.delayMs}ms`,
              // Placeholder tint only (--muted/--border tokens) -- real
              // artwork is a one-line swap here, same pattern as
              // dot-matrix-background.tsx's glass layer:
              // backgroundImage: 'url(/textures/tile.jpg)',
              // backgroundSize: 'cover', backgroundPosition: 'center',
            }}
          />
        </div>
      ))}
    </div>
  )
}
