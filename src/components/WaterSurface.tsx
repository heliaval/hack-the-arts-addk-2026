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
uniform float u_pivot;
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

// --- Ambient swell -------------------------------------------------------
// Three directional sines, summed as a GRADIENT rather than a height: for
// h = sum(Ai * sin(Ki * dot(p, Di) + wi*t)), dh/dp = sum(Ai*Ki*Di*cos(...)),
// so parameterising by the gradient amplitude directly (SWELL_AMP * weight
// == Ai*Ki) is the same field, one multiply cheaper, and -- load-bearing --
// still a TRUE gradient of a real height field, which is what lets it feed
// the same normal/refraction path the ripples use without the two
// disagreeing about which way the surface is tilted.
//
// Deliberately NOT a second octave of wave-packet math: three cos() and a
// dot() each is a fixed, branch-free ~4 transcendentals per fragment, where
// a second packet loop would multiply the loop cost.
//
// Directions are hand-picked unit vectors at unrelated angles (no shared
// factor between the three, so the sum has no visible tiling period), and
// wavenumbers are ~600px/475px/340px wavelengths -- far longer than the
// ripples' 30px carrier, so this reads as the surface breathing rather
// than as a second, finer ripple.
const vec2 SWELL_D1 = vec2( 0.9042,  0.4271);
const vec2 SWELL_D2 = vec2(-0.4322,  0.9018);
const vec2 SWELL_D3 = vec2( 0.8823, -0.4707);
const float SWELL_AMP = 0.007;

// Per-ripple elongation, as a fraction: +ANISO along a per-ripple axis,
// -ANISO across it, so wavefronts are ellipses of ~1.25:1 at random
// orientations instead of ten identical stamped circles.
const float ANISO = 0.11;

