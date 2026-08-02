// One-off generator: fetches live World Bank per-country historical series
// and writes it to src/data/historical-fallback.json, committed as a
// last-resort fallback for machines where the live API is unreachable (see
// src/lib/historicalCache.ts). Only the countries actually clickable on the
// globe are worth bundling -- re-run this if GlobeView.tsx's CITIES array
// gains a new country. Run with `npm run snapshot:historical` whenever the
// bundled data should be refreshed -- not part of the build or dev server.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildYearTotals } from '../src/lib/historicalDemographics'

// Deduped from GlobeView.tsx's CITIES array's `country` fields.
const CLICKABLE_ISO3 = [
  'USA', 'JPN', 'GBR', 'AUS', 'ZAF', 'ARE', 'FRA', 'BRA', 'RUS',
  'CHN', 'IND', 'EGY', 'MEX', 'CAN', 'KOR', 'TUR', 'NGA', 'SGP',
]

async function buildYearTotalsWithRetry(iso3: string, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await buildYearTotals(iso3)
    } catch (err) {
      if (attempt >= attempts) throw err
      console.warn(`  ${iso3}: attempt ${attempt} failed (${(err as Error).message}), retrying...`)
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}

async function main() {
  const result: Record<string, Record<number, { births: number; deaths: number }>> = {}
  // Sequential, not Promise.all -- 18 countries x 3 indicators each would be
  // 54 simultaneous requests against a public, no-SLA API. A short pause
  // between countries avoids tripping the API's own rate limiting, observed
  // while generating this snapshot (a request would hang/timeout after
  // several rapid-fire countries in a row).
  for (const iso3 of CLICKABLE_ISO3) {
    const years = await buildYearTotalsWithRetry(iso3)
    result[iso3] = Object.fromEntries(years)
    console.log(`  ${iso3}: ${years.size} years`)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  const outPath = fileURLToPath(new URL('../src/data/historical-fallback.json', import.meta.url))
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
  console.log(`Wrote ${CLICKABLE_ISO3.length} countries to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
