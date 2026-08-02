import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { Globe as GlobeIcon, Moon, Sun } from 'lucide-react'
import { GlobeView } from '@/components/GlobeView'
import { BeadScene } from '@/components/BeadScene'
import { GlobeRain } from '@/components/GlobeRain'
import { LeafOverlay, type Leaf } from '@/components/LeafOverlay'
import { TileTransition } from '@/components/TileTransition'
import { DotMatrixBackground, DotMatrixAtmosphere } from '@/components/ui/dot-matrix-background'
import type { GlobeCircle } from '@/components/ui/cobe-globe'
import { useDemographics } from '@/lib/useDemographics'
import { useHistoricalDemographics } from '@/lib/historicalDemographics'
import { marbleCountFor } from '@/lib/marbleCount'
import { useTheme } from '@/lib/useTheme'
import { CubeFlipToggle } from '@/components/ui/cube-flip-toggle'
import { Slider } from '@/components/ui/slider-number-flow'
import { Dropdown } from '@/components/ui/dropdown'
import { TextRotate, type TextRotateRef } from '@/components/ui/text-rotate'
import { LANG_GLYPH, LANGUAGES, nextLang, type Lang } from '@/lib/lang'
import { MIN_CITY_COUNT, MAX_CITY_COUNT } from '@/components/GlobeView'
import { DEFAULT_ROTATION_SPEED_KM_S, MAX_ROTATION_SPEED_KM_S } from '@/lib/globeSpeed'

