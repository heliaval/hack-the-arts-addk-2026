import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { BallCollider, CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import type { CountryDemographics } from '@/lib/worldbank'
import type { GlobeCircle } from '@/components/ui/cobe-globe'
import { spawnIntervalMs } from '@/lib/beadSpawnRate'

// With <Canvas orthographic> and no manual frustum override, react-three-
// fiber sizes the camera frustum to the canvas's CSS pixel dimensions on
// every resize (see its updateCamera). So every number in this file is in
// CSS pixels, with the origin at the centre of the viewport, +y up.
// Rapier's default -9.81 gravity would therefore be 9.81 px/s^2 — beads
// would float. -2000 px/s^2 reads as roughly earth-like at this scale.
const GRAVITY_PX_PER_S2 = 2000
const BEAD_RADIUS = 34
const WALL_THICKNESS = 40
// Half-width of the horizontal band beads spawn across. Without jitter
// every bead would stack in one perfect column. Scaled with BEAD_RADIUS
// (was 90 at r=14) so consecutive spawns are no more likely to overlap at
// birth than before, and kept below the globe's typical on-screen radius
// (a 1280x800 viewport gives a 640px globe canvas => a 256px sphere) so
// most beads land ON the globe rather than falling past it.
export const SPAWN_JITTER_PX = 200
// Live bead cap. Past this, the oldest bead is dropped as each new one
// spawns, so performance stays bounded however long the scene stays open.
// Bead area scales with the square of the radius, so 14 -> 34 makes each
// bead 5.9x larger on screen; the old cap of 180 would bury the viewport.
// The previous 180-at-r=14 pile covered ~12% of the screen — matching that
// coverage would take only ~31 beads, which reads as a scatter, not a pile.
// 70 covers roughly 28% of the area the (now permanently centered) globe
// leaves free, filling the lanes either side of it without climbing back up
// to the spawn point.
export const MAX_BEADS = 70

// How long an evicted bead takes to shrink away before it is actually
// removed from the array — and therefore from the physics world, since a
// removed <RigidBody> is torn out of Rapier on the next commit.
//
// Long enough to read as a deliberate exit, short enough that the pile's
// collapse into the gap still feels causally connected to it. It also
// bounds how far the array can exceed MAX_BEADS: the fastest spawn
// interval is 120ms per stream (src/lib/beadSpawnRate.ts) across two
// streams, so at most ~7 beads are mid-exit at any moment.
const BEAD_EXIT_MS = 420

// Marble textures. Each is an equirectangular canvas painted once per
// theme and handed to one shared material as its `map`.
//
// 256x128 because SphereGeometry's UVs are equirectangular (2:1) and
// because a bead is at most ~68 CSS pixels across on screen — a texel
// density well past what refraction through a 1.52-IOR sphere can resolve.
// All eight textures together are 8 * 256 * 128 * 4 bytes ~= 1.0MB, ~1.4MB
// once three has built the mipmap chain. Negligible next to the
// environment cube map.
const MARBLE_TEXTURE_WIDTH = 256
const MARBLE_TEXTURE_HEIGHT = 128
// Three swirl variants and one catseye, per tint. Four is enough that a
// 70-bead pile does not read as 70 copies of one object, and few enough
// that generation stays a handful of milliseconds on a theme flip. The
// catseye is deliberately a minority: it is the distinctive one, and it
// reads as special precisely because roughly a quarter of the pile has it.
const MARBLE_SWIRL_VARIANTS = 3
const MARBLE_CATSEYE_VARIANTS = 1
export const MARBLE_VARIANTS = MARBLE_SWIRL_VARIANTS + MARBLE_CATSEYE_VARIANTS

// Glass tuning. Every length here is in the scene's CSS-pixel world units
// (see the orthographic-camera note above), which is why thickness and
// attenuationDistance are bead-sized two-digit numbers rather than the
// sub-1 values a metres-based three.js scene would use.
//
// BEAD_TRANSMISSION is deliberately not 1.0. three's transmission shader
// ends with `totalDiffuse = mix(totalDiffuse, transmission.rgb,
// material.transmission)`, so at 1.0 the bead's own colour is entirely
// replaced by the refracted sample and only attenuationColor tints it —
// which, against a near-white page in the light theme, loses the
// birth/death colour distinction the whole feature is built on. Holding
// back 10% of the diffuse term keeps a red bead legibly red without
// making it look painted.
const BEAD_TRANSMISSION = 0.9
// Beer-Lambert attenuation. Deliberately weak now: it multiplies the same
// transmitted term the marble texture does (see the shader trace on
// useBeadMaterials), so the tight one-radius distance this used to have
// would multiply every ribbon by a full-strength tint and flatten the
// swirl back into a single hue — technically present, visually gone.
// Three radii leaves a residual body tint, which is what still separates a
// red pile from a grey one at a glance, and lets the texture be the thing
// you actually look at.
const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS * 3
const BEAD_THICKNESS = BEAD_RADIUS * 2
// 1.52 is soda-lime glass. 1.0 would be air (no bending at all), 2.4
// diamond (comically warped at this size).
const BEAD_IOR = 1.52
// Low but not zero: a perfectly smooth sphere reads as a flat disc, a
// slightly rough one catches a readable highlight.
const BEAD_ROUGHNESS = 0.08
// three's native chromatic aberration (MeshPhysicalMaterial.dispersion,
// requires transmission > 0). This is what drei's MeshTransmissionMaterial
// used to be needed for.
const BEAD_DISPERSION = 2.5

// A second, much sharper specular layer on top of the glass body.
// MeshPhysicalMaterial composites it over everything else, transmission
// included (three's meshphysical.glsl.js:212: `outgoingLight =
// outgoingLight * (1 - clearcoat * Fcc) + (clearcoatSpecularDirect +
// clearcoatSpecularIndirect) * clearcoat`). What it buys is a crisp white
// rim and hot-spot that is neither tinted by the glass nor blurred by
// BEAD_ROUGHNESS — the layered look real glass has and a single specular
// lobe cannot fake, and the cheapest "does this look raytraced" cue
// available. What it costs is one more cube-map sample plus a GGX term per
// fragment; there is no clearcoatNormalMap, so three uses the geometry
// normal for free.
const BEAD_CLEARCOAT = 1
// Lower than BEAD_ROUGHNESS on purpose: the whole point of the layer is
// that it is sharper than the surface underneath it.
const BEAD_CLEARCOAT_ROUGHNESS = 0.04

// Environment cube map resolution. 64 was the bottleneck on how convincing
// the reflections could be, and three's own source says why:
// lights_physical_fragment.glsl.js clamps roughness with the comment
// "0.0525 corresponds to the base mip of a 256 cubemap". BEAD_ROUGHNESS is
// 0.08, i.e. the shader asks the IBL for a near-mirror reflection, and a
// 64px cube map has no such detail to give — every highlight comes back as
// an undifferentiated blob. This is also drei's own default.
//
// It costs nothing per frame: <Environment frames={1}> bakes once and
// stops. The only ongoing cost is VRAM — 6 faces * 256^2 * 8 bytes
// (HalfFloatType) ~= 3.1MB plus ~1.4MB of PMREM chain.
const BEAD_ENV_RESOLUTION = 256
// Lowered from 1.4 with the move to a 256px map and a clearcoat layer:
// both add specular energy, and the previous value blows the highlights
// out into white discs.
const BEAD_ENV_INTENSITY = 1.15

// One geometry for every bead, built once at module scope. Phase 1 gave
// each bead its own <sphereGeometry> element, i.e. up to MAX_BEADS
// byte-identical vertex buffers uploaded to the GPU. App renders
// <BeadScene key={selectedIso3} />, so the whole component remounts on
// every country switch — module scope means this buffer survives those
// remounts instead of being rebuilt each time. Never disposed: there is
// exactly one, for the lifetime of the page.
const BEAD_GEOMETRY = new THREE.SphereGeometry(BEAD_RADIUS, 32, 32)

interface Bead {
  id: number
  kind: 'birth' | 'death'
  x: number
  /** Which marble texture this bead got, in [0, MARBLE_VARIANTS). Chosen
   * once at spawn and never changed, so a bead does not swap appearance
   * mid-fall. */
  variant: number
  /** Set by the spawn loop when this bead is evicted at the MAX_BEADS cap.
   * The bead stays in the array — and in the physics world — until
   * BeadFadeOut has shrunk it away and called onExpire. */
  dying: boolean
}

interface BeadColors {
  birth: string
  death: string
}

// THREE.Color cannot parse `oklch(...)` — which is exactly how --foreground
// is declared in src/index.css — and cannot parse a raw `var(--…)`
// reference at all. Reading back fillStyle as a string after setting it is
// NOT reliable for this: modern browsers increasingly echo oklch() back
// verbatim (to preserve wide-gamut precision) instead of collapsing it to
// `rgb()`/`#rrggbb`, so `ctx.fillStyle` can still be an oklch() string that
// THREE.Color's regex-based parser doesn't recognise — and silently leaves
// the material at its default white, with no console warning, since
// three.js's own warn() is a no-op unless the app opts in via
// setConsoleFunction(). Painting a pixel and reading back the *rasterised*
// RGBA bytes sidesteps this entirely: the canvas must resolve the colour to
// concrete pixel values to draw it at all, regardless of how it chooses to
// serialise fillStyle as a string afterwards. If the browser can't parse
// `value`, fillStyle silently keeps the fallback we primed it with, so the
// painted pixel (and thus the returned hex) is the fallback's.
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

// --accent is already a literal hex in index.css so it can be read straight
// off the root element. --foreground is oklch(), so instead of reading the
// custom property's raw text we read the *computed* colour off a real
// element carrying Tailwind's `text-foreground` class — the browser has
// already resolved it there — and then normalise it through the canvas.
function resolveBeadColors(): BeadColors {
  const probe = document.createElement('span')
  probe.className = 'text-foreground'
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const foreground = getComputedStyle(probe).color
  probe.remove()
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return {
    birth: normalizeCssColor(accent, '#912f40'),
    death: normalizeCssColor(foreground, '#333333'),
  }
}

// Deterministic PRNG (mulberry32). Math.random() would repaint different
// marbles on every reload and every theme flip, which makes the human
// visual checkpoint impossible to reason about — "the catseye variant
// looked wrong" has to mean the same thing twice in a row.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface MarblePalette {
  /** The clear body of the glass. Near-white, because it multiplies the
   * refracted light everywhere the ribbons are not (see the shader note on
   * useBeadMaterials) — anything dark here reads as a hole, not as glass. */
  base: string
  /** Ribbon / vane colours, most saturated first. */
  ribbons: string[]
}

