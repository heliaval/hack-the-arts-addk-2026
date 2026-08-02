// One-off generator: fetches live World Bank data and writes it to
// src/data/demographics-fallback.json, committed as a last-resort fallback
// for machines where the live API is unreachable (see
// src/lib/demographicsCache.ts). Run with `npm run snapshot` whenever the
// bundled data should be refreshed -- not part of the build or dev server.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildDemographics } from '../src/lib/worldbank'

async function main() {
  const data = await buildDemographics()
  const plain = Object.fromEntries(data)
  const outPath = fileURLToPath(new URL('../src/data/demographics-fallback.json', import.meta.url))
  writeFileSync(outPath, JSON.stringify(plain, null, 2) + '\n')
  console.log(`Wrote ${data.size} countries to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
