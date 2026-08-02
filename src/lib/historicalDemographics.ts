import { useEffect, useState } from 'react'

const WB_BASE = 'https://api.worldbank.org/v2'
const YEAR_RANGE = '2000:2022'

const INDICATORS = {
  birthRatePer1000: 'SP.DYN.CBRT.IN',
  deathRatePer1000: 'SP.DYN.CDRT.IN',
  population: 'SP.POP.TOTL',
} as const

export interface YearTotals {
  births: number
  deaths: number
}

// Same retry rationale as src/lib/worldbank.ts's fetchJson: the World Bank
// API has no SLA and occasionally blips, but a persistent failure should
// still surface as a real error rather than being masked forever.
const FETCH_RETRIES = 2
const RETRY_DELAY_MS = 500

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`World Bank API request failed: ${url}`)
      return (await res.json()) as T
    } catch (err) {
      if (attempt >= FETCH_RETRIES) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

interface WbIndicatorEntry {
  date: string
  value: number | null
}

async function fetchYearSeries(iso3: string, code: string): Promise<Map<number, number>> {
  const [, entries] = await fetchJson<[unknown, WbIndicatorEntry[] | null]>(
    `${WB_BASE}/country/${iso3}/indicator/${code}?format=json&per_page=100&date=${YEAR_RANGE}`,
  )
  const map = new Map<number, number>()
  for (const entry of entries ?? []) {
    if (entry.value !== null) map.set(Number(entry.date), entry.value)
  }
  return map
}

// Keyed by iso3 — each country's series is fetched at most once per page
// load, the first time it's selected.
const cache = new Map<string, Promise<Map<number, YearTotals>>>()

export function loadHistoricalDemographics(iso3: string): Promise<Map<number, YearTotals>> {
  let cached = cache.get(iso3)
  if (!cached) {
    cached = buildYearTotals(iso3).catch((err) => {
      cache.delete(iso3)
      throw err
    })
    cache.set(iso3, cached)
  }
  return cached
}

async function buildYearTotals(iso3: string): Promise<Map<number, YearTotals>> {
  const [birthRate, deathRate, population] = await Promise.all([
    fetchYearSeries(iso3, INDICATORS.birthRatePer1000),
    fetchYearSeries(iso3, INDICATORS.deathRatePer1000),
    fetchYearSeries(iso3, INDICATORS.population),
  ])

  const result = new Map<number, YearTotals>()
  for (const [year, pop] of population) {
    const births = birthRate.get(year)
    const deaths = deathRate.get(year)
    if (births === undefined || deaths === undefined) continue
    result.set(year, {
      births: (births / 1000) * pop,
      deaths: (deaths / 1000) * pop,
    })
  }
  return result
}

export type HistoricalState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; years: Map<number, YearTotals> }

/** Lazy per-country historical totals, fetched the first time `iso3` is
 * non-null (or changes to a new country) and cached across future
 * selections of the same country for the lifetime of the page. */
export function useHistoricalDemographics(iso3: string | null): HistoricalState {
  const [state, setState] = useState<HistoricalState>({ status: 'idle' })

  useEffect(() => {
    if (!iso3) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    loadHistoricalDemographics(iso3).then(
      (years) => {
        if (!cancelled) setState({ status: 'ready', years })
      },
      (error: Error) => {
        if (!cancelled) setState({ status: 'error', error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [iso3])

  return state
}
