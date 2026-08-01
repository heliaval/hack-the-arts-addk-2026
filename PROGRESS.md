# Progress Log

## 2026-07-31 10:01 — Project init + tooling setup

Started: Devpost "Hack the Arts" hackathon entry (deadline Aug 1 2026, 8:45pm PDT).
Concept: "Hourglass Earth" — an interactive 3D globe colored by live population
growth/decline data (World Bank API), where clicking a country transitions into
a 3D hourglass scene with physically-simulated glass beads flowing to represent
that country's births (top) vs. deaths (bottom) in real time.

Ran `init-claude.md`'s setup procedure for this project:
- Installed Node.js v22.14.0 + npm (portable/per-user, no admin — winget and MSI
  both failed for lack of admin rights on this machine) and uv 0.12.0.
- Installed skills: `shadcn`, `design-taste-frontend`, `impeccable` (installer
  only — see note below), `karpathy-guidelines` (global), plugins `claude-mem`
  and `superpowers` (via `claude plugin marketplace add` + `claude plugin
  install`, both showing `enabled` in `claude plugin list`).
- Installed and registered `graphify` (`uv tool install graphifyy` +
  `graphify claude install`); it wrote its own `## graphify` section into
  CLAUDE.md and a PreToolUse hook in `.claude/settings.json`.
- Declined the optional Neon Postgres + Neon Auth backend attach (project has
  no backend needs — pure client-side app).
- Wrote `CLAUDE.md` with the 8 standing-instruction sections (workflow,
  karpathy think-before-coding, claude-mem scope, design anti-AI-slop rule,
  shadcn-as-primitives rule, React/TS/Tailwind default, model tiering,
  progress-log requirement) around graphify's own section.

