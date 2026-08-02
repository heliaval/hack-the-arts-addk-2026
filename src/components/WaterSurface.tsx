import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { GlobeCircle } from '@/components/ui/cobe-globe'

// The bead scene's water layer: the backdrop plane, rendered through a
// ripple shader instead of a flat meshBasicMaterial.
//
// WHY THIS IS THE BACKDROP PLANE ITSELF rather than a new layer on top of
// it -- this is the load-bearing architectural decision, do not "simplify"
// it into a separate mesh later:
//
//  - A DOM canvas layer behind the beads is physically impossible in this
//    app. BeadScene's backdrop is an OPAQUE full-viewport plane inside a
//    fixed inset-0 z-0 <Canvas> that sits later in App's tree than
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
//
// The water FIELD (waterColor, in WATER_COMMON_GLSL below) is shared, not
// just the technique: BeadScene.tsx's globe-composite plane evaluates the
// exact same function, over the exact same uniform VALUE OBJECTS (see
// useWaterUniforms), so the two planes agree pixel-for-pixel wherever they
// meet -- there is no seam to feather between "the water" and "the globe's
// box" because both are the same shader evaluated at the same screen
// position.

export const WATER_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Must match the shader's own RIPPLE_LIFE_S (WATER_COMMON_GLSL) and is
// injected into WATER_UNIFORMS_GLSL below, so the two can never drift.
export const MAX_RIPPLES = 44
const RIPPLE_LIFE_S = 2.6

// Every length here is in CSS pixels, matching the rest of BeadScene (see
// that file's top-of-file orthographic-camera note).
export const WATER_UNIFORMS_GLSL = `
precision highp float;

#define MAX_RIPPLES ${MAX_RIPPLES}
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
`