// Dragging the city-count slider fires onValueChange many times per
// rendered frame (one per pointermove tick). Each integer crossing forces
// GlobeView to recompute its marker/arc arrays and cobe to re-upload their
// GPU buffers — collapsing bursts of same-frame changes down to one commit
// per animation frame keeps that re-upload rate capped at the display's
// refresh rate instead of the input event rate.
//
// A single persistent per-frame check loop, started once on mount ([] dep)
// — not a schedule/cancel-per-value-change dance keyed on `value`. That
// earlier approach re-ran its effect (and cleanup) on every single value
// change, and under React's dev-mode StrictMode double-invoke that raced:
// the cleanup could cancel the in-flight frame after a new effect
// invocation had already early-returned believing one was still pending,
// permanently orphaning the update — `throttled` would get stuck and never
// advance again. Comparing latestRef against throttledRef once per rAF
// tick has no such race: it doesn't matter how many times the effect
// fires, there's only ever the one mount-lifetime loop.
function useRafThrottled<T>(value: T): T {
  const [throttled, setThrottled] = useState(value)
  const latestRef = useRef(value)
  const throttledRef = useRef(value)
  latestRef.current = value

  useEffect(() => {
    let rafId: number
    function tick() {
      if (latestRef.current !== throttledRef.current) {
        throttledRef.current = latestRef.current
        setThrottled(latestRef.current)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return throttled
}

interface ThemeToggleProps {
  theme: 'light' | 'dark'
  toggleTheme: () => void
  onHoverChange: (hovered: boolean) => void
}

// Front face previews the mode a click switches TO; back face (hover)
// shows the mode currently active. Memoized: with stable callback props
// (see App's useCallback usage below), this skips re-rendering on
// unrelated state changes elsewhere in App.
const ThemeToggle = memo(function ThemeToggle({
  theme,
  toggleTheme,
  onHoverChange,
}: ThemeToggleProps) {
  return (
    <div onMouseEnter={() => onHoverChange(true)} onMouseLeave={() => onHoverChange(false)}>
      {theme === 'dark' ? (
        <CubeFlipToggle
          frontIcon={<Sun />}
          frontLabel="Light"
          backIcon={<Moon />}
          backLabel="Dark"
          onClick={toggleTheme}
          ariaLabel="Switch to light mode"
        />
      ) : (
        <CubeFlipToggle
          frontIcon={<Moon />}
          frontLabel="Dark"
          backIcon={<Sun />}
          backLabel="Light"
          onClick={toggleTheme}
          ariaLabel="Switch to dark mode"
        />
      )}
    </div>
  )
})

// Same corner-anchored hint pattern as LanguageHint below, for the theme
// toggle: current mode picked out in accent red, the other muted.
const ThemeHint = memo(function ThemeHint({
  theme,
  visible,
}: {
  theme: 'light' | 'dark'
  visible: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute bottom-4 right-4 z-20 font-mono text-xs tracking-wide text-muted-foreground/60 transition-opacity duration-300 dark:text-foreground/70 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span className={theme === 'light' ? 'text-accent' : undefined}>light</span>
      {' · '}
      <span className={theme === 'dark' ? 'text-accent' : undefined}>dark</span>
      {' · click to toggle'}
    </span>
  )
})

interface LanguageToggleProps {
  lang: Lang
  onToggle: () => void
  onHoverChange: (hovered: boolean) => void
}

// Cycles through LANGUAGES on each click. Front face previews the language
// a click switches TO (the next one in the cycle); back face (hover) shows
// the one currently active.
const LanguageToggle = memo(function LanguageToggle({
  lang,
  onToggle,
  onHoverChange,
}: LanguageToggleProps) {
  const upcoming = nextLang(lang)
  return (
    <div onMouseEnter={() => onHoverChange(true)} onMouseLeave={() => onHoverChange(false)}>
      <CubeFlipToggle
        frontIcon={<GlobeIcon />}
        frontLabel={LANG_GLYPH[upcoming]}
        backLabel={LANG_GLYPH[lang]}
        onClick={onToggle}
        ariaLabel={`Switch language to ${LANG_GLYPH[upcoming]}`}
      />
    </div>
  )
})

// Rendered at the app's own bottom-right corner rather than anchored to the
// toggle, per explicit request — visibility is driven by hover state lifted
// up from LanguageToggle since the two are no longer DOM neighbors.
const LanguageHint = memo(function LanguageHint({
  lang,
  visible,
}: {
  lang: Lang
  visible: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute bottom-4 right-4 z-20 font-mono text-xs tracking-wide text-muted-foreground/60 transition-opacity duration-300 dark:text-foreground/70 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {LANGUAGES.map((l, i) => (
        <span key={l}>
          <span className={l === lang ? 'text-accent' : undefined}>{LANG_GLYPH[l]}</span>
          {i < LANGUAGES.length - 1 && ' · '}
        </span>
      ))}
      {' · click to cycle'}
    </span>
  )
})

// Shares the language/theme hints' bottom-right corner and fade pattern,
// but unlike those it isn't hover-driven — it's shown once, automatically,
// the first time the city count hits its max. `suppressed` (driven by the
// language/theme hints' own hover state) hides it outright rather than
// just relying on z-index, since the two messages are different widths and
// a shorter hint wouldn't fully cover a longer warning underneath it.
const LagWarning = memo(function LagWarning({
  remainingSeconds,
  suppressed,
}: {
  remainingSeconds: number | null
  suppressed: boolean
}) {
  const visible = remainingSeconds !== null && !suppressed
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute bottom-4 right-4 z-10 font-mono text-xs tracking-wide text-muted-foreground/60 transition-opacity duration-700 ease-in-out dark:text-foreground/70 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      Advisory: rendering performance may degrade at 20 cities
      {visible && (
        <>
          {' · '}
          <span className="text-accent">{remainingSeconds}s</span>
        </>
      )}
    </span>
  )
})

const ONBOARDING_LINES = [
  'Adjust the cities and globe speed with the sliders, bottom left',
  'Click a city to watch a cascade of marbles fall, representing life and death',
  'Language toggles available in the top right',
]
const ONBOARDING_LINE_SECONDS = 10

// Same structure as LagWarning: one flowing single-line span (no wrap
// block), main message followed by a trailing accent-highlighted segment
// after a " · " separator (there it's the countdown seconds, here it's the
// skip hint) -- shown once automatically on every load (not persisted,
// same in-memory-only pattern as the lag warning). Only the message itself
// is animated (TextRotate, same component the globe's city/arc labels use)
// so longer sentences roll in word-by-word instead of an abrupt swap; the
// trailing " · tab to skip" segment stays static throughout.
// `suppressed` mirrors LagWarning's own reasoning: two overlapping messages
// in the same corner read as broken, not just visually.
//
// TextRotate is driven externally via its `jumpTo` ref rather than its own
// `auto`/`rotationInterval` timer (same pattern cobe-globe.tsx already uses
// for the globe's label rotation) -- App owns `lineIndex` and the countdown,
// so a Tab press can advance the line immediately without fighting an
// internal timer that doesn't know about the skip.
const OnboardingHint = memo(function OnboardingHint({
  visible,
  suppressed,
  lineIndex,
  secondsRemaining,
}: {
  visible: boolean
  suppressed: boolean
  lineIndex: number
  secondsRemaining: number
}) {
  const textRotateRef = useRef<TextRotateRef>(null)
  useEffect(() => {
    textRotateRef.current?.jumpTo(lineIndex)
  }, [lineIndex])

  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute bottom-4 right-4 z-10 font-mono text-xs tracking-wide text-muted-foreground/60 transition-opacity duration-700 ease-in-out dark:text-foreground/70 ${
        visible && !suppressed ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <TextRotate
        ref={textRotateRef}
        texts={ONBOARDING_LINES}
        auto={false}
        loop={false}
        splitBy="words"
        staggerDuration={0.02}
        animatePresenceMode="popLayout"
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        mainClassName="inline-flex"
      />
      {' · '}
      <span className="text-accent">tab</span>
      {' to skip · '}
      <span className="text-accent">{secondsRemaining}s</span>
    </span>
  )
})

// Bottom-left instrument panel, mirroring the top-left "reading" panel's
// card/border/uppercase-label styling.
// Slider position itself is a continuous float (fine step) so dragging
// never "locks" between a handful of visible positions; only the displayed
// NumberFlow readout (and whatever consumes the value downstream) rounds to
// the nearest whole number.
const ControlPanel = memo(function ControlPanel({
  cityCountRaw,
  onCityCountRawChange,
  rotationSpeedRaw,
  onRotationSpeedRawChange,
}: {
  cityCountRaw: number
  onCityCountRawChange: (value: number) => void
  rotationSpeedRaw: number
  onRotationSpeedRawChange: (value: number) => void
}) {
  return (
    <div className="absolute bottom-4 left-4 z-10 flex w-96 flex-col gap-3 text-card-foreground">
      <div className="flex items-center gap-2.5">
        <span className="flex shrink-0 items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-accent" />
          cities
        </span>
        <Slider
          value={[cityCountRaw]}
          onValueChange={([v]) => onCityCountRawChange(v)}
          min={MIN_CITY_COUNT}
          max={MAX_CITY_COUNT}
          step={0.01}
          aria-label="Number of cities shown"
        />
        <NumberFlow
          value={Math.round(cityCountRaw)}
          className="w-6 shrink-0 text-right font-mono text-xs font-medium text-foreground"
        />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-accent" />
          rotation (km/s)
        </span>
        <Slider
          value={[rotationSpeedRaw]}
          onValueChange={([v]) => onRotationSpeedRawChange(v)}
          min={DEFAULT_ROTATION_SPEED_KM_S}
          max={MAX_ROTATION_SPEED_KM_S}
          step={0.01}
          aria-label="Globe rotation speed in kilometers per second"
        />
        <NumberFlow
          value={Math.round(rotationSpeedRaw)}
          className="w-11 shrink-0 text-right font-mono text-xs font-medium text-foreground"
        />
      </div>
    </div>
  )
})

// Static title/subtitle card, always present at the top-left corner. Reuses
// the "reading" panel's card treatment (border/backdrop-blur) for legibility
// over the rotating globe.
const AppTitle = memo(function AppTitle() {
  return (
    <div className="pointer-events-none">
      <div className="font-serif text-2xl font-medium text-accent">Red Thread</div>
      <div className="text-[0.65rem] uppercase tracking-widest text-foreground">
        We Are All Bound By Fate.
      </div>
    </div>
  )
})

// Two large serif readouts over the globe's own open space — upper for
// births, lower for deaths. pointer-events-none so they never intercept
// the globe's own drag/click handling; absolutely positioned against the
// same full-viewport container GlobeView renders into.
const YearCounters = memo(function YearCounters({
  births,
  deaths,
}: {
  births: number
  deaths: number
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-between py-24">
      <div className="flex flex-col items-center gap-1">
        <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          births
        </span>
        <NumberFlow
          value={Math.round(births)}
          className="font-serif text-4xl font-medium text-accent"
        />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          deaths
        </span>
        <NumberFlow
          value={Math.round(deaths)}
          className="font-serif text-4xl font-medium text-foreground"
        />
      </div>
    </div>
  )
})

function App() {
  const demographics = useDemographics()
  const [selectedIso3, setSelectedIso3] = useState<string | null>(null)
  const [globeCircle, setGlobeCircle] = useState<GlobeCircle | null>(null)
  const [globeElement, setGlobeElement] = useState<HTMLCanvasElement | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [langHintVisible, setLangHintVisible] = useState(false)
  const [themeHintVisible, setThemeHintVisible] = useState(false)
  const [cityCountRaw, setCityCountRaw] = useState(MIN_CITY_COUNT)
  const [rotationSpeedRaw, setRotationSpeedRaw] = useState(DEFAULT_ROTATION_SPEED_KM_S)
  const [lagWarningRemaining, setLagWarningRemaining] = useState<number | null>(null)
  const hasShownLagWarningRef = useRef(false)
  // Slider position (cityCountRaw) updates instantly for a smooth drag feel;
  // the committed value that actually drives the globe is rAF-throttled so
  // GlobeView/cobe only do their (comparatively expensive) marker/arc-buffer
  // work once per rendered frame, no matter how many pointer events the
  // drag produces in that time. See useRafThrottled above.
  const cityCount = useRafThrottled(Math.round(cityCountRaw))
  const rotationSpeedKmS = Math.round(rotationSpeedRaw)
  const { theme, toggleTheme } = useTheme()

  const historical = useHistoricalDemographics(selectedIso3)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [progress, setProgress] = useState({ births: 0, deaths: 0 })

  // Defaults to the latest available year once a country's historical data
  // loads, and re-defaults on country switch unless the previously
  // selected year happens to also exist in the new country's map.
  useEffect(() => {
    if (historical.status !== 'ready') return
    const latestYear = Math.max(...historical.years.keys())
    setSelectedYear((prev) => (prev !== null && historical.years.has(prev) ? prev : latestYear))
  }, [historical])

  // Clears the stale year immediately on deselect, so it doesn't leak into
  // the next selection before the effect above re-fires.
  useEffect(() => {
    if (!selectedIso3) setSelectedYear(null)
  }, [selectedIso3])

  // Shows the lag warning once, ever, the first time the slider hits max.
  useEffect(() => {
    if (cityCount !== MAX_CITY_COUNT || hasShownLagWarningRef.current) return
    hasShownLagWarningRef.current = true
    setLagWarningRemaining(5)
  }, [cityCount])

  useEffect(() => {
    if (lagWarningRemaining === null) return
    if (lagWarningRemaining === 0) {
      setLagWarningRemaining(null)
      return
    }
    const t = setTimeout(() => setLagWarningRemaining((s) => (s === null ? null : s - 1)), 1000)
    return () => clearTimeout(t)
  }, [lagWarningRemaining])

  // Onboarding hint: cycles the ONBOARDING_LINES once, every load (in-memory
  // only, like the lag warning above -- resets on refresh). App owns the
  // current line and its countdown (not TextRotate's own timer -- see
  // OnboardingHint above), so both the automatic advance and a Tab-skip can
  // share the exact same "go to next line, or dismiss if already on the
  // last one" logic.
  const [onboardingVisible, setOnboardingVisible] = useState(true)
  const [onboardingLineIndex, setOnboardingLineIndex] = useState(0)
  const [onboardingSecondsRemaining, setOnboardingSecondsRemaining] = useState(ONBOARDING_LINE_SECONDS)

  const advanceOnboarding = useCallback(() => {
    setOnboardingLineIndex((i) => {
      if (i >= ONBOARDING_LINES.length - 1) {
        setOnboardingVisible(false)
        return i
      }
      return i + 1
    })
  }, [])

  // Resets the countdown every time the line changes.
  useEffect(() => {
    setOnboardingSecondsRemaining(ONBOARDING_LINE_SECONDS)
  }, [onboardingLineIndex])

  useEffect(() => {
    if (!onboardingVisible) return
    if (onboardingSecondsRemaining <= 0) {
      advanceOnboarding()
      return
    }
    const t = setTimeout(() => setOnboardingSecondsRemaining((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [onboardingVisible, onboardingSecondsRemaining, advanceOnboarding])

  // Tab advances to the next line immediately, only dismissing the whole
  // hint once pressed on the last one -- scoped to only capture Tab while
  // the hint is actually showing, so normal keyboard navigation
  // (focusing buttons/sliders/the year dropdown) is unaffected once it's
  // dismissed or has finished on its own.
  useEffect(() => {
    if (!onboardingVisible) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Tab') {
        e.preventDefault()
        advanceOnboarding()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onboardingVisible, advanceOnboarding])

  // Stable references (required for GlobeView's React.memo to actually skip
  // re-renders on unrelated App state changes) — must be declared before
  // the early returns below, since hooks can't run conditionally.
  // Clicking the already-selected country deselects it — that's the only
  // exit from the bead scene (clicking the shrunken globe again), per the
  // design: symmetric in/out, no separate close control. No `demographics`
  // dependency, so this reference is stable for GlobeView's React.memo.
  const handleSelectCountry = useCallback(
    (iso3: string) => setSelectedIso3((prev) => (prev === iso3 ? null : iso3)),
    [],
  )
  const handleLanguageToggle = useCallback(() => setLang(nextLang), [])
  const handleProgress = useCallback((p: { births: number; deaths: number }) => setProgress(p), [])

  const [leaves, setLeaves] = useState<Leaf[]>([])
  const nextLeafIdRef = useRef(0)
  const handleDeparture = useCallback((x: number, y: number, color: string) => {
    const id = nextLeafIdRef.current++
    setLeaves((prev) => [...prev, { id, x, y, color, seed: Math.floor(Math.random() * 10000) }])
  }, [])
  const handleLeafDone = useCallback((id: number) => {
    setLeaves((prev) => prev.filter((leaf) => leaf.id !== id))
  }, [])

  // Resets the counters whenever a fresh batch starts, mirroring
  // BeadScene's own remount on selectedIso3/selectedYear.
  useEffect(() => {
    setProgress({ births: 0, deaths: 0 })
  }, [selectedIso3, selectedYear])

  const selected = selectedIso3 ? demographics.data.get(selectedIso3) : undefined
  const yearTotals =
    historical.status === 'ready' && selectedYear !== null
      ? historical.years.get(selectedYear)
      : undefined
  const birthAnnualTotal = yearTotals?.births ?? 0
  const deathAnnualTotal = yearTotals?.deaths ?? 0
  const birthMarbleCount = yearTotals ? marbleCountFor(yearTotals.births) : 0
  const deathMarbleCount = yearTotals ? marbleCountFor(yearTotals.deaths) : 0

  // Single source of truth for "the bead scene is the thing on screen" —
  // TileTransition's trigger MUST be the exact same expression that gates
  // BeadScene's mount, so the overlay and the new scene land in the same
  // React commit and there's never a frame where only one of them exists.
  const beadSceneVisible = !!(selected && yearTotals)

  // Memoized/stabilized (found in a 2026-08-06 performance audit): App
  // re-renders up to ~16x/sec while BeadScene's onProgress callback is
  // firing (see handleProgress above), and without these, this inline
  // `.sort().map()` allocated a fresh 23-element array of fresh objects,
  // and the inline `onChange` arrow was a fresh reference, on every one
  // of those renders -- Dropdown isn't memoized, so it fully re-rendered
  // each time regardless of whether the actual year list changed.
  const yearDropdownItems = useMemo(
    () =>
      historical.status === 'ready'
        ? [...historical.years.keys()].sort((a, b) => b - a).map((year) => ({ value: String(year), label: String(year) }))
        : [],
    [historical],
  )
  const handleYearChange = useCallback((v: string) => setSelectedYear(Number(v)), [])

  return (
    <div className="relative h-full w-full">
      <DotMatrixBackground />
      {/* The globe stays centered and full-size while a country is selected
          — it IS the obstacle the beads fall onto (see BeadScene's
          GlobeCollider), so it must never move or shrink out from under the
          physics collider that mirrors it. */}
      <div className="absolute inset-0">
        <GlobeView
          demographics={demographics.data}
          lang={lang}
          onSelectCountry={handleSelectCountry}
          onCircleChange={setGlobeCircle}
          onElementChange={setGlobeElement}
          cityCount={cityCount}
          rotationSpeedKmS={rotationSpeedKmS}
          obscured={beadSceneVisible}
        />
      </div>
      {beadSceneVisible && (
        <BeadScene
          key={`${selectedIso3}-${selectedYear}`}
          birthMarbleCount={birthMarbleCount}
          deathMarbleCount={deathMarbleCount}
          birthAnnualTotal={birthAnnualTotal}
          deathAnnualTotal={deathAnnualTotal}
          onProgress={handleProgress}
          theme={theme}
          globeCircle={globeCircle}
          globeElement={globeElement}
          onDeparture={handleDeparture}
        />
      )}
      {/* Ordering is load-bearing: this MUST sit immediately after
          <BeadScene /> and carry no z-index of its own. BeadScene's
          backdrop is an opaque full-viewport plane at `z-0` that swallows
          DotMatrixBackground (also `z-0`, but earlier in this tree)
          wholesale, taking the cursor sheen and glass texture with it -- so
          the atmosphere is re-mounted here, above the canvas, rather than
          being baked into it (which would mean redrawing a full-viewport
          WebGL texture on every mousemove). Gated on beadSceneVisible so
          the globe view never gets two stacked copies of the same glow.
          See DotMatrixAtmosphere's own comment for the full stacking
          rationale. */}
      {beadSceneVisible && <DotMatrixAtmosphere />}
      <LeafOverlay leaves={leaves} onLeafDone={handleLeafDone} />
      {!selected && <GlobeRain globeCircle={globeCircle} theme={theme} />}
      {beadSceneVisible && <YearCounters births={progress.births} deaths={progress.deaths} />}
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <LanguageToggle lang={lang} onToggle={handleLanguageToggle} onHoverChange={setLangHintVisible} />
        <ThemeToggle theme={theme} toggleTheme={toggleTheme} onHoverChange={setThemeHintVisible} />
      </div>
      <LanguageHint lang={lang} visible={langHintVisible} />
      <ThemeHint theme={theme} visible={themeHintVisible} />
      <LagWarning
        remainingSeconds={lagWarningRemaining}
        suppressed={langHintVisible || themeHintVisible || onboardingVisible}
      />
      <OnboardingHint
        visible={onboardingVisible}
        suppressed={langHintVisible || themeHintVisible}
        lineIndex={onboardingLineIndex}
        secondsRemaining={onboardingSecondsRemaining}
      />
      <ControlPanel
        cityCountRaw={cityCountRaw}
        onCityCountRawChange={setCityCountRaw}
        rotationSpeedRaw={rotationSpeedRaw}
        onRotationSpeedRawChange={setRotationSpeedRaw}
      />
      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <AppTitle />
        {selected && (
          <div className="flex flex-col gap-1.5">
            <div className="pointer-events-none flex items-center gap-1.5 font-mono text-sm font-medium text-foreground">
              <span className="inline-block size-1.5 shrink-0 rounded-full bg-accent" />
              {selected.name}
            </div>
            {historical.status === 'ready' && selectedYear !== null && (
              <div className="flex items-center gap-1.5 pl-3">
                <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">year</span>
                <Dropdown
                  label="year"
                  items={yearDropdownItems}
                  value={String(selectedYear)}
                  onChange={handleYearChange}
                />
              </div>
            )}
          </div>
        )}
      </div>
      <TileTransition active={beadSceneVisible} circle={globeCircle} />
    </div>
  )
}

export default App
