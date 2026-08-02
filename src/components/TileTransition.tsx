import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { computeSweepDelays } from '@/lib/sweep'
import type { GlobeCircle } from '@/components/ui/cobe-globe'

// Module-level, not called inside render: `matchMedia` allocates a fresh
// MediaQueryList and re-evaluates the query every call. This component
// re-renders ~16x/sec while BeadScene's onProgress callback is firing
// during an active transition (see App.tsx's handleProgress), so calling
// this per-render was doing real repeated work for a value that -- for
// this component's ~1s lifetime -- never actually changes.
const reducedMotionQuery =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

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
//
// NOTE (2026-08-08): the `onSettled` prop below does NOT relax any of the
// above. BeadScene still MOUNTS in the same commit `active` flips, exactly
// as this paragraph requires -- its WebGL canvas still gets the full
// lead-in + flip + fade window (~2.03s forward) to init, compile shaders and
// bake its cubemap before the reveal. onSettled gates only BeadScene's
// marble SPAWN TIMER, which is a separate thing from its mount.
// ROWS is NOT a constant -- see FALLBACK_ROWS and the layout effect below.
// Tiles must render square regardless of viewport aspect ratio, so only
// the column count is fixed; row count is derived at measurement time from
// the viewport's actual height/width so each cell works out to the same
// pixel size on both axes.
const COLUMNS = 6
// All timing below bumped slower per explicit request ("could be
// slower") in the same pass that added the fade-in/out below, then
// nudged up a further ~20% ("the transition can be slightly slower too")
// in the pass that added the staggered border seal below -- values are
// eyeball-tuned, not measured, same as before.
const LEAD_IN_FORWARD_MS = 340
const LEAD_IN_REVERSE_MS = 290
const TILE_FLIP_MS = 720
const TILE_PERSPECTIVE_PX = 900
// How long the grid takes to fade in from nothing at the very start of a
// fresh cycle (idle -> covering), mirroring FADE_OUT_MS below. Added per
// explicit feedback that the sequence's start and end points felt
// "intermittent" -- before this, the grid POPPED to full opacity the
// instant it mounted (no transition on that first commit at all, since
// `transition-opacity` only animates a style CHANGE, and mount is not a
// change). See the `entering` state below for how this is actually
// triggered (mounting at opacity 0 isn't enough by itself -- the browser
// needs a painted frame at 0 before the flip to 1 is a transition rather
// than the initial value).
const FADE_IN_MS = 320
// How long the grid takes to fade to nothing once every tile has finished
// flipping. Without this the last frame is a fully-opaque grid removed in
// a single commit -- fine with today's translucent placeholder tint, but
// once real (opaque) artwork replaces it that pop reintroduces the exact
// hard cut this component exists to soften.
//
// Bumped past the others' ~20% (260 -> 400) because it now also has to
// house the border UNSEAL: worst-case that is
// maxDelayMs * BORDER_UNSEAL_DELAY_SCALE + BORDER_SEAL_MS
// = 450 * 0.4 + 220 = 400ms exactly. Shortening this below that value
// clips the tail of the unseal sweep (the grid is already gone before the
// bottom-left seams have finished vanishing) -- keep the two in step.
const FADE_OUT_MS = 400
// The last tile to flip (delayMs === maxDelayMs) only finishes its own
// CSS transition TILE_FLIP_MS after `revealing` actually commits+paints,
// not at the nominal schedule instant -- this slack absorbs that so the
// fade-out doesn't start while the slowest tile is still mid-turn.
const TRAILING_SLACK_MS = 120
// A quicker, non-staggered return when the transition is re-triggered
// mid-flight (e.g. beadSceneVisible flips again before a cycle finished)
// -- snapping every tile back to flat uniformly reads better than
// continuing to honor the forward sweep's per-tile delays in reverse.
const RETRIGGER_COVER_MS = 310
// How long ONE tile's seam lines take to fade from transparent to
// var(--border) ("sealing") -- per tile, not for the whole grid; the grid
// as a whole takes maxDelayMs + this, because each tile's seal is delayed
// by its own tile.delayMs (see the face style below).
//
// MUST stay below both LEAD_IN_* values. Each tile seals at
// (delayMs + BORDER_SEAL_MS) and starts flipping at (leadIn + delayMs) --
// the same delayMs on both sides, so the invariant "a tile's seams are
// fully drawn before that tile turns" reduces to exactly this one
// comparison, independent of grid size or where the tile sits in the
// sweep. Raise this above LEAD_IN_REVERSE_MS and tiles begin turning with
// half-drawn seams.
const BORDER_SEAL_MS = 220
// The unseal (fadingOut) reuses each tile's own delayMs so the seams
// vanish along the same top-right -> bottom-left diagonal they arrived
// on, but COMPRESSED by this factor: the seal-in gets to spread across
// the whole lead-in and flip window, whereas the unseal has to fit inside
// FADE_OUT_MS alongside the container's own opacity fade. 0.4 makes the
// worst case land exactly on FADE_OUT_MS -- see that constant.
const BORDER_UNSEAL_DELAY_SCALE = 0.4
// Matches cube-flip-toggle's own overshoot easing, per explicit request to
// make this read as the same mechanical "bounce" as that button. An
// earlier version of this file used a symmetric ease-in-out instead,
// reasoning that backfaceVisibility hides each face at 90deg before the
// curve's springy settle plays out -- true, but that settle happens
// entirely past the invisibility threshold (the curve overshoots the
// target then eases back DOWN to it, never re-crossing below), so nothing
// ever renders during it -- same geometry as cube-flip-toggle's own
// rotateX(-90deg) flip, which has the identical cutoff and reads fine.
const FLIP_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
// Fallback half-width (px) used only for the first render before a real
// viewport measurement lands -- TileTransition always returns null before
// that happens (see `phase === 'idle'`), so this value is never actually
// painted; it just needs to exist as a starting default for useState.
const FALLBACK_HALF_WIDTH_PX = 90
// Same reasoning as FALLBACK_HALF_WIDTH_PX -- never actually painted,
// just a starting default before the first real measurement.
const FALLBACK_ROWS = 4
// Physical light cue via box-shadow, NOT a background gradient (a gradient
// background was tried on the front face and explicitly reverted per
// request) -- a bright inset line along the top edge and a soft inset
// shadow along the bottom, like a raised panel catching light from above.
// Applied to front and back faces so lighting reads on whichever one is
// currently facing the viewer.
const FACE_LIGHT_SHADOW = 'inset 0 1px 0 oklch(1 0 0 / 14%), inset 0 -10px 14px -10px oklch(0 0 0 / 35%)'
// Same radial-gradient/24px cell as dot-matrix-background.tsx's dot-grid
// layer, so the resting front face reads as the app's own background
// rather than an approximation of it. Only the base grid is replicated
// here -- that component's cursor-reveal mask, sheen and glass-photo
// layers are all driven by live --mx/--my pointer tracking and have no
// meaning on a face that exists for ~200ms and is about to rotate away.
//
// Opacity bumped to 0.32 from that source layer's own 0.18 -- copied
// verbatim at 0.18 first, then reported invisible in light mode. Root
// cause is contrast, not a bug: --foreground is near-black in light mode
// (oklch(0.2 0 0)) over a near-white bg-muted/55, and dots at 18% opacity
// blend to a barely-there light grey there, versus near-white dots over
// dark-grey bg-muted/55 in dark mode, which stays legible at the same
// opacity -- the same alpha value does NOT read as equally visible in
// both directions on this particular pairing. Raised uniformly (not
// per-theme) since dark mode wasn't the reported problem and a single
// value keeps this simple; if 0.32 reads as too strong in dark mode,
// that's the number to walk back down.
//
// Its own layer (a child of the face) rather than a backgroundImage on the
// face itself: the dot alpha comes from a layer `opacity`, and putting
// that directly on the face would also fade its bg-muted tint, its
// border and FACE_LIGHT_SHADOW. Module-level constant, not an inline
// object literal -- this component re-renders ~16x/sec mid-transition
// (see the memo comment below), and a stable reference is one fewer
// allocation per tile per render.
const DOT_GRID_BASE_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle at center, var(--foreground) 0 1px, transparent 1px)',
  backgroundSize: '24px 24px',
  opacity: 0.32,
}
// Dots tile every 24px from their own box's origin, but a cell is
// innerWidth/COLUMNS px wide -- almost never a multiple of 24 -- so an
// un-offset pattern restarts its phase at every tile boundary and the
// resting grid reads as mismatched patches with visible seams. Negative
// background-position equal to the tile's own viewport offset re-anchors
// every tile to a single viewport-origin lattice -- the exact lattice
// DotMatrixBackground uses (it's `absolute inset-0` on the root container
// at 0,0, and this overlay is `fixed inset-0`), so the two line up
// dot-for-dot where they meet.
function dotGridPosition(row: number, col: number, cellPx: number): string {
  return `${-col * cellPx}px ${-row * cellPx}px`
}