// The wave model is a radially expanding WAVE PACKET, not a wave equation:
// a ~3-crest cosine burst inside a sin^2 envelope, riding outward at a
// fixed speed, decaying with both age and distance. Ripples sum linearly
// into one gradient field (real small-amplitude superposition, i.e. real
// interference) and do not reflect off the globe or the screen edges -- a
// wave-equation ping-pong sim would cost two extra fullscreen passes per
// frame for a difference nobody would see at this density.
//
// The gradient is closed-form. Treating decay and atten as constant in r
// while differentiating (they vary over hundreds of px; the wave varies
// over 30px) makes the derivative exact enough to be visually
// indistinguishable, and turns three field evaluations into one.
//
// waterColor() is parameterised on a DOM-pixel position rather than on a
// mesh's own vUv, specifically so a mesh that covers only PART of the
// viewport (BeadScene.tsx's globe-composite plane) can evaluate the
// identical field at the identical screen pixels the full-viewport water
// plane behind it would have produced there. That identity is what removes
// the seam between the two planes: there is nothing to blend or feather,
// because both planes compute the same number for the same pixel.
export const WATER_COMMON_GLSL = `
const float RIPPLE_LIFE_S = 2.6;
const float RIPPLE_SPEED_PX_S = 165.0;
// Per-ripple wavefront envelope width, replacing the old flat
// PACKET_PX = 90.0 ("a 90px-thick annulus"). Drawn per ripple from the
// skewed distribution in the loop below: most ripples land THIN, a minority
// land thick.
//
// PACKET_MAX_PX doubles as the loop's conservative early-out bound, which
// is what keeps the width hash off the rejection path -- see the two-stage
// test in the loop.
//
// The floor is set by WAVELENGTH_PX: at 26px a 30px carrier completes 0.87
// of a cycle inside the envelope, i.e. exactly one crest and the beginning
// of its trough, which is the thinnest thing that still reads as a RING
// rather than as a smear. Below ~20px the envelope would clip the crest
// itself and the ripple would lose its shape.
//
// WAVELENGTH_PX deliberately does NOT scale with this. Scaling it would
// make every ripple a similar-shaped object at a different size ("a smaller
// ripple"); holding it fixed means a thin packet holds ONE crest and a fat
// one holds four ("a thinner ripple"), which is both the ask and what a
// small vs. large drop actually does.
const float PACKET_MIN_PX = 26.0;
const float PACKET_MAX_PX = 130.0;
const float PACKET_SPAN_PX = 104.0; // PACKET_MAX_PX - PACKET_MIN_PX
const float WAVELENGTH_PX = 30.0;
const float ATTEN_FALLOFF_PX = 300.0;
const float REFRACT_PX = 26.0;
const float SLOPE_SCALE = 2.5;
const float SHININESS = 48.0;
// Slope magnitude at which specular reaches full strength. Lowered from
// 12.0: at 12.0 a single fresh ripple (|grad| ~= 0.15..0.28) already
// saturates this gate, so one crest and two CROSSING crests produced an
// identical highlight -- see the crest-response block below, which is what
// actually makes crossings look different. At 6.0 a destructive null where
// two ripples cancel now reads as a genuinely dark dip instead of staying
// at full brightness, and the smoothstep toe further down divides the
// ambient swell's permanent slope floor by roughly 11x instead of 3.5x,
// which only strengthens that comment's original intent.
const float SPEC_GATE = 6.0;
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

// Cursor-local texture reveal, the shader-side replacement for the DOM
// atmosphere layer's brick pane (removed -- see dot-matrix-background.tsx's
// AtmosphereLayers note). Multiplies each fragment's deviation from the
// theme's flat backdrop level (u_pivot), inside the sheen footprint only,
// which amplifies exactly the brick grain + dot lattice that
// useBackdropBase already painted into u_base. Because it reads the
// ALREADY-REFRACTED sample, the revealed grain warps with the ripples.
//
// 1.1 -> 4.6. This is now THE brick-visibility control, not a local boost
// on an already-visible bake: BeadScene.tsx's BACKDROP_TEXTURE_OPACITY
// dropped 0.2 -> 0.06 in the same pass (see its own comment) per explicit
// request ("the 2nd texture isn't visible unless the cursor light is
// shining on it"), so away from the cursor there is effectively no brick,
// and this is what puts it back where the cursor light is. 0.06 * (1 + 4.6)
// * 1.23 (the raised BACKDROP_TEXTURE_FILTER contrast) = 0.41 at the
// cursor's own position, i.e. the same grain strength the old permanently-
// visible 0.2 bake reached under the cursor.
//
// COST: exactly zero new work. Same instruction, same sheenFall term the
// specular lobe below already computes and this line already consumed --
// one changed float literal.
//
// KNOWN, MEASURED SIDE EFFECT, and it is unavoidable at any gain above
// ~1.4: this amplifies the DOT LATTICE too, and the lattice already sits at
// 30% of full contrast. Light theme, a dot's centre pixel is
// 0.994*0.68 + 0.086*0.32 = 0.701, deviation -0.293 from u_pivot, so it
// bottoms out at black once 0.293 * (1 + 4.6*sheenFall) >= 0.994, i.e.
// sheenFall >= 0.303, i.e. within r = 340*(1-sqrt(0.303)) = 153px of the
// cursor. Dark theme is symmetric (dot 0.333, deviation +0.282, clips to
// white on the same schedule). Accepted: it affects the ~1px dot in each
// 24px cell only, it reads as the lattice sharpening under the light rather
// than as an artefact, and it is a transient shader-side effect on an
// UNCHANGED bake -- BACKDROP_DOT_OPACITY stays 0.32, so TileTransition's
// dot-for-dot parity at the moment of reveal is untouched.
const float TEX_REVEAL_GAIN = 4.6;

// --- Non-linear crest response --------------------------------------------
// Ripples already sum LINEARLY into the gradient above, which is correct
// small-amplitude superposition and is real interference -- but nothing
// downstream used to be non-linear enough to make it legible: refraction
// and the broad shade term are both linear in the gradient, and the old
// SPEC_GATE = 12.0 saturated at |grad| = 0.083, which any single fresh
// ripple already exceeds, so one crest and two crossing crests produced an
// identical highlight.
//
// This is the one non-linear step, and it reads the FINAL summed gradient
// ONCE, after the ripple loop -- never per ripple. That is the entire
// reason it is affordable: it costs one smoothstep and two multiplies per
// fragment regardless of how many ripples are live, and it cannot be
// approximated per-ripple, since "how steep is it here in total" is
// precisely the quantity a per-ripple term does not have.
//
// Thresholds are measured against what a lone packet can produce. Peak
// |dhdr| = weight * ~0.22 where weight = ripple.w * decay * atten, so a
// mid-life crest sits near 0.15 and the strongest possible fresh crest
// (w=1.3, decay~0.99, atten~0.98) near 0.28 -- against the OLD flat 90px
// packet. Destructive interference needs no term of its own: the linear sum
// already cancels there, and the lowered SPEC_GATE above is what lets the
// cancelled region read as a genuinely dark null instead of a still-
// saturated highlight.
//
// 0.26 -> 0.32 and 0.48 -> 0.55, re-derived for two changes that both
// invalidate the 0.28 measurement above:
//   (1) per-ripple packet width (PACKET_MIN_PX/MAX_PX): the thinnest 26px
//       envelopes have envDeriv maxing at PI/26 = 0.121 instead of
//       PI/90 = 0.035, raising a lone packet's peak |dhdr| from
//       weight*0.22 to weight*0.24, so the strongest single fresh ripple
//       now reaches ~0.30 -- above the old 0.26, which would have made
//       "one crest" and "two crossing crests" look alike again, the exact
//       regression this threshold exists to prevent.
//   (2) a much higher live ripple population (see SPAWN_MEAN_MS below): the
//       mean simultaneously-in-band count rises well past 1, so a threshold
//       tuned to fire on genuine crossings would otherwise fire almost
//       always instead.
// 0.32 restores the original intent (the strongest lone ripple sits just
// under the toe), and 0.55 keeps the same ~1.7x solo-to-saturation span the
// pair always had.
const float CREST_SOLO = 0.32;
const float CREST_CROSS = 0.55;
const float INTERFERE_GAIN = 0.85;

// normalize(vec3(-0.6, 0.8, 0.35)) -- upper-left key light, in SCREEN space
// with +y UP. GLSL ES 1.00 cannot call normalize() in a const initializer,
// so both this and its half-vector are precomputed. Same light direction
// GlobeRain's SCENE_LIGHT_DIR uses, so the two scenes agree on where the
// light is coming from.
const vec3 KEY_LIGHT = vec3(-0.56631, 0.75508, 0.33035);
// normalize(KEY_LIGHT + vec3(0,0,1)); the view vector is (0,0,1) exactly,
// because the camera is orthographic.
const vec3 KEY_HALF = vec3(-0.34719, 0.46291, 0.81559);

// The water field, evaluated at a DOM-pixel position (top-left origin,
// +y down). See this file's header for why this is parameterised on a raw
// position rather than on a mesh's own vUv.
vec3 waterColor(vec2 p) {
  // Viewport uv for the base texture -- the exact inverse of a
  // full-viewport plane's own p = vec2(vUv.x, 1.0 - vUv.y) * u_resolution.
  vec2 baseUv = vec2(p.x / u_resolution.x, 1.0 - p.y / u_resolution.y);

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
    float dist = length(delta);

    // Distance BEHIND the expanding leading edge, now tested in TWO stages.
    // The first bound is the compile-time PACKET_MAX_PX, so it is as cheap
    // as the old single test was and rejects on exactly the same terms; the
    // second is the ripple's own width and only runs for the survivors it
    // will keep. Splitting it this way is what keeps the width hash below
    // OFF the rejection path -- hashing before the first test would charge
    // every occupied slot ~7 ops it does not need.
    float d = age * speed - dist;
    if (d < 0.0 || d > PACKET_MAX_PX) continue;

    // Per-ripple wavelength hash, off the two independent random fields the
    // slot already carries (birth time, amplitude) -- a fract() product
    // rather than the usual sin(dot(...))*43758.5453, no transcendental,
    // and the quality bar here is "ripples don't share a wavelength", not
    // statistical soundness. Ripples stay CIRCULAR (no per-ripple
    // elongation/orientation) -- wavefronts are perfect expanding rings,
    // varied only in speed, amplitude, this wavelength jitter, and the
    // envelope width below.
    float wobble = fract(ripple.z * 12.9898 + ripple.w * 78.233);

    // A SECOND, independent hash off the SAME two fields -- still no new
    // uniform data, still no transcendental, ~4 ops. Reusing wobble for
    // both would correlate them perfectly and in the worst direction: the
    // thinnest packets would always draw the longest wavelength (the 0.90
    // factor), so a thin ripple would invariably hold ~0.8 of a cycle and a
    // fat one ~4.8, an exceptionless rule the eye picks up as a pattern.
    // The two multiplier pairs generate very differently conditioned
    // lattices (12.99/78.23 = 0.166 against 45.16/21.32 = 2.118), so the
    // two scalars are visually independent.
    float widthHash = fract(ripple.z * 45.164 + ripple.w * 21.317);

    // Cubic skew, not a uniform spread -- "usually thin, sometimes
    // thicker". E[u^3] = 1/4, so the mean lands at 26 + 104/4 = 52px, the
    // MEDIAN at 26 + 104*0.125 = 36.8px, 51% of ripples come out under
    // 40px (a single clean ring), 14.9% exceed the old flat 90px, and 6.9%
    // exceed 110px. A uniform draw would put the median at 78px and read as
    // "every ripple is an arbitrary width" rather than "thin, with the
    // occasional fat one".
    //
    // Written as u*u*u, not pow(u, 3.0): pow() is a transcendental and this
    // is inside the ripple loop. Two multiplies, exactly equal.
    float packet = PACKET_MIN_PX + PACKET_SPAN_PX * (widthHash * widthHash * widthHash);
    if (d > packet) continue;

    float decay = 1.0 - age / RIPPLE_LIFE_S;
    decay *= decay;
    float atten = 1.0 / (1.0 + dist / ATTEN_FALLOFF_PX);
    float weight = ripple.w * decay * atten;

    // PI/PACKET_PX used to be constant-folded by the compiler; packet is
    // per-ripple, so it is a real divide now -- hoisted so the envelope and
    // its derivative share the one division and the one sin/cos argument.
    float invPacket = PI / packet;
    float envPhase = d * invPacket;
    float envRoot = sin(envPhase);
    float env = envRoot * envRoot;
    float envDeriv = 2.0 * envRoot * cos(envPhase) * invPacket;

    // Per-ripple wavelength, +/-10%: 27..33px, held FIXED against the
    // envelope width above, so the number of crests inside the packet is
    // what varies -- roughly 0.9 crests in the thinnest 26px envelope, 3 in
    // a 90px one, 4.3 in the fattest 130px one.
    float k = (2.0 * PI / WAVELENGTH_PX) * (0.90 + 0.20 * wobble);
    float carrier = cos(k * d);
    float carrierDeriv = sin(k * d);

    // d(env*carrier)/dr, with dd/dr = -1.
    float dhdr = -weight * (envDeriv * carrier - env * k * carrierDeriv);
    grad += dhdr * (delta / max(dist, 1.0));
  }

  // Crest steepening, the one non-linear step -- see CREST_SOLO's own
  // comment above. Applied to the FINAL summed gradient, never per ripple.
  float slope = length(grad);
  float boost = 1.0 + INTERFERE_GAIN * smoothstep(CREST_SOLO, CREST_CROSS, slope);
  grad *= boost;
  // Scaling a vector by a positive scalar scales its length by the same
  // scalar, so the gate further down gets its updated magnitude for free
  // rather than paying a second length().
  slope *= boost;

  // Refraction: push the sample point along the slope. The y flip converts
  // the DOM-y-down gradient into uv space, where +v is up.
  vec2 uv = clamp(baseUv + vec2(grad.x, -grad.y) * REFRACT_PX / u_resolution, 0.0, 1.0);
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

  // smoothstep, not a bare min(): the ambient swell means slope now has a
  // small permanent floor (~0.005..0.012), which a linear gate would have
  // promoted straight into a haze everywhere. The cubic toe divides that
  // down while leaving real crests, which saturate the gate anyway, at full
  // strength -- and it is what makes the swell read as an occasional
  // travelling glint rather than a uniform sheen lift.
  float gate = smoothstep(0.0, 1.0, min(1.0, slope * SPEC_GATE));
  col += (specKey * 0.55 + specSheen * u_sheen) * u_specular * gate;

  return col;
}
`

