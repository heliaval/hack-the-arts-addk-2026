// Real birth/death rates (CountryDemographics.birthsPerSecond /
// .deathsPerSecond) span roughly five orders of magnitude: a micro-state
// sits near 1e-5 births/second, India near 0.75. Spawning a bead per real
// event would leave most countries showing nothing at all and the largest
// showing less than one bead per second — legible for neither. So we do
// the same thing src/lib/globeSpeed.ts does for rotation: keep the real
// figure as the input, and map it onto a scale you can actually read.
//
// The map is logarithmic (each 10x in real rate is an equal step in
// interval) and clamped at both ends, so the smallest and largest real
// countries land at a steady trickle and a busy-but-countable stream
// respectively, and nothing ever produces an invisible or overwhelming
// spawn rate.
const MIN_RATE_PER_SECOND = 1e-5
const MAX_RATE_PER_SECOND = 1
const SLOWEST_SPAWN_INTERVAL_MS = 1400
const FASTEST_SPAWN_INTERVAL_MS = 120

const LOG_MIN = Math.log10(MIN_RATE_PER_SECOND)
const LOG_RANGE = Math.log10(MAX_RATE_PER_SECOND) - LOG_MIN

/** Milliseconds to wait between bead spawns for a given real per-second
 * rate. Non-finite or non-positive rates (missing data) fall back to the
 * slowest interval rather than spawning nothing, so a country with a
 * partial record still reads as alive. */
export function spawnIntervalMs(ratePerSecond: number): number {
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) return SLOWEST_SPAWN_INTERVAL_MS
  const clamped = Math.min(MAX_RATE_PER_SECOND, Math.max(MIN_RATE_PER_SECOND, ratePerSecond))
  const t = (Math.log10(clamped) - LOG_MIN) / LOG_RANGE
  return Math.round(
    SLOWEST_SPAWN_INTERVAL_MS + t * (FASTEST_SPAWN_INTERVAL_MS - SLOWEST_SPAWN_INTERVAL_MS),
  )
}
