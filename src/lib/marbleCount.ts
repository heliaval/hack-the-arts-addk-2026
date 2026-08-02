// Real annual birth/death totals span many orders of magnitude — a
// micro-state has a few hundred births a year, a large country tens of
// millions. Mapping raw counts 1:1 to marbles would make the small end
// invisible (0-1 marbles) and the large end absurd (millions of marbles).
// Log-scale mapping, same shape as src/lib/beadSpawnRate.ts's rate-to-
// interval curve: each 10x in real total is an equal step in marble count.
//
// [10, 80] per stream, up from [5, 25]. BeadScene.tsx's live-bead ceiling
// is now viewport-derived (capacityFor(), ~110 beads at a 1280x800
// viewport, hard-capped at 160) rather than a flat 40, and the invariant
// that made the old numbers work is unchanged and still deliberate: the
// combined per-stream max must sit ABOVE the ceiling, or eviction -- and
// the leaf-departure effect it drives -- silently never fires. 80 + 80 =
// 160 clears a ~110 ceiling by a comfortable margin, while a micro-state's
// 10 + 10 = 20 still never reaches it, which is fine: there is nothing to
// evict yet. MIN went 5 -> 10 so even the smallest country reads as a
// pile rather than a handful, per the "dramatically more beads" ask.
const MIN_TOTAL = 1
const MAX_TOTAL = 5e7
const MIN_MARBLES = 10
const MAX_MARBLES = 80

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
