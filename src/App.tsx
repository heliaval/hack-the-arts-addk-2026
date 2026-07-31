import { useState } from 'react'
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

interface ThemeToggleProps {
  theme: 'light' | 'dark'
  toggleTheme: () => void
  onHoverChange: (hovered: boolean) => void
}

// Front face previews the mode a click switches TO; back face (hover)
// shows the mode currently active.
function ThemeToggle({ theme, toggleTheme, onHoverChange }: ThemeToggleProps) {
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
}

// Same corner-anchored hint pattern as LanguageHint below, for the theme
// toggle: current mode picked out in accent red, the other muted.
function ThemeHint({ theme, visible }: { theme: 'light' | 'dark'; visible: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute bottom-4 right-4 z-10 font-mono text-xs tracking-wide text-muted-foreground/60 transition-opacity duration-300 dark:text-foreground/70 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span className={theme === 'light' ? 'text-accent' : undefined}>light</span>
      {' · '}
      <span className={theme === 'dark' ? 'text-accent' : undefined}>dark</span>
      {' · click to toggle'}
    </span>
  )
}

interface LanguageToggleProps {
  lang: Lang
  onToggle: () => void
  onHoverChange: (hovered: boolean) => void
}

// Cycles through LANGUAGES on each click. Front face previews the language
// a click switches TO (the next one in the cycle); back face (hover) shows
// the one currently active.
function LanguageToggle({ lang, onToggle, onHoverChange }: LanguageToggleProps) {
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
}

// Rendered at the app's own bottom-right corner rather than anchored to the
// toggle, per explicit request — visibility is driven by hover state lifted
// up from LanguageToggle since the two are no longer DOM neighbors.
function LanguageHint({ lang, visible }: { lang: Lang; visible: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute bottom-4 right-4 z-10 font-mono text-xs tracking-wide text-muted-foreground/60 transition-opacity duration-300 dark:text-foreground/70 ${
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
}

// Bottom-left instrument panel, mirroring the top-left "reading" panel's
// card/border/uppercase-label styling.
function ControlPanel({
  cityCount,
  onCityCountChange,
  rotationSpeedKmS,
  onRotationSpeedChange,
}: {
  cityCount: number
  onCityCountChange: (value: number) => void
  rotationSpeedKmS: number
  onRotationSpeedChange: (value: number) => void
}) {
  return (
    <div className="absolute bottom-4 left-4 z-10 flex w-96 flex-col gap-3 text-card-foreground">
      <div className="flex items-center gap-2.5">
        <span className="flex shrink-0 items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-accent" />
          cities
        </span>
        <Slider
          value={[cityCount]}
          onValueChange={([v]) => onCityCountChange(v)}
          min={MIN_CITY_COUNT}
          max={MAX_CITY_COUNT}
          step={1}
          aria-label="Number of cities shown"
        />
        <NumberFlow
          value={cityCount}
          className="w-6 shrink-0 text-right font-mono text-xs font-medium text-foreground"
        />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-accent" />
          rotation (km/s)
        </span>
        <Slider
          value={[rotationSpeedKmS]}
          onValueChange={([v]) => onRotationSpeedChange(v)}
          min={DEFAULT_ROTATION_SPEED_KM_S}
          max={MAX_ROTATION_SPEED_KM_S}
          step={1}
          aria-label="Globe rotation speed in kilometers per second"
        />
        <NumberFlow
          value={rotationSpeedKmS}
          className="w-11 shrink-0 text-right font-mono text-xs font-medium text-foreground"
        />
      </div>
    </div>
  )
}

function App() {
  const demographics = useDemographics()
  const [selectedIso3, setSelectedIso3] = useState<string | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [langHintVisible, setLangHintVisible] = useState(false)
  const [themeHintVisible, setThemeHintVisible] = useState(false)
  const [cityCount, setCityCount] = useState(MIN_CITY_COUNT)
  const [rotationSpeedKmS, setRotationSpeedKmS] = useState(DEFAULT_ROTATION_SPEED_KM_S)
  const { theme, toggleTheme } = useTheme()

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
        onSelectCountry={(iso3) => {
          setSelectedIso3(iso3)
          console.log('selected', iso3, demographics.data.get(iso3))
        }}
        cityCount={cityCount}
        rotationSpeedKmS={rotationSpeedKmS}
      />
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <LanguageToggle
          lang={lang}
          onToggle={() => setLang(nextLang)}
          onHoverChange={setLangHintVisible}
        />
        <ThemeToggle theme={theme} toggleTheme={toggleTheme} onHoverChange={setThemeHintVisible} />
      </div>
      <LanguageHint lang={lang} visible={langHintVisible} />
      <ThemeHint theme={theme} visible={themeHintVisible} />
      <ControlPanel
        cityCount={cityCount}
        onCityCountChange={setCityCount}
        rotationSpeedKmS={rotationSpeedKmS}
        onRotationSpeedChange={setRotationSpeedKmS}
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
