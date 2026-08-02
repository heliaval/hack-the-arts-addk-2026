import { useEffect, useRef } from 'react'

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
