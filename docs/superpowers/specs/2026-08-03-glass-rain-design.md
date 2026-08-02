# Glass rain: refracting droplets over the globe

## Problem

The idle state (no country selected) currently renders `GlobeRain`
(`src/components/GlobeRain.tsx`): ~130 accent-tinted streaks falling down a plain
2D canvas, wrapping around the globe's silhouette. It reads as *drawn rain* —
line strokes with a lighter core — sitting flat on top of the scene. Nothing
behind it changes because of it.

The look the user actually wants is the rain-streaked-window photograph: droplets
sitting on a pane of glass in front of the scene, each one acting as a small lens
that genuinely **magnifies and inverts whatever is behind it**. That optical
behaviour is the entire effect. A CSS-shaded circle with a highlight dot is a
recognisable fake; a droplet whose interior shows a warped, magnified slice of the
globe is not.

This is "fake water physics" in the sense that matters: the droplets are
procedurally generated, not rigid bodies, and no fluid is simulated — but the
*optics* are real per-pixel refraction math, which is what sells it.

## Decision

Replace `GlobeRain` at its `App.tsx` call site with a new `GlassRain` layer: a
fullscreen GLSL shader that procedurally generates droplets on a virtual pane of
glass and refracts a live capture of the globe canvas through them.

**Fidelity tier: medium.** Mostly static droplets clinging to the glass, with an
occasional drop that breaks loose, slides down under a gravity sawtooth, and
leaves a trail that fades behind it. Not the fully-static tier (droplets that only
fade in and out), and not the full tier (continuous fall, droplet merging, wind
shear).

## Approach

