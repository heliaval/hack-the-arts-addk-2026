// Shared "sweep" ordering used by both the marker/arc reveal (GlobeView)
// and the language-toggle label re-flip (cobe-globe's Globe component):
// sort items top-left-to-bottom-right by current screen position, then
// spread their start delays evenly across a capped total window so the
// sweep always finishes quickly regardless of how many items are involved.
const MAX_SWEEP_MS = 450
const PER_ITEM_MS = 35

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
