import { Globe } from '@/components/ui/cobe-globe'
import type { CountryDemographics } from '@/lib/worldbank'
import { LANGUAGES, type Lang } from '@/lib/lang'

interface GlobeViewProps {
  demographics: Map<string, CountryDemographics>
  lang: Lang
  onSelectCountry: (iso3: string) => void
}

// The globe sphere always stays white, like the original reference demo —
// it does not follow the app's light/dark theme, only the surrounding page
// chrome (pills, background, toggles) does. Dots are dark red, arc lines
// are light red; no green anywhere.
const GLOBE_COLORS = {
  baseColor: [1, 1, 0.9803921568627451] as [number, number, number], // matches --background #fffffa
  glowColor: [1, 1, 0.9803921568627451] as [number, number, number],
  markerColor: [0.44, 0.15, 0.2] as [number, number, number], // dark red
  arcColor: [0.87, 0.42, 0.44] as [number, number, number], // light red
  dark: 0,
  mapBrightness: 9,
}

// The reference demo's full city set (not derived from real flow data —
// population data has no "from/to" shape). 9 gives a well-spread, legible
// globe without crowding; a dot only ever appears for a labeled city, no
// unlabeled markers. Translation keys match LANGUAGES order in lib/lang.ts.
const CITIES = [
  {
    id: 'city-sf',
    location: [37.7595, -122.4367] as [number, number],
    en: 'San Francisco',
    zh: '旧金山',
    ja: 'サンフランシスコ',
    ko: '샌프란시스코',
    fr: 'San Francisco',
    es: 'San Francisco',
    pt: 'San Francisco',
  },
  {
    id: 'city-nyc',
    location: [40.7128, -74.006] as [number, number],
    en: 'New York',
    zh: '纽约',
    ja: 'ニューヨーク',
    ko: '뉴욕',
    fr: 'New York',
    es: 'Nueva York',
    pt: 'Nova York',
  },
  {
    id: 'city-tokyo',
    location: [35.6762, 139.6503] as [number, number],
    en: 'Tokyo',
    zh: '东京',
    ja: '東京',
    ko: '도쿄',
    fr: 'Tokyo',
    es: 'Tokio',
    pt: 'Tóquio',
  },
  {
    id: 'city-london',
    location: [51.5074, -0.1278] as [number, number],
    en: 'London',
    zh: '伦敦',
    ja: 'ロンドン',
    ko: '런던',
    fr: 'Londres',
    es: 'Londres',
    pt: 'Londres',
  },
  {
    id: 'city-sydney',
    location: [-33.8688, 151.2093] as [number, number],
    en: 'Sydney',
    zh: '悉尼',
    ja: 'シドニー',
    ko: '시드니',
    fr: 'Sydney',
    es: 'Sídney',
    pt: 'Sydney',
  },
  {
    id: 'city-capetown',
    location: [-33.9249, 18.4241] as [number, number],
    en: 'Cape Town',
    zh: '开普敦',
    ja: 'ケープタウン',
    ko: '케이프타운',
    fr: 'Le Cap',
    es: 'Ciudad del Cabo',
    pt: 'Cidade do Cabo',
  },
  {
    id: 'city-dubai',
    location: [25.2048, 55.2708] as [number, number],
    en: 'Dubai',
    zh: '迪拜',
    ja: 'ドバイ',
    ko: '두바이',
    fr: 'Dubaï',
    es: 'Dubái',
    pt: 'Dubai',
  },
  {
    id: 'city-paris',
    location: [48.8566, 2.3522] as [number, number],
    en: 'Paris',
    zh: '巴黎',
    ja: 'パリ',
    ko: '파리',
    fr: 'Paris',
    es: 'París',
    pt: 'Paris',
  },
  {
    id: 'city-saopaulo',
    location: [-23.5505, -46.6333] as [number, number],
    en: 'São Paulo',
    zh: '圣保罗',
    ja: 'サンパウロ',
    ko: '상파울루',
    fr: 'São Paulo',
    es: 'São Paulo',
    pt: 'São Paulo',
  },
]
const CITY_MARKER_SIZE = 0.025

const ARC_ROUTES = [
  { id: 'sf-tokyo', from: CITIES[0], to: CITIES[2] },
  { id: 'nyc-london', from: CITIES[1], to: CITIES[3] },
]

// Variant arrays ordered to match LANGUAGES — stable references so the
// globe never reinits on language change; only `activeLabelIndex` moves,
// which animates the swap via TextRotate instead of an instant text replace.
const MARKERS = CITIES.map((city) => ({
  id: city.id,
  location: city.location,
  label: LANGUAGES.map((l) => city[l]),
  size: CITY_MARKER_SIZE,
}))

const ARCS = ARC_ROUTES.map((route) => ({
  id: route.id,
  from: route.from.location,
  to: route.to.location,
  label: LANGUAGES.map((l) => `${route.from[l]} → ${route.to[l]}`),
}))

export function GlobeView({ demographics, lang, onSelectCountry }: GlobeViewProps) {
  // Country-level demographics/selection isn't wired into the globe right
  // now — dots are city-only until the per-country marker approach is
  // revisited. See PROGRESS.md.
  void demographics
  void onSelectCountry

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Globe
        className="w-full max-w-2xl"
        markers={MARKERS}
        arcs={ARCS}
        activeLabelIndex={LANGUAGES.indexOf(lang)}
        {...GLOBE_COLORS}
      />
    </div>
  )
}