// Every colour in a marble is derived from one of the two resolved tints,
// so a birth marble is still unmistakably the accent red and a death
// marble unmistakably the foreground tone. The birth/death distinction is
// the entire point of the feature and the swirls must not blur it; what
// the extra hues buy is that a bead reads as *swirled glass* rather than
// as a flat coloured ball.
//
// HSL is read and written in explicit SRGBColorSpace. three's default
// working colour space is Linear-sRGB (Color.getHSL/setHSL default to
// ColorManagement.workingColorSpace, node_modules/three/src/math/Color.js
// lines 248 and 567), so an unqualified round-trip would rotate hue and
// scale lightness in linear light and produce visibly darker, differently
// hued results than the CSS-style colours the rest of this file deals in.
function marblePalette(tint: string): MarblePalette {
  const hsl = { h: 0, s: 0, l: 0 }
  new THREE.Color(tint).getHSL(hsl, THREE.SRGBColorSpace)
  const shade = (dh: number, s: number, l: number) =>
    `#${new THREE.Color()
      .setHSL(
        (hsl.h + dh + 1) % 1,
        THREE.MathUtils.clamp(s, 0, 1),
        THREE.MathUtils.clamp(l, 0, 1),
        THREE.SRGBColorSpace,
      )
      .getHexString(THREE.SRGBColorSpace)}`
  // Lightness floor. The light theme's --foreground is oklch(0.2 0 0),
  // i.e. very nearly black, and a near-black texel does not read as "dark
  // glass" — it multiplies the refracted light to zero and reads as a hole
  // punched in the bead.
  const l = Math.max(hsl.l, 0.16)
  return {
    base: shade(0, hsl.s * 0.25, Math.min(0.92, l + (1 - l) * 0.82)),
    ribbons: [
      shade(0, hsl.s, l),
      shade(0.055, hsl.s * 0.85, Math.min(0.85, l + 0.22)),
      shade(-0.055, Math.min(1, hsl.s * 1.15), Math.max(0.16, l - 0.06)),
      shade(0, hsl.s * 0.4, Math.min(0.95, l + 0.42)),
    ],
  }
}

