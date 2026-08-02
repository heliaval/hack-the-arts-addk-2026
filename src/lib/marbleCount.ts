// Real annual birth/death totals span many orders of magnitude — a
// micro-state has a few hundred births a year, a large country tens of
// millions. Mapping raw counts 1:1 to marbles would make the small end
// invisible (0-1 marbles) and the large end absurd (millions of marbles).
// Log-scale mapping, same shape as src/lib/beadSpawnRate.ts's rate-to-
// interval curve: each 10x in real total is an equal step in marble count.
//
// [30, 150] per stream, up from [10, 80]. BeadScene.tsx's live-bead
// ceiling is viewport-derived (capacityFor(), ~110 beads at a 1280x800
// viewport, hard-capped at MAX_CAPACITY_CEILING = 110), and the invariant
// that made the old numbers work is unchanged and still deliberate: the
// combined per-stream max must sit ABOVE the ceiling, or eviction -- and
// the leaf-departure effect it drives -- silently never fires. 150 + 150
// = 300 clears a ~110 ceiling by a wide margin, and MIN went 10 -> 30 so
// even a micro-state's 30 + 30 = 60 sits close enough to the 60-110
// viewport-clamped range that mid-size countries now cross the ceiling
// too, not just large ones -- "hits the limit a lot more often", per the
// ask, rather than only on the biggest countries.
const MIN_TOTAL = 1
const MAX_TOTAL = 5e7
const MIN_MARBLES = 30
const MAX_MARBLES = 150

const LOG_MIN = Math.log10(MIN_TOTAL)
const LOG_RANGE = Math.log10(MAX_TOTAL) - LOG_MIN

/** Maps a real annual birth or death total to a marble count in
 * [MIN_MARBLES, MAX_MARBLES]. Totals at or below the log floor (including
 * non-finite/non-positive values) still return MIN_MARBLES — a country
 * with a genuinely tiny total still reads as "something happened" rather
 * than showing nothing. */
export function marbleCountFor(realAnnualTotal: number): number {
  if (!Number.isFinite(realAnnualTotal) || realAnnualTotal <= MIN_TOTAL) return MIN_MARBLES
  const clamped = Math.min(MAX_TOTAL, realAnnualTotal)
  const t = (Math.log10(clamped) - LOG_MIN) / LOG_RANGE
  return Math.round(MIN_MARBLES + t * (MAX_MARBLES - MIN_MARBLES))
}
