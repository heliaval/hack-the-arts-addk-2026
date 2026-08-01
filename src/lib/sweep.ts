// Shared "sweep" ordering used by both the marker/arc reveal (GlobeView)
// and the language-toggle label re-flip (cobe-globe's Globe component):
// sort items top-left-to-bottom-right by current screen position, then
// spread their start delays evenly across a capped total window so the
// sweep always finishes quickly regardless of how many items are involved.
//
// Widened from an earlier 450ms/35ms-per-item version: even with layout
// FLIP animation disabled (see TextRotate's enableLayoutAnimation), a
// 20-city language toggle still packs ~24 label re-flips into that window
// — a new one starting almost every rendered frame — so at any instant a
// large number of per-character spring animations are concurrently mid-
// flight, which is real animation work regardless of layout cost. Spacing
// items out more (longer window for large batches) reduces how many are
// ever animating at once, at the cost of the full sweep taking a bit
// longer to finish — worth it since a slightly longer but smooth sweep
// reads better than a fast but janky one.
const MAX_SWEEP_MS = 900
const PER_ITEM_MS = 45

export interface SweepItem<T> {
  id: T
  x: number
  y: number
}

export function computeSweepDelays<T>(items: SweepItem<T>[]): Map<T, number> {
  const sorted = [...items].sort((a, b) => a.x + a.y - (b.x + b.y))
  const n = sorted.length
  const totalWindow = Math.min(MAX_SWEEP_MS, n * PER_ITEM_MS)
  const delays = new Map<T, number>()
  sorted.forEach((item, i) => {
    delays.set(item.id, n > 1 ? (i / (n - 1)) * totalWindow : 0)
  })
  return delays
}