// Cursor-local texture reveal, the shader-side replacement for the DOM
// atmosphere layer's brick pane (removed -- see dot-matrix-background.tsx's
// AtmosphereLayers note). Multiplies each fragment's deviation from the
// theme's flat backdrop level (u_pivot), inside the sheen footprint only,
// which amplifies exactly the brick grain + dot lattice that
// useBackdropBase already painted into u_base. Because it reads the
// ALREADY-REFRACTED sample, the revealed grain warps with the ripples.
const float TEX_REVEAL_GAIN = 1.1;

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
  //
  // Seeded with the ambient swell rather than zero: one shared slow drift
  // scalar detunes the three components' phases against each other, so the
  // sum never returns to a previous state and the surface has no loop
  // period. This deliberately RELAXES the old "flat water gets exactly no
  // highlight" guarantee that SPEC_GATE used to enforce -- that invariant
  // existed so a still backdrop could never be tinted, and it is now
  // replaced by a stronger one: the swell is spatially varying and slowly
  // moving, so what it produces is a faint travelling glint field (which is
  // what water does), never a static offset. The gate below is softened to
  // a smoothstep specifically to keep the swell in its toe.
  float drift = sin(u_time * 0.11);
  float ph1 = dot(p, SWELL_D1) * 0.0101 + u_time * 0.55 + drift * 0.9;
  float ph2 = dot(p, SWELL_D2) * 0.0132 - u_time * 0.41 - drift * 1.3;
  float ph3 = dot(p, SWELL_D3) * 0.0185 + u_time * 0.73 + drift * 0.6;
  vec2 grad = SWELL_AMP * (
      SWELL_D1 * cos(ph1)
    + SWELL_D2 * (0.70 * cos(ph2))
    + SWELL_D3 * (0.45 * cos(ph3))
  );

  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 ripple = u_ripples[i];
    if (ripple.w <= 0.0) continue;
    float age = u_time - ripple.z;
    if (age < 0.0 || age > RIPPLE_LIFE_S) continue;

    // Per-ripple speed, free: ripple.w is ALREADY a per-ripple random
    // (AMPLITUDE_MIN/MAX = 0.7..1.3), so no new uniform data and no hash is
    // needed, and the correlation it introduces (a bigger drop throws a
    // slightly faster ring) is the right sign physically. Range 0.89x..1.03x
    // of nominal, which is enough that two ripples spawned a moment apart
    // visibly stop being concentric.
    float speed = RIPPLE_SPEED_PX_S * (0.72 + 0.24 * ripple.w);

    vec2 delta = p - ripple.xy;

    // CONSERVATIVE circular band test, widened by ANISO on both sides.
    // This is what preserves the original early-out contract: the
    // elliptical distance below is bounded by (1 +/- ANISO) * this circular
    // one, so this test can never reject a fragment the exact test would
    // have accepted -- and an off-band ripple still costs exactly one
    // length() plus scalar compares, never the hash/ellipse work below.
    float distC = length(delta);
    float dC = age * speed - distC;
    if (dC < -ANISO * distC || dC > PACKET_PX + ANISO * distC) continue;

    // Per-ripple elongation axis, hashed off the two independent random
    // fields the slot already carries (birth time, amplitude). Two fract()
    // products rather than the usual sin(dot(...))*43758.5453 -- no
    // transcendental, and the quality bar here is "ten ellipses don't share
    // an axis", not statistical soundness.
    vec2 raw = vec2(
      fract(ripple.z * 12.9898 + ripple.w * 78.233),
      fract(ripple.z * 39.3467 + ripple.w * 11.135)
    ) - 0.5;
    vec2 axis = raw * inversesqrt(dot(raw, raw) + 1e-4);

    // Symmetric stretch M: +ANISO along axis, -ANISO across it. Written
    // out as (1-a)*v + 2a*dot(v,axis)*axis, which is M*v without building a
    // mat2. M is symmetric, so M == transpose(M) -- which is why the SAME
    // expression serves both here (transforming delta into the ripple's own
    // metric) and at the bottom of the loop, where the chain rule needs
    // transpose(M) to pull the radial gradient direction back into screen
    // space. Getting that second application wrong would tilt every
    // wavefront's normal away from its own slope.
    float along = dot(delta, axis);
    vec2 q = (1.0 - ANISO) * delta + (2.0 * ANISO * along) * axis;
    float dist = length(q);
    float d = age * speed - dist;
    if (d < 0.0 || d > PACKET_PX) continue;

    float decay = 1.0 - age / RIPPLE_LIFE_S;
    decay *= decay;
    float atten = 1.0 / (1.0 + dist / ATTEN_FALLOFF_PX);
    float weight = ripple.w * decay * atten;

    float envRoot = sin(PI * d / PACKET_PX);
    float env = envRoot * envRoot;
    float envDeriv = 2.0 * envRoot * cos(PI * d / PACKET_PX) * (PI / PACKET_PX);

    // Per-ripple wavelength, +/-10%: 2.7..3.3 crests inside the same 90px
    // packet instead of exactly 3 every time. Taken off raw.x (already
    // computed above, so free) rather than off ripple.w, so it does not
    // correlate with the amplitude and speed that already do.
    float k = (2.0 * PI / WAVELENGTH_PX) * (0.90 + 0.20 * (raw.x + 0.5));
    float carrier = cos(k * d);
    float carrierDeriv = sin(k * d);

    // d(env*carrier)/dr, with dd/dr = -1.
    float dhdr = -weight * (envDeriv * carrier - env * k * carrierDeriv);
    vec2 nq = q / max(dist, 1.0);
    grad += dhdr * ((1.0 - ANISO) * nq + (2.0 * ANISO * dot(nq, axis)) * axis);
  }

  // Refraction: push the sample point along the slope. The y flip converts
  // the DOM-y-down gradient into uv space, where +v is up.
  vec2 uv = clamp(vUv + vec2(grad.x, -grad.y) * REFRACT_PX / u_resolution, 0.0, 1.0);
  vec3 col = texture2D(u_base, uv).rgb;

  // Cursor sheen footprint, hoisted above BOTH its consumers -- the texture
  // reveal immediately below and the specular lobe further down -- so the
  // length()/falloff is computed once instead of twice.
  vec2 toCursor = vec2(u_cursor.x - p.x, p.y - u_cursor.y);
  float sheenFall = 1.0 - clamp(length(toCursor) / SHEEN_RADIUS_PX, 0.0, 1.0);
  sheenFall *= sheenFall;

  // The cursor's "revealed texture patch". This used to be a separate
  // stationary soft-light brick pane in the DOM atmosphere layer; it lives
  // here now so that the reveal rides the refracted sample and moves with
  // the water instead of covering it (see dot-matrix-background.tsx's
  // AtmosphereLayers note for the full reasoning). u_pivot is the flat
  // backdrop's own level, so this is a local contrast push about that
  // level: it amplifies whatever deviates from it -- the brick grain at
  // BACKDROP_TEXTURE_OPACITY and the dot lattice -- and does nothing at all
  // to bare backdrop. Note it reads col AFTER refraction, so a crest
  // passing under the cursor visibly drags the revealed grain with it.
  col += (col - vec3(u_pivot)) * (TEX_REVEAL_GAIN * sheenFall);

  // Surface normal in y-UP screen space: the y-up derivative of the height
  // field is -grad.y, and a normal is the negated gradient, so N.y = grad.y.
  vec3 normal = normalize(vec3(-grad.x * SLOPE_SCALE, grad.y * SLOPE_SCALE, 1.0));

  // Broad shading: brightens slopes facing the key light, darkens those
  // facing away. Subtracting KEY_LIGHT.z makes this exactly zero on a
  // perfectly flat surface, so the swell's own tiny slopes are the only
  // thing that can tint a drop-free backdrop -- and they average to zero
  // over any region larger than a swell wavelength. This is what carries
  // the effect in the light theme, where additive white highlights on a
  // near-white base (#fffffa) would be invisible.
  col += (dot(normal, KEY_LIGHT) - KEY_LIGHT.z) * u_shade;

  // Specular lobe 1: the fixed key light.
  float specKey = pow(max(dot(normal, KEY_HALF), 0.0), SHININESS);

  // Specular lobe 2: the cursor sheen, as a real point light at the same
  // screen position and the same 340px falloff radius the DOM sheen layer
  // uses -- so crests genuinely glint where the atmosphere glow falls,
  // rather than the glow merely sitting on top of them.
  vec3 sheenDir = normalize(vec3(toCursor, SHEEN_HEIGHT_PX));
  vec3 sheenHalf = normalize(sheenDir + vec3(0.0, 0.0, 1.0));
  float specSheen = pow(max(dot(normal, sheenHalf), 0.0), SHININESS) * sheenFall;

  // smoothstep, not the old bare min(): the ambient swell means length(grad)
  // now has a small permanent floor (~0.005..0.012), which the linear gate
  // would have promoted straight to a ~6-14% specular haze everywhere. The
  // cubic toe divides that by roughly 3.5x while leaving real crests, which
  // saturate the gate anyway, at full strength. Three ALU ops, and it is
  // what makes the swell read as an occasional travelling glint rather than
  // a uniform sheen lift.
  float gate = smoothstep(0.0, 1.0, min(1.0, length(grad) * SPEC_GATE));
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
// Exponentially-distributed gaps (a Poisson arrival process), not a uniform
// window. Rain is memoryless: drops genuinely cluster and genuinely leave
// short lulls, where uniform(160, 520) is a metronome with jitter and reads
// as one. The mean is deliberately 340ms -- the mean of the old window --
// so the steady-state population (2.6s / 0.34s ~= 7.6 live) and therefore
// MAX_RIPPLES = 10 as a backstop are both unchanged. The clamps only trim
// the distribution's two tails: without SPAWN_MIN_MS the shortest gaps land
// inside a single frame and waste a slot, and without SPAWN_MAX_MS a rare
// long tail leaves the water visibly empty (which the ambient swell now
// covers, but 1.4s is already past the point of noticing). Bursts past 10
// live are handled by the pool's existing evict-oldest rule.
const SPAWN_MEAN_MS = 340
const SPAWN_MIN_MS = 90
const SPAWN_MAX_MS = 1400
const AMPLITUDE_MIN = 0.7
const AMPLITUDE_MAX = 1.3

