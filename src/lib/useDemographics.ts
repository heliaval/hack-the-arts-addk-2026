import { useEffect, useState } from 'react'
import { loadDemographics, type CountryDemographics } from '@/lib/worldbank'
import { readCache, readSnapshot, writeCache } from '@/lib/demographicsCache'

export interface DemographicsState {
  data: Map<string, CountryDemographics>
  /** True until a live fetch has succeeded at least once this page load --
   * the data shown is a cached or bundled snapshot, not necessarily current. */
  stale: boolean
}

// Renders immediately from whatever's on hand (a previous successful fetch
// cached on this machine, or the snapshot bundled at build time) instead of
// blocking the whole app behind a loading screen. The World Bank API is a
// public third-party service with no SLA -- on some machines/networks it's
// unreachable entirely (blocked by a browser extension or security proxy,
// not just occasionally slow, see PROGRESS.md), so waiting on it before
// rendering anything makes the app hostage to a network path it doesn't
// control. A live fetch still runs in the background and silently upgrades
// the data if/when it succeeds; if it fails, the fallback data just stays.
export function useDemographics(): DemographicsState {
  const [state, setState] = useState<DemographicsState>(() => {
    const cached = readCache()
    return { data: cached ?? readSnapshot(), stale: true }
  })

  useEffect(() => {
    let cancelled = false
    loadDemographics().then(
      (data) => {
        if (cancelled) return
        writeCache(data)
        setState({ data, stale: false })
      },
      (error: Error) => {
        if (!cancelled) console.warn('Live population data fetch failed, keeping fallback data:', error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
