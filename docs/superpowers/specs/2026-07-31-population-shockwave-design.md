# Population Shockwave Design

## Goal

For every city marker on the globe, spawn a brief expanding-ring "shockwave"
from that marker's live screen position whenever enough real births or
deaths have accumulated for the country it represents — a red ring for
births, a black ring for deaths. This is the first piece of visually
connecting the already-live World Bank demographics data (`useDemographics`,
`src/lib/worldbank.ts`) to the globe; previously that data loaded but drove
nothing visible.

## Threshold: 3

National per-second birth/death rates are all well under 1/s even for the
most populous countries (China ≈0.31 births/s, India ≈0.74 births/s
combined, Nigeria ≈0.26 births/s). To hit the requested "quickest cadence
≈7s" while staying literally honest to real-world rates (not time-scaled),
the threshold has to be small. A threshold of **3** (three births, or three
deaths, per shockwave) puts the busiest cities at roughly 8-10s cadence:

- Births: India, split across Delhi+Mumbai (≈0.371 births/s each) →
  3 / 0.371 ≈ 8.1s
- Deaths: China/Beijing (≈0.331 deaths/s, only one Chinese city so
  unsplit) → 3 / 0.331 ≈ 9.1s

Quiet countries (e.g. Singapore, ≈0.0016 births/s) will rarely or never
pulse in a short demo session — expected, and consistent with choosing
literal real-time pacing over an artificial speed-up.

Both births and deaths share the same threshold (3) for simplicity — this
isn't a hard constraint from the data, just avoids introducing two tunable
numbers for a "for now" first pass.

## Country mapping and rate-splitting

Each of the 20 entries in `CITIES` (`src/components/GlobeView.tsx`) gets a
new `country: string` field (ISO3, matching `CountryDemographics.iso3`):

| City | Country | City | Country |
|---|---|---|---|
| San Francisco | USA | Mexico City | MEX |
| New York | USA | Toronto | CAN |
| Tokyo | JPN | Seoul | KOR |
| London | GBR | Mumbai | IND |
| Sydney | AUS | Istanbul | TUR |
| Cape Town | ZAF | Lagos | NGA |
| Dubai | ARE | Singapore | SGP |
| Paris | FRA | Moscow | RUS |
| São Paulo | BRA | Beijing | CHN |
| — | — | Delhi | IND |
| — | — | Cairo | EGY |

Two countries repeat: USA (San Francisco, New York) and IND (Delhi,
Mumbai). A city's effective birth/death rate is the country's
`birthsPerSecond`/`deathsPerSecond` (from `CountryDemographics`, already
computed in `worldbank.ts`) divided by how many of the 20 `CITIES` entries
share that country — a fixed divisor computed once from the full roster,
independent of the city-count slider, so a city's pulse cadence doesn't
shift as the slider is dragged.

## Accumulation mechanism

A new hook, `usePopulationPulses(demographics)` in a new file
`src/lib/populationPulse.ts`, is **not** driven by `requestAnimationFrame`
(unlike most of this app's per-frame work) — it needs to keep accumulating
in real wall-clock time regardless of animation frame availability, so it
uses `setInterval` at a fixed tick (500ms), computing elapsed real time via
`Date.now()` deltas (robust to any tick jitter/drift, e.g. from a
backgrounded tab).

Per city, per kind (`birth`/`death`), a running accumulator (in a ref, not
state — ticks 2x/second and must not force React re-renders) adds
`elapsedSeconds * rate`. When an accumulator reaches the threshold (3), it
emits one pulse event and subtracts 3 (keeping any remainder, so
fractional progress isn't lost — over a long session the cadence stays
accurate rather than drifting slow).

Pulse events are appended to a `useState` array of
`{ id: string; cityId: string; kind: 'birth' | 'death' }`, each with a
unique `id` (incrementing counter). Each pulse is removed via its own
`setTimeout` (matching the ring's ~1.1s CSS animation duration) so the
array doesn't grow unbounded.

The hook only accumulates for the currently-visible city slice (per the
city-count slider) — a city not currently shown on the globe shouldn't
silently bank pulses that all fire the instant it reappears. Concretely:
`usePopulationPulses` takes the current `visibleCityIds: Set<string>` as
an argument, and any city not in that set has its accumulators held at
their current value (not advanced, not reset) so progress isn't lost or
duplicated when cities are added back.

## Visual: expanding ring

A new `Pulse` component in `src/components/ui/cobe-globe.tsx`, sibling to
the existing `LabelPill`: an absolutely-positioned `<div>` anchored to its
marker's live projected screen position (via the same `projectMarker`
math already used for markers/labels, updated every `animate()` frame,
hidden via `visible` check when the marker faces away from the viewer —
identical occlusion handling to existing markers).

The ring itself is a CSS keyframe animation (not JS-driven, since unlike
label fade-in it doesn't need per-frame state — only its *position*
tracks the globe's rotation each frame, its scale/opacity animate once on
mount via CSS and the whole `Pulse` unmounts when the spawning hook's
`setTimeout` removes it from the pulses array): a circular border,
`scale` 0.2 → 1.6 and `opacity` 0.9 → 0 over 1.1s, `ease-out`. Border
color: the app's existing `--accent` red token for `kind === 'birth'`,
literal `#000000` (not the theme-adaptive `--foreground` token, since that
resolves to near-white in dark mode) for `kind === 'death'`.

`Globe` (`cobe-globe.tsx`) gains a new optional prop:
```ts
pulses?: { id: string; markerId: string; kind: 'birth' | 'death' }[]
```
rendered alongside the existing marker/arc label `.map()` blocks, each
`Pulse` looked up against `markers` by `markerId` to get its `location`.

`GlobeView.tsx` calls `usePopulationPulses(demographics, visibleCityIds)`
and passes the result through to `<Globe pulses={...} />`.

## Edge case: missing country data

If a city's `country` isn't present in the loaded `demographics` map (data
gaps happen — the World Bank feed excludes some entries), that city's rate
is simply `0` and it never pulses. No error, no fallback value.

## Out of scope for this pass

- No sound, no haptic, no counter/readout of cumulative births/deaths.
- No interaction (clicking a pulse does nothing).
- Arc/flight-route markers never pulse — only city markers, since only
  cities carry a `country` mapping.
- Color/timing values above are a reasonable first pass, not
  presented as final — easy to retune once visible live.
