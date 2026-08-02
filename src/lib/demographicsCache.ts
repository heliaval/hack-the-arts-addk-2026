import type { CountryDemographics } from '@/lib/worldbank'
import fallbackData from '@/data/demographics-fallback.json'

// Bumped whenever CountryDemographics's shape changes, so an old cached
// entry from a previous shape can't be read back and crash the app.
const CACHE_VERSION = 1
const CACHE_KEY = 'redthread:demographics:v1'

interface CacheEnvelope {
  version: number
  savedAt: number
  data: Record<string, CountryDemographics>
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

/** Last successful live fetch on this machine, if any -- `null` on a first
 * visit, a corrupted entry, or a shape mismatch from an older version. */
export function readCache(): Map<string, CountryDemographics> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isCacheEnvelope(parsed)) return null
    return new Map(Object.entries(parsed.data))
  } catch {
    return null
  }
}

/** Best-effort write -- a full localStorage quota or a disabled storage API
 * must never break the app, so failures are swallowed. */
export function writeCache(data: Map<string, CountryDemographics>): void {
  try {
    const envelope: CacheEnvelope = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      data: Object.fromEntries(data),
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(envelope))
  } catch {
    // Ignore -- e.g. quota exceeded, storage disabled, private browsing.
  }
}

/** Static snapshot bundled at build time (src/data/demographics-fallback.json,
 * generated via `npm run snapshot`) -- the last resort when there's no live
 * network path AND no prior successful load on this machine to cache-read. */
export function readSnapshot(): Map<string, CountryDemographics> {
  return new Map(Object.entries(fallbackData as Record<string, CountryDemographics>))
}
