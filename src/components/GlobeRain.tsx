import { useEffect, useRef } from 'react'
import type { GlobeCircle } from '@/components/ui/cobe-globe'
import { resolveAccentColor } from '@/lib/resolveAccentColor'

// Drops respawn this far above/below the viewport rather than exactly at
// its edge, so a drop doesn't visibly pop into existence right at the top
// edge of the screen — it's already off-screen when it (re)starts falling.
const RESPAWN_MARGIN_PX = 60

// A drop fades to fully transparent over this many pixels as it approaches
// the bottom of the viewport, reaching alpha 0 exactly at the visible
// bottom edge (see dropFadeAlpha) — a dissolve instead of a hard cutoff at
// the edge, or (previously) no visible cue at all before it's silently
// recycled RESPAWN_MARGIN_PX further down, off-screen.
const FADE_ZONE_PX = 90

// Three depth tiers instead of independently randomized speed/width/length
// per drop: correlating them (near = faster/wider/longer/more opaque) is
// what actually reads as depth/parallax rather than a flat wall of
// identical lines, and fixing width/length PER TIER (not randomized within
// it) is what makes the batched-by-tier rendering in GlobeRain's tick()
// possible — one canvas path per tier per style, instead of one
// beginPath/stroke pair per drop (260 -> 6 draw calls at DROP_COUNT=130).
interface DepthTier {
  speedRangePxS: [number, number]
  widthPx: number
  lengthPx: number
  bodyAlpha: number
  highlightAlpha: number
}

const DEPTH_TIERS: readonly DepthTier[] = [
  { speedRangePxS: [340, 420], widthPx: 3, lengthPx: 34, bodyAlpha: 0.55, highlightAlpha: 0.85 },
  { speedRangePxS: [280, 350], widthPx: 2.2, lengthPx: 26, bodyAlpha: 0.42, highlightAlpha: 0.7 },
  { speedRangePxS: [220, 280], widthPx: 1.5, lengthPx: 18, bodyAlpha: 0.3, highlightAlpha: 0.55 },
]

// Slight per-drop color variation instead of every drop in a tier sharing
// one exact shade — three discrete steps (not a continuous random mix), so
// drops can still be grouped and batched per (depth tier, color variant)
// pair rather than needing one draw call per drop. -1 = darker/deeper,
// 0 = base, 1 = lighter. See resolveRainColors for how these map to actual
// colors.
const COLOR_VARIANT_OFFSETS: readonly number[] = [-1, 0, 1]
const COLOR_VARIANT_JITTER = 0.16

// Fraction of spawns pulled toward the globe's own horizontal band rather
// than scattered uniformly across the full viewport width — otherwise, on a
// wide viewport, only a small minority of drops ever cross the globe at all
// and the "rain on the globe" read gets lost in ambient side-fall.
const GLOBE_BAND_SPAWN_FRACTION = 0.82
// How far past the globe's own radius that band extends, so drops still
// visibly approach the silhouette from just outside it rather than only
// ever spawning directly above it. Tightened from 1.4 alongside the raised
// spawn fraction above — a narrower band concentrates the extra density
// directly over the globe instead of just widening the diffuse spread.
const GLOBE_BAND_RADIUS_MULTIPLIER = 1.15
// Of the spawns pulled into the globe band, the fraction that use the
// angle-weighted pick below rather than a flat pick across the band width.
// A flat pick in X under-represents the globe's edges: dx = radius*sin(a),
// so a fixed slice of X near the center covers a much smaller entry-angle
// range than the same width near the edge does (d(angle)/dx = 1/sqrt(r²-dx²)
// is smallest at dx=0 and grows without bound as dx→r) — that's what made
// rain visibly concentrate through dead center. Splitting the biased spawns
// between the two keeps some flat coverage (including the near-miss margin
// past the silhouette) while still meaningfully lifting the edges.
const GLOBE_BAND_ANGLE_WEIGHTED_FRACTION = 0.5

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export interface GlobeCircleLike {
  centerX: number
  centerY: number
  radius: number
}