interface Tile {
  id: string
  delayMs: number
  // Grid coordinates, carried through purely so the front face's dot-grid
  // background can be offset into a single continuous lattice (see
  // dotGridPosition). Not used by the stagger -- that's the normalized
  // x/y computed below, which are mirrored on the column axis.
  row: number
  col: number
}

function buildTiles(rows: number): Tile[] {
  const items: { id: string; x: number; y: number; row: number; col: number }[] = []
  const rowSpan = Math.max(rows - 1, 1)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      // computeSweepDelays sorts purely by (x + y) -- a top-left-first
      // diagonal. Mirroring the column axis here turns that same
      // comparator into a top-right-first diagonal instead (per explicit
      // request for a top-right -> bottom-left sweep), with zero changes
      // to the shared util or its other (perf-sensitive) callers in
      // GlobeView/cobe-globe. Coordinates are normalized 0..1 (not raw
      // cell indices) so the wavefront stays proportionally diagonal
      // regardless of the grid's column/row counts. This is independent
      // of each tile's own rotation direction (still right-to-left
      // per-tile, via rotateY below) -- stagger order and individual
      // rotation axis are separate controls, not the same thing.
      items.push({
        id: `${row}-${col}`,
        x: (COLUMNS - 1 - col) / (COLUMNS - 1),
        y: row / rowSpan,
        row,
        col,
      })
    }
  }
  const delays = computeSweepDelays(items)
  return items.map(({ id, row, col }) => ({ id, row, col, delayMs: delays.get(id) ?? 0 }))
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
  /** Fired exactly once per cover->reveal cycle, at the instant `phase`
   * returns to 'idle' -- i.e. the last tile has finished its flip AND the
   * grid's fade-out has completed AND this component has stopped rendering
   * anything at all. That is the only instant at which the frame budget is
   * genuinely free again; `phase === 'revealing'` is emphatically NOT it
   * (that transition is what STARTS the flip, ~1.2s before it ends).
   *
   * Fires on BOTH directions and on the mid-flight retrigger path, because
   * all three schedule the same `t3` -- the consumer is expected to key its
   * own reaction off the same `active` expression it already owns, rather
   * than this callback trying to describe which cycle just ended.
   *
   * Guaranteed to fire at most once per cycle and never on an unrelated
   * re-render: `t3` is only ever created inside the `[active]` layout effect
   * below, which early-returns unless `active` actually changed, and whose
   * cleanup clears it if the cycle is superseded before it lands.
   *
   * Pass a STABLE reference (useCallback with an empty dep list). This
   * component is memo()'d specifically because App re-renders ~11x/sec
   * during a batch drain -- a fresh arrow function here would defeat that
   * memo on every one of those renders. */
  onSettled?: () => void
}

