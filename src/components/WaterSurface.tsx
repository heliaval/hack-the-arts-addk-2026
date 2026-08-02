import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { GLOBE_SURFACE_RADIUS_FRACTION, type GlobeCircle } from '@/components/ui/cobe-globe'

// The bead scene's water layer: the backdrop plane, rendered through a
// ripple shader instead of a flat meshBasicMaterial.
//
// WHY THIS IS THE BACKDROP PLANE ITSELF rather than a new layer on top of
// it -- this is the load-bearing architectural decision, do not "simplify"
// it into a separate mesh later:
//
//  - A DOM canvas layer behind the beads is physically impossible in this
//    app. BeadScene's backdrop is an OPAQUE full-viewport plane inside a
//    `fixed inset-0 z-0` <Canvas> that sits later in App's tree than
//    DotMatrixBackground, so it occludes every DOM layer behind it
//    wholesale. That is the entire reason DotMatrixAtmosphere exists (see
//    its own comment). The only reachable DOM slot is ABOVE the canvas,
//    i.e. in front of the beads -- the opposite of what this effect is.
//  - A separate transparent plane at z=-418 would work depth-wise but
//    could only ADD light over the backdrop, never refract it. Refracting
//    a known-straight dot lattice is the single strongest "this is water"
//    cue available, and it costs one texture fetch this plane was already
//    paying for.
//  - Reusing this plane means ZERO new meshes, ZERO new draw calls, ZERO
//    new textures and ZERO new per-frame texture uploads. The base texture
//    still uploads exactly once per theme/resize (see useBackdropBase);
//    BACKDROP_SCALE=1's per-frame-reupload constraint is never approached.
//
// The technique (procedural heightfield whose gradient doubles as a
// per-pixel refraction normal against a background texture) is the same
// family as GlassRain.tsx, which already ships in this repo. This version
// is cheaper: the gradient is derived ANALYTICALLY, so each fragment
// evaluates the ripple field once, where GlassRain evaluates it three
// times for a finite-difference epsilon.

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Every length here is in CSS pixels, matching the rest of BeadScene (see
// that file's top-of-file orthographic-camera note).
//
// The wave model is a radially expanding WAVE PACKET, not a wave equation:
// a ~3-crest cosine burst inside a sin^2 envelope, riding outward at a
// fixed speed, decaying with both age and distance. Ripples sum linearly
// and do not reflect off the globe or the screen edges -- at this density
// (steady-state ~7 live, each a 90px-thick annulus) there is nothing to
// interfere with, so a real wave-equation ping-pong sim would cost two
// extra fullscreen passes per frame to produce a difference nobody can see.
//
// The gradient is closed-form. Treating `decay` and `atten` as constant in
// r while differentiating (they vary over hundreds of px; the wave varies
// over 30px) makes the derivative exact enough to be visually
// indistinguishable, and turns three field evaluations into one.
const FRAGMENT_SHADER = `
precision highp float;

#define MAX_RIPPLES 10
#define PI 3.14159265359

uniform sampler2D u_base;
uniform vec2 u_resolution;
uniform float u_time;
/** (x, y, birthTimeSeconds, amplitude) per slot, in DOM pixels (top-left
 *  origin, +y down). amplitude <= 0 means "empty slot". */
uniform vec4 u_ripples[MAX_RIPPLES];
/** Cursor in the same DOM pixel space. */
uniform vec2 u_cursor;
uniform float u_specular;
uniform float u_shade;
uniform vec3 u_sheen;

varying vec2 vUv;

const float RIPPLE_LIFE_S = 2.6;
const float RIPPLE_SPEED_PX_S = 165.0;
const float PACKET_PX = 90.0;
const float WAVELENGTH_PX = 30.0;
const float ATTEN_FALLOFF_PX = 300.0;
const float REFRACT_PX = 26.0;
const float SLOPE_SCALE = 2.5;
const float SHININESS = 48.0;
// Slope magnitude at which specular reaches full strength. Also what
// guarantees FLAT water gets exactly no highlight: at grad == 0 this gate
// is 0, so neither lobe can tint a still surface.
const float SPEC_GATE = 12.0;
// Matches AtmosphereLayers' own radial-gradient(circle 340px ...) so the
// water's specular response and the DOM sheen share one footprint.
const float SHEEN_RADIUS_PX = 340.0;
const float SHEEN_HEIGHT_PX = 240.0;

// normalize(vec3(-0.6, 0.8, 0.35)) -- upper-left key light, in SCREEN space
// with +y UP. GLSL ES 1.00 cannot call normalize() in a const initializer,
// so both this and its half-vector are precomputed. Same light direction
// GlobeRain's SCENE_LIGHT_DIR uses, so the two scenes agree on where the
// light is coming from.
const vec3 KEY_LIGHT = vec3(-0.56631, 0.75508, 0.33035);
// normalize(KEY_LIGHT + vec3(0,0,1)); the view vector is (0,0,1) exactly,
// because the camera is orthographic.
const vec3 KEY_HALF = vec3(-0.34719, 0.46291, 0.81559);

void main() {
  // vUv.y = 1 is the TOP of the plane, and CanvasTexture's default
  // flipY = true maps canvas row 0 (viewport top) to uv.y = 1 -- so this
  // converts to DOM pixel space (top-left origin, +y down), which is the
  // space every ripple/cursor coordinate arrives in.
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * u_resolution;

  // dh/dx, dh/dy of the summed height field, in DOM-y-down space.
  vec2 grad = vec2(0.0);

  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 ripple = u_ripples[i];
    if (ripple.w <= 0.0) continue;
    float age = u_time - ripple.z;
    if (age < 0.0 || age > RIPPLE_LIFE_S) continue;
    vec2 delta = p - ripple.xy;
    float dist = length(delta);
    // Distance BEHIND the expanding leading edge. The two rejects below
    // are what keep the real cost far under the worst case: a fragment
    // only pays for the sin/cos work of ripples whose 90px-thick
    // wavefront is currently crossing it.
    float d = age * RIPPLE_SPEED_PX_S - dist;
    if (d < 0.0 || d > PACKET_PX) continue;

    float decay = 1.0 - age / RIPPLE_LIFE_S;
    decay *= decay;
    float atten = 1.0 / (1.0 + dist / ATTEN_FALLOFF_PX);
    float weight = ripple.w * decay * atten;

    float envRoot = sin(PI * d / PACKET_PX);
    float env = envRoot * envRoot;
    float envDeriv = 2.0 * envRoot * cos(PI * d / PACKET_PX) * (PI / PACKET_PX);

    float k = 2.0 * PI / WAVELENGTH_PX;
    float carrier = cos(k * d);
    float carrierDeriv = sin(k * d);

    // d(env*carrier)/dr, with dd/dr = -1.
    float dhdr = -weight * (envDeriv * carrier - env * k * carrierDeriv);
    grad += dhdr * (delta / max(dist, 1.0));
  }

  // Refraction: push the sample point along the slope. The y flip converts
  // the DOM-y-down gradient into uv space, where +v is up.
  vec2 uv = clamp(vUv + vec2(grad.x, -grad.y) * REFRACT_PX / u_resolution, 0.0, 1.0);
  vec3 col = texture2D(u_base, uv).rgb;

  // Surface normal in y-UP screen space: the y-up derivative of the height
  // field is -grad.y, and a normal is the negated gradient, so N.y = grad.y.
  vec3 normal = normalize(vec3(-grad.x * SLOPE_SCALE, grad.y * SLOPE_SCALE, 1.0));

  // Broad shading: brightens slopes facing the key light, darkens those
  // facing away. Subtracting KEY_LIGHT.z makes this EXACTLY zero on flat
  // water, so it can never tint a still backdrop. This is what carries the
  // effect in the light theme, where additive white highlights on a
  // near-white base (#fffffa) would be invisible.
  col += (dot(normal, KEY_LIGHT) - KEY_LIGHT.z) * u_shade;

  // Specular lobe 1: the fixed key light.
  float specKey = pow(max(dot(normal, KEY_HALF), 0.0), SHININESS);

  // Specular lobe 2: the cursor sheen, as a real point light at the same
  // screen position and the same 340px falloff radius the DOM sheen layer
  // uses -- so crests genuinely glint where the atmosphere glow falls,
  // rather than the glow merely sitting on top of them.
  vec2 toCursor = vec2(u_cursor.x - p.x, p.y - u_cursor.y);
  float sheenFall = 1.0 - clamp(length(toCursor) / SHEEN_RADIUS_PX, 0.0, 1.0);
  sheenFall *= sheenFall;
  vec3 sheenDir = normalize(vec3(toCursor, SHEEN_HEIGHT_PX));
  vec3 sheenHalf = normalize(sheenDir + vec3(0.0, 0.0, 1.0));
  float specSheen = pow(max(dot(normal, sheenHalf), 0.0), SHININESS) * sheenFall;

  float gate = min(1.0, length(grad) * SPEC_GATE);
  col += (specKey * 0.55 + specSheen * u_sheen) * u_specular * gate;

  gl_FragColor = vec4(col, 1.0);
}
`

// Must match the shader's own RIPPLE_LIFE_S / MAX_RIPPLES.
const MAX_RIPPLES = 10
const RIPPLE_LIFE_S = 2.6

// Ambient, data-independent rain. Deliberately NOT tied to
// BATCH_SPAWN_INTERVAL_MS: a batch is capped at 25 births + 25 deaths and
// drains in ~3 seconds, after which the water would sit perfectly dead for
// the rest of the session -- an effect that stops. Beads also all spawn
// from one narrow band at screen top (SPAWN_JITTER_PX), so a ripple
// anywhere else carries no perceivable correspondence to the bead that
// "caused" it. GlobeRain, this app's own rain precedent, is atmospheric
// for the same reasons.
//
// Steady state: 2.6s lifetime / 0.34s mean interval ~= 7.6 live ripples,
// so MAX_RIPPLES = 10 is a backstop rather than a clamp.
const SPAWN_MIN_MS = 160
const SPAWN_MAX_MS = 520
const AMPLITUDE_MIN = 0.7
const AMPLITUDE_MAX = 1.3

// Hardcoded per theme, for the reason BACKDROP_COLORS spells out in
// BeadScene.tsx -- except these are pure numbers, so there is nothing to
// resolve from CSS at all. Light mode leans on `shade` (a near-white base
// cannot show additive white highlights); dark mode leans on `specular`.
const WATER_THEME = {
  light: { specular: 0.32, shade: 0.5 },
  dark: { specular: 0.6, shade: 0.35 },
} as const

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// Same 1x1-canvas readback every colour resolve in this codebase uses --
// the only technique guaranteed correct for --sheen, which is a literal
// hex in the light theme and oklch() in the dark one.
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

function resolveSheenRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--sheen').trim()
  const hex = normalizeCssColor(raw, '#912f40')
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** A uniform-random point on the water, rejecting the globe's own square
 * box -- that region is covered by Backdrop's z=-419 composite plane, so a
 * ripple there would be invisible and would waste a slot. Gives up after a
 * few tries and skips the spawn rather than looping, since the box is only
 * ever a small fraction of the viewport. */
function pickSpawnPoint(
  width: number,
  height: number,
  circle: GlobeCircle | null,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 5; attempt++) {
    const x = Math.random() * width
    const y = Math.random() * height
    if (!circle) return { x, y }
    // Same box-from-radius formula Backdrop's boxSize uses.
    const half = circle.radius / GLOBE_SURFACE_RADIUS_FRACTION / 2
    if (Math.abs(x - circle.centerX) > half || Math.abs(y - circle.centerY) > half) {
      return { x, y }
    }
  }
  return null
}