export interface Drop {
  x: number
  y: number
  speed: number
  width: number
  length: number
  /** Index into DEPTH_TIERS — fixes this drop's width/length/color for its
   * whole lifetime (a respawn via spawnDropAbove picks a fresh one). */
  depth: number
  /** Index into COLOR_VARIANT_OFFSETS — fixes this drop's exact shade for
   * its whole lifetime, same respawn-refreshes-it rule as depth. */
  colorVariant: number
  phase: 'fall' | 'wrap' | 'release'
  /** Angle in [0, π] around the globe's center, 0 = top (north pole of the
   * visible silhouette), π = bottom. Only meaningful while phase === 'wrap'. */
  wrapAngle: number
  /** The wrapAngle at which this drop peels back off the silhouette into a
   * straight fall — derived per drop from a uniformly sampled exit position
   * (see enterWrap) so drops release at varied,
   * evenly spread points along the bottom curve instead of all converging on
   * the exact same pixel. Only meaningful while phase === 'wrap'. */
  wrapExitAngle: number
  /** Which side of the globe's vertical centerline this drop entered on.
   * Only meaningful while phase === 'wrap'. */
  wrapSide: -1 | 1
}

function randomDrop(x: number, y: number): Drop {
  const depth = Math.floor(Math.random() * DEPTH_TIERS.length)
  const tier = DEPTH_TIERS[depth]
  const colorVariant = Math.floor(Math.random() * COLOR_VARIANT_OFFSETS.length)
  return {
    x,
    y,
    speed: randomBetween(tier.speedRangePxS[0], tier.speedRangePxS[1]),
    width: tier.widthPx,
    length: tier.lengthPx,
    depth,
    colorVariant,
    phase: 'fall',
    wrapAngle: 0,
    wrapExitAngle: Math.PI,
    wrapSide: 1,
  }
}

/** Picks a spawn x biased toward the globe's own horizontal band (see
 * GLOBE_BAND_SPAWN_FRACTION) so a majority of drops visibly cross its
 * silhouette rather than scattering evenly across the full viewport. Falls
 * back to a full-width uniform pick once no globe has been measured yet. */
function randomSpawnX(viewportWidth: number, globe: GlobeCircleLike | null): number {
  if (!globe || Math.random() >= GLOBE_BAND_SPAWN_FRACTION) return Math.random() * viewportWidth

  if (Math.random() < GLOBE_BAND_ANGLE_WEIGHTED_FRACTION) {
    // Sample the entry ANGLE uniformly (0 = dead center top, π/2 = the
    // silhouette's outer edge) rather than x directly, then convert back —
    // see GLOBE_BAND_ANGLE_WEIGHTED_FRACTION for why this is what actually
    // lifts the edges instead of just widening the flat spread.
    const angle = Math.random() * (Math.PI / 2)
    const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1
    const x = globe.centerX + globe.radius * Math.sin(angle) * side
    return Math.min(viewportWidth, Math.max(0, x))
  }

  const bandHalfWidth = globe.radius * GLOBE_BAND_RADIUS_MULTIPLIER
  const min = Math.max(0, globe.centerX - bandHalfWidth)
  const max = Math.min(viewportWidth, globe.centerX + bandHalfWidth)
  return randomBetween(min, max)
}

/** A fresh drop above the viewport, ready to fall in. Used both for the
 * initial pool (see seedDrop) and to recycle a drop that has fallen past
 * the bottom of the viewport. */
export function spawnDropAbove(viewportWidth: number, globe: GlobeCircleLike | null = null): Drop {
  const x = randomSpawnX(viewportWidth, globe)
  const y = -RESPAWN_MARGIN_PX - Math.random() * RESPAWN_MARGIN_PX
  return randomDrop(x, y)
}

// Snaps a drop that has just crossed into the globe's circle into the
// 'wrap' phase, deriving wrapAngle/wrapSide from the (x, y) it crossed at.
// The release angle is derived from a uniformly sampled X FRACTION over the
// full [0, 1] range (i.e. every point across the globe's radius is equally
// likely), not a uniformly sampled angle — solving x/radius = sin(angle) on
// the angle ∈ [π/2, π] branch gives angle = π - asin(x/radius), which lands
// in [π/2, π] for any fraction in [0, 1]. Clamped to be at least the entry
// angle so the drop always makes forward progress even if it entered
// unusually late. Confirmed exactly uniform (flat to within ~5% across 20
// equal-width buckets) by a 20000-sample simulation of this formula.
// y = centerY - radius*cos(angle)  =>  cos(angle) = (centerY - y) / radius
function enterWrap(drop: Drop, x: number, y: number, globe: GlobeCircleLike): void {
  const side: -1 | 1 = x >= globe.centerX ? 1 : -1
  const cosAngle = Math.min(1, Math.max(-1, (globe.centerY - y) / globe.radius))
  const entryAngle = Math.acos(cosAngle)
  const exitXFraction = Math.random()
  const candidateExitAngle = Math.PI - Math.asin(exitXFraction)
  drop.phase = 'wrap'
  drop.wrapAngle = entryAngle
  drop.wrapExitAngle = Math.max(entryAngle, candidateExitAngle)
  drop.wrapSide = side
}