type Phase = 'idle' | 'covering' | 'revealing' | 'fadingOut'

// memo: App re-renders ~16x/sec while BeadScene's onProgress callback is
// firing mid-transition (see App.tsx), and this component's own props
// (`active`, `circle`) don't change nearly that often -- without memo,
// every one of those renders re-allocates and diffs this file's full
// tile tree (up to ~30 tiles x 5 faces x several inline style props each)
// for no output change. `circle` is already deduped upstream in
// GlobeView (stable reference unless the globe's on-screen box actually
// moves), so this comparison is cheap and almost always short-circuits.
// The `onSettled` prop added alongside `active`/`circle` does not weaken
// this: App passes a useCallback-with-no-deps handler, so it is reference-
// stable for the app's lifetime and the shallow comparison still
// short-circuits on every one of those renders.
export const TileTransition = memo(function TileTransition({
  active,
  circle,
  onSettled,
}: TileTransitionProps) {
  // Row count is derived from the viewport, not fixed -- see the layout
  // effect below, which sets this alongside halfWidthPx so both stay in
  // sync (rows changing without a matching halfWidthPx update, or vice
  // versa, would make cells non-square).
  const [rows, setRows] = useState(FALLBACK_ROWS)
  const tiles = useMemo(() => buildTiles(rows), [rows])
  // Render-time copy of the sweep's longest delay, used only to size the
  // grid container's own border-color fade so its outer L ramps in over
  // the same window the per-tile seams seal across (a single element can't
  // be staggered). Deliberately NOT the same value the layout effect
  // computes -- that one must be a fresh local for the reasons spelled out
  // at length in the effect below (staleness + an infinite-loop dependency
  // cycle); this one is derived from the committed `tiles` and is only
  // ever read during render, where `tiles` is by definition current.
  const maxDelayMs = useMemo(() => tiles.reduce((m, t) => Math.max(m, t.delayMs), 0), [tiles])

  const [phase, setPhase] = useState<Phase>('idle')
  const [retriggered, setRetriggered] = useState(false)
  // Drives the fade-IN, symmetric to `phase === 'fadingOut'` driving the
  // fade-out. Starts a fresh cycle true (grid mounts at opacity 0) then
  // flips false a couple of frames later so the opacity change from 0->1
  // is a real CSS transition, not the element's initial value (a mount
  // has no "previous style" to transition FROM). Left false during a
  // mid-flight retrigger -- the grid is already visible then, so there's
  // nothing to fade in.
  const [entering, setEntering] = useState(false)
  // Half of a real tile's rendered width, in px -- translateZ needs an
  // absolute length, and a mismatch here means the two cube faces don't
  // actually meet at a shared edge (a visible slit/overlap at every
  // tile's leading corner). Measured fresh at the start of each cycle
  // rather than tracked via ResizeObserver, since the overlay only exists
  // for ~1.1s and a mid-transition resize isn't worth handling. Cell width
  // == cell height (tiles are square), so this same value also derives
  // `rows` below -- there's only one "tile size" now, not independent
  // width/height knobs.
  const [halfWidthPx, setHalfWidthPx] = useState(FALLBACK_HALF_WIDTH_PX)
  const prevActiveRef = useRef(active)
  // Latest `phase`, read (not depended on) inside the layout effect below
  // to detect a mid-flight retrigger -- a plain dependency would rerun
  // that effect on every phase change the effect itself causes.
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  // Same discipline as phaseRef directly above: assigned during render and
  // READ (never depended on) inside the layout effect. The effect's
  // dependency array is deliberately `[active]` and nothing else -- see the
  // long maxDelayMs comment inside it for why widening that array has
  // already caused one infinite-loop / stuck-overlay bug -- so the callback
  // cannot be listed there, and capturing it in the closure directly would
  // pin whatever reference existed when `active` last changed.
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

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
    const cellPx = window.innerWidth / COLUMNS
    const nextRows = Math.max(1, Math.ceil(window.innerHeight / cellPx))
    setHalfWidthPx(cellPx / 2)
    setRows(nextRows)
    setPhase('covering')
    // Double rAF, not a single one or a setTimeout(0): a single rAF's
    // callback can still fire before the browser has actually painted the
    // `entering: true` (opacity 0) commit above, in which case the flip
    // to false lands in the SAME paint and there is no "0" frame to
    // transition from -- back to an instant pop. Two rAFs guarantee at
    // least one full paint happens in between (the standard "wait for the
    // next frame after this one" idiom).
    if (wasMidFlight) {
      setEntering(false)
    } else {
      setEntering(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setEntering(false))
      })
    }
    // maxDelayMs computed as a LOCAL here (via buildTiles(nextRows), not
    // read from the `tiles`/state derived elsewhere) and deliberately kept
    // OUT of this effect's dependency array. Two reasons, found together
    // during a 2026-08-06 performance audit:
    // 1. `rows` (and therefore `tiles`/maxDelayMs) is state set by THIS
    //    effect a few lines up -- reading a memoized `tiles` value derived
    //    from it would only reflect the PREVIOUS cycle's row count until
    //    next render, one cycle stale.
    // 2. Depending on that derived value at all was an infinite-loop bug
    //    on wide/short viewports: setRows above triggers a re-render with
    //    a new `tiles`/maxDelayMs, which if listed as a dependency
    //    re-fires this whole effect -- whose body then hits the
    //    `prevActiveRef.current === active` early return and never
    //    reschedules t1/t2/t3, permanently stuck in `covering` (a
    //    full-screen overlay swallowing every pointer event). Any
    //    viewport/window shape that changes `rows` between the previous
    //    and current transition triggers it -- e.g. an ultrawide monitor,
    //    or a window resized short-and-wide. Computing it locally and
    //    depending on nothing but `active` makes this structurally
    //    impossible: the effect can only ever re-run when `active` itself
    //    changes.
    const maxDelayMs = Math.max(...buildTiles(nextRows).map((t) => t.delayMs))
    const leadIn = wasMidFlight ? RETRIGGER_COVER_MS : forward ? LEAD_IN_FORWARD_MS : LEAD_IN_REVERSE_MS
    const t1 = window.setTimeout(() => setPhase('revealing'), leadIn)
    const t2 = window.setTimeout(
      () => setPhase('fadingOut'),
      leadIn + maxDelayMs + TILE_FLIP_MS + TRAILING_SLACK_MS,
    )
    const t3 = window.setTimeout(() => {
      setPhase('idle')
      // Same tick as the phase flip, deliberately: 'idle' is what makes
      // this component return null, so firing here means "the overlay is
      // gone as of this commit", not "the overlay will be gone shortly".
      // Nothing downstream may assume a painted frame has happened yet.
      onSettledRef.current?.()
    }, leadIn + maxDelayMs + TILE_FLIP_MS + TRAILING_SLACK_MS + FADE_OUT_MS)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [active])

  if (phase === 'idle') return null

  const reduced = reducedMotionQuery?.matches ?? false

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

  // Single source of truth for "the seam lines are drawn". Shares
  // `entering` with the opacity fade-in on purpose: `entering` is exactly
  // the "mounted, painted one frame, hasn't started yet" state, which is
  // the only state a CSS transition can actually animate OUT of (a mount
  // has no previous style to transition from -- see FADE_IN_MS). Keying
  // the borders to the same flag means the seal is guaranteed to be a real
  // transition rather than an initial value, for free, with no second
  // double-rAF dance. On a mid-flight retrigger `entering` stays false and
  // the seams are simply already sealed, which is correct -- the grid is
  // visibly on screen at that point and re-drawing its seams would read as
  // a glitch, not a sweep.
  const sealed = !entering && phase !== 'fadingOut'

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
      className="fixed inset-0 z-40 grid border-l border-t"
      style={{
        // Explicit px cells, not 1fr -- 1fr stretches each cell to fill the
        // container's exact width/COLUMNS x height/ROWS box, which only
        // happens to be square if the viewport's own aspect ratio matches
        // COLUMNS/ROWS. Since `rows` is now derived FROM halfWidthPx*2 to
        // guarantee square cells (see the layout effect), the grid must
        // actually be sized in those same px terms, not left to stretch.
        // The grid's own total height (rows * cellPx) can slightly exceed
        // the viewport height by design (ROWS is a ceil()) -- harmless,
        // since this is a `fixed inset-0` viewport-covering overlay and
        // anything past the bottom edge is naturally clipped by the
        // viewport itself.
        gridTemplateColumns: `repeat(${COLUMNS}, ${halfWidthPx * 2}px)`,
        gridTemplateRows: `repeat(${rows}, ${halfWidthPx * 2}px)`,
        // `entering` and `phase === 'fadingOut'` are mutually exclusive by
        // construction (entering is always set false well before
        // fadingOut is ever reached), so this can't fight itself.
        opacity: entering || phase === 'fadingOut' ? 0 : 1,
        // The overlay's outer L (border-l/border-t, closing the two edges
        // the per-tile border-r/border-b leave open). It's one element
        // spanning the whole left and top edges, so it can't be staggered
        // the way the internal seams are -- instead it ramps across the
        // entire sweep's duration, so it neither snaps on nor finishes
        // before the seams it's supposed to be continuous with.
        // `border-border` was dropped from the className above: the class
        // sets border-color, and the value has to be driven from here now.
        borderColor: sealed ? 'var(--border)' : 'transparent',
        // Was Tailwind's `transition-opacity ease-out`. Inlined because
        // opacity and border-color need DIFFERENT durations on the same
        // element (a per-property duration list, which the utility class
        // can't express).
        transitionProperty: 'opacity, border-color',
        transitionDuration: `${phase === 'fadingOut' ? FADE_OUT_MS : FADE_IN_MS}ms, ${
          phase === 'fadingOut' ? FADE_OUT_MS : maxDelayMs + BORDER_SEAL_MS
        }ms`,
        transitionTimingFunction: 'ease-out',
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
        // The seam animation, keyed to the SAME tile.delayMs that drives
        // this tile's flip below. That shared key is the whole point: the
        // seams used to be static `border-border`, so the entire wireframe
        // appeared in one frame the moment the container faded in, while
        // the tiles themselves opened on a staggered top-right ->
        // bottom-left diagonal -- two motions that visibly did not belong
        // to each other. Reusing delayMs makes the seam close on the same
        // wavefront as the tile it belongs to.
        //
        // border-color (transparent -> var(--border)), NOT an opacity
        // fade: opacity on a face would take its bg-muted tint, its dot
        // grid and FACE_LIGHT_SHADOW down with it, and an opacity on a
        // dedicated border-only overlay element would mean a fifth div per
        // tile purely to carry 1px of colour. border-color is directly
        // animatable, costs nothing extra, and touches only the lines.
        //
        // Its own transitionProperty on the FACE, separate from the
        // rotating wrapper's `transform` transition one level up: the two
        // need different delays (the seal fires during `covering`, the
        // flip during `revealing`) and different durations, and they live
        // on different elements, so there is nothing to reconcile.
        //
        // Not gated on `reduced` (unlike the flip's transform above): this
        // is a colour cross-fade, not motion, and snapping the whole
        // wireframe on in one frame is precisely the artifact being fixed.
        //
        // Applied identically to both faces. The front face carries the
        // seal (it's what faces the viewer through `covering`); the back
        // face is hidden then, is already sealed by the time it rotates
        // into view, and is the face actually on screen during
        // `fadingOut` -- so it's the one that carries the unseal. One
        // shared object covers both without either needing to know which.
        const faceBorderStyle: CSSProperties = {
          borderColor: sealed ? 'var(--border)' : 'transparent',
          transitionProperty: 'border-color',
          transitionDuration: `${BORDER_SEAL_MS}ms`,
          transitionTimingFunction: 'ease-out',
          transitionDelay: `${
            phase === 'fadingOut' ? tile.delayMs * BORDER_UNSEAL_DELAY_SCALE : tile.delayMs
          }ms`,
        }
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
                  boundary.
                  This is the face that represents the scene being
                  transitioned AWAY FROM (it faces the viewer at
                  rotateY(0deg), i.e. throughout `covering`, in BOTH
                  directions), so it carries the app's own dot-matrix
                  texture -- see DOT_GRID_BASE_STYLE. The bg-muted/55 tint
                  stays underneath it as the face's opaque body; the dot
                  layer is a child rather than a second background on this
                  div so its 0.18 opacity applies to the dots alone and
                  not to the tint/border/FACE_LIGHT_SHADOW. Still no
                  gradient overlay -- one was tried on this face and
                  explicitly reverted per request. */}
              <div
                className="absolute inset-0 border-r border-b bg-muted/55"
                style={{
                  ...faceBorderStyle,
                  backfaceVisibility: 'hidden',
                  transform: `translateZ(${halfWidthPx}px)`,
                  boxShadow: FACE_LIGHT_SHADOW,
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    ...DOT_GRID_BASE_STYLE,
                    backgroundPosition: dotGridPosition(tile.row, tile.col, halfWidthPx * 2),
                  }}
                />
              </div>
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
                className="absolute inset-0 border-r border-b bg-muted/40"
                style={{
                  ...faceBorderStyle,
                  backfaceVisibility: 'hidden',
                  transform: `rotateY(-90deg) translateZ(${halfWidthPx}px)`,
                  boxShadow: FACE_LIGHT_SHADOW,
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
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
})
