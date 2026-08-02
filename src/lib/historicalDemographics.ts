import { useEffect, useState } from 'react'
import { fetchJson } from './worldbank'
import { readHistoricalCache, readHistoricalSnapshot, writeHistoricalCache } from '@/lib/historicalCache'

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

export async function buildYearTotals(iso3: string): Promise<Map<number, YearTotals>> {
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
 * selections of the same country for the lifetime of the page.
 *
 * Stale-while-revalidate, same rationale as useDemographics: this hits the
 * same api.worldbank.org host that's unreachable on some machines (see
 * PROGRESS.md), and unlike that hook this one gates the entire bead-scene
 * render (App.tsx), so blocking on the live fetch isn't just a stale-data
 * inconvenience -- it silently breaks the app's core interaction. Seeds
 * synchronously from a per-country localStorage cache or a bundled
 * snapshot (the ~18 countries actually clickable on the globe) before the
 * live fetch even starts; a background failure never downgrades a
 * successfully-seeded state to 'error'. */
export function useHistoricalDemographics(iso3: string | null): HistoricalState {
  const [state, setState] = useState<HistoricalState>({ status: 'idle' })

  useEffect(() => {
    if (!iso3) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    const seed = readHistoricalCache(iso3) ?? readHistoricalSnapshot(iso3)
    setState(seed ? { status: 'ready', years: seed } : { status: 'loading' })
    loadHistoricalDemographics(iso3).then(
      (years) => {
        if (cancelled) return
        writeHistoricalCache(iso3, years)
        setState({ status: 'ready', years })
      },
      (error: Error) => {
        if (cancelled) return
        if (seed) {
          console.warn(`Live historical fetch for ${iso3} failed, keeping fallback data:`, error)
        } else {
          setState({ status: 'error', error })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [iso3])

  return state
}