function isInsideGlobe(x: number, y: number, globe: GlobeCircleLike): boolean {
  const dx = x - globe.centerX
  const dy = y - globe.centerY
  return dx * dx + dy * dy < globe.radius * globe.radius
}

/** Places a drop at a random position across the FULL viewport height
 * (not just above it), used only to seed the initial pool so the effect
 * looks already in progress on mount instead of starting from zero. If
 * that random position happens to already be inside the globe's
 * silhouette, the drop starts directly in the 'wrap' phase. */
export function seedDrop(viewportWidth: number, viewportHeight: number, globe: GlobeCircleLike | null): Drop {
  const x = randomSpawnX(viewportWidth, globe)
  const y = randomBetween(-RESPAWN_MARGIN_PX, viewportHeight + RESPAWN_MARGIN_PX)
  const drop = randomDrop(x, y)
  if (globe && isInsideGlobe(x, y, globe)) enterWrap(drop, x, y, globe)
  return drop
}

/** Advances a drop by dt seconds, mutating it in place. Recycles it back
 * above the viewport (spawnDropAbove) once it has fallen past the bottom. */
export function updateDrop(
  drop: Drop,
  dt: number,
  globe: GlobeCircleLike | null,
  viewportWidth: number,
  viewportHeight: number,
): void {
  switch (drop.phase) {
    case 'fall': {
      const nextY = drop.y + drop.speed * dt
      if (globe && isInsideGlobe(drop.x, nextY, globe)) {
        enterWrap(drop, drop.x, nextY, globe)
      } else {
        drop.y = nextY
      }
      break
    }
    case 'wrap': {
      if (!globe) {
        // Globe measurement disappeared (e.g. resize mid-frame) — fall
        // straight from the current position rather than getting stuck.
        drop.phase = 'release'
        break
      }
      drop.wrapAngle += (drop.speed * dt) / globe.radius
      if (drop.wrapAngle >= drop.wrapExitAngle) {
        drop.wrapAngle = drop.wrapExitAngle
        const exitPosition = dropPosition(drop, globe)
        drop.x = exitPosition.x
        drop.y = exitPosition.y
        drop.phase = 'release'
      }
      break
    }
    case 'release': {
      drop.y += drop.speed * dt
      break
    }
  }

  const { y } = dropPosition(drop, globe)
  if (y - drop.length > viewportHeight + RESPAWN_MARGIN_PX) {
    Object.assign(drop, spawnDropAbove(viewportWidth, globe))
  }
}

/** Current on-screen position of a drop, deriving it from wrapAngle while
 * phase === 'wrap' rather than trusting stale x/y fields. */
export function dropPosition(drop: Drop, globe: GlobeCircleLike | null): { x: number; y: number } {
  if (drop.phase === 'wrap' && globe) {
    return {
      x: globe.centerX + globe.radius * Math.sin(drop.wrapAngle) * drop.wrapSide,
      y: globe.centerY - globe.radius * Math.cos(drop.wrapAngle),
    }
  }
  return { x: drop.x, y: drop.y }
}

/** Current unit direction of travel, used to orient the drawn streak. */
export function dropDirection(drop: Drop, globe: GlobeCircleLike | null): { x: number; y: number } {
  if (drop.phase === 'wrap' && globe) {
    // d/dangle of (centerX + r*sin(a)*side, centerY - r*cos(a)) is
    // (r*cos(a)*side, r*sin(a)) — the radius factor cancels out on
    // normalization, so it's omitted here.
    const dx = Math.cos(drop.wrapAngle) * drop.wrapSide
    const dy = Math.sin(drop.wrapAngle)
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }
  return { x: 0, y: 1 }
}

