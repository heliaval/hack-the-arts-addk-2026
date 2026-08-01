const WB_BASE = 'https://api.worldbank.org/v2'

const INDICATORS = {
  population: 'SP.POP.TOTL',
  growthPct: 'SP.POP.GROW',
  birthRatePer1000: 'SP.DYN.CBRT.IN',
  deathRatePer1000: 'SP.DYN.CDRT.IN',
} as const

export interface CountryDemographics {
  iso3: string
  iso2: string
  name: string
  population: number
  growthPct: number
  birthRatePer1000: number
  deathRatePer1000: number
  birthsPerSecond: number
  deathsPerSecond: number
}

interface WbCountryEntry {
  id: string
  iso2Code: string
  name: string
  incomeLevel: { id: string }
}

interface WbIndicatorEntry {
  countryiso3code: string
  value: number | null
}

const SECONDS_PER_YEAR = 365.25 * 24 * 3600

// The World Bank API is a public third-party service with no SLA and no
// retry logic of its own -- it occasionally blips (a single request taking
// several seconds, or a transient network failure) even though it's up and
// fast the rest of the time. Two retries with a short delay absorbs that
// without masking a genuinely broken endpoint (persistent 4xx/5xx still
// exhausts the retries and surfaces the real error).
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

async function fetchCountryList(): Promise<Map<string, { iso2: string; name: string }>> {
  const [, entries] = await fetchJson<[unknown, WbCountryEntry[]]>(
    `${WB_BASE}/country?format=json&per_page=400`,
  )
  const map = new Map<string, { iso2: string; name: string }>()
  for (const entry of entries) {
    // Aggregates (regions, income groups) have no real income level.
    if (entry.incomeLevel.id === 'NA') continue
    map.set(entry.id, { iso2: entry.iso2Code, name: entry.name })
  }
  return map
}

async function fetchIndicator(code: string): Promise<Map<string, number>> {
  const [, entries] = await fetchJson<[unknown, WbIndicatorEntry[] | null]>(
    `${WB_BASE}/country/all/indicator/${code}?format=json&per_page=400&mrnev=1`,
  )
  const map = new Map<string, number>()
  for (const entry of entries ?? []) {
    if (entry.value !== null) map.set(entry.countryiso3code, entry.value)
  }
  return map
}

let cachedPromise: Promise<Map<string, CountryDemographics>> | null = null

export function loadDemographics(): Promise<Map<string, CountryDemographics>> {
  if (!cachedPromise) {
    cachedPromise = buildDemographics().catch((err) => {
      cachedPromise = null
      throw err
    })
  }
  return cachedPromise
}

async function buildDemographics(): Promise<Map<string, CountryDemographics>> {
  const [countries, population, growthPct, birthRate, deathRate] = await Promise.all([
    fetchCountryList(),
    fetchIndicator(INDICATORS.population),
    fetchIndicator(INDICATORS.growthPct),
    fetchIndicator(INDICATORS.birthRatePer1000),
    fetchIndicator(INDICATORS.deathRatePer1000),
  ])

  const result = new Map<string, CountryDemographics>()

  for (const [iso3, meta] of countries) {
    const pop = population.get(iso3)
    const births = birthRate.get(iso3)
    const deaths = deathRate.get(iso3)
    if (pop === undefined || births === undefined || deaths === undefined) continue

    const birthsPerYear = (births / 1000) * pop
    const deathsPerYear = (deaths / 1000) * pop

    result.set(iso3, {
      iso3,
      iso2: meta.iso2,
      name: meta.name,
      population: pop,
      growthPct: growthPct.get(iso3) ?? 0,
      birthRatePer1000: births,
      deathRatePer1000: deaths,
      birthsPerSecond: birthsPerYear / SECONDS_PER_YEAR,
      deathsPerSecond: deathsPerYear / SECONDS_PER_YEAR,
    })
  }

  return result
}
