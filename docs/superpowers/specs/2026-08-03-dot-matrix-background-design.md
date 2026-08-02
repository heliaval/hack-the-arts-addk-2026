# Dot-matrix background revealed by the cursor

## Problem

Outside the globe's circle the page is flat empty background. The globe canvas
(`GlobeView`, mounted in `App.tsx` inside an `absolute inset-0` wrapper) is only
opaque inside the sphere itself; the corners and margins around it are pure
`--background` with nothing in them. The app's tide-gauge direction wants
instrument-plate texture there, but a permanently visible dot grid would compete
with the globe and the readouts for attention.

## Decision

An invisible dot-matrix layer covering the whole page, revealed only where the
cursor "shines light" on it: a soft radial glow that fades with distance from the
pointer, plus a secondary glass-sheen highlight so the reveal reads like light
catching a pane of glass rather than a flashlight beam.

Decorative texture, not a UI affordance. Nothing depends on it being seen.

## Approach

CSS-only. One DOM layer whose dot pattern is a repeating `background-image`, whose
reveal is a `mask-image` built from radial gradients centered on two CSS custom
properties (`--mx` / `--my`), and whose only per-frame work is writing those two
properties from a `mousemove` handler.

Rejected alternative: a `<canvas>` that redraws the dot field every frame around
the cursor. It gives finer control (per-dot brightness falloff, size modulation)
but costs a full clear + redraw per frame for a purely decorative effect, on top of
an app that already runs a `cobe` WebGL globe and a Rapier physics scene. This
session has already had two real performance-regression incidents in exactly that
budget (commits `5956d6d`, `a3a9eb8` on `BeadScene.tsx` / `cobe-globe.tsx`), so the
zero-per-frame-draw option wins. The CSS mask is composited by the browser; moving
the cursor mutates two custom properties and nothing else.

## Design

### Layer and stacking

New component `src/components/ui/dot-matrix-background.tsx`, mounted once as the
**first** child of `App.tsx`'s outer `relative h-full w-full` container — before the
`absolute inset-0` wrapper that holds `GlobeView`.

Classes: `pointer-events-none absolute inset-0 z-0`.

`z-0` rather than a negative index. Current z usage in that container is:
`GlobeView`'s wrapper and the top-left title/reading stack are positioned with
`z-index: auto`; `YearCounters` is `z-[5]`; `ControlPanel`, the toggle cluster and
`LagWarning` are `z-10`; `LanguageHint` / `ThemeHint` are `z-20`. Positioned
elements with `z-index: 0` and `z-index: auto` paint together in DOM order, so
being first in the tree puts this layer behind the globe wrapper without needing a
negative value — and the app uses no negative z-index anywhere, so introducing one
(which would also push the layer behind the root container's own painting) is
avoided.

### Dot grid

- Tile: `background-image: radial-gradient(circle at center, var(--border) 0 1px, transparent 1px)`
- `background-size: 24px 24px`
- Layer `opacity` such that the dots land around 4–6% effective alpha. `--border` is
  already a low-alpha neutral (`oklch(0.5 0 0 / 16%)` light, `oklch(0.9 0 0 / 12%)`
  dark), so the layer sits near `opacity: 0.35` to reach that range; tune by eye in
  both themes and hard-code the final value.

Result reads as texture, not pattern: at full reveal the dots should be noticeable
only once you look for them.

### Reveal mask

`mask-image` (with `-webkit-mask-image` alongside it) composed of two stacked radial
gradients centered on the tracked position:

1. Inner: `radial-gradient(circle 140px at var(--mx) var(--my), #000 0%, #000 40%, transparent 100%)`
   — full reveal in the immediate neighbourhood of the cursor.
2. Outer: `radial-gradient(circle 320px at var(--mx) var(--my), rgba(0,0,0,0.5) 0%, transparent 100%)`
   — a wide, low-strength halo so the field dissolves gradually over roughly
   250–350px instead of ending at a visible circle edge.

Composited additively (`mask-composite: add` / `-webkit-mask-composite: source-over`)
so the two stops sum rather than intersect.

`--mx` / `--my` initialise to `-9999px` so nothing is revealed before the first
`mousemove` — no flash of dots on load.

### Glass sheen

A second element inside the same layer, absolutely filling it, painted above the
dots:

- `background: radial-gradient(ellipse 420px 260px at calc(var(--mx) - 70px) calc(var(--my) - 50px), var(--foreground), transparent 70%)`
- Layer opacity in the 3–5% range.

Wider than tall, offset up-and-left from the raw cursor position, and softer-edged
than the dot reveal — so it lags the pointer visually and reads as a specular
reflection on glass rather than a second spotlight. It is *not* masked; its own
gradient falloff is the shape.

### Cursor tracking

One `mousemove` listener on `window`, registered in a `useEffect` on mount and
removed on unmount. The handler stores the latest `clientX` / `clientY` in a ref and
schedules a single `requestAnimationFrame` (skipped if one is already pending); the
frame callback writes `--mx` / `--my` onto the layer's DOM node via `ref.current.style.setProperty`.

No React state, therefore no re-render per pointer event. This mirrors the existing
`useRafThrottled` hook in `App.tsx` (used for the city-count slider) in intent —
collapse a burst of input events down to one visual update per frame — but writes
straight to the DOM instead of through a state setter, since nothing in the React
tree needs the value.

### Theming

Every color is `var(--border)` / `var(--foreground)` read at paint time, so the
`.dark` block in `src/index.css` swaps them automatically. No theme prop, no
`useTheme` subscription, no `dark:` variants.

Explicitly **not** the wine-red `--accent`. The accent is reserved for meaning
(selected country, readouts, active state); background texture stays neutral.

## Out of scope

- No touch or mobile handling. Without `mousemove` the field simply never reveals,
  which is the correct fallback for a decorative layer; this is a desktop demo.
- No configurability — grid size, radii, offsets and opacities are hard-coded
  constants, not props or user settings.
- No tests. Purely decorative and non-interactive; verification is a manual visual
  check in light and dark mode that the dots reveal under the cursor, fade out
  smoothly, never appear over the globe sphere or above any panel, and never
  intercept pointer events.