// The water plane's own fragment shader: the shared uniform block, the
// shared field function, and a thin main() that converts this mesh's own
// vUv into a DOM-pixel position and asks waterColor() for the answer.
// BeadScene.tsx's globe-composite plane uses the exact same
// WATER_UNIFORMS_GLSL + WATER_COMMON_GLSL pair in its own shader, over the
// same uniform value objects (see useWaterUniforms) -- see this file's
// header comment for why that is the fix for the seam between the two.
const FRAGMENT_SHADER = `
varying vec2 vUv;
${WATER_UNIFORMS_GLSL}
${WATER_COMMON_GLSL}
void main() {
  // vUv.y = 1 is the TOP of the plane, and CanvasTexture's default
  // flipY = true maps canvas row 0 (viewport top) to uv.y = 1 -- so this
  // converts to DOM pixel space (top-left origin, +y down), which is the
  // space every ripple/cursor coordinate arrives in.
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * u_resolution;
  gl_FragColor = vec4(waterColor(p), 1.0);
}
`

// Ambient, data-independent rain. Deliberately NOT tied to
// BATCH_SPAWN_INTERVAL_MS: a batch drains in a handful of seconds, after
// which the water would sit perfectly dead for the rest of the session --
// an effect that stops. Beads also all spawn from one narrow band at screen
// top (SPAWN_JITTER_PX), so a ripple anywhere else carries no perceivable
// correspondence to the bead that "caused" it. GlobeRain, this app's own
// rain precedent, is atmospheric for the same reasons. This is a DIFFERENT
// system from BeadScene.tsx's BATCH_SPAWN_INTERVAL_MS (bead batch playback
// speed) -- the two must never be reasoned about as the same knob.
//
// Exponentially-distributed gaps (a Poisson arrival process), not a uniform
// window. Rain is memoryless: drops genuinely cluster and genuinely leave
// short lulls, where a uniform window with jitter reads as a metronome. The
// clamps only trim the distribution's two tails: without SPAWN_MIN_MS the
// shortest gaps land inside a single frame and waste a slot, and without
// SPAWN_MAX_MS a rare long tail leaves the water visibly empty.
//
// The lower clamp is what makes the EFFECTIVE mean 82.0ms rather than the
// nominal 75: E[max(35, Exp(75))] = 35*(1-e^-35/75) + 110*e^-35/75
// = 35*0.3729 + 110*0.6271 = 82.0, less a correction from the upper clamp
// that is now truly negligible (P(Exp(75) > 1400) = e^-18.7 = 8e-9).
//
// 260 -> 75, i.e. "drastically more rain", not another modest bump. Steady-
// state population goes 2600/273.9 = 9.5 live to RIPPLE_LIFE_S /
// effective_mean_gap = 2600/82.0 = 31.7 live, a 3.3x increase, at 12.2
// drops/second.
//
// SPAWN_MIN_MS 90 -> 35 is NOT cosmetic and must move with the mean. At a
// 75ms mean, P(Exp(75) < 90) = 70%, so a 90ms floor would clamp seven gaps
// in ten to the identical value and turn a Poisson arrival process into a
// literal metronome -- destroying the "drops genuinely cluster and leave
// short lulls" property this whole distribution exists for, at exactly the
// density where clustering is most visible. 35ms is ~2 frames at 60fps, and
// its original justification (a sub-frame gap "wastes a slot") has largely
// lapsed: MAX_RIPPLES more than tripled below, so slots are no longer the
// scarce resource, and two drops in one frame at two different
// pickSpawnPoint()s read as two drops, not as one. At 35ms the clamp fires
// on 37% of draws and the tail is otherwise intact.
//
// 14 -> 44. The standard is the one MAX_RIPPLES already used: enough
// headroom that the evict-oldest rule is invisible. Population 31.7, an
// upper bound sigma <= sqrt(31.7) = 5.6 (the min clamp makes the renewal
// process sub-Poisson, so the true variance is lower), so 44 sits at
// mean + 2.2 sigma, MORE conservative than the old 14's mean + 1.45 sigma.
// And when it does evict, the victim is the oldest of forty-four spread
// over RIPPLE_LIFE_S, i.e. age ~= 2.6 * 43/44 = 2.54s, where
// decay = (1 - 2.54/2.6)^2 = 0.0005 -- an order of magnitude below the old
// 0.006.
//
// PER-FRAGMENT COST, honestly. Two terms move in opposite directions: the
// per-ripple sin/cos work an in-band ripple pays goes UP with population
// but DOWN per-ripple thanks to PACKET_MIN_PX/MAX_PX's thinner mean
// envelope (see that constant's own comment), landing around 1.9x today's
// in-band cost; the ripple LOOP ITSELF (a compile-time-unrolled 44
// iterations instead of 14, each occupied-but-off-band slot paying the age
// test, speed multiply, delta subtract, length() and compares) is the
// larger mover, at roughly 2.6x. Against the rest of this shader (three
// cos() of ambient swell, one texture fetch, two pow(48) specular lobes, a
// normalize) the whole water fragment lands around 2x its previous cost.
// This is a FULL-VIEWPORT term that does not scale with the bead count,
// unlike everything BeadScene.tsx's own perf comments are about. If it ever
// needs trimming, cut MAX_RIPPLES before SPAWN_MEAN_MS -- the population is
// what you see, the headroom is not (at 36 the evicted ripple's decay is
// still only 0.001).
const SPAWN_MEAN_MS = 75
const SPAWN_MIN_MS = 35
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

