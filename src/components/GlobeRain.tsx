import { useEffect, useRef } from 'react'
import type { GlobeCircle } from '@/components/ui/cobe-globe'
import { resolveAccentColor } from '@/lib/resolveAccentColor'

// Drops respawn this far above/below the viewport rather than exactly at
// its edge, so a drop doesn't visibly pop into existence right at the top
// edge of the screen — it's already off-screen when it (re)starts falling.
const RESPAWN_MARGIN_PX = 60

const MIN_SPEED_PX_S = 220
const MAX_SPEED_PX_S = 420
const MIN_FONT_SIZE_PX = 14
const MAX_FONT_SIZE_PX = 26

// Rendered as monospace glyphs rather than plain line strokes — plain
// translucent lines read as generic "particle system" fill; a handful of
// rain-shaped characters (weighted toward the two full-height bar glyphs, so
// it still reads primarily as streaks rather than scattered punctuation)
// gives the effect a deliberately drawn, ASCII-rain character instead.
const GLYPHS = ['¦', '|', '¦', '|', "'", '`', ':', '.']

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

// How far a wrapping drop's release point can land, expressed as a fraction
// of the globe's radius along its horizontal spread (not as an angle).
// Sampling angle directly (uniform in [angle, π]) produced an X position
// biased toward the far edges: x = radius*sin(angle), and sin() is flattest
// near its peak (angle ≈ π/2) and steepest near π, so a uniform angle spread
// piled up release points near the equator's width and thinned out toward
// center. Sampling this X FRACTION uniformly instead, then solving back for
// the angle (see enterWrap), makes the actual on-screen release positions
// themselves uniform along the globe's width — confirmed by a 5000-sample
// simulation of this exact formula.
const MAX_WRAP_EXIT_X_FRACTION = 0.92

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
  fontSize: number
  glyph: string
  phase: 'fall' | 'wrap' | 'release'
  /** Angle in [0, π] around the globe's center, 0 = top (north pole of the
   * visible silhouette), π = bottom. Only meaningful while phase === 'wrap'. */
  wrapAngle: number
  /** The wrapAngle at which this drop peels back off the silhouette into a
   * straight fall — randomized per drop (see MIN/MAX_WRAP_SPAN_RAD) so drops
   * release at varied points along the bottom curve instead of all
   * converging on the exact same pixel. Only meaningful while
   * phase === 'wrap'. */
  wrapExitAngle: number
  /** Which side of the globe's vertical centerline this drop entered on.
   * Only meaningful while phase === 'wrap'. */
  wrapSide: -1 | 1
}

function randomDrop(x: number, y: number): Drop {
  return {
    x,
    y,
    speed: randomBetween(MIN_SPEED_PX_S, MAX_SPEED_PX_S),
    fontSize: randomBetween(MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX),
    glyph: randomGlyph(),
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
// The release angle is derived from a uniformly sampled X FRACTION (see
// MAX_WRAP_EXIT_X_FRACTION), not a uniformly sampled angle — solving
// x/radius = sin(angle) on the angle ∈ [π/2, π] branch gives
// angle = π - asin(x/radius), which lands in [π/2, π) for any fraction in
// (0, 1]. Clamped to be at least the entry angle so the drop always makes
// forward progress even if it entered unusually late.
// y = centerY - radius*cos(angle)  =>  cos(angle) = (centerY - y) / radius
function enterWrap(drop: Drop, x: number, y: number, globe: GlobeCircleLike): void {
  const side: -1 | 1 = x >= globe.centerX ? 1 : -1
  const cosAngle = Math.min(1, Math.max(-1, (globe.centerY - y) / globe.radius))
  const entryAngle = Math.acos(cosAngle)
  const exitXFraction = Math.random() * MAX_WRAP_EXIT_X_FRACTION
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
  if (y - drop.fontSize > viewportHeight + RESPAWN_MARGIN_PX) {
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

interface RainColors {
  /** Translucent body/tail color, drawn as a wider, lower-alpha stroke. */
  body: string
  /** Brighter core along the streak's leading edge, standing in for a
   * droplet's specular highlight — pushed toward white so it doesn't just
   * read as a second copy of the body color. */
  highlight: string
}

function resolveRainColors(): RainColors {
  const accent = resolveAccentColor()
  return {
    body: hexToRgba(accent, 0.32),
    highlight: hexToRgba(mixHex(accent, '#ffffff', 0.65), 0.75),
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

// Rotates the canvas so a glyph's own vertical axis (its natural, unrotated
// orientation) points along `dir`. At dir = (0, 1) — straight down, the
// 'fall'/'release' case — this is 0 (no rotation, glyph stays upright);
// atan2(dir.x, dir.y) is exactly the angle between (0, 1) and dir, which is
// what lets the same formula also orient a glyph along the wrap phase's
// tangent as it curves around the globe.
function glyphRotation(dir: { x: number; y: number }): number {
  return Math.atan2(dir.x, dir.y)
}

function drawDrop(ctx: CanvasRenderingContext2D, drop: Drop, globe: GlobeCircleLike | null, colors: RainColors): void {
  const pos = dropPosition(drop, globe)
  const dir = dropDirection(drop, globe)

  ctx.save()
  ctx.translate(pos.x, pos.y)
  ctx.rotate(glyphRotation(dir))
  ctx.font = `${drop.fontSize}px "Geist Mono Variable", ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Soft glow pass: a blurred, translucent halo behind the glyph — canvas
  // shadowBlur is the cheapest way to get a glow on filled text, and reads
  // as "wet" rather than "printed" the way a flat single fill would.
  ctx.shadowColor = colors.body
  ctx.shadowBlur = drop.fontSize * 0.6
  ctx.fillStyle = colors.body
  ctx.fillText(drop.glyph, 0, 0)

  // Crisp bright core on top, no blur — the specular highlight a real
  // droplet would show.
  ctx.shadowBlur = 0
  ctx.fillStyle = colors.highlight
  ctx.fillText(drop.glyph, 0, 0)

  ctx.restore()
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
    dropsRef.current = Array.from({ length: DROP_COUNT }, () =>
      seedDrop(window.innerWidth, window.innerHeight, globeRef.current),
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
        for (const drop of dropsRef.current) {
          updateDrop(drop, dt, globe, window.innerWidth, window.innerHeight)
          drawDrop(ctx, drop, globe, colorsRef.current)
        }
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
