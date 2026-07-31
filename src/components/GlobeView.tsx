import { memo, useEffect, useMemo, useRef, useState } from 'react'
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
  // Lagos and Singapore are deliberately last (indices 18/19) — they're the
  // endpoints of the last two arc routes below, so those routes only
  // appear once their cities have entered the slider's visible slice, and
  // the 4th route only appears at the slider's max.
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
]
export const MIN_CITY_COUNT = 9
export const MAX_CITY_COUNT = CITIES.length

const CITY_MARKER_SIZE = 0.025

// Each route only appears once both its cities have entered the city-count
// slider's visible slice (`cityCount >= requiredCityCount`) — routes
// "propagate" in as the slider grows rather than all being fixed/always-on.
// Lagos and Singapore are deliberately the last two entries in CITIES, so
// the 4th route only appears at the slider's max.
const CITY_INDEX = new Map(CITIES.map((city, i) => [city.id, i]))
function cityById(id: string) {
  return CITIES.find((c) => c.id === id)!
}
const ARC_ROUTE_DEFS = [
  { id: 'sf-tokyo', fromId: 'city-sf', toId: 'city-tokyo' },
  { id: 'nyc-london', fromId: 'city-nyc', toId: 'city-london' },
  { id: 'saopaulo-lagos', fromId: 'city-saopaulo', toId: 'city-lagos' },
  { id: 'dubai-singapore', fromId: 'city-dubai', toId: 'city-singapore' },
]
const ARC_ROUTES = ARC_ROUTE_DEFS.map((def) => ({
  id: def.id,
  from: cityById(def.fromId),
  to: cityById(def.toId),
  requiredCityCount: Math.max(CITY_INDEX.get(def.fromId)!, CITY_INDEX.get(def.toId)!) + 1,
}))

const ARC_DRAW_DURATION_MS = 1600
function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}
// Straight-line lerp in lat/lng space, not a true great-circle slerp — cobe
// still draws a proper great-circle bulge between `from` and whatever `to`
// we hand it each frame, so the arc still reads as smoothly extending
// toward its real destination without needing 3D vector math here.
function interpolateLocation(
  from: [number, number],
  to: [number, number],
  t: number,
): [number, number] {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
}

// Tracks, per route id, how long it's been visible — routes that just
// became visible animate their `to` endpoint in from `from` over
// ARC_DRAW_DURATION_MS so the flight line appears to "draw" itself rather
// than popping in fully formed. Returns a Map whose reference only changes
// on an actual animation tick (not on every unrelated App re-render), so
// callers can safely useMemo off it.
function useArcDrawProgress(visibleIds: string[]): Map<string, number> {
  const [progress, setProgress] = useState<Map<string, number>>(new Map())
  const startTimes = useRef(new Map<string, number>())
  const prevIds = useRef<string[]>([])
  const idsKey = visibleIds.join(',')

  useEffect(() => {
    const newlyVisible = visibleIds.filter((id) => !prevIds.current.includes(id))
    prevIds.current = visibleIds
    if (newlyVisible.length === 0) return

    const now = performance.now()
    for (const id of newlyVisible) startTimes.current.set(id, now)

    let rafId: number
    function tick() {
      const t = performance.now()
      const next = new Map<string, number>()
      let animating = false
      for (const [id, start] of startTimes.current) {
        const p = easeOutCubic(Math.min(1, (t - start) / ARC_DRAW_DURATION_MS))
        next.set(id, p)
        if (p < 1) animating = true
      }
      setProgress(next)
      if (animating) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  return progress
}

// Memoized — wraps the WebGL globe, by far the most expensive component in
// the tree, so it shouldn't re-render on unrelated App state changes (hover
// hints, theme toggle hover, etc.) as long as its own props are unchanged.
// Requires callers to pass stable prop references (see App.tsx's
// useCallback usage for onSelectCountry).
export const GlobeView = memo(function GlobeView({
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

  const visibleRoutes = useMemo(
    () => ARC_ROUTES.filter((route) => cityCount >= route.requiredCityCount),
    [cityCount],
  )
  const drawProgress = useArcDrawProgress(visibleRoutes.map((r) => r.id))

  // Memoized off [visibleRoutes, drawProgress] rather than recomputed every
  // render — drawProgress's reference only changes on an actual animation
  // tick, so this correctly recomputes each frame while a route is mid-draw
  // but stays cheap (skipped) on unrelated App re-renders (e.g. hovering an
  // unrelated toggle), same as cobe-globe's own liveProps/lastArcs check
  // that this feeds into.
  const arcs = useMemo(
    () =>
      visibleRoutes.map((route) => {
        const t = drawProgress.get(route.id) ?? 1
        return {
          id: route.id,
          from: route.from.location,
          to:
            t >= 1
              ? route.to.location
              : interpolateLocation(route.from.location, route.to.location, t),
          label: LANGUAGES.map((l) => `${route.from[l]} → ${route.to[l]}`),
        }
      }),
    [visibleRoutes, drawProgress],
  )

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Globe
        className="w-full max-w-2xl"
        markers={markers}
        arcs={arcs}
        activeLabelIndex={LANGUAGES.indexOf(lang)}
        speed={kmPerSecToPhiSpeed(rotationSpeedKmS)}
        {...GLOBE_COLORS}
      />
    </div>
  )
})