// Swirl variant: soft ribbons running pole to pole.
//
// SphereGeometry's UVs are equirectangular, so a stroke that runs
// top-to-bottom in this canvas maps to a band that converges to a point at
// both poles of the bead — which is exactly how the ribbons in a real
// swirl marble are arranged. The notorious equirectangular pole pinch
// works FOR us here rather than against us.
//
// Each ribbon is drawn three times, offset by -W, 0 and +W, so a stroke
// that crosses the u = 0 seam appears on both sides of it and the texture
// wraps without a visible join. The texture's wrapS is RepeatWrapping for
// the same reason.
function paintSwirl(ctx: CanvasRenderingContext2D, palette: MarblePalette, rand: () => number) {
  const w = MARBLE_TEXTURE_WIDTH
  const h = MARBLE_TEXTURE_HEIGHT
  ctx.fillStyle = palette.base
  ctx.fillRect(0, 0, w, h)
  // Canvas 2D's own blur is what sells "suspended inside the glass";
  // hard-edged strokes read as paint on the surface instead. This runs
  // once per texture, not per frame, so its cost is irrelevant.
  ctx.filter = 'blur(3px)'
  ctx.lineCap = 'round'
  const ribbons = 5
  for (let i = 0; i < ribbons; i++) {
    const x = ((i + 0.5 + (rand() - 0.5) * 0.6) / ribbons) * w
    const sway = (0.1 + rand() * 0.22) * w * (rand() < 0.5 ? -1 : 1)
    ctx.strokeStyle = palette.ribbons[i % palette.ribbons.length]
    ctx.lineWidth = (0.045 + rand() * 0.075) * w
    for (const dx of [-w, 0, w]) {
      ctx.beginPath()
      // Start above and end below the canvas so the stroke's round cap is
      // never visible as a blunt end at the poles.
      ctx.moveTo(x + dx, -0.1 * h)
      ctx.bezierCurveTo(x + dx + sway, 0.3 * h, x + dx - sway, 0.7 * h, x + dx, 1.1 * h)
      ctx.stroke()
    }
  }
  ctx.filter = 'none'
}

