# Glass Rain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `GlobeRain` (flat 2D-canvas falling streaks) with `GlassRain` — a ported "Heartfelt Rain" GLSL shader rendered on a plain three.js fullscreen quad, where droplets genuinely refract a live capture of the globe canvas, at a "medium fidelity" tier (mostly static droplets, one occasional slow-drip falling layer with a fading trail).

**Architecture:** One new self-contained component, `src/components/GlassRain.tsx`, doing imperative three.js setup inside a single `useEffect` (no React Three Fiber — this is one shader pass with no scene graph, mirroring how `cobe-globe.tsx` is already a plain imperative WebGL setup outside React's render cycle). It captures the live globe `<canvas>` into an offscreen 2D canvas each `CAPTURE_UPDATE_EVERY_N_FRAMES` frames (reusing `BeadScene.tsx`'s `Backdrop` capture pattern), uploads that as a `THREE.CanvasTexture` (`u_tex0`), and renders a `THREE.ShaderMaterial` whose fragment shader is a trimmed port of `rocksdanister/rain`'s `shaders/rain.frag`. `App.tsx` swaps its `GlobeRain` call site for `GlassRain`; `GlobeRain.tsx` itself is untouched, so reverting is a two-line change.

**Tech Stack:** `three` (already a direct dependency, currently only used via `@react-three/fiber`/`@react-three/rapier` in `BeadScene.tsx` — this task uses it directly/imperatively for the first time), plain GLSL (`THREE.ShaderMaterial`), no new npm dependency.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-glass-rain-design.md` — follow it exactly; values below are copied verbatim from it.
- `src/components/GlobeRain.tsx` must NOT be modified or deleted.
- `App.tsx` changes are limited to: the import line, and the single JSX line currently `{!selected && <GlobeRain globeCircle={globeCircle} theme={theme} />}` becoming `{!selected && <GlassRain globeCircle={globeCircle} theme={theme} globeElement={globeElement} />}`.
- No React state for animation-driven values — direct imperative writes inside a `requestAnimationFrame` loop.
- Device pixel ratio capped at 1.5 (`MAX_DEVICE_PIXEL_RATIO`), matching `GlobeRain`/`BeadScene`.
- Capture texture update throttled to every 2 frames (`CAPTURE_UPDATE_EVERY_N_FRAMES`), at half viewport resolution (`CAPTURE_SCALE = 0.5`) — matches `BeadScene.tsx`'s `Backdrop` (`BACKDROP_UPDATE_EVERY_N_FRAMES`) for the same GPU→CPU readback cost reason.
- Output is alpha-masked RGBA (`gl_FragColor = vec4(col, alpha)` where `alpha` derives from the droplet heightfield), NOT opaque — this sits on top of the live 60fps globe, it does not replace it.
- Placement/stacking identical to `GlobeRain` today: `<div className="pointer-events-none fixed inset-0 z-0"><canvas ... /></div>`, mounted only when `{!selected}`.
- Theming: colors resolved from CSS custom properties at paint time (`--background`, `--accent`), re-resolved on a `theme` prop change inside one `requestAnimationFrame` (child-effects-run-before-parent-effects timing, same documented reasoning as `GlobeRain`/`BeadScene`).
- Backdate this task's commit: `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` both `2026-07-31T19:00:00` (standing instruction for this work session).
- Update `PROGRESS.md` with a start entry and an end entry per this project's CLAUDE.md convention.
- Run `graphify update .` after the code change, before committing.
- No automated tests (purely decorative/non-interactive, per spec's "Out of scope" — manual visual check only).

---

### Task 1: Build `GlassRain` and swap it in at the `App.tsx` call site

**Files:**
- Create: `src/components/GlassRain.tsx`
- Modify: `src/App.tsx` (import line ~7, JSX line ~466)
- Modify: `PROGRESS.md` (start + end entries)

**Interfaces:**
- Produces: `GlassRain` — `function GlassRain(props: GlassRainProps): JSX.Element`, named export, where:
  ```ts
  export interface GlassRainProps {
    globeCircle: GlobeCircle | null
    theme: 'light' | 'dark'
    globeElement: HTMLCanvasElement | null
  }
  ```
  (`GlobeCircle` imported from `@/components/ui/cobe-globe`, same type `GlobeRainProps` already uses.)
- Consumes: `GLOBE_SURFACE_RADIUS_FRACTION` (exported constant, `src/components/ui/cobe-globe.tsx:85`) and `resolveAccentColor()` (`src/lib/resolveAccentColor.ts`, returns a `#rrggbb` hex string). Both already exist, no changes needed to either file.

