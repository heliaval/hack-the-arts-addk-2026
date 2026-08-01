import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe, type GlobeRef } from '@/components/ui/cobe-globe'
import type { CountryDemographics } from '@/lib/worldbank'
import { LANGUAGES, type Lang } from '@/lib/lang'
import { kmPerSecToPhiSpeed } from '@/lib/globeSpeed'
import { computeSweepDelays } from '@/lib/sweep'
import { usePopulationPulses } from '@/lib/populationPulse'

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
    country: 'USA',
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
    country: 'USA',
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
    country: 'JPN',
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
    country: 'GBR',
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
    country: 'AUS',
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
    country: 'ZAF',
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
    country: 'ARE',
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
    country: 'FRA',
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
    country: 'BRA',
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
    country: 'RUS',
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
    country: 'CHN',
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
    country: 'IND',
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
    country: 'EGY',
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
    country: 'MEX',
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
    country: 'CAN',
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
    country: 'KOR',
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
    country: 'IND',
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
    country: 'TUR',
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
    country: 'NGA',
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
    country: 'SGP',
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

// Precomputed once rather than inside the `markers` useMemo — see the
// matching note above ARC_ROUTES for why a stable label reference matters.
const CITY_LABELS = new Map(CITIES.map((city) => [city.id, LANGUAGES.map((l) => city[l])]))

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
// Label arrays are precomputed once here rather than inside the per-frame
// `arcs` useMemo below — that memo recomputes every animation frame while
// ANY route is mid-draw-in, and without this, LANGUAGES.map(...) would
// reallocate a fresh label array for every route (not just the one
// animating) on every one of those frames, for content that never
// actually changes. A fresh array reference on every frame also defeats
// TextRotate's own internal memoization (its `elements` useMemo keys off
// the `texts` prop reference).
const ARC_ROUTES = ARC_ROUTE_DEFS.map((def) => {
  const from = cityById(def.fromId)
  const to = cityById(def.toId)
  return {
    id: def.id,
    from,
    to,
    requiredCityCount: Math.max(CITY_INDEX.get(def.fromId)!, CITY_INDEX.get(def.toId)!) + 1,
    label: LANGUAGES.map((l) => `${from[l]} → ${to[l]}`),
  }
})

const ARC_DRAW_DURATION_MS = 1600
function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}
function unitVector([lat, lng]: [number, number]): [number, number, number] {
  const latRad = (lat * Math.PI) / 180
  const lngRad = (lng * Math.PI) / 180
  const cosLat = Math.cos(latRad)
  return [cosLat * Math.cos(lngRad), cosLat * Math.sin(lngRad), Math.sin(latRad)]
}

function vectorToLocation([x, y, z]: [number, number, number]): [number, number] {
  const lat = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI
  const lng = (Math.atan2(y, x) * 180) / Math.PI
  return [lat, lng]
}

// True spherical interpolation along the great-circle geodesic between
// `from` and `to` — NOT a straight lat/lng lerp. Any point along this path
// lies on the same great circle as the final route, so cobe's own
// bulge-height calculation for the growing partial arc is a genuine
// sub-segment of the final curve's shape (small near the start, growing
// correctly as it extends) instead of an unrelated shape that reads as
// scaling up. Also incidentally takes the shorter side of the globe for
// long east-west routes near the antimeridian, where a plain lat/lng lerp
// would sweep the long way around.
function slerpLocation(from: [number, number], to: [number, number], t: number): [number, number] {
  if (t <= 0) return from
  if (t >= 1) return to
  const a = unitVector(from)
  const b = unitVector(to)
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const omega = Math.acos(dot)
  if (omega < 1e-6) return to
  const sinOmega = Math.sin(omega)
  const s0 = Math.sin((1 - t) * omega) / sinOmega
  const s1 = Math.sin(t * omega) / sinOmega
  return vectorToLocation([a[0] * s0 + b[0] * s1, a[1] * s0 + b[1] * s1, a[2] * s0 + b[2] * s1])
}