// Catseye variant: a real cat's-eye marble is clear glass with a single
// flattened fan of coloured vanes suspended in the middle of it — hard
// edges, few of them, symmetric, on an otherwise colourless body. It is
// NOT a swirl, and the whole reason the user asked for it is that it reads
// as a different object.
//
// Each vane is a filled lens/leaf: widest at the equator, tapering to a
// point at both poles, which under equirectangular UVs is exactly the
// shape a real vane has. Much less blur than paintSwirl, because the edge
// of a cat's-eye vane is genuinely sharp.
function paintCatseye(ctx: CanvasRenderingContext2D, palette: MarblePalette, rand: () => number) {
  const w = MARBLE_TEXTURE_WIDTH
  const h = MARBLE_TEXTURE_HEIGHT
  ctx.fillStyle = palette.base
  ctx.fillRect(0, 0, w, h)
  ctx.filter = 'blur(1.5px)'
  const vanes = 3
  for (let i = 0; i < vanes; i++) {
    const x = ((i + 0.5) / vanes) * w + (rand() - 0.5) * 0.05 * w
    const halfWidth = (0.055 + rand() * 0.03) * w
    ctx.fillStyle = palette.ribbons[i % palette.ribbons.length]
    for (const dx of [-w, 0, w]) {
      ctx.beginPath()
      ctx.moveTo(x + dx, 0)
      ctx.quadraticCurveTo(x + dx + halfWidth, h * 0.5, x + dx, h)
      ctx.quadraticCurveTo(x + dx - halfWidth, h * 0.5, x + dx, 0)
      ctx.fill()
    }
  }
  ctx.filter = 'none'
}

// One THREE.CanvasTexture per variant, for one tint. Called twice (birth,
// death) from inside useBeadMaterials' useMemo, so it runs on mount and
// then only on a theme flip — never per bead, never per frame.
//
// Returns a fixed-length array with a null wherever a 2D context could not
// be obtained. That is the same defensive shape normalizeCssColor already
// uses in this file, and it degrades honestly: a null map makes
// useBeadMaterials fall back to exactly the flat-tint glass this file
// shipped before marbles existed, rather than producing a black bead.
function createMarbleTextures(tint: string, seed: number): (THREE.CanvasTexture | null)[] {
  const palette = marblePalette(tint)
  const textures: (THREE.CanvasTexture | null)[] = []
  for (let variant = 0; variant < MARBLE_VARIANTS; variant++) {
    const canvas = document.createElement('canvas')
    canvas.width = MARBLE_TEXTURE_WIDTH
    canvas.height = MARBLE_TEXTURE_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      textures.push(null)
      continue
    }
    // A distinct but stable stream per variant. 7919 is just a prime
    // stride, so variant 0 and variant 1 do not start from adjacent seeds
    // and come out looking like each other.
    const rand = mulberry32(seed + variant * 7919)
    if (variant < MARBLE_SWIRL_VARIANTS) paintSwirl(ctx, palette, rand)
    else paintCatseye(ctx, palette, rand)
    const texture = new THREE.CanvasTexture(canvas)
    // The canvas holds CSS colours, i.e. sRGB. Without this three treats
    // the bytes as already-linear and every marble comes out pale and
    // washed out — the classic silent colour-space bug, with no warning.
    texture.colorSpace = THREE.SRGBColorSpace
    // u wraps around the bead (paintSwirl draws seam-crossing strokes on
    // both sides for this to be seamless); v runs pole to pole and must
    // clamp, or the north pole would sample the south pole's texels.
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    // Beads are viewed at a grazing angle around their silhouette, which
    // is where the ribbons are most compressed. 4x is the cheap end of
    // anisotropic filtering and is what stops the edge ribbons aliasing
    // into shimmer as a bead rolls.
    texture.anisotropy = 4
    textures.push(texture)
  }
  return textures
}