**Known follow-up**: `impeccable`'s own installer says to run `/impeccable
init` inside a Claude Code session to finish its setup — not done yet. Also,
skills installed mid-session (`shadcn`, `design-taste-frontend`, `impeccable`,
`karpathy-guidelines`) are NOT usable via the Skill tool in the session that
installed them — Claude Code only scans installed plugins/skills at session
startup. **A fresh `claude` session started in this directory is required
before those skills become invokable.**
Status: done.

## 2026-07-31 (continued) — Scaffolded app + globe view, checkpoint verified

Started: build the Vite/React/TS/Tailwind app and get a first working
checkpoint (app boots, globe renders with real country data, click resolves a
country's demographic rates) before building the hourglass scene.

What was built:
- Scaffolded Vite + React 19 + TypeScript into the project root (had to
  scaffold into a temp dir and `mv` in — `create-vite` cancels non-interactively
  when the target dir already has files, even with `--force`/`CI=true`).
- Installed and wired Tailwind v4 (`@tailwindcss/vite` plugin) + `@/*` path
  alias in `vite.config.ts`/`tsconfig*.json`.
- Ran `shadcn init -d` — created `components.json`, `src/components/ui/button.tsx`,
  `src/lib/utils.ts`. **Note**: shadcn's init pulled in its default neutral
  gray theme + Geist font into `src/index.css` — this is the exact "default
  shadcn look" CLAUDE.md's design rule says to avoid; it has NOT been
  overridden yet. Do this before final polish (this is what the color-scheme
  conversation with the user was about to lead into, via `impeccable`, when
  paused — see below).
- Removed Vite scaffold boilerplate (`App.css`, demo markup in `App.tsx`,
  `src/assets/*`).
- Data layer: `src/lib/worldbank.ts` — fetches World Bank API indicators
  (`SP.POP.TOTL`, `SP.POP.GROW`, `SP.DYN.CBRT.IN`, `SP.DYN.CDRT.IN`) for all
  real countries (filters aggregates via `incomeLevel.id !== 'NA'`), derives
  `birthsPerSecond`/`deathsPerSecond` per country. Cached via module-level
  promise. `src/lib/useDemographics.ts` is the React hook wrapper.
- Country boundaries: `src/lib/countryGeo.ts` fetches Natural Earth GeoJSON
  (177 countries, `ISO_A3` properties) from a jsdelivr GitHub CDN mirror of
  `vasturiano/globe.gl`'s example dataset — confirmed `ISO_A3` codes match
  World Bank's `countryiso3code` (e.g. `USA`, `AFG`).
- Globe view: `src/components/GlobeView.tsx` using `react-globe.gl`, colored
  by growth rate (red→green interpolation), tooltip showing population/growth,
  `onPolygonClick` resolves the clicked country's ISO3 and calls back to
  `App.tsx`, which currently just `console.log`s the selected country's data
  (this was the checkpoint's success criterion, not final UI).
- **Bug found and fixed**: react-globe.gl's internal wrapper `<div>` has no
  explicit height, so the canvas rendered at 0×0 inside our flex/h-full
  layout. Fixed by measuring the container synchronously in a
  `useLayoutEffect` (`getBoundingClientRect`, with `ResizeObserver` + window
  `resize` listener as live-update fallback) and passing explicit
  `width`/`height` props to `<Globe>`. Confirmed canvas now renders at the
  correct pixel size after the fix.

Verification done: dev server boots clean (`npm run dev`, port 5173), no
console errors, World Bank API and the GeoJSON CDN both confirmed reachable
and returning matching ISO3 codes via direct `fetch()` checks in the running
page. Canvas size confirmed correct post-fix (1000×562 for an 800×450 CSS
container, i.e. devicePixelRatio-scaled).

**Not fully verified**: couldn't visually click-test the globe interaction in
this session — the browser preview pane wasn't composited/visible on the
user's end during this session, so screenshots and simulated pointer events on
the WebGL canvas didn't register (raycasting likely depends on a render loop
that's throttled for a non-visible/non-composited tab). The `onPolygonClick`
wiring follows react-globe.gl's documented API exactly. **Next session should
open http://localhost:5173 (run `npm run dev` first) and manually click a
country to confirm the tooltip and selection callback fire correctly.**

Status: checkpoint done, user confirmed "it's good."

## 2026-07-31 (continued) — Paused: globe swap + color scheme, handed off

User asked to replace `react-globe.gl` with a different globe implementation:
a `cobe` (WebGL globe library) based component the user pasted in full,
`Globe` from `@/components/ui/cobe-globe.tsx`, using markers/arcs rather than
country polygons. **This has NOT been implemented yet** — no files for it
exist. Needs, when picked back up:
- `npm install cobe`
- Create `src/components/ui/cobe-globe.tsx` with the pasted component code
  as-is (it's already written to spec by the user, `"use client"` directive
  can be stripped since this is a plain Vite SPA, not Next.js).
- Decide how the existing demographics data maps onto `cobe`'s marker/arc
  model, since `cobe` doesn't do country polygons/choropleth like
  `react-globe.gl` did — the growth-rate color-per-country approach in the
  current `GlobeView.tsx` won't port directly. This needs a design decision:
  e.g. markers sized/colored by population or growth rate, or arcs are
  probably not the right fit for a population-only visualization (arcs read
  as "flows between two points," which doesn't map to "one country's growth
  rate"). **Whoever picks this up should raise this mismatch with the user
  before wiring click-to-select onto it.**
- `react-globe.gl` and its country-polygon click-selection logic in
  `src/components/GlobeView.tsx` — keep or remove depending on the user's
  answer once they're back; don't delete it preemptively since it's a working
  verified checkpoint.

Also paused: user wants a deliberate color scheme via the `impeccable` skill
before continuing visual work (explicitly wants to avoid the default-shadcn
gray/Geist look already sitting in `src/index.css` from the `shadcn init`
step above). **Blocked on**: `impeccable` was installed mid-session, so it's
not invokable via the Skill tool in the session that installed it. User was
given instructions to start a fresh `claude` session in this directory
(`cd "C:\Users\Alber\CN4\hack-the-arts-addk-2026" && claude`) and run
`/impeccable init` once, after which the skill will be usable both for the
color-scheme decision and for the general "avoid AI-slop" design pass
CLAUDE.md requires before shipping.

Three palette directions were proposed to the user as a starting point (not
yet chosen): (1) warm sand/amber glass — ties directly to the literal
"glass beads" concept; (2) cold obsidian/bioluminescence — cooler, more
sci-fi; (3) dual-tone — cool globe view, warm hourglass view, deliberate
contrast between "the world" and "the human story inside it." No decision
made yet.

Dev server: was running in the background on port 5173 during this session
(`npm run dev`) — likely no longer running once this session ends; start it
fresh with `npm run dev` from the project root.

Status: paused/handed off, no code changes in this entry beyond this log.
Outstanding for next session, in order: (1) start fresh `claude` session here
to unlock the installed skills, (2) run `/impeccable init`, (3) resolve the
color scheme with the user, (4) decide the cobe marker/arc data mapping with
the user, (5) implement the cobe globe swap, (6) do the shadcn-default
override pass on `src/index.css` (currently untouched default gray/Geist
theme), (7) resume the hourglass (Rapier + glass bead physics) scene, which
was the next planned phase and has not been started at all yet.

## 2026-07-31 (continued) — Color scheme resolved + shadcn default override

Started: resume the handoff. Fresh session confirmed the four previously
locked skills (`shadcn`, `design-taste-frontend`, `impeccable`,
`karpathy-guidelines`) are now usable.

**Environment note**: Node/npm (`AppData\Local\nodejs`) is in the user's
persisted PATH env var, but this session's shell processes did not inherit
it (likely captured before that PATH change took effect) — every `node`/`npm`
call this session needed `export PATH="/c/Users/Alber/AppData/Local/nodejs:$PATH"`
prefixed in Bash, or an explicit `$env:Path` rebuild in PowerShell. If a
future session hits "node: command not found", this is why — try a genuinely
fresh terminal first; if it persists, use the same explicit-PATH workaround.

User confirmed via question: cobe globe swap is still wanted but deferred —
color scheme first. Priority for this session: color scheme + shadcn theme
override before the cobe swap or hourglass scene.

Ran `impeccable init` (no PRODUCT.md existed): wrote `PRODUCT.md` after one
clarifying round (audience = Devpost hackathon judges, evaluated mainly via
a demo video, not live interaction — this shapes "must read clearly in a
single video watch" as a real constraint, not just live-UX polish).

Ran `impeccable` new-work flow for the color scheme (Experience mode):
- Asked what carries the emotional weight of the globe→hourglass transition
  — user said **the bead physics**, not the transition itself.
- Asked for a visual anchor — user said "very simple hourglass, but visually
  impressive, minimal, glass beads" (a soft pin, not a hard reference).
- Ran the required `concept-seed.mjs --scope direction --mode experience`
  dice roll (seed `909ae7cd`) to avoid picking the model's default rut.
  Built 7 grounded directions from the product's own world (civic/scientific
  measuring instruments, print/ledger traditions, agricultural/industrial,
  architectural) organized by resonance; the assigned index (3) landed on
  **tide gauge / harbor flow-station** — population data read as an
  instrument reading, not a dashboard card.
- Weighed the 3 strongest catalog challengers (oscilloscope signal bench,
  bioluminescent night-sea wake, curved-crease paper shell) against it.
  Notably, the two most "impressive-sounding" challengers (oscilloscope,
  bioluminescent) both land in the exact near-black+neon-accent AI-slop
  pattern the `impeccable` skill explicitly calls out — this is why the
  tide-gauge direction won over flashier-sounding alternatives, not despite
  them.
- Presented all four (assigned + 2 strongest challengers + the standing
  "play it safe" category-default exit) to the user via `AskUserQuestion`.
  **User's answer**: liked the tide-gauge direction but specified green +
  orange (not exactly teal+amber), light **and** dark mode support, and
  capped it at 2-3 colors max (a Committed color strategy, not Full palette).

Implemented:
- `src/index.css` — full token rewrite: institutional marine green (primary/
  structure) + warm amber-orange (accent — the "reading," reused later for
  hourglass sand/glow), warm-tinted cream ground (light) / ink-black-green
  ground (dark), OKLCH throughout, `--radius` tightened `0.625rem → 0.3rem`
  (instrument-plate feel over shadcn's default soft-card look). Direction
  contract recorded as the file's opening comment per `impeccable` process.
- Installed `@fontsource-variable/geist-mono`; added `--font-mono` for
  numeric/data readouts (instrument-readout register), keeping the existing
  `Geist Variable` body face as-is (already a fine workhorse choice, not
  replaced).
- `src/lib/useTheme.ts` (new): light/dark toggle hook — `localStorage` +
  `prefers-color-scheme` fallback.
- `src/App.tsx`: added the theme toggle button (shadcn `Button`, top-right),
  restyled the selected-country panel from hardcoded white/red text to
  theme tokens, relabeled it "reading" to match the instrument metaphor.
- Ran `impeccable`'s slop detector (`detect.mjs`) on the changed files — it
  correctly flagged a side-tab colored-left-border accent on the reading
  panel (a named AI-slop pattern) on the first pass; fixed by swapping it
  for a small accent dot next to the label. Clean on re-run.
- Wrote `DESIGN.md` documenting the direction, tokens, and one deferred item
  (see below) — done directly rather than via the skill's subagent
  documenter/finish-reviewer pipeline, given this environment's time
  constraints; disclosing that substitution here per the skill's own rule.

**Also fixed, unrelated but blocking**: `npm run build` was failing outright
on a pre-existing `tsconfig.app.json` issue (`baseUrl` deprecated, TS5101)
that predates this session's changes — added
`"ignoreDeprecations": "6.0"` to unblock production builds ahead of
submission. Build now succeeds (`tsc -b && vite build`); one expected
"chunk larger than 500kB" warning from three.js/globe deps, not an error.

**Deferred, on purpose**: `src/components/GlobeView.tsx`'s red→green
choropleth gradient (`growthColor()`) was left untouched — it's tied to
`react-globe.gl`, which is getting swapped for `cobe` next, so re-theming it
now would be throwaway work. Re-theme it in the amber/green palette as part
of that swap.

**Not verified visually**: same limitation as the previous session — the
browser preview pane did not composite frames, so no screenshot was
possible. Verified instead via: production build succeeds, `oxlint` clean
on project source (pre-existing warnings only in `.claude/`/`.agents/` skill
scaffolding, not app code), `impeccable` detector clean on changed files,
and direct computed-style checks in the live page confirming both light and
dark token sets resolve correctly and the theme toggle renders. **Next
session (or the user, live) should do a quick visual pass** — `npm run dev`
and eyeball both themes — before recording the submission demo video.

Status: done (color scheme + shadcn override). Outstanding next, in order:
(1) quick human visual QA of the new theme in both light/dark, (2) decide +
implement the `cobe` globe swap (marker/arc data mapping still needs a
decision — deferred earlier in this session, not resolved), re-theming
`GlobeView`'s choropleth colors as part of that work, (3) hourglass
(Rapier + glass bead physics) scene — still 0% started, still the largest
remaining chunk of work before the Aug 1 8:45pm PDT deadline.

## 2026-07-31 (continued) — cobe globe swap implemented

Started: user said "implement this globe" and pasted the full `cobe`-based
`Globe` component (from a shadcn-style component-integration prompt), asked
to implement it. When asked how per-country population/growth data should
map onto cobe's marker/arc model (the open question flagged twice before),
user said: **implement as-is for now, I'll adjust**.

Implemented:
- `npm install cobe`, `npm uninstall react-globe.gl` (decision is now final,
  no reason to keep the old dependency around — this also dropped the
  bundle from ~2.1MB to ~251KB minified per `npm run build`).
- `src/components/ui/cobe-globe.tsx` (new): the pasted `Globe` component,
  adapted — dropped `"use client"` (Vite SPA, not Next.js), dropped the
  unused `useState` import (would've failed the project's
  `noUnusedLocals` build setting), removed the marker/arc label tooltip
  overlays (they referenced `--cobe-visible-*` CSS custom properties that
  nothing in the original snippet ever set, so they were always-invisible
  dead code as pasted — cut rather than silently shipped broken).
  **One real fix, not just a paste**: the original snippet's `Marker`
  interface had no `size` field, so every marker was forced to the same
  global `markerSize` — added an optional per-marker `size` (cobe's
  underlying library already supports per-marker size) since uniform-size
  markers would defeat the entire point of a population map.
- `src/lib/countryGeo.ts`: added `featureCentroid()` — a rough
  vertex-average centroid per country polygon (not a true geographic
  centroid, good enough for marker placement) since neither existing data
  source had lat/lon.
- `src/components/GlobeView.tsx`: rewritten around `cobe-globe.tsx`. One
  marker per country with real demographics: size = population (sqrt
  scale, so marker *area* ~ population), single accent-orange marker color
  matching the tide-gauge palette. Globe surface/glow colors and `dark`
  flag are wired to `useTheme()` so the globe itself responds to the
  light/dark toggle, not just the surrounding UI.

**Known gap, called out explicitly rather than silently dropped**: the
pasted `cobe` component has no marker click/hit-testing at all — only
drag-to-rotate. `onSelectCountry` is still a prop on `GlobeView` (App.tsx
is unchanged) but it's not wired to anything yet; there is currently no way
to click a country. This breaks the demo's core "click a country →
hourglass" flow once the hourglass scene exists. Since the hourglass scene
doesn't exist yet either, this isn't blocking anything *today*, but it
needs a real decision before the two scenes get connected — likely either
raycasting against marker positions manually, or a from-scratch
click-detection layer, since `cobe` doesn't expose one.

Verification: `npm run build` succeeds (bundle size dropped as noted),
`oxlint` clean on `src/` (one pre-existing unrelated warning on
`button.tsx`), `impeccable`'s slop detector clean on all new/changed files.
Visually confirmed in a fresh browser tab (had to restart the dev server —
an earlier tab accumulated stale Vite HMR errors from iterating on this
file live, unrelated to the final code): canvas renders at full size and
opacity, theme toggle still works, globe colors follow light/dark.

Status: done (cobe swap implemented, matches "as-is for now"). Outstanding
next, in order: (1) decide click-to-select approach for markers (blocks
wiring the globe to the hourglass scene), (2) hourglass (Rapier + glass
bead physics) scene — still 0% started, the largest remaining chunk of
work before the Aug 1 8:45pm PDT deadline.

## 2026-07-31 (continued) — Globe polish marathon: labels, i18n, theming bugs

Started: catch-up entry. **This whole stretch of work was not logged as it
happened** — the previous entry above is the last one written; everything
below covers one long live-iteration session with the user on the cobe
globe, done in small back-and-forth steps without a PROGRESS.md update
between them. Writing it up now in full, and going forward each
significant change gets logged as it happens rather than in a batch at the
end. Also not run until the very end of this stretch: `graphify update .`
(see below) — CLAUDE.md's own instruction to keep the graph current was
missed for this entire session; caught and fixed only when explicitly
asked.

**Marker/label system replaced twice.** First pass wired real per-country
markers (population-sized dots, top-15 pool, rotating window of 10 shown
at a time with labels). The rotation looked "obviously loopy" to the user
(deterministic 0/5/10 window cycling every 6s) and country pills were
dropped as unnecessary "for now" — country dots are gone entirely now,
replaced by the reference demo's fixed 9-city set (San Francisco, New
York, Tokyo, London, Sydney, Cape Town, Dubai, Paris, São Paulo) with 2
demo arcs (SF→Tokyo, NYC→London), chosen because that's what the original
pasted component was tuned around and it reads cleanly without crowding.
Real per-country demographic markers are **not currently on the globe at
all** — `demographics`/`onSelectCountry` props on `GlobeView` are `void`ed
with a comment pointing here. This needs a real decision before the globe
can drive country selection again.

**Real bug found and fixed: cobe's built-in label system doesn't work.**
cobe (the library) ships its own CSS Anchor Positioning-based mechanism for
marker labels — it creates invisible anchor `<div>`s and toggles a
`--cobe-visible-{id}` custom property via a `<style>` tag it rewrites every
animation frame. The "make opacity resolve via an intentionally-invalid
custom property value" trick it relies on works in isolation (verified with
a standalone test), but because cobe rewrites the *entire* stylesheet's
`textContent` every single frame, the browser treats it as a brand new
rule each time and the CSS opacity transition never gets an uninterrupted
window to complete — labels computed permanently stuck at opacity 0 even
when cobe's own visibility flag said "show this one." Root-caused via
direct `getComputedStyle`/`--cobe-visible-*` inspection in a live tab.
Fixed by throwing out cobe's label system entirely and re-deriving its
marker/arc projection math by hand from `node_modules/cobe/dist/index.esm.js`
(functions `U`/`O`/`W`/`X`) into `projectMarker`/`projectArcMidpoint` in
`src/components/ui/cobe-globe.tsx`, driving each label `<div>`'s
`left`/`top`/`opacity` imperatively from the same animation loop that
drives the WebGL render — no CSS custom properties involved.

**Real bug found and fixed: globe rotation reset on every prop change.**
The original pasted cobe component tore down and recreated the whole globe
(`createGlobe()`, `phi` reset to 0) inside a `useEffect` keyed on
`markers`/`arcs`/colors/etc. Any theme or language toggle reset the
rotation to the start. Fixed by refactoring so the mount effect only runs
once (deps trimmed to `[speed, theta, diffuse, mapSamples]`, none of which
this app ever changes), and reading live `markers`/`arcs`/colors from a
`liveProps` ref inside the animation loop's `globe.update()` call instead —
rotation state (`phi`, drag offsets) now lives entirely outside the
prop-driven render cycle.

**Real bug found and fixed: GPU buffers re-uploaded every frame for no
reason.** `globe.update()` rebuilds the marker/arc WebGL buffers whenever
those keys are present in its payload, even with identical data — the
loop was passing freshly `.map()`'d marker/arc arrays 60×/sec regardless
of whether anything changed. Fixed with a `lastMarkers`/`lastArcs`
reference-equality check so the buffers are only rebuilt when the actual
data reference changes (in practice: once, plus rare language toggles).
Verified this is real hardware acceleration first (not the cause of
reported lag being a software renderer) — checked
`WEBGL_debug_renderer_info` directly in a live tab:
`ANGLE (Intel, Intel(R) UHD Graphics ..., D3D11)`, genuine GPU path.
Also tried lowering `mapSamples` (16000 → 9000) as a second perf lever;
user said the globe looked "significantly worse," reverted that one
specific change back to the default. The buffer-upload fix stayed (pure
perf, zero visual difference).

**Real bug found and fixed: theme state was two disconnected copies.**
`useTheme()` (`src/lib/useTheme.ts`) is a plain hook with its own
`useState` — it was called independently in both `App.tsx` (for the
toggle button) and `GlobeView.tsx` (for globe colors), giving two
unrelated React state instances. Clicking the toggle updated the page
correctly (it flips a class on `<html>`, which CSS reacts to globally)
but `GlobeView`'s own separate `theme` value never learned about the
change, leaving the globe's colors stuck on whatever theme was active at
its *own* mount time — independent of what the visible page was doing.
This is what produced a "muddy" mismatched-looking globe the user flagged.
Fixed by lifting `theme`/`toggleTheme` to `App.tsx` as the single source
and passing `theme` down to `GlobeView` as a prop (matching how `lang` was
already threaded through). **Then simplified further**: asked the user
directly whether the globe sphere itself should track light/dark at all,
since the original reference demo never had a dark mode — answer was "just
make it white as it was before." `GlobeView` no longer takes a `theme`
prop at all; the globe always uses one fixed `GLOBE_COLORS` constant
(white sphere, dark-red dots, light-red arcs), and only the page chrome
(background, pills, toggles) still follows light/dark.

**Two more real color bugs along the way, both self-inflicted while
trying to make the (now-removed) dark-mode globe match the page:**
1. Tried to read the app's exact `--background` value via
   `getComputedStyle(el).color` to eliminate a visible seam at the globe's
   edge. On this browser engine, that returns the *literal string*
   `"oklch(0.16 0 0)"` for an oklch-defined color, not a normalized
   `rgb(...)` — a regex meant to parse `rgb()` output instead extracted
   the raw OKLCH channel numbers and divided by 255, producing a bogus
   near-black reading that was then applied as the dark-mode base color.
   Re-diagnosed correctly using `<canvas>` `fillStyle` +
   `getImageData` (which does perform real color-space conversion):
   `oklch(0.16 0 0)` is actually `rgb(13, 13, 13)`.
2. Even after that fix, dark mode showed a bright white ring around the
   globe. Cause: `glowColor` was set at `createGlobe()` init time but
   accidentally left out of the per-frame `update()` payload during the
   rotation-preserving refactor above — it froze at whatever it was on
   first mount (often light mode's near-white) and never updated again on
   theme change. Fixed by adding it to the recurring update payload.
   (Moot now that the globe is always-white, but the underlying "every
   themeable prop must be in the per-frame update payload, not just
   init" lesson stays relevant if the globe ever needs live-updating
   colors again.)

**Visual/UX changes, roughly chronological:**
- Palette went through three full passes this session: pine-green accent
  (`#3f6659`/`#345349`), then a wine/rose palette
  (`#912f40`/`#702632` light, `#c17b8a`/`#d99aa6` dark) the user liked
  better and asked to keep, then a final "completely remove green"
  pass that converted every remaining green-hued structural token
  (foreground, primary, borders, chart colors, sidebar — anything still
  at OKLCH hue ~150/155/130) to neutral black/white/gray, leaving red as
  the only chromatic color in the whole app. `src/index.css`'s opening
  direction-contract comment was updated to note it's superseded by this
  direct user color direction rather than the original `impeccable`
  brainstorm output.
- Label pills went through several recolors (accent-tinted →
  crimson-on-white → theme-token-driven → finally plain
  `bg-foreground`/`text-background`, which auto-inverts light/dark and is
  what's live now) before landing on "keep the pills black/white,
  completely remove green" as an explicit instruction.
- Marker/arc colors: green → light-red dots/dark-red arcs → swapped to
  dark-red dots/light-red arcs per explicit request (current).
- Marker size: population-scaled → uniform (`0.025`) fixed size, per
  explicit request once real per-country markers were dropped.
- Halo/glow ring around the sphere killed by setting `glowColor` equal to
  `baseColor` (still true now that both are the fixed white).
- Added a soft-edged near-white backdrop plate behind the globe at one
  point, then removed it once the whole page background itself became
  the matching near-white tone (redundant).
- Label pill fade timing slowed from 0.4s to 1.4s per request, and later
  the *swap* transition (not just fade) got smoother by adding
  `animatePresenceMode="popLayout"` to the `TextRotate` instance inside
  each pill — in the default `"wait"` mode the pill only resized *after*
  the old text finished exiting; `"popLayout"` pulls exiting text out of
  layout flow immediately so the pill's own `layout` animation can resize
  smoothly in step with the character swap.

**New: cube-flip header toggles.** Added `src/components/ui/cube-flip-toggle.tsx`,
a reusable primitive implementing the user's own detailed cube-turn spec
(two faces joined at a shared edge via `translateZ` = half the button
height, `perspective` on the outer button, front face previews the state a
click switches TO, back face revealed on hover shows the current state).
Sized down from the user's 92×30px spec to 74×28px to match this project's
compact instrument-panel type scale. Two instances wired in `App.tsx`:
`ThemeToggle` (fully functional) and `LanguageToggle` (now fully
functional too, see below — was initially a visual-only placeholder per
explicit instruction, then wired up). Kept the user's specified overshoot
easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`) even though `impeccable`'s
slop detector flags bounce/elastic easing as a pattern to avoid by
default — it's the user's explicit spec with stated rationale, not a
default choice, so the detector finding was noted and left as-is rather
than silently overridden.

**New: i18n for the globe's city/arc labels.** Installed `motion`
(framer-motion's successor package) and added `src/components/ui/text-rotate.tsx`
(a pasted community component, adapted: dropped `"use client"`, fixed a
literal-newline-inside-a-string-literal bug in the original snippet's
`splitBy === "lines"` branch, split type-only imports for this project's
`verbatimModuleSyntax` tsconfig setting). Each marker/arc label now carries
one string per supported language (index-aligned with `LANGUAGES` in the
new `src/lib/lang.ts`), and `TextRotate`'s imperative `jumpTo()` ref API
animates between them character-by-character when the language toggle
changes `activeLabelIndex`. Language list grew twice in direct response to
requests: en/zh → +ja/fr/es → +ko/pt, landing on the final order
`en, zh, ja, ko, fr, es, pt` (7 languages, cycling on each toggle click,
not a binary flip). All 9 cities have all 7 translations; verified by the
fact that `LANGUAGES.map((l) => city[l])` type-checks (a missing key on
any city would fail the build).

**Verification for this whole stretch:** `npm run build`, `oxlint`, and
`impeccable`'s `detect.mjs` slop scanner were run after every change
described above (not just at the end) — all clean at time of writing,
aside from the pre-existing unrelated `button.tsx` fast-refresh warning
and the one disclosed/kept bounce-easing finding. Visual verification was
mostly done live with the user in their own browser (this environment's
browser pane frequently doesn't composite frames for screenshots, a
limitation noted since the very first session) — several of the bugs
above were only caught because the user reported what they were actually
seeing and pushed back when something looked wrong, not from automated
checks alone.

Status: done for this stretch. Outstanding, in order: (1) click-to-select
on globe markers is still completely unresolved — no country markers are
even on the globe right now, this needs a fresh design decision, (2)
hourglass (Rapier + glass bead physics) scene — still 0% started, the
single largest remaining chunk of work before the Aug 1 8:45pm PDT
deadline, (3) keep PROGRESS.md updated as work happens from here, not in
a batch.

## 2026-07-31 (continued) — graphify + git repo setup

Started: user asked to (a) get a detailed PROGRESS.md update — done above,
with an explicit admission that it had lagged the whole previous stretch,
(b) confirm graphify is actually being used per CLAUDE.md's instruction,
(c) initialize and push to a GitHub remote at
`https://github.com/heliaval/hack-the-arts-addk-2026.git`.

**graphify**: had never been run this session despite CLAUDE.md requiring
it — `graphify-out/` didn't exist. Ran `graphify update .`; first pass
indexed 6966 nodes because it picked up the installed `.agents/` and
`.claude/skills/` tooling directories (large vendored/minified scripts
like `impeccable`'s `live-browser.js`) as if they were project source,
which drowned out the actual app in the community-hub listing. Added
`.graphifyignore` (`node_modules`, `.agents`, `.claude/skills`, `dist`,
`graphify-out`) and re-ran with `--force`: 259 nodes, 292 edges, 17
communities, 29 files — correctly scoped to this app's actual source now.
`graphify-out/` itself is gitignored (regenerable via `graphify update .`,
not committed).

**git/GitHub**: project was not a git repo at all until now (confirmed via
`git status` at session start — no `.git`). Ran `git init`, renamed the
default branch to `main`, added `graphify-out` to `.gitignore` (generated
artifact), scanned for stray `.env`/credential files before staging
(none found), `git add -A`, and committed 359 files as the initial commit.
Added `origin` pointing at
`https://github.com/heliaval/hack-the-arts-addk-2026.git`, confirmed via
`git ls-remote` that it was empty and reachable before pushing (no risk of
clobbering existing history), then `git push -u origin main`. Pushed
clean, `main` now tracks `origin/main`.

One judgment call made without asking first, flagged here for the user to
override if unwanted: `.claude/` and `.agents/` (the installed Claude
Code / Codex skill tooling, ~3.2MB and ~3.5MB respectively) were
committed as-is rather than excluded — they're not huge and excluding
them felt like a bigger call to make unilaterally than including them.
Worth revisiting if the user wants a leaner public repo for the hackathon
submission.

Status: done. All three asks from this task complete: PROGRESS.md caught
up (this entry + the one above it), graphify verified working and
correctly scoped, GitHub repo initialized and pushed. Outstanding product
work is unchanged from the previous entry: click-to-select on globe
markers unresolved, hourglass scene still 0% started — deadline is
2026-08-01 8:45pm PDT.

## 2026-07-31 (continued) — Language toggle hover tooltip

Started: user asked for a small hover subtitle under the language toggle
listing available languages and how to cycle them, with a fade in/out
transition, in grey.

Implemented in `src/App.tsx`'s `LanguageToggle`: wrapped the existing
`CubeFlipToggle` button in a `group/flip relative` div, added an
`aria-hidden`, `pointer-events-none` absolute-positioned `<span>` that
fades in/out (`opacity-0` -> `group-hover/flip:opacity-100`,
`duration-300`) on hover. Iterated twice per user feedback:
- First pass: centered below the button, `text-muted-foreground/60` at
  `text-[0.5rem]`.
- Second pass: moved to bottom-right (`right-0` instead of centered),
  bumped to `text-[0.55rem]`, and the currently-active language's glyph
  is now rendered in `text-accent` (the app's one wine-red chromatic
  token, `#912f40` light / `#c17b8a` dark) while the rest stay muted grey
  — highlights the current selection within the "EN · ZH · JA · KO · FR ·
  ES · PT · click to cycle" list. Requires importing `LANGUAGES` from
  `src/lib/lang.ts` (previously only `LANG_GLYPH`/`nextLang` were used).

Verification: `npm run build` clean after both passes, `graphify update .`
run after. **Not visually screenshotted** — same recurring limitation
noted throughout this project (browser preview pane doesn't composite
frames in this environment); user should eyeball the hover state in
`npm run dev` before the demo.

User also instructed: auto-commit changes going forward without asking
first, for the remainder of this project.

Status: done.

## 2026-07-31 (continued) — Language hint repositioned + push

Started: user clarified "bottom right" meant the whole web app's corner,
not just below the toggle button, and asked to also push commits (not
just commit locally) going forward without asking.

Reworked `src/App.tsx`: the hint text can no longer live nested inside
`LanguageToggle` since it now renders at the app root's `bottom-4 right-4`
corner, physically far from the toggle button. Lifted hover state up —
`LanguageToggle` takes an `onHoverChange` prop (plain
`onMouseEnter`/`onMouseLeave`, replacing the CSS-only `group/flip` hover
trick used before) — and split the hint into its own `LanguageHint`
component rendered as a sibling of the toggle row, controlled by
`langHintVisible` state in `App`. Fade transition, muted-grey text, and
the accent-red current-language highlight are unchanged from the previous
entry; bumped hint text to `0.6rem` per "slightly bigger" from that
entry (was `0.55rem`).

Verification: `npm run build` clean.

Status: done. Committed and pushed to `origin/main`.

## 2026-07-31 (continued) — Language hint size bump

User said the hint was still too small to read. Bumped `LanguageHint`
from `text-[0.6rem]` to `text-xs` (0.75rem) in `src/App.tsx`. Build
clean. Committed and pushed.

## 2026-07-31 (continued) — Bottom-left control panel: city count + rotation speed sliders

User pasted a shadcn-style component-integration prompt for a NumberFlow
+ Radix slider (`@number-flow/react`, `@radix-ui/react-slider`) and asked
for two sliders bottom-left: number of cities shown, and globe rotation
speed in km/s. Both: min = current value, max = "something reasonable" —
delegated to my judgment.

Installed `@radix-ui/react-slider` + `@number-flow/react` (`clsx` was
already a dependency). Judgment calls made, flagged here per the
delegated scope:
- **Cities max = 20.** `src/components/GlobeView.tsx`'s `CITIES` array
  (previously fixed at 9) got 11 more entries (Moscow, Beijing, Delhi,
  Cairo, Lagos, Mexico City, Toronto, Singapore, Seoul, Mumbai, Istanbul)
  with full 7-language labels matching the existing set's shape. Appended
  after the original 9 (not interspersed) so the slider's minimum
  position renders pixel-identical to before. `MIN_CITY_COUNT`/
  `MAX_CITY_COUNT` exported from the module. The two hardcoded demo arcs
  (SF→Tokyo, NYC→London) stay pinned to `CITIES[0..3]`, always present
  since the count never drops below 9.
- **Rotation speed unit = km/s via v = ω·r.** cobe's `speed` prop is an
  opaque radians-per-frame constant, not a real unit. Rather than expose
  that directly, `src/lib/globeSpeed.ts` treats it as the equatorial
  surface velocity implied by the spin rate (Earth's real 6371km radius,
  assumed 60fps) — turns the default `speed=0.003` into a computed
  instrument reading of ~1147 km/s (not literal — the visual spin is
  already far faster than real life — but keeps with the app's
  tide-gauge/instrument-reading design language rather than an arbitrary
  slider number). Min = that computed default, max = 6× it (~6882 km/s)
  for a dramatic-but-still-legible fast spin.

**Real bug caught before shipping**: `cobe-globe.tsx`'s `speed` prop was
still a `useEffect` dependency (`[speed, theta, diffuse, mapSamples]`) —
the exact "prop change tears down and recreates the globe, resetting
rotation to phi=0" bug already fixed for markers/arcs/colors/theme in an
earlier session (see the "Globe polish marathon" entry above), just never
triggered before because nothing live-changed `speed` until now. Fixed by
moving `speed` into the existing `liveProps` ref pattern (read live each
animation frame via `liveProps.current.speed` instead of the effect's
closure) and dropping it from the dependency array. Verified live in a
running dev server: dragged both sliders through their full range via
keyboard (Radix slider Home/End/ArrowRight), single stable `<canvas>`
throughout, no reinit/rotation-jump, no console errors.

New `Slider` component (`src/components/ui/slider-number-flow.tsx`) is
the pasted reference restyled off this app's own tokens (`--accent`,
`--card`, `font-mono`) instead of the original's hardcoded zinc/black —
per the project's anti-AI-slop design rule. Dropped the pasted
`continuous` prop on `NumberFlow`; not present in the installed
`@number-flow/react` version, caused a build error. New `ControlPanel`
component in `src/App.tsx` mirrors the existing top-left "reading"
panel's card/border/uppercase-label instrument styling, placed
bottom-left.

**Also fixed in passing**: created `.claude/launch.json` so this
project's dev server can be launched via the Browser pane's
`preview_start` tool going forward (didn't exist before this session;
had to fall back to manually backgrounding `npm run dev` this time after
`preview_start` couldn't resolve `npm`/`node` in its own spawn
environment — the launch.json is still worth having for future sessions
where that resolves cleanly).

Verification: `npm run build` clean, `oxlint src` clean (only the
pre-existing unrelated `button.tsx` warning), live-browser slider
interaction verified as described above (screenshots still not possible
in this environment — same recurring composited-frame limitation — but
DOM/ARIA state, console, and network were all checked directly).

Status: done. Committed and pushed.

## 2026-07-31 (continued) — Control panel redesign: inline rows, no container box

User feedback on the control panel from a screenshot: the floating
NumberFlow readout above each thumb collided with the row/label below it
(panel was too cramped, especially with the value positioned above the
thumb per an earlier iteration in this same session), the panel clipped
against the viewport bottom, and the boxed card container wasn't wanted
for this element specifically (unlike the top-left "reading" panel, which
keeps its card style). Also asked for: "ROTATION (KM/S)" as the label
text, dot+label inline with the slider (not stacked above it), a smoother
slider, and the live number moved to the end of the row instead of
floating over the thumb.

Reworked both files:
- `src/components/ui/slider-number-flow.tsx`: dropped the built-in
  absolutely-positioned `NumberFlow` overlay entirely (root cause of the
  clipping/overlap — it had no reliable safe area regardless of panel
  width or padding, since Radix's thumb positioning percentage is
  computed against the Root's own padding-box, which made earlier `px-*`
  padding attempts on the Root a dead end). Added
  `transition-[width]`/`transition-[left]` to the Range/Thumb for a
  smoother visual response to value changes.
- `src/App.tsx`'s `ControlPanel`: each control is now a single flex row
  — accent dot + uppercase label + `Slider` (flex-1) + a trailing
  `NumberFlow` (imported directly here now) right-aligned at the row's
  end. Removed the card/border/bg/shadow/backdrop-blur container
  entirely per "I don't really like placing it in a container" — panel
  is now bare, positioned `absolute bottom-4 left-4`. Rotation's label
  changed to "rotation (km/s)"; the `unit` prop on `Slider` was dropped
  since the unit now lives in the label instead of a trailing suffix on
  the number.

Verified live in the dev server: panel bottom now sits at 704px in a
720px-tall viewport (16px clear margin, no clipping), both rows'
dot/label/slider/number confirmed inline via DOM `getBoundingClientRect`
checks, dragging the cities slider to its max (`aria-valuenow` 9→20) and
back confirmed working with no console errors. (One transient "error
occurred in ControlPanel" console warning was observed mid-session during
an intermediate HMR save — did not reproduce on a fresh page load or
after the final save, treated as a stale hot-reload artifact rather than
a real bug.) Build and `oxlint src` both clean.

Status: done. Committed and pushed.

## 2026-07-31 (continued) — Same hover hint for theme toggle

User asked for the same treatment on the theme (light/dark) toggle. Added
`ThemeHint` in `src/App.tsx`, same pattern as `LanguageHint` — bottom-4
right-4 corner, fade in/out, `text-xs`/`text-muted-foreground/60`, active
mode in `text-accent` — text reads "light · dark · click to toggle" with
whichever mode is current highlighted. `ThemeToggle` now takes an
`onHoverChange` prop (mirroring `LanguageToggle`) wired to a new
`themeHintVisible` state in `App`. Both hints share the same corner but
never show simultaneously since only one button can be hovered at a
time. Build clean. Committed and pushed.

## 2026-07-31 (continued) — Hint color in dark mode

User asked for the grey hint text to become white/off-white specifically
in dark mode (dark mode's `--muted-foreground` is a mid-grey
`oklch(0.65 0 0)`, not white). Added `dark:text-foreground/70` to both
`LanguageHint` and `ThemeHint` in `src/App.tsx` — light mode keeps
`text-muted-foreground/60`, dark mode overrides to the near-white
`--foreground` token (`oklch(0.95 0 0)`) at 70% opacity. Build clean.
Committed and pushed.

## 2026-07-31 (continued) — Continuous sliders + 4 arc routes

User asked for two things: (1) sliders shouldn't "lock" to discrete
positions while dragging — the displayed number should just round to
nearest wherever the thumb sits; (2) grow the demo arcs from 2 to 4,
specifically suggesting Dubai→Sydney and Cape Town→São Paulo.

`src/components/GlobeView.tsx`: `ARC_ROUTES` now has 4 entries — the
original SF→Tokyo/NYC→London plus the two suggested (`CITIES[6]→CITIES[4]`
for Dubai→Sydney, `CITIES[5]→CITIES[8]` for Cape Town→São Paulo), giving
good spread across the Pacific, Atlantic, Indian Ocean, and South
Atlantic. All indices ≤8, safe since the city-count slider's minimum
never drops below 9.

`src/App.tsx`: `cityCount`/`rotationSpeedKmS` state split into raw float
state (`cityCountRaw`, `rotationSpeedRaw`, slider `step={0.01}`) plus
`Math.round()`'d derived values used everywhere downstream (GlobeView
props, the NumberFlow display). The thumb now moves continuously with
the pointer instead of visibly snapping between the ~11 discrete
positions the cities range previously had at `step={1}`; only the
displayed number rounds.

Verified live: dispatched keyboard events directly against the focused
slider and confirmed the underlying value is genuinely fractional
(`aria-valuenow` showed `9.01` after five 0.01-step arrow presses, thumb
`left` position moved sub-pixel), and counted 13 label pills on the
default view (9 city markers + 4 arc labels, matching the new route
count). Build and `oxlint src` both clean.

**Also noted**: this log had a mis-ordered entry from earlier in this
session (an edit anchored to a repeated "Status: done. Committed and
pushed." phrase landed mid-file instead of at the true end) — moved to
its correct chronological position while writing this entry, no content
lost.

Status: done. Committed and pushed.

## 2026-07-31 (continued) — Cube-flip jitter fix, thumb theming, arc route propagation + draw-in

Several small, related asks in one pass:

**Cube-flip hover jitter**: hovering right at the edge of the language/
theme toggle buttons could flicker in and out of the 3D flip. Fixed in
`src/components/ui/cube-flip-toggle.tsx` by adding an invisible `-inset-2`
buffer span inside the button — hovering that (which extends past the
button's own layout box) still counts as hovering the button per normal
CSS containment, giving edge tolerance without changing the visible size.

**Slider thumb theming** (`src/components/ui/slider-number-flow.tsx`,
two rounds of feedback): dark mode's thumb fill is now `dark:bg-accent-hover`
(the lighter pink-red, `#d99aa6`) while the border is pinned to the dark
red (`#912f40`, hardcoded via `dark:border-[#912f40]` since it needs to
stay dark in BOTH themes, unlike `border-accent` which flips with the
theme token). Verified via computed styles in a live dark-mode session:
border `rgb(145, 47, 64)`, fill `rgb(217, 154, 166)`.

**Arc routes now propagate with the city-count slider**
(`src/components/GlobeView.tsx`): previously all 4 routes were always on
once cityCount ≥ 9. Reworked so each route only appears once BOTH its
cities are within the current city-count slice — computed as
`requiredCityCount = max(fromIndex, toIndex) + 1` per route, looked up
dynamically by city id rather than hardcoded array indices (safer against
future reordering). Reordered `CITIES` so Lagos and Singapore — endpoints
of the two new routes — sit last (indices 18/19), and swapped those two
routes' cities per explicit request: `saopaulo-lagos` (was
`capetown-saopaulo`) and `dubai-singapore` (was `dubai-sydney`). Net
effect: SF→Tokyo and NYC→London are always on (their cities are within
the min-9 slice); São Paulo→Lagos appears at cityCount ≥ 19; Dubai→
Singapore only at cityCount = 20 (the max) — matching "only at 20 should
show all 4 flights" exactly, driven by data rather than an arbitrary
quartile formula.

**Arc "draw-in" animation**: new `useArcDrawProgress` hook in
`GlobeView.tsx` tracks how long each route has been visible and, for
routes that just appeared, animates their `to` endpoint in from `from`
over 900ms (`easeOutCubic`) via straight lat/lng interpolation (not a
true great-circle slerp — unnecessary complexity here, since cobe still
renders a proper great-circle bulge between whatever `from`/`to` pair
it's given each frame, so the line still reads as smoothly extending
toward its real destination). The `arcs` array is intentionally
unmemoized during the animation window so cobe-globe's existing
`liveProps`/`lastArcs` reference-equality check (added in an earlier
session to avoid needless GPU buffer re-uploads) naturally settles back
to skipping updates once the draw-in finishes.

Verified live: pill count (marker + arc label DOM nodes) matches
expectations at both ends of the slider (11 at cityCount=9: 9 markers + 2
always-on arcs; 24 at cityCount=20: 20 markers + 4 arcs), no console
errors during or after the slider-driven animation, `aria-valuenow`
confirms the slider itself still works correctly post-changes. Build and
`oxlint src` both clean.

Status: done. Committed and pushed.

## 2026-07-31 (continued) — Slower arc draw-in + re-render optimizations

User asked to slow the arc "draw" animation slightly, and to optimize the
app without changing anything visually.

**Slower draw-in**: `ARC_DRAW_DURATION_MS` in `GlobeView.tsx` bumped
900ms → 1600ms.

**Real optimization found while touching that code**: the `arcs` array
was deliberately left unmemoized (comment said so, from the previous
session) so it would update every animation frame during a draw-in — but
that also meant it recomputed on every App re-render, including ones
completely unrelated to the globe (e.g. hovering the theme toggle). Fixed
by having `useArcDrawProgress` return a `Map` whose reference only
changes on an actual rAF tick (previously it returned a plain closure,
recreated every call), then `useMemo`'d `arcs` off `[visibleRoutes,
drawProgress]` — now it only recomputes when the city-count slice changes
or an animation is actually in flight, exactly matching cobe-globe's own
`lastArcs` reference-equality check that this feeds into.

**Broader re-render pass** (zero visual change, verified via unchanged
CSS output in the build): wrapped `GlobeView` (the expensive one — wraps
the WebGL globe) and the smaller leaf components (`ThemeToggle`,
`ThemeHint`, `LanguageToggle`, `LanguageHint`, `ControlPanel`) in
`React.memo`. For `GlobeView`'s memo to actually take effect, its
callback prop needed a stable reference too — `onSelectCountry` was an
inline arrow recreated every `App` render; replaced with a `useCallback`
(`handleSelectCountry`, deps `[demographics]` — stable once loaded, since
`useDemographics` only replaces its state object on an actual load/error
transition). Same treatment for the language-cycle handler
(`handleLanguageToggle`). Also moved `toggleTheme` inside `useTheme.ts`
into a `useCallback` — it was a fresh arrow every hook call, which
would've defeated `ThemeToggle`'s memo.

Net effect: hovering the language/theme toggles (which toggles hint
visibility state in `App`) or any other future unrelated `App` state
change no longer re-renders the WebGL globe or the other toggles/hints —
previously all of App's JSX re-ran on every such state change.

Verified: `npm run build` output is byte-identical in shape (same CSS
size, same warnings), confirming no visual/styling regression. Live
check: page renders correctly on fresh load (all 9 default cities, 2
arcs, no error overlay), dragging the city slider to max still correctly
shows 24 pills (20 markers + 4 arcs) with the slower draw-in, no console
errors. `oxlint src` clean.

## 2026-07-31 14:46 — Resumed on new machine, dependency/path check

Started: user transferred to a new computer; asked to continue the
project and verify dependencies still work.

- Cloned `https://github.com/heliaval/hack-the-arts-addk-2026` fresh
  into the project directory (new machine had nothing local yet).
- This machine already had Node v24.15.0 / npm 11.12.1 preinstalled
  (global `C:\Program Files\nodejs\`, not the old machine's per-user
  portable install). `npm install` completed clean (439 packages, 0
  vulnerabilities). `npm run build` (tsc -b && vite build) and
  `oxlint src` both clean.
- **Found and fixed 2 hardcoded old-machine paths** left over from the
  previous computer's per-user tool installs (old user folder was
  `C:\Users\Alber\`, new one is `C:\Users\Albert.T4\`):
  - `.claude/settings.json` — both `PreToolUse` hooks called
    `C:/Users/Alber/.local/bin/graphify.EXE`, which doesn't exist on
    this machine (graphify is installed at
    `C:\Users\Albert.T4\.local\bin\graphify.exe` here). Updated both
    hook commands to the correct path.
  - `.claude/launch.json` — `runtimeExecutable` pointed at
    `C:\Users\Alber\AppData\Local\nodejs\npm.cmd` (old portable Node
    install). Updated to `C:\Program Files\nodejs\npm.cmd`, this
    machine's actual npm location.
- Verified live via the dev server (`npm run dev`, port 5173): app
  boots as "Hourglass Earth", globe renders with all 9 default city
  markers + 2 arc routes, language/theme toggles and city/rotation
  sliders present, zero console errors, all asset/module requests
  200 OK.

Status: done. Project is fully runnable on the new machine.

## 2026-07-31 14:55 — Fix city-count slider lag

Started: user reported the bottom-left control-panel sliders lag,
especially the city-count one, with their own hypothesis that newly
"propagated" markers/arcs were all animating in at the same time.

Root-caused via code inspection (not guessed): two compounding causes,
both specific to `cityCount`, which explains why the rotation-speed
slider (fed straight into a per-frame-read uniform, no re-render) doesn't
show the same lag.
1. `cityCount` derived straight from the raw slider value with no
   throttling — a fast drag fires `onValueChange` many times within a
   single rendered frame, and each integer crossing makes `GlobeView`
   recompute its marker/arc arrays and makes cobe re-upload their GPU
   buffers (`globe.update()`), so multiple re-uploads could happen inside
   one frame instead of one.
2. `useArcDrawProgress` (`GlobeView.tsx`) started every newly-visible
   route's 1.6s draw-in animation at the identical timestamp. Each route's
   animation runs its own `requestAnimationFrame` loop calling `setState`
   ~60x/sec for the full 1.6s, and every tick creates a new `arcs` array
   reference, triggering another GPU arc-buffer re-upload. A fast drag
   that crosses more than one route's `requiredCityCount` threshold at
   once (several are close together) started multiple of these 60fps
   loops simultaneously — up to 4 concurrent re-upload loops for 1.6s
   straight, matching the user's "all propagate at once" read of the
   symptom.

Fix:
- `App.tsx` — added `useRafThrottled`, a small hook that coalesces rapid
  value changes into at most one committed update per animation frame.
  Applied to the rounded `cityCount` (not the raw slider position, which
  still updates instantly for a smooth drag feel/NumberFlow readout) —
  caps GlobeView's marker/arc recompute + cobe's GPU re-upload rate at
  the display refresh rate regardless of input event rate.
- `GlobeView.tsx` — `useArcDrawProgress` now staggers simultaneously-
  newly-visible routes' start times by `ARC_DRAW_STAGGER_MS` (150ms)
  each instead of starting them all at the same `now`, so their 1.6s
  per-frame GPU-upload windows overlap less. Also clamped the progress
  calc to `[0, 1]` (`Math.max(0, ...)`) since a staggered route's start
  time can now be in the future relative to a given tick.

Verified: `npm run build` and `oxlint src` clean. Live check via dev
server — rapidly toggling the city slider between min/max (Home/End keys,
the worst-case burst this fix targets) produced zero console errors and
landed correctly at the max value (20, `aria-valuenow` confirmed). No
automated performance/FPS measurement was done (no profiler available in
this session) — the fix targets the mechanism found via code inspection,
not a measured-then-reproduced number; flag to the user if lag persists
so it can be profiled properly.

Status: done. Committed and pushed per user's standing instruction to
commit+push all changes without asking.

## 2026-07-31 15:49 — Sweep animation implementation + real useRafThrottled bug

Continuation of the previous entry's design. Implemented the sweep design
(`docs/superpowers/specs/2026-07-31-globe-sweep-animation-design.md`):
`Globe` (`cobe-globe.tsx`) is now a `forwardRef` exposing `project(location)`
for live screen-position lookups; `GlobeView.tsx` uses it to stagger newly-
eligible city reveals and reorder the arc draw-in stagger by top-left-to-
bottom-right sweep instead of array order; the language toggle's label
re-flip is staggered the same way, self-contained inside `Globe` since it
already tracks every label's projected position each frame. Arc draw-in
switched from a linear lat/lng lerp to a proper spherical slerp
(`slerpLocation`), fixing the user-reported "curve scales instead of being
drawn" look — root cause: the linear lerp wasn't a sub-segment of the final
great-circle path, so cobe's bulge-height calc for the growing partial arc
didn't grow the way a real partial reveal would.

**Found and fixed a genuine, unrelated regression while testing this**: the
previous session's `useRafThrottled` (the fix for slider lag) never
actually commits past its first value. Root cause, confirmed via targeted
debug logging: its effect was keyed on `[value]`, so it re-ran on every
single value change, cancelling and rescheduling its `requestAnimationFrame`
call each time via a `frameRef` guard — under React's dev-mode StrictMode
double-invoke, that schedule/cancel dance could race and leave `frameRef`
permanently in a state where no new frame ever got scheduled, silently
freezing the committed value forever (confirmed live: `cityCountRaw` tracked
the slider correctly up to 20, but `cityCount` stayed stuck at 9 no matter
how long you waited). Rewrote it as a single persistent per-frame comparison
loop started once on mount (`[]` dep, no per-value scheduling) — structurally
immune to that race regardless of how often the input value changes.

**Verification limitation, disclosed to the user**: this session's Browser
pane is not composited/visible (confirmed via a direct `requestAnimationFrame`
probe that never resolved, and `computer.screenshot` erroring "pane is not
displayed") — browsers pause or heavily throttle rAF for non-visible
documents, so none of the rAF-driven behavior here (the throttle fix, the
sweep timing, the arc draw-in) could be visually verified end-to-end in this
sandbox. What WAS verified: `tsc -b` + `npm run build` + `oxlint src` clean
throughout; live interaction (slider to max, language toggle, rapid
min/max cycling) produced zero NEW console errors; the DOM/React side
(markers/arcs mounting, no exceptions) behaved correctly. The `useRafThrottled`
race itself was proven via debug-log evidence (not just code reading), so
that fix is on solid ground; the sweep-timing and slerp-path correctness
rest on code review, not a visual check — user should confirm the actual
on-screen feel.

**Additional real optimization found during review** (separate from the
StrictMode bug): arc/marker label arrays (`LANGUAGES.map(...)`) were being
reallocated inside the per-frame `arcs`/`markers` `useMemo`s — meaning
during any arc draw-in, EVERY visible label's array got a fresh reference
every single animation frame, not just the one actually animating. Moved
label computation to module scope (`ARC_ROUTES[].label`, `CITY_LABELS` map)
so references are stable across frames. This also enabled a previously-
inert optimization: `cobe-globe.tsx`'s `LabelPill` is now wrapped in
`React.memo` (it wasn't before), with its `setRef` callback changed from a
fresh inline arrow per render to a cached per-id stable function
(`getRefSetter`) — without both changes together, the memo would never
actually skip a re-render since props would always look "different".
Checked cobe's own `update()` source directly (`node_modules/cobe/dist/index.esm.js`)
to rule out a suspected bigger issue: it only touches the GPU buffer for
whichever key (`markers`/`arcs`/`mapSamples`) is actually present in the
update payload, so the per-frame arc re-upload itself was never the
expensive part — the label re-render fan-out was.

Status: done, pending user's live confirmation of animation feel. Committed
and pushed per user's standing instruction to commit+push without asking.

## 2026-07-31 21:37 — Fix remaining lag: translation at 20 cities

User confirmed the earlier fixes resolved the general lag, but reported it
still lags specifically when toggling language with all 20 cities visible
(24 labels total: 20 markers + 4 arcs).

Root cause: `TextRotate` (`text-rotate.tsx`), used by every label pill,
hardcoded Framer Motion's `layout` prop on its two wrapper elements. `layout`
animations use FLIP (measure old position/size, then animate to the new
one), and Framer Motion batches that measure-then-mutate pass across every
currently-registered `layout`-tracked component in the document together —
so its cost scales with the TOTAL count of such components, not just the
ones actually changing. A language toggle at max city count triggers up to
24 of these simultaneously (double that counting both wrapper elements per
pill = ~48), against only ~11×2 at the default 9-city view — matching
exactly why the lag only showed up at 20 cities. The `layout` prop's only
purpose here was cosmetically smoothing the pill's width when swapping to a
longer/shorter translated word — label *position* is already handled
imperatively via direct style writes in `updateLabels` (cobe-globe.tsx),
so it wasn't load-bearing for correctness.

Fix: added an `enableLayoutAnimation` prop to `TextRotate` (default `true`,
preserving behavior for any other future consumer) and set it `false` for
the globe's `LabelPill` usage specifically — trades the smooth pill-resize
for no forced-synchronous-layout cost, which matters exactly in the
many-concurrent-labels case this was actually slow in.

Verified: `tsc -b` + `npm run build` + `oxlint src` clean. Live: cycled the
language toggle 3x at max city count (20/24 labels) via the dev server —
zero console errors. Per the same verification-limitation note as the
previous entry, this session's Browser pane doesn't composite frames, so
the actual smoothness improvement couldn't be watched directly — reasoning
is grounded in Framer Motion's documented layout-animation batching
behavior, not a before/after frame-rate measurement.

Status: done, pending user's live confirmation. Committed and pushed per
standing instruction.

## 2026-07-31 22:01 — Revert sweep window widening

User tried the wider window and it felt less snappy overall, preferred the
previous feel. Reverted via `git revert` (commit d0aae6b), restoring
`src/lib/sweep.ts`'s `MAX_SWEEP_MS`/`PER_ITEM_MS` to 450/35. The
layout-FLIP fix (`enableLayoutAnimation`) from the prior entry is
unaffected and stays in place. Build/lint verified clean post-revert.

Status: done. Committed and pushed per standing instruction.

## 2026-07-31 22:08 — Fix: labels stopped updating on language toggle

User reported the label pill "doesn't seem to dynamically change with
different languages now" — a regression from the layout-FLIP fix two
entries back, which disabled Framer Motion's `layout` prop on BOTH of
`TextRotate`'s wrapper elements.

Root cause, confirmed via direct DOM inspection (checked the pill's actual
`textContent` before/after toggling, not just visual inspection): the
inner `motion.div` — the one keyed by `currentTextIndex` and wrapped by
`AnimatePresence mode="popLayout"` — needs its own `layout` prop for
`popLayout` to actually remove the exiting text from flow. Without it, old
and new text both remained mounted/visible simultaneously (confirmed:
`textContent` read `"旧金山San Francisco旧金山"` after toggling to
Chinese — both languages present at once). The `sr-only` accessibility
span (driven straight off React state, not Framer Motion) correctly read
just `"旧金山"`, confirming the state/toggle logic itself was fine — only
the animated exit was broken.

Fix: `text-rotate.tsx` — inner `motion.div` now always has `layout`
(unconditional, required for correctness), only the OUTER `motion.span`
(purely cosmetic pill-width resize) respects `enableLayoutAnimation`.
Updated the prop's doc comment to reflect the split. This still gets most
of the original perf win (halves the FLIP-tracked element count per pill
instead of eliminating it) while not breaking the actual text swap.

**Verification caveat**: re-tested live via DOM content check — still saw
old+new text coexisting immediately after toggling in this session's
Browser pane, but can't distinguish "still broken" from "correct fix, but
stuck mid-exit-animation because this pane's rAF is paused" (the same
non-compositing-tab limitation noted in every entry since the sweep work
began) — the `sr-only` span updated correctly either way, consistent with
the fix addressing the actual reported cause. `npm run build` +
`oxlint src` clean. **Needs the user's confirmation on their end** — this
one specifically couldn't be conclusively verified in-session.

Status: shipped, unverified pending user confirmation. Committed and
pushed per standing instruction.

## 2026-07-31 22:18 — Revert enableLayoutAnimation entirely: "too instant"

User reported the label swap now feels "too instant" — the crossfade
animation itself wasn't visibly happening. Two consecutive partial-disable
attempts on `TextRotate`'s `layout` prop each broke something different
(first: old+new text coexisting; then, after fixing that: the transition
losing its visible motion). Rather than continue tweaking which of the two
wrapper elements gets `layout`, reverted the whole `enableLayoutAnimation`
experiment — removed the prop from `text-rotate.tsx` entirely, restored
`layout` unconditionally on both wrapper elements (the original, previously
user-confirmed-working design), and removed the now-nonexistent prop from
`LabelPill`'s usage in `cobe-globe.tsx`.

This gives up the FLIP-batching perf reduction from two entries back for
the 20-city-translate case, in favor of correct, confirmed-good animated
behavior — the user's priority ordering across this whole thread has
consistently been "smooth/correct over faster," and the perf angle was
never conclusively verified in-session anyway (rAF-pause limitation).

**Tooling note**: hit the same stale-console-buffer issue as earlier in
this session again — `read_console_messages` kept reporting an old
`enableLayoutAnimation` PropTypes-style warning long after the source was
confirmed clean (verified via a cache-busted `fetch()` of the live dev
server's response body) and after a full dev-server restart. Opening a
*new* browser tab (rather than reusing/reloading the existing one) cleared
it — worth remembering for future sessions in this environment.

Verified: `npm run build` + `oxlint src` clean, no `enableLayoutAnimation`
references left in `src/`. Fresh-tab console clean after toggling language.
The animation smoothness itself still can't be watched end-to-end in this
non-compositing pane — needs the user's live confirmation.

Status: done, pending user's live confirmation. Committed and pushed per
standing instruction.

## 2026-07-31 (continued) — Globe size bump + one-time lag warning

Started: user asked (1) whether the globe should be bigger since it's the
primary interactive element, (2) after agreeing, a one-time 5s countdown
warning in the language-hint's bottom-right corner the first time the
city-count slider hits its max (20), warning about possible WebGL lag.

**Globe size**: `src/components/GlobeView.tsx`'s `<Globe>` wrapper was
capped at `max-w-2xl` (672px) inside a full-viewport flex container — a
lot of dead space on any real screen. First attempt (`h-full max-h-[48rem]
w-full max-w-[48rem]`) broke the wrapper's `aspect-square` class since
setting both axes explicitly overrides `aspect-ratio` — confirmed via
`getBoundingClientRect()` showing a stretched 768×656 non-square canvas.
Fixed by constraining only one axis and letting `aspect-square` derive the
other: `aspect-square w-full max-w-[min(80vh,48rem)]` — confirmed square
576×576 at the 1280×720 dev viewport (80% of 720 height, well under the
48rem ceiling).

**Lag warning**: went through the brainstorming skill (two rounds of
`AskUserQuestion`) before implementing, per CLAUDE.md. Design: new
`LagWarning` component in `src/App.tsx`, same bottom-right corner/fade
pattern as `LanguageHint`/`ThemeHint` but not hover-driven — triggered
once, ever, by a `useEffect` keyed on `cityCount === MAX_CITY_COUNT` (a
`hasShownLagWarningRef` prevents retriggering if the user drags away and
back). Text: "please be advised that WebGL performance may degrade at 20
cities", amber/yellow (`text-amber-500`/`dark:text-amber-400`), with a
` · Ns` countdown suffix ticking 5→1 via a chained `setTimeout` effect,
then unmounting. `LanguageHint`/`ThemeHint` bumped from `z-10` to `z-20`
so hovering either visually covers the lag message rather than needing
shared visibility-coordination state (per user's explicit "overrideable
by any other message" answer).

Plan written to
`docs/superpowers/plans/2026-07-31-lag-warning-message.md` and executed
inline (single small task, no subagent dispatch needed).

**Verification**: `npm run build` and `oxlint src` both clean (only the
pre-existing unrelated `button.tsx` warning). Could NOT verify the
trigger end-to-end live in this session — re-confirmed the same
rAF-pane limitation noted throughout this project: a fresh
`requestAnimationFrame` probe scheduled in the live tab never fired even
after 2s, so `cityCount` (which is rAF-throttled, see the "Fix
city-count slider lag" entry above) never advances in this sandbox even
though the slider's raw `aria-valuenow` reached 20 via a simulated `End`
keypress. Confirmed instead via direct DOM inspection: the `LagWarning`
span renders in the correct corner with the correct text/classes,
currently at `opacity-0` (correctly not yet triggered, since `cityCount`
never moved). **User should verify live**: drag the city slider to 20 in
a real browser and confirm the amber countdown message appears bottom-
right, ticks down, and disappears after 5s, and does not reappear on a
second visit to 20 without a page reload.

Status: done, pending the user's live confirmation of the untestable-here
rAF-gated behavior. Committed and pushed (`e5fb9fc` globe size,
`eba33b2` lag warning).

## 2026-07-31 (continued) — Population shockwave feature + reveal-delay fix + label pill inversion + globe polish

Started: user asked whether the population API data was connected to
anything visible yet (it wasn't — loaded but dead-ended, see earlier
entries), then requested a "shockwave" feature: every N real births/
deaths for a city's country spawns an expanding ring from that marker,
red for births, black for deaths.

**Brainstormed first** (per CLAUDE.md): computed real per-second birth/
death rates for all 20 cities' countries from the already-live World Bank
data before picking a threshold — found national rates are all well under
1/s even for the busiest countries (China ≈0.31 births/s, India ≈0.74
combined), so hitting the user's "~7s cadence" target required a small
threshold (~3-5), not the user's own suggested "100." Presented this
finding plus a country-overlap question (SF/NYC both USA, Delhi/Mumbai
both IND) via `AskUserQuestion`; user chose literal real-time pacing
(not time-scaled) and splitting each shared country's rate across its
cities. Landed on **threshold = 3** (both births and deaths), giving the
busiest cities ~8-10s cadence. Design doc:
`docs/superpowers/specs/2026-07-31-population-shockwave-design.md`. Plan:
`docs/superpowers/plans/2026-07-31-population-shockwave.md`.

**Implemented** across 3 commits:
- `src/components/GlobeView.tsx`: added a `country` (ISO3) field to all 20
  `CITIES` entries.
- `src/lib/populationPulse.ts` (new): `usePopulationPulses` hook —
  deliberately ticks on a plain `setInterval` (500ms) rather than
  `requestAnimationFrame` like most of this app's per-frame work, since it
  needs to keep accumulating in real wall-clock time regardless of
  animation-frame availability (relevant given this project's recurring
  rAF-pane sandbox limitation, but also just correct for a real-time
  simulation). Per-city birth/death accumulators (refs, not state) add
  `elapsed × (country rate / cities-sharing-that-country)` each tick;
  crossing the threshold spawns a `PopulationPulse` event and keeps the
  remainder rather than dropping it, so cadence doesn't drift over a long
  session. Cities outside the current city-count slider slice don't
  accumulate at all (held, not reset) — no burst of pulses when a city
  reappears.
- `src/components/ui/cobe-globe.tsx`: `Globe`
  gained a `pulses` prop; a new `Pulse` component renders one ring per
  active pulse. Position/occlusion-opacity are imperative, updated every
  `animate()` frame exactly like existing labels (reusing `projectMarker`)
  — deliberately split into an outer wrapper div (position/occlusion) and
  an inner `<span>` (the ring's own CSS `pulse-ring` keyframe animation,
  new in `src/index.css`: `scale` 0.2→1.6, `opacity` 0.9→0 over 1.1s) so
  the two don't fight over the same `opacity` property.
- `src/components/GlobeView.tsx`: `demographics` is no longer `void`'d —
  it now feeds `usePopulationPulses`, whose output maps to `Globe`'s
  `pulses` prop. This is the first real connection between the
  long-loaded-but-unused World Bank data and anything visible on the
  globe.

**Verified live, and this one actually worked in this sandbox**: unlike
most animation-timing checks this project, `setInterval` (unlike `rAF`)
DOES fire in this environment's browser pane. Waited ~50s on a fresh page
load (default 9-city view) and confirmed via direct DOM inspection that a
real pulse spawned — correctly colored black (a death pulse), timed
consistently with the computed ~50-60s cadence for the USA cities (split
across SF+NYC) at their real World Bank death rate. This proves the full
accumulation → threshold → spawn pipeline works against live data. The
pulse's on-screen *position* stayed unset in this check only because that
part (`updatePulses`) runs inside the `animate()` rAF loop, which still
doesn't fire in this sandboxed pane (long-documented limitation) — that
code path reuses the exact same projection math already proven correct
for markers/labels in earlier sessions. **User should confirm live** that
rings visibly appear and expand from markers (most reliably observable by
dragging to max city count first, for Beijing/Delhi/Mumbai/Lagos's faster
~8-10s cadence).

**Separate small fix in the same stretch**: user reported new city
markers popping in instantly when dragging the slider slowly (one city at
a time), "not bad but I would prefer some kind of slight delay like
previously." Root-caused via code read (not guessed): `computeSweepDelays`
(`src/lib/sweep.ts`) always returns `0ms` for a batch of exactly one new
item — the stagger math only kicks in when several items cross their
reveal threshold in the same frame, which is the uncommon case for a slow
drag. Fixed with a `MIN_REVEAL_DELAY_MS = 300` floor in `useSweepReveal`
(`GlobeView.tsx`), applied via `Math.max(delay, MIN_REVEAL_DELAY_MS)` —
lone reveals now always wait at least 300ms, giving the label's existing
1.4s opacity fade room to actually read as an entrance.

**Also this stretch, smaller iterative UI requests** (each verified via
build/lint + DOM inspection, several via `AskUserQuestion` where genuinely
ambiguous):
- Globe enlarged from a flat `max-w-2xl` (672px) cap to
  `aspect-square w-full max-w-[min(80vh,48rem)]` — first attempt broke the
  square aspect ratio by setting both height and width classes at once
  (caught via `getBoundingClientRect` showing a stretched 768×656 canvas),
  fixed by constraining only one axis.
- Added a one-time, 5s-countdown "Advisory: rendering performance may
  degrade at 20 cities" message in the language-hint's bottom-right
  corner, triggered once ever when the city slider first hits max —
  iterated through several rounds of copy/color/fade feedback, and fixed
  to actually hide (not just get visually covered by z-index, since the
  two messages are different widths) when the language/theme hover hints
  are active.
- Flight-route label pills recolored to an inverted scheme (bordered
  light fill, dark text) vs. city marker pills (solid dark fill, light
  text) — after an initial wrong-target attempt at inverting the dot/arc
  *line* colors instead, corrected per user clarification. Border opacity
  tuned down twice (100% → 40% → 10%) per "a little thick" /
  "almost borderless" feedback.

Status: population shockwave feature done, pending the user's live
confirmation of ring visibility/position (the one part genuinely
untestable in this sandbox). All other items in this entry fully done
and verified. Committed and pushed throughout (commits `e5fb9fc` through
`8d69074`).

## 2026-08-01 — Spherical shockwave: real geodesic ripple instead of flat CSS circle

Started: user wanted the shockwave ring to actually "travel around the
globe" following its curvature (foreshortening, disappearing over the
horizon) rather than being a flat CSS circle that just scales in 2D
screen-space — "start fast and strong, fizzle out." Asked for a plan
before implementing.

Design + plan written and committed first (per CLAUDE.md):
`docs/superpowers/specs/2026-08-01-spherical-shockwave-design.md`,
`docs/superpowers/plans/2026-08-01-spherical-shockwave.md`. Ran
`graphify update .` (graph didn't exist yet this session — first use of
graphify in this session) and `graphify query` to confirm the existing
projection helpers before designing around them, per CLAUDE.md's graphify
rule.

**Implemented across 3 commits**:
- `src/lib/populationPulse.ts`: added `spawnedAt: number` to
  `PopulationPulse`, set from the tick's `now` at spawn time — needed so
  the ring's per-frame math is based on real elapsed time, independent of
  when React happens to render it.
- `src/components/ui/cobe-globe.tsx`: added `ringPointsOnSphere()` (the
  standard spherical-cap parametrization — builds a tangent basis at the
  pulse's marker via cross products, samples 40 points around a circle of
  growing *angular radius* on the unit sphere, in the same xyz convention
  `unitSphere()` already uses) and `buildRingPath()` (turns projected
  points into an SVG path string, starting a new subpath whenever a point
  crosses the occlusion boundary so the ring breaks apart correctly at
  the horizon instead of drawing a garbled line across the back of the
  globe). Replaced the old `updatePulses` (position-only) with
  `updateRipples`, called every `animate()` frame — computes angular
  radius via an ease-out curve (fast burst, decelerating) up to 1.1 rad
  (~63°) and opacity via a separate `(1-p)^1.3` curve (stays strong
  early, "fizzles" toward the end), reusing the existing `project()`
  function so it's pixel-consistent with markers/labels. Replaced the
  old CSS-scaled `Pulse` div + `pulse-ring` keyframe (deleted from
  `index.css`) with an SVG `<path>` overlay per active pulse.
  `getRefSetter` generalized from a hardcoded `HTMLDivElement` type to a
  generic `<T extends Element>` so it still serves both the (unchanged)
  label refs and the new `SVGPathElement` pulse refs.
- `src/components/GlobeView.tsx`: pulse mapping now passes `spawnedAt`
  through to `Globe`'s `pulses` prop.

**Verified live at each step**: build intentionally failed after Task 2
(missing `spawnedAt` on the object passed to `Globe`'s `pulses` prop) —
confirmed the error named exactly that field before proceeding, proving
each task's own change type-checked correctly in isolation. Final build
+ `oxlint src` clean. In-browser: waited ~50s on a fresh load and
confirmed via DOM inspection that a real pulse spawned as an `<path
stroke="#000000">` (a death pulse, correctly colored) inside the new
`<svg>` overlay — proves the spawn → prop-threading pipeline works
end-to-end with the new `spawnedAt` field. Its `d` attribute stayed
`null` in this check only because `updateRipples` runs inside the
`animate()` `requestAnimationFrame` loop, which still doesn't fire in
this sandbox's browser pane (the same long-documented limitation
affecting every animation-timing check this project has done). **User
should confirm live** that the ring now visibly follows the globe's
curvature (foreshortens, breaks apart at the horizon) rather than
scaling as a flat on-screen circle.

Status: done, pending the user's live visual confirmation (the one part
genuinely untestable in this sandbox, same as the original shockwave
feature). Committed and pushed (`08929e6`, `b4dec1c`, `167230c`).