export function WaterSurface({
  texture,
  width,
  height,
  theme,
  circle,
}: {
  texture: THREE.Texture
  width: number
  height: number
  theme: 'light' | 'dark'
  circle: GlobeCircle | null
}) {
  // Created once for the component's whole life. Ripple state lives in the
  // uniform's own Vector4s and is written ONLY at spawn -- the animation
  // itself is a pure function of u_time, so the per-frame CPU cost of this
  // entire effect is one float write.
  const material = useMemo(() => {
    const themeValues = WATER_THEME[theme]
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_base: { value: null as THREE.Texture | null },
        u_resolution: { value: new THREE.Vector2(1, 1) },
        u_time: { value: 0 },
        u_ripples: {
          value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)),
        },
        u_cursor: { value: new THREE.Vector2(-9999, -9999) },
        u_specular: { value: themeValues.specular },
        u_shade: { value: themeValues.shade },
        u_sheen: { value: new THREE.Vector3(0.57, 0.18, 0.25) },
      },
    })
    // theme is deliberately NOT a dependency -- the two theme-driven values
    // are plain uniforms, updated in place by the effect below. Rebuilding
    // the material would recompile the shader program on every theme flip.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    material.uniforms.u_base.value = texture
  }, [material, texture])

  useEffect(() => {
    ;(material.uniforms.u_resolution.value as THREE.Vector2).set(width, height)
  }, [material, width, height])

  // Theme values + the sheen colour, re-resolved one rAF after the flip --
  // the exact pattern resolveBeadColors uses further down BeadScene.tsx and
  // GlobeRain/GlassRain both mirror. BACKDROP_COLORS' "hardcode it" rule
  // does not apply here: that constraint is about a RENDER-time read inside
  // a useMemo (which runs before App's useTheme effect has toggled .dark);
  // a uniform written from an effect has the escape hatch a useMemo lacks,
  // and --sheen is oklch() in dark mode, i.e. exactly the kind of value a
  // hand-conversion gets wrong.
  useEffect(() => {
    const themeValues = WATER_THEME[theme]
    material.uniforms.u_specular.value = themeValues.specular
    material.uniforms.u_shade.value = themeValues.shade
    const id = requestAnimationFrame(() => {
      const [r, g, b] = resolveSheenRgb()
      ;(material.uniforms.u_sheen.value as THREE.Vector3).set(r, g, b)
    })
    return () => cancelAnimationFrame(id)
  }, [material, theme])

  // Plain mutable ref rather than React state, same reasoning as
  // MouseLight's own targetRef in BeadScene.tsx: pointermove fires far
  // faster than React commits and this only feeds a uniform.
  useEffect(() => {
    const cursor = material.uniforms.u_cursor.value as THREE.Vector2
    function handlePointerMove(event: PointerEvent) {
      cursor.set(event.clientX, event.clientY)
    }
    function handlePointerLeave() {
      cursor.set(-9999, -9999)
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    document.addEventListener('pointerleave', handlePointerLeave)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [material])

  // Shared clock between useFrame and the setTimeout-driven spawner below.
  // A spawn can be up to one frame (~16ms) stale against u_time, which at
  // 165 px/s is a 2.7px error in the ripple's initial radius -- invisible.
  const elapsedRef = useRef(0)

  // Fixed-cap pool, oldest evicted on overflow -- the same discipline
  // GlobeRain's own Ripple pool uses (see spawnRipple there). Everything
  // else about that file's spawner (130-object Drop pools, depth tiers, the
  // fall/wrap/release state machine, globe-band biasing) has no analogue
  // here, which is why this is a fresh ~20 lines rather than an import: a
  // "drop" in this effect is invisible and its entire existence is
  // (x, y, birth, amplitude).
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  const circleRef = useRef<GlobeCircle | null>(circle)
  circleRef.current = circle

  useEffect(() => {
    const slots = material.uniforms.u_ripples.value as THREE.Vector4[]
    let timeoutId = 0
    let cancelled = false

    function spawn() {
      const { width: w, height: h } = sizeRef.current
      const point = pickSpawnPoint(w, h, circleRef.current)
      if (!point) return
      const now = elapsedRef.current
      let target = slots[0]
      for (const slot of slots) {
        // Free slot: never used, or its ripple has already expired.
        if (slot.w <= 0 || now - slot.z > RIPPLE_LIFE_S) {
          target = slot
          break
        }
        // Otherwise fall back to evicting the oldest.
        if (slot.z < target.z) target = slot
      }
      target.set(point.x, point.y, now, randomBetween(AMPLITUDE_MIN, AMPLITUDE_MAX))
    }

    function schedule() {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return
        spawn()
        schedule()
      }, randomBetween(SPAWN_MIN_MS, SPAWN_MAX_MS))
    }
    schedule()

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [material])

  useFrame((state) => {
    elapsedRef.current = state.clock.getElapsedTime()
    material.uniforms.u_time.value = elapsedRef.current
  })

  return (
    <mesh position={[0, 0, -420]}>
      <planeGeometry args={[width, height]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