// A small FIXED set of materials for the entire scene — MARBLE_VARIANTS
// per kind, eight in total — not one per bead. This is the invariant the
// glass conversion is built on: three runs its transmission pass once per
// camera per frame for every transmissive object at once
// (renderTransmissionPass in WebGLRenderer), so the marginal cost of the
// Nth glass bead is one more draw call, not one more render target. Eight
// materials rather than two does not weaken that at all: all eight compile
// to a single shader program (identical defines), draw calls are unchanged
// at one per bead, and the transmission pass is still called once. What
// must never happen is this set becoming a function of the bead count.
//
// The marble texture is the material's `map`, and that is not decorative:
// three multiplies the REFRACTED light by the diffuse colour —
// map_fragment.glsl.js does `diffuseColor *= sampledDiffuseColor`,
// lights_physical_fragment.glsl.js sets `material.diffuseContribution =
// diffuseColor.rgb * (1 - metalness)`, and
// transmission_pars_fragment.glsl.js line 218 does `transmittance =
// diffuseColor * volumeAttenuation(...)` before `attenuatedColor =
// transmittance * transmittedLight.rgb`. So the swirl survives
// transmission at full strength instead of being mixed out by it, which is
// the whole reason a flat `map` behind a transmissive surface is the
// standard "colour trapped inside glass" technique.
//
// Recreated only when the resolved colours change, i.e. on a theme flip.
// The cleanup disposes the previous materials AND their canvas textures;
// by the time it runs React has already committed the render in which
// every mesh points at the new set, so nothing is disposed while in use.
function useBeadMaterials(colors: BeadColors) {
  const materials = useMemo(() => {
    function glass(tint: string, map: THREE.CanvasTexture | null) {
      const material = new THREE.MeshPhysicalMaterial({
        // White where a marble texture exists: the map already carries
        // every colour in the bead, including the tint it was derived
        // from, so a tinted `color` would apply that tint twice and crush
        // the ribbons back into one flat hue. Where no texture could be
        // built (see createMarbleTextures), this falls back to exactly the
        // flat-tint glass this file shipped before marbles existed.
        color: new THREE.Color(map ? 0xffffff : tint),
        map,
        // Pulled 60% toward white where a marble texture exists. Beer-Lambert
        // multiplies the same transmitted light the map does, so a
        // full-strength attenuation colour on top of a textured bead is the
        // tint applied twice. Without a texture the tint is the only colour
        // the bead has, so it stays at full strength there.
        attenuationColor: map
          ? new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.6)
          : new THREE.Color(tint),
        attenuationDistance: BEAD_ATTENUATION_DISTANCE,
        transmission: BEAD_TRANSMISSION,
        thickness: BEAD_THICKNESS,
        ior: BEAD_IOR,
        roughness: BEAD_ROUGHNESS,
        clearcoat: BEAD_CLEARCOAT,
        clearcoatRoughness: BEAD_CLEARCOAT_ROUGHNESS,
        metalness: 0,
        envMapIntensity: BEAD_ENV_INTENSITY,
      })
      // Assigned after construction rather than in the constructor object:
      // the installed @types/three's MeshPhysicalMaterialParameters may lag
      // behind the runtime three version and reject `dispersion` there even
      // though the runtime property exists (three 0.185+).
      material.dispersion = BEAD_DISPERSION
      return material
    }
    // Fixed seeds, not Date.now() or Math.random(): the same country in
    // the same theme must produce the same marbles on every reload, or the
    // human visual checkpoint has nothing stable to judge.
    const birthMaps = createMarbleTextures(colors.birth, 0x9e3779b1)
    const deathMaps = createMarbleTextures(colors.death, 0x85ebca77)
    return {
      birth: birthMaps.map((map) => glass(colors.birth, map)),
      death: deathMaps.map((map) => glass(colors.death, map)),
      textures: [...birthMaps, ...deathMaps].filter((map): map is THREE.CanvasTexture => map !== null),
    }
  }, [colors])

  useEffect(
    () => () => {
      for (const material of materials.birth) material.dispose()
      for (const material of materials.death) material.dispose()
      // Materials do not dispose their maps, so the canvas textures have
      // to be released explicitly or a theme flip leaks 1MB of VRAM.
      for (const texture of materials.textures) texture.dispose()
    },
    [materials],
  )

  return materials
}

