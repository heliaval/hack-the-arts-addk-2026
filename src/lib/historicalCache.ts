import type { YearTotals } from '@/lib/historicalDemographics'
import fallbackData from '@/data/historical-fallback.json'

// Bumped whenever YearTotals's shape changes, so an old cached entry from a
// previous shape can't be read back and crash the app.
const CACHE_VERSION = 1
const cacheKey = (iso3: string) => `redthread:historical:v1:${iso3}`

interface CacheEnvelope {
  version: number
  savedAt: number
  data: Record<string, YearTotals>
}

function isCacheEnvelope(value: unknown): value is CacheEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CacheEnvelope>
  return (
    candidate.version === CACHE_VERSION &&
    typeof candidate.savedAt === 'number' &&
    typeof candidate.data === 'object' &&
    candidate.data !== null &&
    Object.keys(candidate.data).length > 0
  )
}

function toYearMap(data: Record<string, YearTotals>): Map<number, YearTotals> {
  return new Map(Object.entries(data).map(([year, totals]) => [Number(year), totals]))
}

/** Last successful live fetch of this country's series on this machine, if
 * any -- `null` on a first visit, a corrupted entry, or a shape mismatch
 * from an older version. */
export function readHistoricalCache(iso3: string): Map<number, YearTotals> | null {
  try {
    const raw = localStorage.getItem(cacheKey(iso3))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isCacheEnvelope(parsed)) return null
    return toYearMap(parsed.data)
  } catch {
    return null
  }
}

/** Best-effort write -- a full localStorage quota or a disabled storage API
 * must never break the app, so failures are swallowed. */
export function writeHistoricalCache(iso3: string, years: Map<number, YearTotals>): void {
  try {
    const envelope: CacheEnvelope = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      data: Object.fromEntries(years),
    }
    localStorage.setItem(cacheKey(iso3), JSON.stringify(envelope))
  } catch {
    // Ignore -- e.g. quota exceeded, storage disabled, private browsing.
  }
}

/** Static snapshot bundled at build time (src/data/historical-fallback.json,
 * generated via `npm run snapshot:historical`), covering only the ~18
 * countries actually clickable on the globe (see GlobeView.tsx's CITIES) --
 * `null` for any other iso3, since there's no fallback for it. */
export function readHistoricalSnapshot(iso3: string): Map<number, YearTotals> | null {
  const entry = (fallbackData as Record<string, Record<string, YearTotals>>)[iso3]
  if (!entry) return null
  return toYearMap(entry)
}