// Tracks, per route id, how long it's been visible — routes that just
// became visible animate their `to` endpoint in from `from` over
// ARC_DRAW_DURATION_MS so the flight line appears to "draw" itself rather
// than popping in fully formed. Returns a Map whose reference only changes
// on an actual animation tick (not on every unrelated App re-render), so
// callers can safely useMemo off it.
//
// A fast slider drag can cross more than one route's `requiredCityCount`
// threshold in a single commit, making several routes "newly visible" at
// once — their draw-ins are staggered (via computeSweepDelays, ordered by
// each route's current on-screen midpoint) rather than starting together,
// both to sweep left-to-right/top-to-bottom and to spread their per-frame
// setState + GPU arc-buffer re-upload cost across frames instead of
// stacking it up.
function useArcDrawProgress(
  visibleRoutes: { id: string; from: { location: [number, number] }; to: { location: [number, number] } }[],
  project: (location: [number, number]) => { x: number; y: number },
): Map<string, number> {
  const [progress, setProgress] = useState<Map<string, number>>(new Map())
  const startTimes = useRef(new Map<string, number>())
  const prevIds = useRef<string[]>([])
  const routesRef = useRef(visibleRoutes)
  routesRef.current = visibleRoutes
  const idsKey = visibleRoutes.map((r) => r.id).join(',')

  useEffect(() => {
    const routes = routesRef.current
    const newlyVisible = routes.filter((r) => !prevIds.current.includes(r.id))
    prevIds.current = routes.map((r) => r.id)
    if (newlyVisible.length === 0) return

    const items = newlyVisible.map((route) => {
      const a = project(route.from.location)
      const b = project(route.to.location)
      return { id: route.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    })
    const now = performance.now()
    for (const [id, delay] of computeSweepDelays(items)) startTimes.current.set(id, now + delay)

    let rafId: number
    function tick() {
      const t = performance.now()
      const next = new Map<string, number>()
      let animating = false
      for (const [id, start] of startTimes.current) {
        const p = easeOutCubic(Math.max(0, Math.min(1, (t - start) / ARC_DRAW_DURATION_MS)))
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

// Mirrors useArcDrawProgress's stagger approach for newly-eligible city
// markers: instead of adding them to the rendered set all at once, reveal
// them one at a time in sweep order (top-left to bottom-right by current
// screen position). Each reveal mounts that city's LabelPill, which
// already fades in via its own CSS opacity transition — no new fade code
// needed here, just staggered mount timing. Cities dropped by the slider
// moving back down are removed immediately (no sweep needed on the way
// out). Returns a Set whose reference only changes on an actual
// reveal/removal, so callers can safely useMemo off it.
// computeSweepDelays gives a lone newly-eligible item (the common case for
// a slow, deliberate drag) a delay of 0ms — staggering only kicks in once
// several items cross their threshold in the same frame. That made a
// single new city mount instantly, with no time for its label's existing
// fade-in transition to actually read as an entrance. This floor ensures
// every reveal, even a lone one, waits at least this long first.
const MIN_REVEAL_DELAY_MS = 300

function useSweepReveal(
  eligibleIds: string[],
  locationOf: (id: string) => [number, number],
  project: (location: [number, number]) => { x: number; y: number },
): Set<string> {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set(eligibleIds))
  const prevIds = useRef<string[]>(eligibleIds)
  const idsKey = eligibleIds.join(',')

  useEffect(() => {
    const eligibleSet = new Set(eligibleIds)
    const newlyEligible = eligibleIds.filter((id) => !prevIds.current.includes(id))
    prevIds.current = eligibleIds

    setRevealed((prev) => {
      if ([...prev].every((id) => eligibleSet.has(id))) return prev
      const next = new Set<string>()
      for (const id of prev) if (eligibleSet.has(id)) next.add(id)
      return next
    })

    if (newlyEligible.length === 0) return

    const items = newlyEligible.map((id) => {
      const { x, y } = project(locationOf(id))
      return { id, x, y }
    })
    const timers = [...computeSweepDelays(items)].map(([id, delay]) =>
      window.setTimeout(() => {
        setRevealed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      }, Math.max(delay, MIN_REVEAL_DELAY_MS)),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  return revealed
}

// cobe-globe's canvas handles drag-to-rotate on the same pointer stream and
// doesn't distinguish a click from a drag, so GlobeView does: a pointerup
// only counts as a "click" if the pointer barely moved and the press was
// short. Everything else is a rotation gesture and must not select a
// country. The hit radius is a fraction of the canvas box (the same 0-1
// space GlobeRef.project returns) — ~4.5%, comfortably larger than a
// marker's 0.025 dot but small enough that adjacent cities don't overlap.
const CLICK_MAX_MOVE_PX = 6
const CLICK_MAX_DURATION_MS = 400
const CLICK_HIT_RADIUS_FRACTION = 0.045

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
  // Globe exposes live screen-space projection (see cobe-globe.tsx) so the
  // reveal/draw-in stagger below can order itself top-left to bottom-right
  // by each item's *current* on-screen position rather than fixed geography
  // — stays correct regardless of how the globe is currently rotated.
  const globeRef = useRef<GlobeRef>(null)
  const project = useCallback(
    (location: [number, number]) => globeRef.current?.project(location) ?? { x: 0, y: 0, visible: false },
    [],
  )

  const eligibleCityIds = useMemo(() => CITIES.slice(0, cityCount).map((c) => c.id), [cityCount])
  const revealedIds = useSweepReveal(
    eligibleCityIds,
    useCallback((id: string) => cityById(id).location, []),
    project,
  )

  const visibleCities = useMemo(
    () => CITIES.slice(0, cityCount).filter((city) => revealedIds.has(city.id)),
    [cityCount, revealedIds],
  )
  const visibleCityIds = useMemo(() => new Set(visibleCities.map((c) => c.id)), [visibleCities])
  const populationPulses = usePopulationPulses(CITIES, visibleCityIds, demographics)
  const pulses = useMemo(
    () => populationPulses.map((p) => ({ id: p.id, markerId: p.cityId, kind: p.kind, spawnedAt: p.spawnedAt })),
    [populationPulses],
  )

  // Memoized so the marker array reference only changes when the revealed
  // set actually does — cobe-globe's animation loop only re-uploads GPU
  // marker buffers when the reference changes (see its `lastMarkers` check).
  const markers = useMemo(
    () =>
      visibleCities.map((city) => ({
        id: city.id,
        location: city.location,
        label: CITY_LABELS.get(city.id)!,
        size: CITY_MARKER_SIZE,
      })),
    [visibleCities],
  )

  const visibleRoutes = useMemo(
    () => ARC_ROUTES.filter((route) => cityCount >= route.requiredCityCount),
    [cityCount],
  )
  const drawProgress = useArcDrawProgress(visibleRoutes, project)

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
          to: t >= 1 ? route.to.location : slerpLocation(route.from.location, route.to.location, t),
          label: route.label,
        }
      }),
    [visibleRoutes, drawProgress],
  )

  const pointerDownRef = useRef<{ x: number; y: number; t: number } | null>(null)

  function handlePointerDown(e: React.PointerEvent) {
    pointerDownRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const down = pointerDownRef.current
    pointerDownRef.current = null
    if (!down) return
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_MAX_MOVE_PX) return
    if (performance.now() - down.t > CLICK_MAX_DURATION_MS) return

    const canvas = globeRef.current?.getElement()
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    // Same 0-1 canvas-box fraction space that GlobeRef.project() returns.
    // getBoundingClientRect already accounts for any CSS transform on an
    // ancestor (App shrinks the globe into a corner once a country is
    // selected), so this stays correct in both the full and shrunken states.
    const fx = (e.clientX - rect.left) / rect.width
    const fy = (e.clientY - rect.top) / rect.height

    let bestCountry: string | null = null
    let bestDistance = CLICK_HIT_RADIUS_FRACTION
    for (const city of visibleCities) {
      const p = project(city.location)
      // Far-side markers project onto the same 2D disc as near-side ones;
      // without this they'd be selectable "through" the globe.
      if (!p.visible) continue
      const d = Math.hypot(fx - p.x, fy - p.y)
      if (d <= bestDistance) {
        bestDistance = d
        bestCountry = city.country
      }
    }
    if (bestCountry) onSelectCountry(bestCountry)
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center p-8"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <Globe
        ref={globeRef}
        className="aspect-square w-full max-w-[min(80vh,48rem)]"
        markers={markers}
        arcs={arcs}
        pulses={pulses}
        activeLabelIndex={LANGUAGES.indexOf(lang)}
        speed={kmPerSecToPhiSpeed(rotationSpeedKmS)}
        {...GLOBE_COLORS}
      />
    </div>
  )
})