// A lighting rig built from emissive planes and baked locally into a cube
// map. Two reasons it is shaped this way rather than <Environment
// preset="studio">: drei's presets fetch a 1-2MB HDRI from
// raw.githack.com at runtime, which is an outbound network dependency on a
// demo machine; and a locally baked map is deterministic and, with
// frames={1}, costs nothing after the first frame.
//
// memo() is load-bearing, not hygiene. drei's <Environment> re-runs its
// layout effect — and with frames={1} that effect re-renders the whole
// cube map — whenever its `children` element identity changes. BeadScene
// re-renders on every spawn (up to ~8/second), so without this memo the
// cube map would be re-baked several times a second forever. That was
// already true at 64px; at 256px it would be catastrophic.
//
// The fifth lightformer is new and is there for a specific reason:
// reflections read as *real* when the viewer can identify the shape being
// reflected. Four broad soft sources give a bead an even sheen; one small,
// bright, clearly rectangular "window" gives it a recognisable hard
// highlight that slides across the surface as the bead rolls, which is the
// single most convincing raytracing cue at this scale. It is bright and
// small rather than large and dim so it survives the PMREM blur.
//
// Positions are CSS pixels from the viewport centre; drei's Lightformer
// geometries are unit-sized, so `scale` is the light's size in pixels.
const BeadEnvironment = memo(function BeadEnvironment({
  intensity,
  resolution,
}: {
  intensity: number
  resolution: number
}) {
  return (
    <Environment resolution={resolution} frames={1} environmentIntensity={intensity}>
      <Lightformer form="rect" intensity={5} color="#ffffff" position={[0, 320, 140]} scale={[700, 320, 1]} />
      <Lightformer form="circle" intensity={3} color="#ffd9c4" position={[-360, 60, 220]} scale={[260, 260, 1]} />
      <Lightformer form="circle" intensity={2.4} color="#c7ddff" position={[360, -40, 220]} scale={[260, 260, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#ffffff" position={[0, -320, 180]} scale={[700, 260, 1]} />
      <Lightformer
        form="rect"
        intensity={9}
        color="#ffffff"
        position={[-150, 190, 300]}
        rotation={[0, 0.45, 0]}
        scale={[110, 190, 1]}
      />
    </Environment>
  )
})

// Invisible static colliders sized to the current viewport: a floor, two
// side walls, and a front/back pair that pins beads to the z=0 plane so the
// pile stays readable from a flat orthographic camera. No ceiling — the
// spawn point is above the top edge.
// memo() with no props means this re-renders only when its own useThree
// size subscription fires, not on every one of BeadScene's ~8/second spawn
// re-renders. Five fixed RigidBodies is not much to reconcile, but it is
// exactly zero work to avoid.
const Boundaries = memo(function Boundaries() {
  const { width, height } = useThree((state) => state.size)
  const halfW = width / 2
  const halfH = height / 2
  const half = WALL_THICKNESS / 2
  // CuboidCollider args are HALF-extents.
  // Side walls use halfH * 2 (i.e. extend to 2x the viewport height, not
  // just to its edges): beads spawn ABOVE the visible viewport (see
  // BeadBody's spawn position, height/2 + BEAD_RADIUS * 2), so the walls
  // must reach up past that spawn point too, or a bead could fall past the
  // wall's top edge before ever entering the visible region.
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, -halfH - half, 0]}>
        <CuboidCollider args={[halfW + WALL_THICKNESS, half, WALL_THICKNESS]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[-halfW - half, 0, 0]}>
        <CuboidCollider args={[half, halfH * 2, WALL_THICKNESS]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[halfW + half, 0, 0]}>
        <CuboidCollider args={[half, halfH * 2, WALL_THICKNESS]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[0, 0, BEAD_RADIUS + half]}>
        <CuboidCollider args={[halfW + WALL_THICKNESS, halfH * 2, half]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[0, 0, -BEAD_RADIUS - half]}>
        <CuboidCollider args={[halfW + WALL_THICKNESS, halfH * 2, half]} />
      </RigidBody>
    </>
  )
})

// An invisible static sphere standing in for the globe, so beads bounce off
// it and pile up around it instead of passing through the image of it.
//
// The globe is a flat 2D <canvas> (cobe is a shader drawing a sphere
// illusion — there is no 3D mesh to collide with), and it lives in a
// completely separate DOM layer from this physics canvas. So its geometry
// has to be measured on the DOM side and handed across: `circle` is in
// viewport CSS pixels (origin top-left, +y down), which converts into this
// canvas's world space (origin at the viewport's centre, +y up, 1 unit =
// 1 CSS pixel) by the two lines below.
//
// A true BallCollider, not a flattened disc: Boundaries' front/back planes
// already pin every bead's centre to exactly z = 0, and a sphere cut by the
// z = 0 plane IS a circle of the same radius — so this gives exactly the
// silhouette the user sees, with real curved contact normals that let beads
// roll off the shoulders rather than skid down a facet.
//
// Lower friction than the beads' own 0.6 so they actually shed off the
// crown instead of parking on top of it; low restitution so they roll away
// rather than ping across the screen.
function GlobeCollider({ circle }: { circle: GlobeCircle }) {
  const { width, height } = useThree((state) => state.size)
  const x = circle.centerX - width / 2
  const y = height / 2 - circle.centerY
  // Rapier reads position and collider args once, at creation. A window
  // resize moves and resizes the globe, so key the body on those values to
  // force a clean recreate rather than trusting an in-place shape diff.
  return (
    <RigidBody
      key={`${Math.round(x)}:${Math.round(y)}:${Math.round(circle.radius)}`}
      type="fixed"
      colliders={false}
      position={[x, y, 0]}
    >
      <BallCollider args={[circle.radius]} friction={0.3} restitution={0.2} />
    </RigidBody>
  )
}

