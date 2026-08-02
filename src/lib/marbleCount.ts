// Real annual birth/death totals span many orders of magnitude — a
// micro-state has a few hundred births a year, a large country tens of
// millions. Mapping raw counts 1:1 to marbles would make the small end
// invisible (0-1 marbles) and the large end absurd (millions of marbles).
// Log-scale mapping, same shape as src/lib/beadSpawnRate.ts's rate-to-
// interval curve: each 10x in real total is an equal step in marble count.
//
// [5, 25] per stream (not a literal reading of births+deaths capped at 70
// from the original design spec). This file's own comment used to claim a
// MAX_CAPACITY = 55 backstop already existed in BeadScene.tsx -- it never
// did, and 55 sits above this combined max of 50 anyway, which would have
// meant eviction (and the leaf-departure effect it drives) silently never
// fired for any single country/year. BeadScene.tsx's actual MAX_CAPACITY
// is 40, deliberately below this file's max, so eviction reliably fires
// for populous countries.
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
