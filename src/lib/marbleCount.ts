// Real annual birth/death totals span many orders of magnitude — a
// micro-state has a few hundred births a year, a large country tens of
// millions. Mapping raw counts 1:1 to marbles would make the small end
// invisible (0-1 marbles) and the large end absurd (millions of marbles).
// Log-scale mapping, same shape as src/lib/beadSpawnRate.ts's rate-to-
// interval curve: each 10x in real total is an equal step in marble count.
//
// [5, 25] per stream (not a literal reading of births+deaths capped at 70
// from the original design spec) — see the Global Constraints note in
// docs/superpowers/plans/2026-08-01-year-select-marble-batches.md: this
// repo's live bead-capacity backstop is MAX_CAPACITY = 55
// (src/components/BeadScene.tsx), set by a later perf pass, so keeping the
// combined max at 50 stays under it with margin.
const MIN_TOTAL = 1
const MAX_TOTAL = 5e7
const MIN_MARBLES = 5
const MAX_MARBLES = 25

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