// Drives the shrink-out of an evicted bead, and is the thing that finally
// removes it. Rendered only while `bead.dying` is true, deliberately:
// useFrame cannot be called conditionally, so subscribing all ~70 live
// beads to the render loop just so that a couple of them can animate would
// put 70 callbacks on every frame for nothing. A conditionally rendered
// companion moves that cost onto exactly the beads that need it.
//
// Scale, not opacity. Fading a MeshPhysicalMaterial needs transparent:true
// and a per-bead `opacity`, and opacity lives on the material — with the
// shared materials this file is built around (see useBeadMaterials) that
// would mean cloning a material per dying bead, which is precisely the
// per-bead allocation Phase 2 removed. Scale lives on the mesh's own
// Object3D, so it is per-bead by nature and touches no material state at
// all. It also simply looks better: a shrinking sphere of glass keeps
// refracting the whole way down, so it reads as receding rather than as
// dissolving.
//
// The collider is NOT resized. Rapier reads collider args once, at body
// creation, so resizing means recreating the body — which would teleport a
// settled bead back to the spawn point. For these ~420ms the bead
// therefore occupies slightly more space than it draws, and the pile
// visibly settles into the gap just after it has gone. That is the correct
// reading, and at this duration nobody parses the in-between frames.
function BeadFadeOut({
  meshRef,
  id,
  onExpire,
}: {
  meshRef: RefObject<THREE.Mesh | null>
  id: number
  onExpire: (id: number) => void
}) {
  const elapsedRef = useRef(0)
  // onExpire triggers a setState, and React may render one more frame
  // before the removal commits. Without this latch that frame would call
  // onExpire a second time with an id that is already gone.
  const doneRef = useRef(false)
  useFrame((_, delta) => {
    if (doneRef.current) return
    // useFrame's delta is in seconds.
    elapsedRef.current += delta * 1000
    const t = Math.min(elapsedRef.current / BEAD_EXIT_MS, 1)
    // Smoothstep, so the collapse has no jerk at either end.
    const scale = 1 - t * t * (3 - 2 * t)
    // Never exactly 0: a zero scale gives a singular model matrix, which
    // makes three's normal-matrix inverse produce NaNs and can blow out the
    // whole transmission pass for that frame.
    meshRef.current?.scale.setScalar(Math.max(scale, 0.001))
    if (t >= 1) {
      doneRef.current = true
      onExpire(id)
    }
  })
  return null
}

// Beads share one geometry and one of a small fixed set of materials (see
// BEAD_GEOMETRY and useBeadMaterials), passed in as a prop rather than
// declared as a child element — declaring it as a child is what would give
// every bead its own copy. `dispose={null}` tells react-three-fiber not to
// dispose these shared objects when an individual bead is culled by the
// MAX_BEADS cap; their lifetimes are owned by the module and by
// useBeadMaterials.
//
// RigidBody `position` is only read when the body is created, so stable
// React keys matter: a changing key would recreate the body and teleport a
// settled bead back to the spawn point.
//
// BeadFadeOut sits OUTSIDE the RigidBody on purpose. It renders null, so
// it is inert either way, but keeping it out of the RigidBody's subtree
// keeps react-three-rapier's child traversal (which is what derives the
// ball collider from the mesh) looking at exactly one child, as before.
const BeadBody = memo(function BeadBody({
  bead,
  material,
  onExpire,
}: {
  bead: Bead
  material: THREE.Material
  onExpire: (id: number) => void
}) {
  const height = useThree((state) => state.size.height)
  const meshRef = useRef<THREE.Mesh>(null)
  return (
    <>
      <RigidBody
        colliders="ball"
        position={[bead.x, height / 2 + BEAD_RADIUS * 2, 0]}
        restitution={0.25}
        friction={0.6}
        linearDamping={0.1}
      >
        <mesh ref={meshRef} geometry={BEAD_GEOMETRY} material={material} dispose={null} />
      </RigidBody>
      {bead.dying && <BeadFadeOut meshRef={meshRef} id={bead.id} onExpire={onExpire} />}
    </>
  )
})

interface BeadSceneProps {
  demographics: CountryDemographics
  theme: 'light' | 'dark'
  /** The globe's on-screen circle, measured by GlobeView. Null until the
   * globe canvas has been laid out — the scene simply runs without the
   * globe obstacle until it arrives. */
  globeCircle: GlobeCircle | null
}

