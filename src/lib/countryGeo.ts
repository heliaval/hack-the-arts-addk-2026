type Ring = [number, number][]

export interface CountryFeature {
  type: 'Feature'
  properties: {
    ISO_A2: string
    ISO_A3: string
    NAME: string
  }
  geometry:
    | { type: 'Polygon'; coordinates: Ring[] }
    | { type: 'MultiPolygon'; coordinates: Ring[][] }
}

/** Rough centroid (vertex average of the largest ring) — good enough for marker placement, not a true geographic centroid. */
export function featureCentroid(feature: CountryFeature): [number, number] {
  const polygons =
    feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  const largestRing = polygons
    .map((rings) => rings[0])
    .reduce((a, b) => (a.length > b.length ? a : b))

  let sumLat = 0
  let sumLon = 0
  for (const [lon, lat] of largestRing) {
    sumLat += lat
    sumLon += lon
  }
  return [sumLat / largestRing.length, sumLon / largestRing.length]
}

export interface CountryFeatureCollection {
  type: 'FeatureCollection'
  features: CountryFeature[]
}

const GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson'

let cachedPromise: Promise<CountryFeatureCollection> | null = null

export function loadCountryGeo(): Promise<CountryFeatureCollection> {
  if (!cachedPromise) {
    cachedPromise = fetch(GEOJSON_URL)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load country boundaries')
        return res.json() as Promise<CountryFeatureCollection>
      })
      .catch((err) => {
        cachedPromise = null
        throw err
      })
  }
  return cachedPromise
}
