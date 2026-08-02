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
// grading, vignette) — see
// docs/superpowers/specs/2026-08-03-glass-rain-design.md for the original
// "medium fidelity" rationale. Both falling-drop layers are kept (unlike
// that original design) per explicit follow-up feedback wanting a genuine
// heavy-rain-on-a-window read rather than occasional drips — see
// PROGRESS.md, "GlassRain: heavy rain".
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
// side to side, and leaves a fading trail behind it as it falls. Called
// twice at different scales (see Drops, below) for the heavy-downpour look.
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
// its own short cycle rather than falling.
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

// Composites the static layer with BOTH falling layers (the second sampled
// at 1.85x scale, exactly as the reference does) into a single heightfield
// (x) plus a trail-alpha channel (y) — two overlapping falling layers at
// different scales is what makes this read as a downpour rather than
// occasional drips.
vec2 Drops(vec2 uv, float t, float staticWeight, float fallWeight1, float fallWeight2) {
  float s = StaticDrops(uv, t) * staticWeight;
  vec2 fall1 = DropLayer2(uv, t) * fallWeight1;
  vec2 fall2 = DropLayer2(uv * 1.85, t) * fallWeight2;
  float c = S(.3, 1., s + fall1.x + fall2.x);
  return vec2(c, max(fall1.y * fallWeight1, fall2.y * fallWeight2));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - .5 * u_resolution.xy) / u_resolution.y;
  vec2 UV = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * .2 * u_speed;

  // The reference multiplies by (.7 + zoom * .3) * u_zoom, where u_zoom
  // defaults to 2.61 (js/script.js's dat.gui init) — this port dropped
  // u_panning/zoom (no wallpaper to pan) but silently left u_zoom at an
  // implicit 1 instead of baking in its real default, leaving droplets
  // 2.61x oversized linearly (~6.8x in area) since the original port. See
  // PROGRESS.md, "GlassRain: fix oversized droplets (dropped u_zoom)".
  uv *= .7 * 2.61;

  float staticWeight = S(-.5, 1., u_intensity) * 2.;
  float fallWeight1 = S(.25, .75, u_intensity);
  float fallWeight2 = S(.0, .5, u_intensity);

  vec2 c = Drops(uv, t, staticWeight, fallWeight1, fallWeight2);

  vec2 e = vec2(.001, 0.) * u_normal;
  float cx = Drops(uv + e, t, staticWeight, fallWeight1, fallWeight2).x;
  float cy = Drops(uv + e.yx, t, staticWeight, fallWeight1, fallWeight2).x;
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

// Tuned for a genuine heavy-rain-on-a-window read (superseding this
// project's original "medium fidelity, occasional drips" design — see
// PROGRESS.md, "GlassRain: heavy rain", for why): high u_intensity pushes
// BOTH falling-layer weights (fallWeight1/fallWeight2 in the shader) up
// together with the static layer, and both DropLayer2 calls are active
// (see Drops, above) — two overlapping falling layers at different scales
// is specifically what the reference shader relies on to read as a
// downpour rather than scattered drips.
//
// u_speed re-tuned alongside the uv-zoom fix above (see PROGRESS.md,
// "GlassRain: fix oversized droplets") — with droplets correctly sized,
// the previous 3.5 (tuned against the oversized/mis-scaled droplet field)
// read too fast; 2.5 gives a ~2s fall cycle, fast and continuous without
// strobing the static layer's own repopulation cycle.
//
// u_normal (refraction displacement strength) also scales with the uv
// zoom — left at the pre-fix 1.0 it would refract 2.61x more strongly
// than the reference's own tuning intended; 0.5 matches the reference's
// own u_normal default.
const DEFAULT_INTENSITY = 0.75
const DEFAULT_NORMAL_STRENGTH = 0.5
const DEFAULT_SPEED = 2.5
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