export function BeadScene({ demographics, theme, globeCircle }: BeadSceneProps) {
  // Re-resolved whenever the theme flips. Deliberately inside a rAF: the
  // `.dark` class is toggled by App's own useTheme effect, and child
  // effects run BEFORE parent effects in React — reading the computed
  // colour synchronously here would pick up the OLD theme's values. Waiting
  // one frame guarantees the class is on the document first.
  const [colors, setColors] = useState<BeadColors>(resolveBeadColors)
  useEffect(() => {
    const id = requestAnimationFrame(() => setColors(resolveBeadColors()))
    return () => cancelAnimationFrame(id)
  }, [theme])
  const materials = useBeadMaterials(colors)

  const [beads, setBeads] = useState<Bead[]>([])
  // Monotonic counter, not Math.random(): React keys must be stable and
  // never collide, or Rapier bodies get torn down and recreated mid-fall.
  const nextIdRef = useRef(0)

  const birthIntervalMs = useMemo(
    () => spawnIntervalMs(demographics.birthsPerSecond),
    [demographics.birthsPerSecond],
  )
  const deathIntervalMs = useMemo(
    () => spawnIntervalMs(demographics.deathsPerSecond),
    [demographics.deathsPerSecond],
  )

  // Stable identity: BeadBody is memo()'d, so a fresh callback on every
  // render would defeat that memo for all ~70 beads on every spawn tick.
  // The functional setState means it never needs to close over `beads`.
  const expireBead = useCallback((id: number) => {
    setBeads((prev) => prev.filter((bead) => bead.id !== id))
  }, [])

  useEffect(() => {
    function spawn(kind: 'birth' | 'death') {
      setBeads((prev) => {
        // Evicting the oldest bead is what keeps the scene bounded, but
        // deleting it outright is what made beads appear to blink out of
        // existence: after a few seconds the oldest bead is almost always
        // one that has already settled at the bottom of the pile, so the
        // eviction reads as a settled bead vanishing at the exact instant a
        // new one appears at the top. Instead the oldest LIVE bead is
        // flagged `dying`; BeadFadeOut shrinks it over BEAD_EXIT_MS and
        // then calls expireBead, which is what finally removes it.
        //
        // MAX_BEADS therefore caps live beads, not array length — a handful
        // of dying beads ride along for under half a second each (see the
        // bound in BEAD_EXIT_MS's comment).
        const live = prev.reduce((count, bead) => (bead.dying ? count : count + 1), 0)
        let next = prev
        if (live >= MAX_BEADS) {
          // find() returns the first non-dying entry, i.e. the oldest one,
          // because the array is append-ordered.
          const oldest = prev.find((bead) => !bead.dying)
          if (oldest) next = prev.map((bead) => (bead === oldest ? { ...bead, dying: true } : bead))
        }
        return [
          ...next,
          {
            id: nextIdRef.current++,
            kind,
            x: (Math.random() - 0.5) * 2 * SPAWN_JITTER_PX,
            variant: Math.floor(Math.random() * MARBLE_VARIANTS),
            dying: false,
          },
        ]
      })
    }
    const birthTimer = window.setInterval(() => spawn('birth'), birthIntervalMs)
    const deathTimer = window.setInterval(() => spawn('death'), deathIntervalMs)
    return () => {
      window.clearInterval(birthTimer)
      window.clearInterval(deathTimer)
    }
  }, [birthIntervalMs, deathIntervalMs])

  return (
    // pointer-events-none so the sliders and toggles underneath stay fully
    // usable — and so clicks still reach the globe underneath, which is the
    // scene's only exit (clicking the selected country's marker again).
    // z-0 keeps beads above the globe (earlier in the DOM) but below every
    // z-10/z-20 panel, so the beads read as falling in FRONT of the globe.
    //
    // R3F's <Canvas> unconditionally injects its own wrapper <div> with an
    // inline `pointer-events: auto` (react-three-fiber.esm.js's CanvasImpl,
    // to make sure its own pointer/orbit event handling works by default).
    // That inline style beats our ancestor's `pointer-events-none` class —
    // without overriding it here, this canvas would silently swallow every
    // click over the full viewport, including the globe's own deselect
    // click. Canvas spreads its `style` prop after its own defaults, so this
    // override wins.
    <div className="pointer-events-none fixed inset-0 z-0">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 600], zoom: 1, near: 0.1, far: 2000 }}
        // The glass shader and three's transmission pass both scale with
        // pixel count, and react-three-fiber otherwise renders at the full
        // device pixel ratio — 2 or 3 on the kind of laptop a demo gets
        // recorded on, i.e. 4-9x the fragments. Capping at 1.5 keeps bead
        // silhouettes smooth while bounding the worst case.
        dpr={[1, 1.5]}
        style={{ pointerEvents: 'none' }}
        onCreated={({ gl }) => {
          // three sizes its transmission render target to viewport *
          // transmissionResolutionScale (WebGLRenderer's
          // renderTransmissionPass). Nothing opaque is behind the beads
          // except the globe collider (invisible) and the page itself, so
          // downscaling this target is visually free while quartering the
          // pass's fill cost and its mipmap chain.
          gl.transmissionResolutionScale = 0.5
        }}
      >
        {/* Phase 1's ambientLight is deliberately gone: a transmissive
            material mixes its diffuse term out, so flat ambient light only
            washes out the highlights that make a bead read as glass. The
            directional light stays — it supplies the one crisp specular
            hot-spot per bead that separates "glass" from "fogged plastic" —
            at a lower intensity now that the environment map handles the
            rest. environmentIntensity is the only theme-dependent dial: the
            dark theme needs less lift or the pile blows out against a
            near-black page. */}
        <BeadEnvironment intensity={theme === 'dark' ? 1 : 1.5} resolution={BEAD_ENV_RESOLUTION} />
        <directionalLight position={[200, 400, 300]} intensity={1.4} />
        {/* Rapier's WASM is loaded via suspend-react, so Physics suspends. */}
        <Suspense fallback={null}>
          <Physics gravity={[0, -GRAVITY_PX_PER_S2, 0]}>
            <Boundaries />
            {globeCircle && <GlobeCollider circle={globeCircle} />}
            {beads.map((bead) => (
              <BeadBody
                key={bead.id}
                bead={bead}
                material={(bead.kind === 'birth' ? materials.birth : materials.death)[bead.variant]}
                onExpire={expireBead}
              />
            ))}
          </Physics>
        </Suspense>
      </Canvas>
    </div>
  )
}