/** A uniform-random point on the water, rejecting the globe's own DISC --
 * only the sphere's opaque silhouette actually hides a ripple now, because
 * BeadScene.tsx's globe-composite plane composites the live globe OVER the
 * identical water field (see that plane's shader) rather than over a static
 * crop, so anywhere outside the silhouette (including the box's corners and
 * glow ring) shows real, visible water. Gives up after a few tries and
 * skips the spawn rather than looping, since the disc is only ever a small
 * fraction of the viewport. */
function pickSpawnPoint(
  width: number,
  height: number,
  circle: GlobeCircle | null,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 5; attempt++) {
    const x = Math.random() * width
    const y = Math.random() * height
    if (!circle) return { x, y }
    const dx = x - circle.centerX
    const dy = y - circle.centerY
    if (dx * dx + dy * dy > circle.radius * circle.radius) return { x, y }
  }
  return null
}

export type WaterUniforms = Record<string, THREE.IUniform>

/** Creates and drives the ONE water-field uniform set for the whole bead
 * scene. Called once by Backdrop (inside <Canvas>, so useFrame/useMemo are
 * legal) and handed to both the full-viewport water plane (WaterSurface,
 * below) and BeadScene.tsx's globe-composite plane -- sharing the same
 * uniform VALUE OBJECTS, not copies, is what keeps the two planes in sync:
 * three's WebGLUniforms reads `.value` at upload time, so writing u_time
 * once here updates both materials' next draw. */
