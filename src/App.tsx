import { memo, useCallback, useEffect, useRef, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { Globe as GlobeIcon, Moon, Sun } from 'lucide-react'
import { GlobeView } from '@/components/GlobeView'
import { useDemographics } from '@/lib/useDemographics'
import { useTheme } from '@/lib/useTheme'
import { CubeFlipToggle } from '@/components/ui/cube-flip-toggle'
import { Slider } from '@/components/ui/slider-number-flow'
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
// the first time the city count hits its max. Sits at a lower z-index than
// the hover hints so hovering the language/theme toggle visually covers it
// without needing to coordinate visibility state between the three.
const LagWarning = memo(function LagWarning({ remainingSeconds }: { remainingSeconds: number | null }) {
  const visible = remainingSeconds !== null
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

function App() {
  const demographics = useDemographics()
  const [selectedIso3, setSelectedIso3] = useState<string | null>(null)
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

  // Stable references (required for GlobeView's React.memo to actually skip
  // re-renders on unrelated App state changes) — must be declared before
  // the early returns below, since hooks can't run conditionally.
  const handleSelectCountry = useCallback(
    (iso3: string) => {
      setSelectedIso3(iso3)
      if (demographics.status === 'ready') {
        console.log('selected', iso3, demographics.data.get(iso3))
      }
    },
    [demographics],
  )
  const handleLanguageToggle = useCallback(() => setLang(nextLang), [])

  if (demographics.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center font-mono text-sm text-muted-foreground">
        loading population data…
      </div>
    )
  }

  if (demographics.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center font-mono text-sm text-destructive">
        failed to load population data: {demographics.error.message}
      </div>
    )
  }

  const selected = selectedIso3 ? demographics.data.get(selectedIso3) : undefined

  return (
    <div className="relative h-full w-full">
      <GlobeView
        demographics={demographics.data}
        lang={lang}
        onSelectCountry={handleSelectCountry}
        cityCount={cityCount}
        rotationSpeedKmS={rotationSpeedKmS}
      />
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <LanguageToggle lang={lang} onToggle={handleLanguageToggle} onHoverChange={setLangHintVisible} />
        <ThemeToggle theme={theme} toggleTheme={toggleTheme} onHoverChange={setThemeHintVisible} />
      </div>
      <LanguageHint lang={lang} visible={langHintVisible} />
      <ThemeHint theme={theme} visible={themeHintVisible} />
      <LagWarning remainingSeconds={lagWarningRemaining} />
      <ControlPanel
        cityCountRaw={cityCountRaw}
        onCityCountRawChange={setCityCountRaw}
        rotationSpeedRaw={rotationSpeedRaw}
        onRotationSpeedRawChange={setRotationSpeedRaw}
      />
      {selected && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-[var(--radius)] border bg-card/90 px-3 py-2 text-card-foreground shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-accent" />
            reading
          </div>
          <div className="font-mono text-sm font-medium">{selected.name}</div>
        </div>
      )}
    </div>
  )
}

export default App
