// The globe's spin is animated as `phi` radians advanced per rendered frame
// (see cobe-globe.tsx's `animate()` loop, assumed ~60fps). To give the speed
// control a "cool" physical unit instead of an opaque animation constant, we
// treat it as the equatorial surface velocity implied by that spin rate:
// v = ω * r, using Earth's real equatorial radius. Not a literal simulation
// of Earth's rotation (the visual spin is already far faster than real life)
// — just a grounded instrument-style reading for the km/s figure.
const EARTH_EQUATORIAL_RADIUS_KM = 6371
const ASSUMED_FPS = 60

export const DEFAULT_ROTATION_SPEED_KM_S = Math.round(
  0.003 * ASSUMED_FPS * EARTH_EQUATORIAL_RADIUS_KM,
)
// 6x the default — dramatically faster spin, still readable as a dot rather
// than a blur at typical frame rates.
export const MAX_ROTATION_SPEED_KM_S = DEFAULT_ROTATION_SPEED_KM_S * 6

export function kmPerSecToPhiSpeed(kmPerSec: number): number {
  return kmPerSec / ASSUMED_FPS / EARTH_EQUATORIAL_RADIUS_KM
}