export function useWaterUniforms(
  texture: THREE.Texture | null,
  width: number,
  height: number,
  theme: 'light' | 'dark',
  circle: GlobeCircle | null,
): WaterUniforms {
  // Created once for the scene's whole life. Ripple state lives in the
  // uniform's own Vector4s and is written ONLY at spawn -- the animation
  // itself is a pure function of u_time, so the per-frame CPU cost of this
  // entire effect is one float write.
  const uniforms = useMemo<WaterUniforms>(() => {
    const themeValues = WATER_THEME[theme]
    return {
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
    }
    // theme is deliberately NOT a dependency -- the theme-driven values are
    // plain uniforms, updated in place by the effect below. Recreating this
    // object would recompile BOTH shader programs (the water plane's and
    // the globe-composite plane's) on every theme flip.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    uniforms.u_base.value = texture
  }, [uniforms, texture])

  useEffect(() => {
    ;(uniforms.u_resolution.value as THREE.Vector2).set(width, height)
  }, [uniforms, width, height])

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
    uniforms.u_specular.value = themeValues.specular
    uniforms.u_shade.value = themeValues.shade
    uniforms.u_pivot.value = themeValues.pivot
    const id = requestAnimationFrame(() => {
      const [r, g, b] = resolveSheenRgb()
      ;(uniforms.u_sheen.value as THREE.Vector3).set(r, g, b)
    })
    return () => cancelAnimationFrame(id)
  }, [uniforms, theme])

  // Plain mutable ref rather than React state, same reasoning as
  // MouseLight's own targetRef in BeadScene.tsx: pointermove fires far
  // faster than React commits and this only feeds a uniform.
  useEffect(() => {
    const cursor = uniforms.u_cursor.value as THREE.Vector2
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
  }, [uniforms])

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
    const slots = uniforms.u_ripples.value as THREE.Vector4[]
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
  }, [uniforms])

  useFrame((state) => {
    elapsedRef.current = state.clock.getElapsedTime()
    uniforms.u_time.value = elapsedRef.current
  })

  return uniforms
}

/** The full-viewport water plane. Purely a mesh + material over an
 * already-driven uniform set -- see useWaterUniforms for everything that
 * animates it. */
export function WaterSurface({
  uniforms,
  width,
  height,
}: {
  uniforms: WaterUniforms
  width: number
  height: number
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: WATER_VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms,
      }),
    [uniforms],
  )
  useEffect(() => () => material.dispose(), [material])

  return (
    <mesh position={[0, 0, -420]}>
      <planeGeometry args={[width, height]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