- [ ] **Step 1: Write the shader source and component**

Write `src/components/GlassRain.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLOBE_SURFACE_RADIUS_FRACTION, type GlobeCircle } from '@/components/ui/cobe-globe'
import { resolveAccentColor } from '@/lib/resolveAccentColor'

// Ported from https://github.com/rocksdanister/rain (threejs branch,
// shaders/rain.frag) — the "Heartfelt Rain" technique (Martijn Steinrucken /
// Bruno Imbrizi lineage): procedurally generated droplets whose heightfield
// gradient doubles as a per-pixel refraction normal against a background
// texture. Adapted here to (a) refract a live capture of the globe canvas
// instead of a static wallpaper image, (b) output alpha-masked RGBA instead
// of an opaque fullscreen fill, since this sits on top of the live globe
// rather than being the whole picture, and (c) drop every reference-project
// feature irrelevant to this app (lightning, panning, blur passes, colour
// grading, vignette, the second falling-drop layer — see
// docs/superpowers/specs/2026-08-03-glass-rain-design.md for the full
// rationale on each cut).
const VERTEX_SHADER = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_tex0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform float u_intensity;
uniform float u_normal;
uniform vec3 u_tint;
uniform float u_tint_strength;

#define S(a, b, t) smoothstep(a, b, t)
#define TRAIL_ALPHA 0.35

vec3 N13(float p) {
  vec3 p3 = fract(vec3(p) * vec3(.1031, .11369, .13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}

float N(float t) {
  return fract(sin(t * 12345.564) * 7658.76);
}

float Saw(float b, float t) {
  return S(0., b, t) * S(1., b, t);
}

// The falling-drop layer: hangs, slides under a gravity sawtooth, wiggles
// side to side, and leaves a fading trail behind it as it falls. The
// reference stacks two of these at different scales for a downpour look;
// this app's medium-fidelity tier only ever calls this once.
vec2 DropLayer2(vec2 uv, float t) {
  vec2 UV = uv;

  uv.y += t * .75;
  vec2 a = vec2(6., 1.);
  vec2 grid = a * 2.;
  vec2 id = floor(uv * grid);

  float colShift = N(id.x);
  uv.y += colShift;

  id = floor(uv * grid);
  vec3 n = N13(id.x * 35.2 + id.y * 2376.1);
  vec2 st = fract(uv * grid) - vec2(.5, 0);

  float x = n.x - .5;

  float y = UV.y * 20.;
  float wiggle = sin(y + sin(y));
  x += wiggle * (.5 - abs(x)) * (n.z - .5);
  x *= .7;
  float ti = fract(t + n.z);
  y = (Saw(.85, ti) - .5) * .9 + .5;
  vec2 p = vec2(x, y);

  float d = length((st - p) * a.yx);
  float mainDrop = S(.4, .0, d);

  float r = sqrt(S(1., y, st.y));
  float cd = abs(st.x - x);
  float trail = S(.23 * r, .15 * r * r, cd);
  float trailFront = S(-.02, .02, st.y - y);
  trail *= trailFront * r * r;

  y = UV.y;
  float trail2 = S(.2 * r, .0, cd);
  float droplets = max(0., (sin(y * (1. - y) * 120.) - st.y)) * trail2 * trailFront * n.z;
  y = fract(y * 10.) + (st.y - .5);
  float dd = length(st - vec2(x, y));
  droplets = S(.3, 0., dd);
  float m = mainDrop + droplets * r * trailFront;

  return vec2(m, trail);
}

// Droplets clinging to the glass, each individually fading in and out on
// its own short cycle rather than falling — the dominant layer at this
// app's medium-fidelity tier.
float StaticDrops(vec2 uv, float t) {
  uv *= 40.;
  vec2 id = floor(uv);
  uv = fract(uv) - .5;
  vec3 n = N13(id.x * 107.45 + id.y * 3543.654);
  vec2 p = (n.xy - .5) * .7;
  float d = length(uv - p);
  float fade = Saw(.025, fract(t + n.z));
  return S(.3, 0., d) * fract(n.z * 10.) * fade;
}

// Composites the static layer with the one falling layer into a single
// heightfield (x) plus a trail-alpha channel (y).
vec2 Drops(vec2 uv, float t, float staticWeight, float fallWeight) {
  float s = StaticDrops(uv, t) * staticWeight;
  vec2 fall = DropLayer2(uv, t) * fallWeight;
  float c = S(.3, 1., s + fall.x);
  // Trail gated by the falling layer's OWN weight — the reference's
  // max(m1.y * l0, m2.y * l1) mixes both falling layers' weights because
  // it has two to arbitrate between; with only one, gating its trail on its
  // own intensity (not the unrelated static-layer weight) is the sensible
  // reading, not a literal copy of that expression.
  return vec2(c, fall.y * fallWeight);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - .5 * u_resolution.xy) / u_resolution.y;
  vec2 UV = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * .2 * u_speed;

  uv *= .7;

  float staticWeight = S(-.5, 1., u_intensity) * 2.;
  float fallWeight = S(.25, .75, u_intensity);

  vec2 c = Drops(uv, t, staticWeight, fallWeight);

  vec2 e = vec2(.001, 0.) * u_normal;
  float cx = Drops(uv + e, t, staticWeight, fallWeight).x;
  float cy = Drops(uv + e.yx, t, staticWeight, fallWeight).x;
  vec2 n = vec2(cx - c.x, cy - c.x);

  vec3 col = texture2D(u_tex0, UV + n).rgb;
  col = mix(col, u_tint, u_tint_strength);

  float alpha = clamp(c.x + c.y * TRAIL_ALPHA, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`

