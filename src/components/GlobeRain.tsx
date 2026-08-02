import { useEffect, useRef } from 'react'
import type { GlobeCircle } from '@/components/ui/cobe-globe'
import { resolveAccentColor } from '@/lib/resolveAccentColor'

// Drops respawn this far above/below the viewport rather than exactly at
// its edge, so a drop doesn't visibly pop into existence right at the top
// edge of the screen — it's already off-screen when it (re)starts falling.
const RESPAWN_MARGIN_PX = 60

const MIN_SPEED_PX_S = 220
const MAX_SPEED_PX_S = 420
const MIN_WIDTH_PX = 1.5
const MAX_WIDTH_PX = 3
const MIN_LENGTH_PX = 18
const MAX_LENGTH_PX = 34

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
  phase: 'fall' | 'wrap' | 'release'
  /** Angle in [0, π] around the globe's center, 0 = top (north pole of the
   * visible silhouette), π = bottom. Only meaningful while phase === 'wrap'. */
  wrapAngle: number
  /** Which side of the globe's vertical centerline this drop entered on.
   * Only meaningful while phase === 'wrap'. */
  wrapSide: -1 | 1
}

function randomDrop(x: number, y: number): Drop {
  return {
    x,
    y,
    speed: randomBetween(MIN_SPEED_PX_S, MAX_SPEED_PX_S),
    width: randomBetween(MIN_WIDTH_PX, MAX_WIDTH_PX),
    length: randomBetween(MIN_LENGTH_PX, MAX_LENGTH_PX),
    phase: 'fall',
    wrapAngle: 0,
    wrapSide: 1,
  }
}

/** A fresh drop above the viewport, ready to fall in. Used both for the
 * initial pool (see seedDrop) and to recycle a drop that has fallen past
 * the bottom of the viewport. */
export function spawnDropAbove(viewportWidth: number): Drop {
  const x = Math.random() * viewportWidth
  const y = -RESPAWN_MARGIN_PX - Math.random() * RESPAWN_MARGIN_PX
  return randomDrop(x, y)
}

// Snaps a drop that has just crossed into the globe's circle into the
// 'wrap' phase, deriving wrapAngle/wrapSide from the (x, y) it crossed at.
// y = centerY - radius*cos(angle)  =>  cos(angle) = (centerY - y) / radius
function enterWrap(drop: Drop, x: number, y: number, globe: GlobeCircleLike): void {
  const side: -1 | 1 = x >= globe.centerX ? 1 : -1
  const cosAngle = Math.min(1, Math.max(-1, (globe.centerY - y) / globe.radius))
  drop.phase = 'wrap'
  drop.wrapAngle = Math.acos(cosAngle)
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
  const x = Math.random() * viewportWidth
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
      if (drop.wrapAngle >= Math.PI) {
        drop.wrapAngle = Math.PI
        drop.x = globe.centerX
        drop.y = globe.centerY + globe.radius
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
    Object.assign(drop, spawnDropAbove(viewportWidth))
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

const DROP_COUNT = 30
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

function drawDrop(ctx: CanvasRenderingContext2D, drop: Drop, globe: GlobeCircleLike | null, colors: RainColors): void {
  const head = dropPosition(drop, globe)
  const dir = dropDirection(drop, globe)
  const tail = { x: head.x - dir.x * drop.length, y: head.y - dir.y * drop.length }

  ctx.lineCap = 'round'
  ctx.strokeStyle = colors.body
  ctx.lineWidth = drop.width
  ctx.beginPath()
  ctx.moveTo(tail.x, tail.y)
  ctx.lineTo(head.x, head.y)
  ctx.stroke()

  // Highlight core: the leading third of the streak, thinner and brighter.
  const coreStart = { x: head.x - dir.x * drop.length * 0.3, y: head.y - dir.y * drop.length * 0.3 }
  ctx.strokeStyle = colors.highlight
  ctx.lineWidth = Math.max(1, drop.width * 0.5)
  ctx.beginPath()
  ctx.moveTo(coreStart.x, coreStart.y)
  ctx.lineTo(head.x, head.y)
  ctx.stroke()
}

export interface GlobeRainProps {
  globeCircle: GlobeCircle | null
  theme: 'light' | 'dark'
}

// Plain 2D canvas, not a second react-three-fiber <Canvas>: this effect is
// procedural curve math over ~30 drops, not physics, so a second WebGL
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