Port the droplet-generation and normal-based-refraction core of
[`rocksdanister/rain`](https://github.com/rocksdanister/rain)'s
`shaders/rain.frag` (`threejs` branch) — the well-known "Heartfelt Rain" technique
in the Martijn Steinrucken / Bruno Imbrizi lineage — into a `THREE.ShaderMaterial`
on a plain three.js fullscreen quad.

How that shader works, from the actual source:

- `N13()` / `N14()` / `N()` are hash-noise generators seeded off a grid cell id.
- `StaticDrops(uv, t)` tiles UV space at 40x, hashes each cell to a jittered
  droplet centre, and returns a `smoothstep` disc whose visibility is gated by
  `Saw(.025, fract(t + n.z))` — a very short pulse, so each static droplet spends
  most of its cycle present and fades quickly at the ends.
- `DropLayer2(uv, t)` is the falling layer: a `6 x 1` cell grid scrolled by
  `uv.y += t * .75`, per-column phase offset via `N(id.x)`, a horizontal `wiggle`
  from `sin(y + sin(y))` so drops don't fall in straight lines, and a vertical
  position driven by `Saw(.85, ti)` — the sawtooth that produces "hangs, then
  slides, then resets". It returns `vec2(mainDrop, trail)`, where `trail` is
  shaped by `S(.23*r, .15*r*r, cd)` gated by a `trailFront` term so the trail only
  exists *behind* the drop's current y.
- `Drops()` composites the layers into a single scalar heightfield `c.x`.
- The refraction is the payoff: the shader samples `Drops()` twice more at
  `uv + vec2(.001, 0) * u_normal` and its `.yx` swizzle, takes the differences as
  a 2D gradient `n`, and then samples the background as
  `texture2D(u_tex0, UV + n)`. That gradient *is* the droplet's surface normal,
  and offsetting the sample coordinate by it is a first-order refraction — genuine
  per-pixel optical displacement, not a blur or a distortion filter.

That last step is what gets ported. Everything wrapped around it in the reference
(lightning, wallpaper panning, blur passes, colour grading, vignette) is
wallpaper-app scenery and is dropped.

**Rejected alternative: CSS `backdrop-filter` + SVG `feDisplacementMap`.** A
`backdrop-filter: blur()` layer masked to droplet shapes, with an SVG turbulence
displacement map for the warp, needs no WebGL context and no shader code. It was
rejected because `feDisplacementMap` displaces by a *static noise texture*, not by
a per-droplet normal, so the warp inside each droplet is arbitrary rather than
lens-shaped — the exact tell we're trying to avoid. Animating it means swapping
filter primitives per frame, which is slower than a shader, not faster. And the
user pointed at a concrete, proven reference implementation and asked for
something stunning; the fidelity ceiling of the CSS route is well below the bar.

## Design

### Files

- **Create** `src/components/GlassRain.tsx` — component, imperative three.js
  setup, GLSL source as a template literal in the same file (matching how the rest
  of this repo keeps single-purpose visual code self-contained).
- **Modify** `src/App.tsx` — two lines only (see *Reversibility*).
- **Do not touch** `src/components/GlobeRain.tsx`.

### Props

```ts
export interface GlassRainProps {
  globeCircle: GlobeCircle | null
  theme: 'light' | 'dark'
  globeElement: HTMLCanvasElement | null
}
```

A strict superset of `GlobeRainProps` (`{ globeCircle, theme }`). The one addition,
`globeElement`, already exists as state in `App.tsx` (`const [globeElement,
setGlobeElement] = useState<HTMLCanvasElement | null>(null)`, fed by
`GlobeView`'s `onElementChange` callback and already passed to `BeadScene`), so the
call-site swap needs no new plumbing anywhere.

### Rendering surface

Plain imperative three.js inside one `useEffect`, **not** React Three Fiber:

- `new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false })`,
  `setClearColor(0x000000, 0)`.
- `new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)` and a
  `THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)` — the same fullscreen-quad
  setup the reference's `js/script.js` uses.
- Device pixel ratio capped at **1.5**, matching `GlobeRain`'s
  `MAX_DEVICE_PIXEL_RATIO` and `BeadScene`'s `<Canvas dpr={[1, 1.5]}>`.
- A `resize` listener calls `renderer.setSize()` and updates `u_resolution`.
- Cleanup disposes geometry, material, both textures, and calls
  `renderer.dispose()`.

R3F would add a scene graph, reconciler and per-frame React overhead for what is a
single shader pass with no objects in it. Plain three.js here mirrors
`cobe-globe.tsx`, which is likewise an imperative WebGL setup living outside
React's render cycle inside a `useEffect`.

**GPU context count.** This is a third WebGL surface in the codebase but never a
third *live* one: `GlassRain` mounts only when `!selected`, and `BeadScene` mounts
only when a country *is* selected, so at any moment there are exactly two live
contexts (cobe's globe + one of the two). That is the same budget `GlobeRain`'s
own header comment describes; the difference is that `GlassRain` needs a WebGL
context where `GlobeRain` did not, and it gets one only in the state where
`BeadScene`'s is not allocated.

No new npm dependency: `three` is already a direct dependency.

### The background texture (`u_tex0`)

This is the one place the reference cannot be copied. Its `u_tex0` is a static
wallpaper image; ours has to be *whatever is actually behind the glass*, which is
the globe's live `<canvas>` plus flat page background around it.

Reuse the pattern already proven in `BeadScene.tsx`'s `Backdrop` component:

1. Create one offscreen scratch `<canvas>` sized to
   `viewport * CAPTURE_SCALE` (`CAPTURE_SCALE = 0.5`). Half resolution is fine
   because this texture is only ever seen through droplet-sized magnifying lenses
   — it is never displayed directly — and it halves the readback cost in each
   dimension.
2. Wrap it as a `THREE.CanvasTexture` with `colorSpace = THREE.SRGBColorSpace`
   (same as `Backdrop`'s textures), and assign it to `u_tex0`.
3. Inside the rAF loop, every `CAPTURE_UPDATE_EVERY_N_FRAMES = 2` frames
   (`Backdrop`'s `BACKDROP_UPDATE_EVERY_N_FRAMES` value, for the same reason —
   `drawImage` off a live WebGL canvas is a GPU→CPU readback and
   `needsUpdate` is a full re-upload):
   - `ctx.fillRect` the whole scratch canvas with the resolved `--background`
     colour, so the area outside the globe refracts something rather than
     transparent black;
   - `ctx.drawImage(globeElement, sx, sy, boxSize, boxSize)` positioned from
     `globeCircle`, deriving the box the same way `Backdrop` does
     (`boxSize = (circle.radius / 0.4) * CAPTURE_SCALE`, where `0.4` is cobe's
     sphere-radius-as-fraction-of-canvas-width — the same
     `GLOBE_SURFACE_RADIUS_FRACTION` value `BeadScene` uses; re-declare it as a
     local constant rather than reaching into `BeadScene.tsx`,
     drawn centred on `circle.centerX/centerY * CAPTURE_SCALE`);
   - set `texture.needsUpdate = true`.

Because the scratch canvas is a 1:1 (scaled) copy of screen space, `u_tex0` can be
sampled with plain screen UVs. That removes the need for the reference's
`u_texture_fill` aspect-fit block and `u_tex0_resolution` uniform entirely.

Refraction outside the globe's footprint therefore distorts flat `--background`
and is visually a no-op. That is expected and correct — the droplet is still there
in alpha and specular, it just has nothing interesting to magnify.

`globeElement` and `globeCircle` are read from refs updated on every render (the
`globeRef.current = globeCircle` pattern already used at the top of `GlobeRain`),
so the effect body never re-runs when they change.

### Alpha, not opaque fullscreen

The reference shader writes `gl_FragColor = vec4(col, 1)` — it *is* the wallpaper.
Ours sits on top of the live globe, so writing opaque would replace the crisp,
60fps globe with a half-resolution copy refreshed every other frame.

Instead the fragment shader outputs **premultiplied-free RGBA with a
droplet-derived alpha**:

```glsl
float alpha = clamp(c.x + c.y * TRAIL_ALPHA, 0.0, 1.0);
gl_FragColor = vec4(col, alpha);
```

where `TRAIL_ALPHA` is a `#define` in the shader source (start at `0.35`, tune by
eye) that keeps trails visibly fainter than droplet bodies.

Outside droplets `alpha` is 0 and the real globe canvas shows through untouched at
full framerate and full resolution. Inside a droplet or its trail, the layer is
opaque and shows the refracted `u_tex0` sample. This inverts the reference's
compositing model and is the main structural adaptation of the port.

Consequence, accepted deliberately: there is no whole-pane defocus blur. The
reference blurs the entire background to sell "looking through wet glass," but
here that would permanently soften the globe — the app's primary object. Droplet
interiors sample sharp. The reference's `u_blur_intensity` /
`u_blur_iterations` / `N21` loop is dropped along with it.

### Adapted uniform set

Kept:

| Uniform | Type | Purpose |
| --- | --- | --- |
| `u_tex0` | `sampler2D` | The globe capture described above |
| `u_resolution` | `vec2` | Device-pixel viewport, for the `gl_FragCoord` → uv mapping |
| `u_time` | `float` | Seconds since mount, from a `THREE.Clock` |
| `u_intensity` | `float` | Feeds the retained `staticDrops` and `layer1` weights (the `layer2` weight goes away with the second falling layer) |
| `u_normal` | `float` | Scale on the refraction offset epsilon — i.e. how strongly droplets magnify |
| `u_speed` | `float` | Drip rate for the falling layer |
| `u_tint` | `vec3` | Accent-derived droplet tint (see *Theming*) |
| `u_tint_strength` | `float` | How much of that tint to mix in |

Dropped, with reasons:

- `u_tex0_resolution`, `u_texture_fill` — capture is already screen-aligned.
- `u_panning` and its `zoom = -cos(T * .2)` term — that pans a wallpaper; there is
  no wallpaper.
- `u_zoom` — baked as a constant, since droplet scale is a fixed design choice
  here, not a user setting.
- `u_brightness`, `u_post_processing` (the `mix(vec3(1.), vec3(.8,.9,1.3), 1.)`
  cool-shift) — colour grading belongs to the wallpaper app's look, not this
  design system.
- `u_lightning` and its flicker/flash terms — no.
- `u_blur_intensity`, `u_blur_iterations` — see above.
- The final `col *= 1. - dot(UV -= .5, UV)` vignette — would darken the whole
  frame; irrelevant once output is alpha-masked anyway.

Everything dropped is a uniform *and* its dependent code path; no dead branches
are left in the ported GLSL.

### Medium-fidelity tuning

Concretely, in the ported `Drops()`:

- **Keep** `StaticDrops()` at a high weight — this is the dominant layer, and it
  is what makes the pane read as "mostly still droplets clinging to glass."
- **Keep one** `DropLayer2(uv, t)` call, at a reduced `u_speed` (roughly a quarter
  of the reference's default) so drops hang, then slide, then reset, rather than
  raining continuously. Its `Saw(.85, ti)` gravity function and its `trail` output
  are exactly the "occasionally drips down leaving a fading trail" behaviour the
  medium tier calls for, so it is ported unchanged apart from the weight.
- **Drop** the second `DropLayer2(uv * 1.85, t)` call. Two overlapping falling
  layers at different scales is what makes the reference read as a downpour; one
  layer is the medium tier.

Start from `u_intensity` around 0.4 and `u_normal` around 1.0, tune both by eye in
both themes, then hard-code the final values as module constants (no props, no UI
controls) — the same "tune by eye and hard-code" instruction the dot-matrix spec
used for its opacities.

### Animation loop

One `requestAnimationFrame` loop in the same `useEffect`, structured exactly like
`GlobeRain`'s `tick()`:

```
tick(now):
  material.uniforms.u_time.value = clock.getElapsedTime()
  if (++frameCount % CAPTURE_UPDATE_EVERY_N_FRAMES === 0) recapture()
  renderer.render(scene, camera)
  rafId = requestAnimationFrame(tick)
```

No React state is written per frame — uniforms are mutated directly, matching
`GlobeRain`'s `tick()` and `dot-matrix-background.tsx`'s rAF-batched custom-property
writes. `cancelAnimationFrame` on cleanup.

### Placement and stacking

Identical to what `GlobeRain` renders today:

```tsx
<div className="pointer-events-none fixed inset-0 z-0">
  <canvas ref={canvasRef} className="h-full w-full" />
</div>
```

Mounted at the same position in `App.tsx`'s JSX — a sibling *after* the
`absolute inset-0` wrapper holding `GlobeView`, so it paints on top of the globe —
and gated on the same condition, `{!selected && ...}`.

### Theming

`resolveGlassRainColors()`, following `GlobeRain`'s `resolveRainColors()` and
`BeadScene`'s `resolveBeadColors()`:

- Reads `--background` (as the scratch-canvas fill) and `--accent` (as `u_tint`)
  from computed style at resolve time, so the `.dark` block in `src/index.css`
  swaps `#912f40` → `#c17b8a` and the light/dark background automatically.
- Re-resolved on a `theme` prop change inside a `useEffect` that wraps the read in
  **one `requestAnimationFrame`** — same documented reasoning as `GlobeRain`'s
  colour effect: the `.dark` class toggle happens in a sibling effect and child
  effects run before parent effects, so a synchronous read here could observe the
  stale theme.

`u_tint_strength` stays low (single-digit percent mix). The droplets are water:
their colour should come overwhelmingly from what they refract, with only a faint
wine-red cast to tie them to the palette. A strongly accent-coloured droplet would
read as decoration rather than glass.

### Reversibility

An explicit constraint, not an incidental property:

- `src/components/GlobeRain.tsx` is neither deleted nor modified. It keeps its
  exported helpers and its own spec
  (`docs/superpowers/specs/2026-08-01-globe-rain-design.md`).
- The only change to `App.tsx` is the import line and the single JSX line
  (currently `{!selected && <GlobeRain globeCircle={globeCircle} theme={theme} />}`)
  becoming `{!selected && <GlassRain globeCircle={globeCircle} theme={theme}
  globeElement={globeElement} />}`.
- Reverting is swapping those two lines back. Because `GlassRainProps` is a
  superset of `GlobeRainProps`, the reverse swap needs no other edits.

### Attribution

A comment at the top of the GLSL string crediting `rocksdanister/rain` and the
Heartfelt Rain lineage the technique comes from. The code is an adaptation, not a
copy, but the provenance is worth recording in-file.

### Verification

Manual, in both themes, with no country selected:

1. Droplets are visible over the globe and clearly show a *magnified, warped* slice
   of it — pause and confirm the globe's coastlines are legibly distorted inside a
   droplet, not just tinted.
2. The globe outside droplets stays sharp and smooth (the layer is not painting
   opaque over it).
3. Occasional drops slide downward leaving a trail that fades; most droplets stay
   put. Nothing looks like a downpour.
4. Selecting a country unmounts the layer cleanly; deselecting remounts it; no
   WebGL context-loss warning in the console after several cycles.
5. Resize and theme flip both behave.

## Out of scope

- **Not ported from the reference project**: the lightning flicker/flash terms,
  wallpaper panning/zoom animation, the multi-tap background blur loop
  (`u_blur_intensity` / `u_blur_iterations` / `N21`), the post-processing colour
  shift, the brightness control, the vignette, the aspect-fit `u_texture_fill`
  path, and video-texture support. None of them serve this app.
- **No droplet merging, no wind shear, no continuous downpour.** That is the
  "full" fidelity tier; the user chose medium.
- **No runtime controls.** All tuning values are hard-coded module constants — no
  props beyond the three above, no entry in `ControlPanel`.
- **No mobile or touch-specific handling** beyond what already exists: the layer is
  `pointer-events-none` and non-interactive, and inherits the app's existing
  desktop-demo posture.
- **No automated tests.** Purely decorative and non-interactive; verification is
  the manual checklist above. Same precedent as
  `2026-08-03-dot-matrix-background-design.md`.
- **`GlobeRain` is not deleted or refactored**, and its unit-testable exports are
  left alone.

## Scope assessment

This is one implementation plan, not several. It is a single new file plus a
two-line call-site swap; the GLSL port, the texture-capture wiring and the
alpha-compositing adaptation are all interdependent (none of them is
independently verifiable without the others), so splitting them would create
phases that cannot be checked in isolation. The riskiest single step is the
alpha-masked output — if droplets end up invisible or the whole frame goes opaque,
that is where to look first.