export interface GlassRainProps {
  globeCircle: GlobeCircle | null
  theme: 'light' | 'dark'
  globeElement: HTMLCanvasElement | null
}

// Capped like GlobeRain's own MAX_DEVICE_PIXEL_RATIO and BeadScene's
// <Canvas dpr={[1, 1.5]}> — crisp rendering without paying for a full 2-3x
// device pixel ratio's worth of fragments on every frame, doubly so here
// since every fragment runs the droplet/refraction math twice more (the
// normal-epsilon samples).
const MAX_DEVICE_PIXEL_RATIO = 1.5

// Half viewport resolution for the captured background texture — it is
// only ever seen through droplet-sized magnifying lenses, never displayed
// directly, so full resolution buys nothing. Halves the GPU->CPU readback
// cost in each dimension (see BeadScene.tsx's Backdrop / BACKDROP_SCALE
// comment for the same reasoning applied to that component's own capture).
const CAPTURE_SCALE = 0.5

// Every other frame only, matching BeadScene.tsx's Backdrop
// (BACKDROP_UPDATE_EVERY_N_FRAMES) — ctx.drawImage() off a live WebGL
// canvas is a GPU->CPU readback, and texture.needsUpdate then re-uploads
// the full result back to the GPU; the globe rotates slowly enough that
// this doesn't need 60fps freshness to read as smooth.
const CAPTURE_UPDATE_EVERY_N_FRAMES = 2

// Tuned by eye per the spec's "medium fidelity" tier: mostly static
// droplets (high staticWeight via u_intensity), one slow falling layer
// (low u_speed relative to the reference's continuous-downpour default),
// moderate refraction strength, and a faint accent tint so droplets read
// as tied to this app's palette without looking tinted rather than clear.
const DEFAULT_INTENSITY = 0.4
const DEFAULT_NORMAL_STRENGTH = 1.0
const DEFAULT_SPEED = 0.25
const DEFAULT_TINT_STRENGTH = 0.06

