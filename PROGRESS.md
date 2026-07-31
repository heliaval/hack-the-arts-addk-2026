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