/** 1 while a drop is well above the bottom of the viewport, ramping down
 * to 0 exactly at viewportHeight — see FADE_ZONE_PX. Drops below that (in
 * the RESPAWN_MARGIN_PX gap before actually being recycled, see
 * updateDrop) are already fully transparent, so no visible pop either way. */
export function dropFadeAlpha(drop: Drop, globe: GlobeCircleLike | null, viewportHeight: number): number {
  const { y } = dropPosition(drop, globe)
  const fadeStart = viewportHeight - FADE_ZONE_PX
  if (y <= fadeStart) return 1
  return Math.max(0, 1 - (y - fadeStart) / FADE_ZONE_PX)
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface TierColors {
  /** Translucent body/tail color, drawn as a wider, lower-alpha stroke. */
  body: string
  /** Brighter core along the streak's leading edge, standing in for a
   * droplet's specular highlight — pushed toward white so it doesn't just
   * read as a second copy of the body color. */
  highlight: string
}

interface RainColors {
  /** [tier][colorVariant + 1] — index-aligned with DEPTH_TIERS and
   * COLOR_VARIANT_OFFSETS (offset -1/0/1 -> index 0/1/2). */
  variants: TierColors[][]
  /** Base color for the entry-ripple rings (see Ripple, below) — full
   * alpha here, ripple fade is applied separately via ctx.globalAlpha so
   * one color resolve covers every ripple regardless of its age. */
  ripple: string
}

// How far the deepened base color is mixed toward pure black to build the
// -1 ("darker") color variant, and toward white for the +1 ("lighter")
// one — kept separate from COLOR_VARIANT_JITTER's role in resolveRainColors
// only in name; same constant, used symmetrically in both directions.
function resolveRainColors(): RainColors {
  const accent = resolveAccentColor()
  // --accent alone read as washed out for a raindrop's own body color,
  // especially in dark mode where it's a light pink-red (#c17b8a) rather
  // than a deep red — mixing toward a dark blood-red anchor first gives a
  // richer base in both themes without introducing a hue outside the
  // palette (still derived from --accent, just pulled darker/more
  // saturated).
  const deepBase = mixHex(accent, '#4a0e14', 0.4)
  const highlightHex = mixHex(deepBase, '#ffffff', 0.65)

  const variantColor = (baseHex: string, offset: number): string =>
    offset === 0 ? baseHex : mixHex(baseHex, offset < 0 ? '#000000' : '#ffffff', COLOR_VARIANT_JITTER)

  return {
    variants: DEPTH_TIERS.map((tier) =>
      COLOR_VARIANT_OFFSETS.map((offset) => ({
        body: hexToRgba(variantColor(deepBase, offset), tier.bodyAlpha),
        highlight: hexToRgba(variantColor(highlightHex, offset), tier.highlightAlpha),
      })),
    ),
    ripple: hexToRgba(highlightHex, 0.6),
  }
}

const DROP_COUNT = 130
// Capped like BeadScene's Canvas dpr (see BeadScene.tsx's <Canvas dpr={[1, 1.5]}>)
// for the same reason: crisp lines without paying for a full 2-3x device
// pixel ratio's worth of fragments on every frame.
const MAX_DEVICE_PIXEL_RATIO = 1.5

function resizeCanvasToViewport(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
  const width = window.innerWidth
  const height = window.innerHeight
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  // Every subsequent draw call can then be written in CSS pixels, matching
  // how the rest of this file's coordinate math (viewportWidth/Height,
  // globeCircle) is already expressed.
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

// A drop mid-wrap is moving along the globe's circular silhouette, but the
// original drawDrop always drew a straight tangent segment behind it — so
// the trail visibly stuck off the sphere instead of hugging the curve it's
// supposedly gliding along, the one moment the enterWrap/dropPosition curve
// math exists to sell. Sampling several points along the actual arc (via
// the same sin/cos parametrization dropPosition already uses for wrap
// phase) and connecting them with short line segments fixes this without
// needing canvas arc()'s angle-direction bookkeeping: since wrapAngle only
// ever increases going forward, "behind in time" is always simply "a
// smaller wrapAngle," for either wrapSide.
const WRAP_TRAIL_SEGMENTS = 5

function wrapPointAt(globe: GlobeCircleLike, angle: number, side: -1 | 1): { x: number; y: number } {
  return {
    x: globe.centerX + globe.radius * Math.sin(angle) * side,
    y: globe.centerY - globe.radius * Math.cos(angle),
  }
}

// Appends the wrap-phase trail's curved subpath (moveTo + lineTo...) to
// the currently-open path without stroking it — callers batch many drops
// into one path per depth tier and issue a single stroke() for all of them
// at once, instead of one beginPath/stroke pair per drop.
function appendWrapTrail(ctx: CanvasRenderingContext2D, drop: Drop, globe: GlobeCircleLike): void {
  const fullSpan = drop.length / globe.radius
  const headAngle = drop.wrapAngle
  const tailAngle = Math.max(0, headAngle - fullSpan)
  for (let i = 0; i <= WRAP_TRAIL_SEGMENTS; i++) {
    const a = tailAngle + (headAngle - tailAngle) * (i / WRAP_TRAIL_SEGMENTS)
    const p = wrapPointAt(globe, a, drop.wrapSide)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
}

// A single stroked line reads as an abstract streak, not a droplet. This
// builds an actual teardrop outline instead — a rounded head (the bulge
// where surface tension pools the water) tapering to a point at the tail
// (where it's been stretched thin by drag) — appended to the currently-open
// path as one filled subpath, same batching approach as the trail above:
// many drops' teardrops go into one path, one fill() call covers all of
// them. `head` is the drop's leading point, `dir` its unit direction of
// travel, `length`/`headRadius` its tail length and head bulb radius.
function appendTeardrop(
  ctx: CanvasRenderingContext2D,
  head: { x: number; y: number },
  dir: { x: number; y: number },
  length: number,
  headRadius: number,
): void {
  const dirAngle = Math.atan2(dir.y, dir.x)
  // The two points where the tail's tangent lines meet the head's circle,
  // 90 degrees off the direction of travel on either side. The arc between
  // them (swept the "long way," through dirAngle, i.e. the far side from
  // the tail) is the rounded head; the tail point connects to both via
  // straight tangent lines, giving the classic teardrop silhouette.
  const leftAngle = dirAngle + Math.PI / 2
  const rightAngle = dirAngle - Math.PI / 2
  const leftHead = {
    x: head.x + Math.cos(leftAngle) * headRadius,
    y: head.y + Math.sin(leftAngle) * headRadius,
  }
  const tail = { x: head.x - dir.x * length, y: head.y - dir.y * length }

  ctx.moveTo(tail.x, tail.y)
  ctx.lineTo(leftHead.x, leftHead.y)
  ctx.arc(head.x, head.y, headRadius, leftAngle, rightAngle, true)
  ctx.lineTo(tail.x, tail.y)
}

// Draws one drop's body + (if mid-wrap) trail + highlight with its own
// beginPath/fill/stroke calls under a shared ctx.globalAlpha, for the
// small number of drops currently inside FADE_ZONE_PX — everything else
// still goes through the batched-per-(tier, colorVariant) path above/below,
// since ctx.globalAlpha applies to a whole fill()/stroke() call and can't
// vary per subpath within one shared batched path.
function drawSingleFadingDrop(
  ctx: CanvasRenderingContext2D,
  drop: Drop,
  globe: GlobeCircleLike | null,
  colors: TierColors,
  headRadius: number,
  highlightRadius: number,
  fadeAlpha: number,
): void {
  if (fadeAlpha <= 0) return
  ctx.globalAlpha = fadeAlpha

  const head = dropPosition(drop, globe)
  ctx.fillStyle = colors.body
  ctx.beginPath()
  if (drop.phase === 'wrap') {
    ctx.moveTo(head.x + headRadius, head.y)
    ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2)
  } else {
    appendTeardrop(ctx, head, dropDirection(drop, globe), drop.length, headRadius)
  }
  ctx.fill()

  if (drop.phase === 'wrap' && globe) {
    ctx.strokeStyle = colors.body
    ctx.lineWidth = DEPTH_TIERS[drop.depth].widthPx
    ctx.beginPath()
    appendWrapTrail(ctx, drop, globe)
    ctx.stroke()
  }

  const dir = dropDirection(drop, globe)
  const dirAngle = Math.atan2(dir.y, dir.x)
  const highlightAngle = dirAngle - Math.PI * 0.65
  const hx = head.x + Math.cos(highlightAngle) * headRadius * 0.4
  const hy = head.y + Math.sin(highlightAngle) * headRadius * 0.4
  ctx.fillStyle = colors.highlight
  ctx.beginPath()
  ctx.moveTo(hx + highlightRadius, hy)
  ctx.arc(hx, hy, highlightRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 1
}

// A drop's on-screen entry point into the globe's silhouette, marked by a
// small expanding ring that fades out — a hairline, water-instrument-style
// punctuation for the one moment in a drop's life that previously happened
// silently (see enterWrap). Fixed-cap pool, oldest evicted on overflow —
// no unbounded growth, no per-frame allocation beyond the occasional push.
export interface Ripple {
  x: number
  y: number
  startMs: number
}

const RIPPLE_MAX_COUNT = 24
const RIPPLE_DURATION_MS = 350
const RIPPLE_MAX_RADIUS_PX = 14

function spawnRipple(pool: Ripple[], x: number, y: number, nowMs: number): void {
  if (pool.length >= RIPPLE_MAX_COUNT) pool.shift()
  pool.push({ x, y, startMs: nowMs })
}

// Iterates backward so expired ripples can be spliced out mid-loop without
// skipping the element that shifts into the current index.
function drawRipples(ctx: CanvasRenderingContext2D, pool: Ripple[], nowMs: number, color: string): void {
  if (pool.length === 0) return
  ctx.lineWidth = 1
  ctx.strokeStyle = color
  for (let i = pool.length - 1; i >= 0; i--) {
    const ripple = pool[i]
    const elapsed = nowMs - ripple.startMs
    if (elapsed >= RIPPLE_DURATION_MS) {
      pool.splice(i, 1)
      continue
    }
    const t = elapsed / RIPPLE_DURATION_MS
    ctx.globalAlpha = 1 - t
    ctx.beginPath()
    ctx.arc(ripple.x, ripple.y, RIPPLE_MAX_RADIUS_PX * t, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

export interface GlobeRainProps {
  globeCircle: GlobeCircle | null
  theme: 'light' | 'dark'
}

// Plain 2D canvas, not a second react-three-fiber <Canvas>: this effect is
// procedural curve math over ~130 drops, not physics, so a second WebGL
// context (and its own render overhead, mirroring what BeadScene already
// pays for the beads) would buy nothing. GlobeRain and BeadScene are
// mount-exclusive (see App.tsx), so they never compete for a GPU context
// anyway.
export function GlobeRain({ globeCircle, theme }: GlobeRainProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dropsRef = useRef<Drop[]>([])
  const ripplesRef = useRef<Ripple[]>([])
  const globeRef = useRef<GlobeCircleLike | null>(globeCircle)
  globeRef.current = globeCircle

  // Re-resolved on theme flip via a rAF, same reasoning as BeadScene's
  // resolveBeadColors effect: the `.dark` class toggle happens in a
  // sibling effect, and child effects run before parent effects, so
  // reading computed style synchronously here could observe the OLD
  // theme's value. One rAF is enough to guarantee the class is applied.
  const colorsRef = useRef<RainColors>(resolveRainColors())
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      colorsRef.current = resolveRainColors()
    })
    return () => cancelAnimationFrame(id)
  }, [theme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    resizeCanvasToViewport(canvas)
    const initialViewportWidth = window.innerWidth
    const initialViewportHeight = window.innerHeight
    dropsRef.current = Array.from({ length: DROP_COUNT }, () =>
      seedDrop(initialViewportWidth, initialViewportHeight, globeRef.current),
    )

    function handleResize() {
      if (canvas) resizeCanvasToViewport(canvas)
    }
    window.addEventListener('resize', handleResize)

    let rafId: number
    let lastTime = performance.now()
    function tick(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 1 / 30)
      lastTime = now
      const ctx = canvas?.getContext('2d')
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const globe = globeRef.current
        // Hoisted out of the per-drop loop below — window.innerWidth/
        // innerHeight are layout reads, and reading them once per DROP
        // (previously 130x/frame) rather than once per FRAME was pure
        // waste, not a correctness requirement (the viewport doesn't
        // change mid-frame).
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        const drops = dropsRef.current
        for (const drop of drops) {
          const wasFalling = drop.phase === 'fall'
          updateDrop(drop, dt, globe, viewportWidth, viewportHeight)
          if (wasFalling && drop.phase === 'wrap' && globe) {
            const entryPoint = dropPosition(drop, globe)
            spawnRipple(ripplesRef.current, entryPoint.x, entryPoint.y, now)
          }
        }

        // Batched by (depth tier, color variant): a handful of paths (and
        // one fill/stroke each) per bucket, instead of one beginPath/stroke
        // pair per drop — see DEPTH_TIERS' and COLOR_VARIANT_OFFSETS' own
        // comments for why width/length/shade are all fixed per bucket
        // rather than randomized, which is what makes this possible. Drops
        // currently inside FADE_ZONE_PX are excluded here and drawn
        // individually afterward instead, since ctx.globalAlpha can't vary
        // per subpath within one shared batched fill()/stroke() call.
        ctx.lineCap = 'round'
        const colors = colorsRef.current
        const fadingDrops: { drop: Drop; alpha: number }[] = []
        for (let tier = 0; tier < DEPTH_TIERS.length; tier++) {
          const tierSpec = DEPTH_TIERS[tier]
          // The head bulb is where surface tension pools the water — sized
          // off the tier's stroke width so nearer (wider) tiers get
          // visibly bigger drops, not just longer/faster ones.
          const headRadius = tierSpec.widthPx * 0.9
          const highlightRadius = headRadius * 0.35

          for (let variant = 0; variant < COLOR_VARIANT_OFFSETS.length; variant++) {
            const bucketColors = colors.variants[tier][variant]
            const inBucket = (drop: Drop) => drop.depth === tier && drop.colorVariant === variant

            // Body: a filled teardrop while falling/releasing straight, or
            // a round head bulb (the trailing curve is the separate
            // wrap-trail stroke below) while gliding along the globe's
            // silhouette. Both shapes use this bucket's body color, so
            // they share one fill().
            ctx.fillStyle = bucketColors.body
            ctx.beginPath()
            for (const drop of drops) {
              if (!inBucket(drop)) continue
              const alpha = dropFadeAlpha(drop, globe, viewportHeight)
              if (alpha < 1) {
                fadingDrops.push({ drop, alpha })
                continue
              }
              const head = dropPosition(drop, globe)
              if (drop.phase === 'wrap') {
                ctx.moveTo(head.x + headRadius, head.y)
                ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2)
              } else {
                appendTeardrop(ctx, head, dropDirection(drop, globe), drop.length, headRadius)
              }
            }
            ctx.fill()

            // The curved trail behind a wrap-phase drop's head bulb — see
            // appendWrapTrail for why this can't just be another teardrop.
            ctx.strokeStyle = bucketColors.body
            ctx.lineWidth = tierSpec.widthPx
            ctx.beginPath()
            for (const drop of drops) {
              if (!inBucket(drop) || drop.phase !== 'wrap' || !globe) continue
              if (dropFadeAlpha(drop, globe, viewportHeight) < 1) continue
              appendWrapTrail(ctx, drop, globe)
            }
            ctx.stroke()

            // Specular highlight: a small bright dot offset toward the
            // head's leading curve, mimicking where a real droplet catches
            // light.
            ctx.fillStyle = bucketColors.highlight
            ctx.beginPath()
            for (const drop of drops) {
              if (!inBucket(drop)) continue
              if (dropFadeAlpha(drop, globe, viewportHeight) < 1) continue
              const head = dropPosition(drop, globe)
              const dir = dropDirection(drop, globe)
              const dirAngle = Math.atan2(dir.y, dir.x)
              const highlightAngle = dirAngle - Math.PI * 0.65
              const hx = head.x + Math.cos(highlightAngle) * headRadius * 0.4
              const hy = head.y + Math.sin(highlightAngle) * headRadius * 0.4
              ctx.moveTo(hx + highlightRadius, hy)
              ctx.arc(hx, hy, highlightRadius, 0, Math.PI * 2)
            }
            ctx.fill()
          }
        }

        // The disappearing effect: the handful of drops currently inside
        // FADE_ZONE_PX, drawn individually under their own globalAlpha.
        for (const { drop, alpha } of fadingDrops) {
          const tierSpec = DEPTH_TIERS[drop.depth]
          drawSingleFadingDrop(
            ctx,
            drop,
            globe,
            colors.variants[drop.depth][drop.colorVariant],
            tierSpec.widthPx * 0.9,
            tierSpec.widthPx * 0.9 * 0.35,
            alpha,
          )
        }

        drawRipples(ctx, ripplesRef.current, now, colors.ripple)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