// Duplicated from resolveAccentColor.ts on purpose, not imported — see
// that file's own comment for why (no dependency on a file that may be
// under concurrent, unrelated edits). Painting onto a 1x1 canvas and
// reading the rasterised pixel back is the one technique guaranteed
// correct regardless of how the browser serialises a color (oklch()
// included — canvas 2D contexts perform real color-space conversion here,
// unlike a hand-rolled string parser).
function normalizeCssColor(value: string, fallback: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return fallback
  ctx.fillStyle = fallback
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function hexToUnitRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

interface GlassRainColors {
  /** Hex string, valid as a canvas 2D fillStyle directly. */
  background: string
  tint: [number, number, number]
}

function resolveGlassRainColors(): GlassRainColors {
  const backgroundRaw = getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
  return {
    background: normalizeCssColor(backgroundRaw, '#000000'),
    tint: hexToUnitRgb(resolveAccentColor()),
  }
}

// Plain imperative three.js, not React Three Fiber: this is a single
// fullscreen shader pass with no scene graph, matching how cobe-globe.tsx
// is already a plain imperative WebGL setup living outside React's render
// cycle inside a useEffect. A third WebGL surface in the codebase, but
// never a third LIVE one — GlassRain mounts only when !selected, and
// BeadScene mounts only when a country IS selected, so at most two
// contexts (cobe's globe + one of these two) are ever live at once, same
// budget GlobeRain's own header comment already describes.
export function GlassRain({ globeCircle, theme, globeElement }: GlassRainProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const circleRef = useRef<GlobeCircle | null>(globeCircle)
  circleRef.current = globeCircle
  const elementRef = useRef<HTMLCanvasElement | null>(globeElement)
  elementRef.current = globeElement

  // Re-resolved on theme flip via one rAF — same reasoning as GlobeRain's
  // own colour effect and BeadScene's resolveBeadColors effect: the .dark
  // class toggle happens in a sibling effect, and child effects run before
  // parent effects, so a synchronous read here could observe the stale
  // theme.
  const colorsRef = useRef<GlassRainColors>(resolveGlassRainColors())
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      colorsRef.current = resolveGlassRainColors()
    })
    return () => cancelAnimationFrame(id)
  }, [theme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(dpr)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const captureCanvas = document.createElement('canvas')
    const captureCtx = captureCanvas.getContext('2d')
    const captureTexture = new THREE.CanvasTexture(captureCanvas)
    captureTexture.colorSpace = THREE.SRGBColorSpace

    const initialColors = colorsRef.current
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      uniforms: {
        u_tex0: { value: captureTexture },
        u_resolution: { value: new THREE.Vector2() },
        u_time: { value: 0 },
        u_speed: { value: DEFAULT_SPEED },
        u_intensity: { value: DEFAULT_INTENSITY },
        u_normal: { value: DEFAULT_NORMAL_STRENGTH },
        u_tint: { value: new THREE.Vector3(...initialColors.tint) },
        u_tint_strength: { value: DEFAULT_TINT_STRENGTH },
      },
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    scene.add(mesh)

    function resize() {
      const width = window.innerWidth
      const height = window.innerHeight
      renderer.setSize(width, height)
      const uResolution = material.uniforms.u_resolution.value as THREE.Vector2
      uResolution.set(width * dpr, height * dpr)
      captureCanvas.width = Math.max(1, Math.round(width * CAPTURE_SCALE))
      captureCanvas.height = Math.max(1, Math.round(height * CAPTURE_SCALE))
    }
    resize()
    window.addEventListener('resize', resize)

    function recapture() {
      if (!captureCtx) return
      const w = captureCanvas.width
      const h = captureCanvas.height
      captureCtx.fillStyle = colorsRef.current.background
      captureCtx.fillRect(0, 0, w, h)
      const circle = circleRef.current
      const element = elementRef.current
      if (circle && element) {
        const boxSize = Math.max(1, Math.round((circle.radius / GLOBE_SURFACE_RADIUS_FRACTION) * CAPTURE_SCALE))
        const cx = circle.centerX * CAPTURE_SCALE
        const cy = circle.centerY * CAPTURE_SCALE
        captureCtx.drawImage(element, cx - boxSize / 2, cy - boxSize / 2, boxSize, boxSize)
      }
      captureTexture.needsUpdate = true
    }

    const tintVec = material.uniforms.u_tint.value as THREE.Vector3
    const clock = new THREE.Clock()
    let frameCount = 0
    let rafId: number
    function tick() {
      material.uniforms.u_time.value = clock.getElapsedTime()
      tintVec.set(...colorsRef.current.tint)
      frameCount++
      if (frameCount % CAPTURE_UPDATE_EVERY_N_FRAMES === 0) recapture()
      renderer.render(scene, camera)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(rafId)
      mesh.geometry.dispose()
      material.dispose()
      captureTexture.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
```

- [ ] **Step 2: Swap the call site in `App.tsx`**

Change the import (currently `import { GlobeRain } from '@/components/GlobeRain'`):

```tsx
import { GlassRain } from '@/components/GlassRain'
```

Change the render call (currently `{!selected && <GlobeRain globeCircle={globeCircle} theme={theme} />}`):

```tsx
{!selected && <GlassRain globeCircle={globeCircle} theme={theme} globeElement={globeElement} />}
```

`globeElement` is already in scope at this point in `App.tsx` (existing state, already passed to `BeadScene` a few lines above).

- [ ] **Step 3: Typecheck and lint**

Run: `npm run build` (this project's actual build command is `tsc -b && vite build` — a bare `npx tsc --noEmit` throws an unrelated pre-existing `baseUrl` deprecation error that does not reproduce under `tsc -b`, per this project's own prior precedent; use `npm run build` as the real check)
Expected: succeeds, no type errors.

Run: `npx oxlint src/components/GlassRain.tsx src/App.tsx`
Expected: no errors.

- [ ] **Step 4: Manual visual check in the running dev server**

Start the dev server preview, open the app with no country selected, and confirm in both light and dark mode:
- Droplets are visible over the globe and clearly show a magnified, warped slice of it (coastlines/markers visibly distorted inside a droplet, not just tinted) — if the globe instead looks mirrored/upside-down inside droplets, the capture-to-shader UV orientation needs a `captureTexture.flipY` fix (start from three.js's `CanvasTexture` default of `flipY = true` and flip only if the visual check shows it's wrong).
- The globe outside droplets stays sharp, smooth, and at full framerate (this layer is not painting opaque over it).
- Most droplets stay put; occasionally one slides down leaving a fading trail. Nothing looks like a downpour.
- Selecting a country unmounts the layer cleanly (globe rain disappears, `BeadScene` takes over); deselecting remounts it. No WebGL context-loss warning in the console after a few cycles.
- Resize and theme toggle both behave — droplets keep the accent tint's hue shift between light/dark, and the capture doesn't visibly misalign after a resize.

- [ ] **Step 5: Update PROGRESS.md**

Append a start entry and an end entry describing what was built, per this project's terse running-log convention. Note explicitly that visual confirmation of the shader's actual on-screen look (droplet distortion correctness, UV orientation, tuning) could not be done in this sandbox if the Browser pane doesn't composite frames (a recurring, previously-documented limitation in this project) — flag it as needing a live human check, same as prior entries have done.

- [ ] **Step 6: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\Albert.T4\3D Objects\hack-the-arts-addk-2026"
git add src/components/GlassRain.tsx src/App.tsx PROGRESS.md
GIT_AUTHOR_DATE="2026-07-31T19:00:00" GIT_COMMITTER_DATE="2026-07-31T19:00:00" git commit -m "Add GlassRain: refracting droplet shader replacing GlobeRain"
```