// Hardcoded per theme, for the reason BACKDROP_COLORS spells out in
// BeadScene.tsx -- except these are pure numbers, so there is nothing to
// resolve from CSS at all. Light mode leans on `shade` (a near-white base
// cannot show additive white highlights); dark mode leans on `specular`.
//
// `pivot` is the relative luminance of BACKDROP_COLORS[theme].base, i.e.
// the level the backdrop sits at with no dots and no brick grain on it:
// light #fffffa -> 0.994, dark #0d0d0d -> 0.051. The shader's cursor-local
// texture reveal pushes each fragment AWAY from this value, so it amplifies
// exactly the grain (brick + dot lattice) that useBackdropBase painted and
// leaves untouched backdrop untouched. Derived from the same constants, so
// if BACKDROP_COLORS ever changes these must follow.
const WATER_THEME = {
  light: { specular: 0.32, shade: 0.5, pivot: 0.994 },
  dark: { specular: 0.6, shade: 0.35, pivot: 0.051 },
} as const

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function nextSpawnDelayMs(): number {
  // Inverse-transform sampling of Exponential(1/SPAWN_MEAN_MS). The
  // max() guards log(0) on the (astronomically unlikely) exact zero.
  const u = Math.max(1e-6, Math.random())
  return Math.min(SPAWN_MAX_MS, Math.max(SPAWN_MIN_MS, -Math.log(u) * SPAWN_MEAN_MS))
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
        u_pivot: { value: themeValues.pivot },
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
    material.uniforms.u_pivot.value = themeValues.pivot
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
      }, nextSpawnDelayMs())
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
