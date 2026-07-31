import { useMemo } from 'react'
import { Globe } from '@/components/ui/cobe-globe'
import type { CountryDemographics } from '@/lib/worldbank'
import { LANGUAGES, type Lang } from '@/lib/lang'
import { kmPerSecToPhiSpeed } from '@/lib/globeSpeed'

interface GlobeViewProps {
  demographics: Map<string, CountryDemographics>
  lang: Lang
  onSelectCountry: (iso3: string) => void
  cityCount: number
  rotationSpeedKmS: number
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
  // Extra cities beyond the original 9-city demo set, added so the city-count
  // slider has room to grow. Appended after the original set rather than
  // interspersed, so the default (min) view is pixel-identical to before.
  {
    id: 'city-moscow',
    location: [55.7558, 37.6173] as [number, number],
    en: 'Moscow',
    zh: '莫斯科',
    ja: 'モスクワ',
    ko: '모스크바',
    fr: 'Moscou',
    es: 'Moscú',
    pt: 'Moscou',
  },
  {
    id: 'city-beijing',
    location: [39.9042, 116.4074] as [number, number],
    en: 'Beijing',
    zh: '北京',
    ja: '北京',
    ko: '베이징',
    fr: 'Pékin',
    es: 'Pekín',
    pt: 'Pequim',
  },
  {
    id: 'city-delhi',
    location: [28.6139, 77.209] as [number, number],
    en: 'Delhi',
    zh: '德里',
    ja: 'デリー',
    ko: '델리',
    fr: 'Delhi',
    es: 'Delhi',
    pt: 'Deli',
  },
  {
    id: 'city-cairo',
    location: [30.0444, 31.2357] as [number, number],
    en: 'Cairo',
    zh: '开罗',
    ja: 'カイロ',
    ko: '카이로',
    fr: 'Le Caire',
    es: 'El Cairo',
    pt: 'Cairo',
  },
  {
    id: 'city-lagos',
    location: [6.5244, 3.3792] as [number, number],
    en: 'Lagos',
    zh: '拉各斯',
    ja: 'ラゴス',
    ko: '라고스',
    fr: 'Lagos',
    es: 'Lagos',
    pt: 'Lagos',
  },
  {
    id: 'city-mexicocity',
    location: [19.4326, -99.1332] as [number, number],
    en: 'Mexico City',
    zh: '墨西哥城',
    ja: 'メキシコシティ',
    ko: '멕시코시티',
    fr: 'Mexico',
    es: 'Ciudad de México',
    pt: 'Cidade do México',
  },
  {
    id: 'city-toronto',
    location: [43.6532, -79.3832] as [number, number],
    en: 'Toronto',
    zh: '多伦多',
    ja: 'トロント',
    ko: '토론토',
    fr: 'Toronto',
    es: 'Toronto',
    pt: 'Toronto',
  },
  {
    id: 'city-singapore',
    location: [1.3521, 103.8198] as [number, number],
    en: 'Singapore',
    zh: '新加坡',
    ja: 'シンガポール',
    ko: '싱가포르',
    fr: 'Singapour',
    es: 'Singapur',
    pt: 'Singapura',
  },
  {
    id: 'city-seoul',
    location: [37.5665, 126.978] as [number, number],
    en: 'Seoul',
    zh: '首尔',
    ja: 'ソウル',
    ko: '서울',
    fr: 'Séoul',
    es: 'Seúl',
    pt: 'Seul',
  },
  {
    id: 'city-mumbai',
    location: [19.076, 72.8777] as [number, number],
    en: 'Mumbai',
    zh: '孟买',
    ja: 'ムンバイ',
    ko: '뭄바이',
    fr: 'Bombay',
    es: 'Bombay',
    pt: 'Mumbai',
  },
  {
    id: 'city-istanbul',
    location: [41.0082, 28.9784] as [number, number],
    en: 'Istanbul',
    zh: '伊斯坦布尔',
    ja: 'イスタンブール',
    ko: '이스탄불',
    fr: 'Istanbul',
    es: 'Estambul',
    pt: 'Istambul',
  },
]
export const MIN_CITY_COUNT = 9
export const MAX_CITY_COUNT = CITIES.length

const CITY_MARKER_SIZE = 0.025

// Fixed to the original first-4 cities (always present, since cityCount's
// minimum is 9) so the two demo arcs never reference a sliced-out city.
const ARC_ROUTES = [
  { id: 'sf-tokyo', from: CITIES[0], to: CITIES[2] },
  { id: 'nyc-london', from: CITIES[1], to: CITIES[3] },
]

// Variant arrays ordered to match LANGUAGES — only `activeLabelIndex` moves
// on language change, which animates the swap via TextRotate instead of an
// instant text replace.
const ARCS = ARC_ROUTES.map((route) => ({
  id: route.id,
  from: route.from.location,
  to: route.to.location,
  label: LANGUAGES.map((l) => `${route.from[l]} → ${route.to[l]}`),
}))

export function GlobeView({
  demographics,
  lang,
  onSelectCountry,
  cityCount,
  rotationSpeedKmS,
}: GlobeViewProps) {
  // Country-level demographics/selection isn't wired into the globe right
  // now — dots are city-only until the per-country marker approach is
  // revisited. See PROGRESS.md.
  void demographics
  void onSelectCountry

  // Memoized so the marker array reference only changes when cityCount
  // actually does — cobe-globe's animation loop only re-uploads GPU marker
  // buffers when the reference changes (see its `lastMarkers` check).
  const markers = useMemo(
    () =>
      CITIES.slice(0, cityCount).map((city) => ({
        id: city.id,
        location: city.location,
        label: LANGUAGES.map((l) => city[l]),
        size: CITY_MARKER_SIZE,
      })),
    [cityCount],
  )

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Globe
        className="w-full max-w-2xl"
        markers={markers}
        arcs={ARCS}
        activeLabelIndex={LANGUAGES.indexOf(lang)}
        speed={kmPerSecToPhiSpeed(rotationSpeedKmS)}
        {...GLOBE_COLORS}
      />
    </div>
  )
}
