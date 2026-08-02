import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { BallCollider, CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import { GLOBE_SURFACE_RADIUS_FRACTION, type GlobeCircle } from '@/components/ui/cobe-globe'

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

// Fixed cadence for the year-batch drain — reuses beadSpawnRate.ts's
// FASTEST_SPAWN_INTERVAL_MS value as a constant rate rather than a rate
// derived from real births/deathsPerSecond, since this feature shows "this
// year's totals landing," not "right now" — see
// docs/superpowers/specs/2026-08-01-year-select-marble-batches-design.md.
const BATCH_SPAWN_INTERVAL_MS = 120

// Restores the per-bead eviction the leaf-departure effect was originally
// designed around (see docs/superpowers/specs/2026-08-01-leaf-departure-
// effect-design.md), lost when the year-select-marble-batches refactor
// removed the old fixed-cap mechanism. marbleCount.ts's own comment
// references a "MAX_CAPACITY = 55" backstop as already existing here --
// it never actually did, and even if it had, 55 sits ABOVE this scene's
// real max combined spawn (25 + 25 = 50, per marbleCount.ts's MAX_MARBLES),
// so eviction would have silently never fired for any single country/year.
// 40 sits below that max so it actually bites for populous countries
// (where the effect is visible during normal viewing, not just on
// country/year switch), while small countries under 40 combined simply
// never reach it -- which is fine, there's nothing to evict yet.
const MAX_CAPACITY = 40
// How long a bead takes to shrink away once evicted.
const BEAD_EXIT_MS = 400

// No marble texture (see the removed painting pipeline further down this
// file). MARBLE_VARIANTS survives purely so Bead.variant keeps the same
// range and the material-array indexing in useBeadMaterials/BeadBody stays
// unchanged — each entry is currently the same clear-glass material.
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
// back a slice of the diffuse term keeps a red bead legibly red without
// making it look painted.
const BEAD_TRANSMISSION = 0.98
// Beer-Lambert attenuation. Deliberately weak: it multiplies the same
// transmitted term the marble texture does (see the shader trace on
// useBeadMaterials), so a tight attenuation distance would multiply every
// ribbon by a full-strength tint and flatten the swirl back into a single
// hue — technically present, visually gone. Six radii leaves a residual
// body tint, which is what still separates a red pile from a grey one at a
// glance, and lets the texture be the thing you actually look at.
const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS * 6
const BEAD_THICKNESS = BEAD_RADIUS * 2
// 1.52 is soda-lime glass. 1.0 would be air (no bending at all), 2.4
// diamond (comically warped at this size).
const BEAD_IOR = 1.52
// Low but not zero: a perfectly smooth sphere reads as a flat disc, a
// slightly rough one catches a readable highlight.
const BEAD_ROUGHNESS = 0.05
// three's native chromatic aberration (MeshPhysicalMaterial.dispersion,
// requires transmission > 0). This is what drei's MeshTransmissionMaterial
// used to be needed for.
//
// 0, not a subtle value: three only compiles the dispersion code path
// (USE_DISPERSION) when dispersion > 0 at all, and that path samples the
// transmission background THREE times per fragment (once per colour
// channel, offset) instead of once — turning it down to e.g. 1.0 keeps
// that same 3x sampling cost while only making the effect subtler. For up
// to a full batch's worth of fragments, every frame, this was the
// single most expensive line in the material — a real render-cost trade
// against the chromatic-fringing "raytraced" cue, not a free tune.
const BEAD_DISPERSION = 0

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
const BEAD_CLEARCOAT = 0.6
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
const BEAD_ENV_INTENSITY = 0.45

// One geometry for every bead, built once at module scope. Phase 1 gave
// each bead its own <sphereGeometry> element, i.e. up to a full batch's
// worth of byte-identical vertex buffers uploaded to the GPU. App renders
// <BeadScene key={`${iso3}-${year}`} />, so the whole component remounts on
// every country/year switch — module scope means this buffer survives those
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

const LENS_TEXTURE_WIDTH = 256
const LENS_TEXTURE_HEIGHT = 128

// A single flattened lens of colour suspended in otherwise-clear glass —
// the reference-photo cat's-eye look: a light, bright core inside a
// saturated rim, not a flat swirl. Painted on an equirectangular canvas, so
// under SphereGeometry's UVs the lens converges to a point at both poles of
// the bead exactly the way a real vane does.
//
// The base is opaque white, not transparent: this material still relies on
// `transmission` (see BEAD_TRANSMISSION) for its clear-glass read, and a
// transparent/black canvas area would multiply the transmitted light to
// zero and read as a hole rather than clear glass — the same trap the
// removed marble pipeline's `base` colour was built to avoid.
//
// Colour is derived from the tint, not hard-coded to the reference photo's
// purple/green, so birth/death legibility survives — the shape is what's
// being matched, not the specific hue.
function paintLens(ctx: CanvasRenderingContext2D, tint: string) {
  const w = LENS_TEXTURE_WIDTH
  const h = LENS_TEXTURE_HEIGHT
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  const hsl = { h: 0, s: 0, l: 0 }
  new THREE.Color(tint).getHSL(hsl, THREE.SRGBColorSpace)
  const shade = (dh: number, s: number, l: number) =>
    `#${new THREE.Color()
      .setHSL((hsl.h + dh + 1) % 1, THREE.MathUtils.clamp(s, 0, 1), THREE.MathUtils.clamp(l, 0, 1), THREE.SRGBColorSpace)
      .getHexString(THREE.SRGBColorSpace)}`
  const x = w / 2
  const halfWidth = 0.15 * w
  for (const dx of [-w, 0, w]) {
    // Outer rim: saturated, derived straight from the tint.
    ctx.fillStyle = shade(0, Math.min(1, hsl.s * 1.3 + 0.15), Math.max(0.32, hsl.l))
    ctx.beginPath()
    ctx.moveTo(x + dx, 0)
    ctx.quadraticCurveTo(x + dx + halfWidth, h * 0.5, x + dx, h)
    ctx.quadraticCurveTo(x + dx - halfWidth, h * 0.5, x + dx, 0)
    ctx.fill()
    // Inner core: lighter, narrower — the bright "hot" centre a real
    // cat's-eye vane has, which is what separates a lens from a flat blob.
    ctx.fillStyle = shade(0.03, hsl.s * 0.35, Math.min(0.95, hsl.l + 0.35))
    const innerHalf = halfWidth * 0.42
    ctx.beginPath()
    ctx.moveTo(x + dx, h * 0.1)
    ctx.quadraticCurveTo(x + dx + innerHalf, h * 0.5, x + dx, h * 0.9)
    ctx.quadraticCurveTo(x + dx - innerHalf, h * 0.5, x + dx, h * 0.1)
    ctx.fill()
  }
}

// One texture per tint (birth, death) — not per variant. Called from inside
// useBeadMaterials' useMemo, so it runs on mount and on a theme flip only.
function createLensTexture(tint: string): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = LENS_TEXTURE_WIDTH
  canvas.height = LENS_TEXTURE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  paintLens(ctx, tint)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 4
  return texture
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
          ? new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.92)
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
    // One lens texture per kind (birth, death), reused across all
    // MARBLE_VARIANTS material-array slots — bead.variant indexing stays
    // valid, but every entry currently points at the same lens look.
    const birthMap = createLensTexture(colors.birth)
    const deathMap = createLensTexture(colors.death)
    return {
      birth: Array.from({ length: MARBLE_VARIANTS }, () => glass(colors.birth, birthMap)),
      death: Array.from({ length: MARBLE_VARIANTS }, () => glass(colors.death, deathMap)),
      textures: [birthMap, deathMap].filter((t): t is THREE.CanvasTexture => t !== null),
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
//
// The six BOKEH_SPOTS below stand in for the bokeh circles the backdrop
// used to paint directly into the visible plane (useBackdropBase). Moving
// them here keeps the same illuminating effect on the beads' surface
// highlights without ever drawing a shape the camera can see on its own —
// see docs/superpowers/specs/2026-08-01-hidden-backdrop-glow-design.md.
// Positions/sizes are carried over from the old normalised canvas spots,
// scaled into this rig's pixel-from-centre space.
const BOKEH_SPOTS: Array<{ position: [number, number, number]; scale: number }> = [
  { position: [-230, 179, 260], scale: 200 },
  { position: [158, 224, 260], scale: 144 },
  { position: [252, -32, 260], scale: 230 },
  { position: [-108, -115, 260], scale: 173 },
  { position: [72, -205, 260], scale: 130 },
  { position: [-288, -160, 260], scale: 115 },
]

const BeadEnvironment = memo(function BeadEnvironment({
  intensity,
  resolution,
}: {
  intensity: number
  resolution: number
}) {
  return (
    <Environment resolution={resolution} frames={1} environmentIntensity={intensity}>
      <Lightformer form="rect" intensity={0.3} color="#ffffff" position={[0, 320, 140]} scale={[700, 320, 1]} />
      <Lightformer form="circle" intensity={0.15} color="#ffffff" position={[-360, 60, 220]} scale={[260, 260, 1]} />
      <Lightformer form="circle" intensity={0.15} color="#ffffff" position={[360, -40, 220]} scale={[260, 260, 1]} />
      <Lightformer form="rect" intensity={0.1} color="#ffffff" position={[0, -320, 180]} scale={[700, 260, 1]} />
      <Lightformer
        form="rect"
        intensity={2}
        color="#ffffff"
        position={[-150, 190, 300]}
        rotation={[0, 0.45, 0]}
        scale={[110, 190, 1]}
      />
      {BOKEH_SPOTS.map((spot, i) => (
        <Lightformer
          key={i}
          form="circle"
          intensity={0.1}
          color="#ffffff"
          position={spot.position}
          scale={[spot.scale, spot.scale, 1]}
        />
      ))}
    </Environment>
  )
})

// An opaque, warm-toned backdrop the beads genuinely refract, with the
// actual live globe drawn into it. three's transmission pass only samples
// OPAQUE geometry inside this scene, and without one there is none — the
// cobe globe is a separate canvas composited via CSS, invisible to this
// scene's own render — so transmission fell back to the lighting rig,
// reading as reflective rather than see-through. The bokeh backdrop (soft
// round highlights, not a flat gradient) gives transmission real structure
// to bend, and matches a real photographed marble's blurred background.
//
// An earlier version tried a transparent hole here so the DOM globe could
// show through underneath instead. That leaked: with no opaque geometry
// behind a bead, three's transmission shader lowers that fragment's own
// output alpha, and because the canvas is alpha-composited into the page,
// the browser then blends the bead itself with whatever DOM content sits
// below it — the globe's brightness bled straight into the glass. Drawing
// the globe's actual pixels INTO this canvas (ctx.drawImage, ordinary
// source-over onto an already-opaque base) sidesteps that entirely: the
// canvas stays alpha=1 everywhere, so there is nothing for the browser to
// blend through, and the beads now refract the real rotating globe as
// genuine in-scene content — the "actually see-through" look asked for
// from the start of this pass, without the compositing bug.
// Was 0.35. That downsampled the crisp globe canvas into this compositing
// canvas every frame, then a full-viewport plane stretched the low-res
// result back up — a downsample immediately followed by an upsample, which
// blurred the globe's fine dot-matrix landmasses (the flat gradient/bokeh
// underneath was soft enough that the same loss never showed). 1.0 matches
// the globe's own CSS-pixel resolution 1:1, so the plane no longer
// magnifies it. Costs more per-frame texture upload than 0.35 did, but the
// bokeh spots that originally justified keeping this low have moved to the
// Lightformer rig (BeadEnvironment) and no longer scale with it.
const BACKDROP_SCALE = 1

// Same lattice as the app's real background layer
// (src/components/ui/dot-matrix-background.tsx: a 24px radial-gradient
// cell with a 1px dot at each cell's centre) and as TileTransition's
// resting front face (DOT_GRID_BASE_STYLE). Reproduced here with Canvas
// 2D calls rather than CSS because this backdrop is a raw <canvas> that
// becomes a THREE.CanvasTexture -- there is no DOM element to put a
// background-image on.
const DOT_GRID_CELL_PX = 24
const DOT_RADIUS_PX = 1
// 0.32, not dot-matrix-background.tsx's own 0.18, for the reason spelled
// out at length on TileTransition's DOT_GRID_BASE_STYLE: near-black dots
// on a near-white base do NOT read as equally present as near-white dots
// on a near-black one at the same alpha, and 0.18 was reported invisible
// in light mode there. Matching TileTransition's number specifically
// matters here -- its tiles flip away to reveal THIS surface, so a
// different density would show as a visible step at the moment of the
// reveal.
const BACKDROP_DOT_OPACITY = 0.32

// Resolved sRGB values of src/index.css's --background / --foreground for
// each theme, hardcoded rather than read via getComputedStyle. Canvas 2D
// can't consume CSS custom properties, and reading the computed values at
// runtime would be reliably WRONG here: this runs inside a useMemo (i.e.
// during render), and the `.dark` class is toggled by App's own useTheme
// effect -- child effects run before parent effects, so a render-time
// read would pick up the PREVIOUS theme. Same trap resolveBeadColors
// works around with a requestAnimationFrame further down this file; a
// useMemo has no equivalent escape hatch, and the `theme` parameter here
// is already an authoritative input. Conversions are oklch(L 0 0) ->
// linear L^3 -> sRGB gamma: 0.2 -> #161616, 0.16 -> #0d0d0d,
// 0.95 -> #eeeeee. --background is a literal #fffffa in :root.
const BACKDROP_COLORS = {
  light: { base: '#fffffa', dot: '#161616' },
  dark: { base: '#0d0d0d', dot: '#eeeeee' },
} as const

// Same treatment as the DOM atmosphere layer's texture photo
// (AtmosphereLayers in dot-matrix-background.tsx: grayscale + contrast/
// brightness filter, soft-light blend), reproduced with Canvas 2D calls,
// for the same reason the dot grid above is -- this backdrop is a raw
// <canvas> feeding a THREE.CanvasTexture, no DOM element to put a CSS
// filter/background-image on. "Behind the globe" per explicit request,
// i.e. this backdrop specifically, not the DOM overlay
// (DotMatrixAtmosphere) that already sits above the beads.
//
// Contrast and opacity are LOWER here than the DOM layer's 1.5/0.23,
// deliberately, not a copy of those values -- found live: this plane has
// no cursor-reveal mask (unlike the DOM layer, which only ever shows a
// localized 340px patch), so it's permanently visible across the WHOLE
// backdrop, and the same contrast/opacity that reads as a subtle patch
// under the cursor reads as a bold, obviously-a-photo pattern spread
// across the entire scene. Toned down until it reads as background grain
// again rather than a visible motif.
const BACKDROP_TEXTURE_URL = '/textures/brick.jpg'
const BACKDROP_TEXTURE_FILTER = 'grayscale(1) contrast(1.15) brightness(1.05)'
const BACKDROP_TEXTURE_OPACITY = 0.1

// Module-level singleton, not per-component-instance: the image only
// ever needs to be fetched/decoded once for the whole app lifetime, and
// multiple BeadScene mounts (one per country selection, see App.tsx's
// `key={selectedIso3-selectedYear}`) must all reuse the same decoded
// <img> rather than each re-fetching it.
let backdropTextureImagePromise: Promise<HTMLImageElement> | null = null
function loadBackdropTextureImage(): Promise<HTMLImageElement> {
  if (!backdropTextureImagePromise) {
    backdropTextureImagePromise = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`failed to load ${BACKDROP_TEXTURE_URL}`))
      img.src = BACKDROP_TEXTURE_URL
    })
  }
  return backdropTextureImagePromise
}

// Returns null until the image has actually decoded -- the very first
// BeadScene mount of a session will draw its backdrop WITHOUT the
// texture layer (base + dots only) for one memo cycle, then redraw once
// this resolves. Every mount after that resolves synchronously from the
// cached promise before the first paint, since the image is already
// decoded. Acceptable: this is a one-time, one-frame cold-start gap, not
// a recurring cost, and BeadScene already has its own cold-start lead-in
// (see TileTransition's LEAD_IN_FORWARD_MS) that this comfortably fits
// inside.
function useBackdropTextureImage(): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    let cancelled = false
    loadBackdropTextureImage()
      .then((img) => {
        if (!cancelled) setImage(img)
      })
      .catch(() => {
        // Missing texture degrades to "no texture layer", not a crash --
        // same fallback the one-memo-cycle cold-start gap above already
        // exercises.
      })
    return () => {
      cancelled = true
    }
  }, [])
  return image
}

// Draws `img` into the current path/rect as CSS `background-size: cover`
// would: scaled up (never down) just enough that the shorter axis exactly
// fills its target dimension, centered, cropping the overflow on the
// longer axis. Canvas has no built-in equivalent of `background-size`.
function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

// Static base only (the app's dot-matrix texture) -- memoized on
// theme/viewport size alone, so it is NOT rebuilt every time the globe
// rotates or the circle moves a pixel during layout. The live globe is
// composited on top of a copy of this each frame in Backdrop's useFrame,
// below.
//
// History (2026-08-06): this was a vertical light-to-dark gradient, then
// briefly a flat pure-black fill, then reverted to the gradient, and is
// now the dot grid. The intent is that the bead scene's background reads
// as a CONTINUATION of the app's own persistent background layer
// (dot-matrix-background.tsx) rather than a separate gradient treatment
// of its own -- same 24px lattice, same --background/--foreground
// pairing per theme.
//
// The whole draw happens once per memo recomputation (theme flip or
// viewport resize), never per frame: Backdrop wraps the returned canvas
// in a CanvasTexture that uploads on construction and never has
// needsUpdate set again. Keep it that way.
function useBackdropBase(
  theme: 'light' | 'dark',
  width: number,
  height: number,
  textureImage: HTMLImageElement | null,
  circle: GlobeCircle | null,
) {
  return useMemo(() => {
    if (width <= 0 || height <= 0) return null
    const canvas = document.createElement('canvas')
    const w = Math.max(1, Math.round(width * BACKDROP_SCALE))
    const h = Math.max(1, Math.round(height * BACKDROP_SCALE))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const { base, dot } = BACKDROP_COLORS[theme]
    ctx.fillStyle = base
    ctx.fillRect(0, 0, w, h)

    // One 24x24 tile carrying a single dot, then one pattern fill for the
    // whole viewport -- two draw calls instead of a nested arc() loop
    // over every cell, and the pattern anchors to this canvas's own
    // origin under the identity transform, which IS the viewport-origin
    // lattice (this plane covers the full viewport 1:1 at
    // BACKDROP_SCALE=1). That's the same lattice TileTransition
    // reconstructs by hand via dotGridPosition, so the two line up
    // dot-for-dot where they meet.
    const cell = Math.max(1, Math.round(DOT_GRID_CELL_PX * BACKDROP_SCALE))
    const tile = document.createElement('canvas')
    tile.width = cell
    tile.height = cell
    const tileCtx = tile.getContext('2d')
    if (tileCtx) {
      // Dot at the cell's centre with a radius well under half the cell,
      // matching `radial-gradient(circle at center, ... 0 1px,
      // transparent 1px)` -- it never touches a tile edge, so the repeat
      // has no seam or clipping to worry about.
      tileCtx.fillStyle = dot
      tileCtx.beginPath()
      tileCtx.arc(cell / 2, cell / 2, DOT_RADIUS_PX * BACKDROP_SCALE, 0, Math.PI * 2)
      tileCtx.fill()
      const pattern = ctx.createPattern(tile, 'repeat')
      if (pattern) {
        // globalAlpha, not a pre-multiplied rgba() dot colour: it applies
        // to the pattern fill as a whole, and the tile is transparent
        // everywhere but the dot, so this is exactly the CSS layer's
        // `opacity` semantics. Restored immediately so nothing
        // downstream inherits it.
        ctx.globalAlpha = BACKDROP_DOT_OPACITY
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 1
      }
    }
    // Texture photo, soft-light blended over the base+dots composite so
    // far -- same layering order as the DOM atmosphere layer (dots, then
    // sheen, then photo on top). `ctx.filter` + `globalCompositeOperation`
    // are the Canvas 2D equivalents of the DOM layer's `filter` and
    // `mixBlendMode`; both are reset via save/restore immediately after,
    // same discipline as the globalAlpha reset above.
    //
    // Excludes the globe's own square box, clipped out BEFORE drawing --
    // found live as "the texture is superimposed on the globe." Root
    // cause: Backdrop's useFrame (below) composites the LIVE globe into
    // that exact box each frame via `ctx.drawImage(globeElement, ...)`,
    // but cobe's canvas is only opaque inside the sphere's circular
    // silhouette -- transparent in the box's four corners (see
    // cobe-globe.tsx). Ordinary source-over compositing means those
    // transparent corners let whatever THIS canvas already painted there
    // show through, every single frame. That was always true for the dot
    // grid too, just subtle enough not to draw complaints; the higher-
    // contrast texture photo made that same pre-existing seam obviously
    // visible as a patterned patch hugging the sphere's edge. Clipping
    // the texture draw to exclude that box removes the seam at the
    // source rather than tuning contrast/opacity down further to try to
    // hide it.
    if (textureImage) {
      ctx.save()
      if (circle) {
        // Same box-from-radius formula Backdrop's own boxSize uses
        // below, so this clip and that composite target the identical
        // region -- a mismatch here would just move the seam instead of
        // removing it.
        const boxSize = Math.max(
          1,
          Math.round((circle.radius / GLOBE_SURFACE_RADIUS_FRACTION) * BACKDROP_SCALE),
        )
        const boxX = circle.centerX * BACKDROP_SCALE - boxSize / 2
        const boxY = circle.centerY * BACKDROP_SCALE - boxSize / 2
        // evenodd, not the default nonzero: a plain outer rect plus an
        // inner rect wound the same direction would just re-fill the
        // whole canvas. evenodd makes overlapping subpaths punch a hole
        // wherever they're nested an odd number of times, so the inner
        // rect subtracts from the outer one regardless of winding order.
        ctx.beginPath()
        ctx.rect(0, 0, w, h)
        ctx.rect(boxX, boxY, boxSize, boxSize)
        ctx.clip('evenodd')
      }
      ctx.filter = BACKDROP_TEXTURE_FILTER
      ctx.globalCompositeOperation = 'soft-light'
      ctx.globalAlpha = BACKDROP_TEXTURE_OPACITY
      drawImageCover(ctx, textureImage, w, h)
      ctx.restore()
    }
    // The bokeh highlights that used to live here now live in the
    // Lightformer rig (BeadEnvironment) instead — same illuminating effect
    // on the beads, but no longer a shape visible directly in this backdrop.
    // See docs/superpowers/specs/2026-08-01-hidden-backdrop-glow-design.md.
    return canvas
  }, [theme, width, height, textureImage, circle])
}

// Every other frame only (~30fps at a 60fps display) — the globe rotates
// slowly enough that this backdrop doesn't need 60fps freshness to read as
// smooth, and this is the single most expensive per-frame op in the scene:
// ctx.drawImage(globeElement, ...) is a GPU->CPU readback off cobe's live
// WebGL canvas, and texture.needsUpdate then re-uploads the full result
// back to the GPU, at BACKDROP_SCALE=1 (full viewport resolution -- see
// that constant's own comment for why it isn't lower). Halving the update
// rate halves this cost without touching resolution or reverting that fix.
const BACKDROP_UPDATE_EVERY_N_FRAMES = 2

// Only the globe-sized region needs a per-frame update -- the dot-matrix
// base behind it never changes once built (see useBackdropBase).
// Previously this whole file's Backdrop was one full-viewport canvas,
// recomposited AND re-uploaded every BACKDROP_UPDATE_EVERY_N_FRAMES
// frames even though only the globe's own on-screen box (typically well
// under half the viewport) ever actually changes. Split into two meshes:
// a full-viewport base plane whose texture uploads exactly once
// (CanvasTexture uploads on construction; nothing here ever sets
// needsUpdate on it again), and a small globe-sized plane that gets the
// per-frame composite+upload treatment, at its own boxSize x boxSize
// resolution instead of the full viewport.
const Backdrop = memo(function Backdrop({
  theme,
  circle,
  globeElement,
}: {
  theme: 'light' | 'dark'
  circle: GlobeCircle | null
  globeElement: HTMLCanvasElement | null
}) {
  const { width, height } = useThree((state) => state.size)
  const backdropTextureImage = useBackdropTextureImage()
  const base = useBackdropBase(theme, width, height, backdropTextureImage, circle)

  const gradientTexture = useMemo(() => {
    if (!base) return null
    const texture = new THREE.CanvasTexture(base)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [base])
  useEffect(() => () => gradientTexture?.dispose(), [gradientTexture])

  // GLOBE_SURFACE_RADIUS_FRACTION (0.4) is already "sphere radius as a
  // fraction of the FULL canvas box width" — dividing circle.radius by it
  // yields the box width directly, not a radius that still needs doubling
  // into a diameter. `circle` is stable between resizes (GlobeView only
  // reports on an actual ResizeObserver/resize event with dedupe), so this
  // stays stable too, same rarity as the canvas/texture memo below.
  const boxSize = circle
    ? Math.max(1, Math.round((circle.radius / GLOBE_SURFACE_RADIUS_FRACTION) * BACKDROP_SCALE))
    : 0

  // Recreated only when the base (theme/size) or the globe's on-screen
  // size changes — globeElement is read fresh every frame in useFrame
  // instead of triggering a recreate, since the globe rotates continuously.
  // ctx hoisted alongside the canvas it belongs to (found in a 2026-08-06
  // performance audit) -- was previously re-fetched via canvas.getContext
  // inside useFrame every BACKDROP_UPDATE_EVERY_N_FRAMES-th frame; cheap
  // per-call (browsers cache the context object) but pointless work in a
  // hot path when it can just be captured once here instead.
  const { canvas, ctx, texture } = useMemo(() => {
    if (!base || boxSize <= 0) return { canvas: null, ctx: null, texture: null }
    const canvas = document.createElement('canvas')
    canvas.width = boxSize
    canvas.height = boxSize
    const ctx = canvas.getContext('2d')
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return { canvas, ctx, texture }
  }, [base, boxSize])
  useEffect(() => () => texture?.dispose(), [texture])

  const frameCountRef = useRef(0)

  useFrame(() => {
    if (!canvas || !ctx || !base || !texture || !circle) return
    frameCountRef.current++
    if (frameCountRef.current % BACKDROP_UPDATE_EVERY_N_FRAMES !== 0) return
    // Coordinates are DOM/CSS pixels with a top-left origin, matching this
    // canvas's own 2D coordinate system directly (unlike GlobeCollider,
    // which has to flip into world-space for Rapier). Crop `base` at the
    // same box the globe itself occupies, so the dot lattice stays
    // continuous (same phase, same size) across the seam between the two
    // planes.
    const cx = circle.centerX * BACKDROP_SCALE
    const cy = circle.centerY * BACKDROP_SCALE
    const sx = cx - boxSize / 2
    const sy = cy - boxSize / 2
    // No clearRect: the drawImage immediately below is opaque and covers
    // this exact same (0, 0, boxSize, boxSize) target rect every time, so
    // the clear was always immediately overwritten in full (found in the
    // same audit).
    ctx.drawImage(base, sx, sy, boxSize, boxSize, 0, 0, boxSize, boxSize)
    if (globeElement) ctx.drawImage(globeElement, 0, 0, boxSize, boxSize)
    texture.needsUpdate = true
  })

  if (!gradientTexture) return null
  return (
    <>
      <mesh position={[0, 0, -420]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={gradientTexture} toneMapped={false} />
      </mesh>
      {texture && circle && (
        <mesh position={[circle.centerX - width / 2, height / 2 - circle.centerY, -419]}>
          <planeGeometry args={[boxSize, boxSize]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      )}
    </>
  )
})

// The one highlight in the scene that's deliberately meant to be seen: a
// point light that tracks the cursor, so the specular hot-spot on whichever
// beads are nearby visibly slides as the mouse moves — the interactive cue
// the flat lighting rig above intentionally doesn't provide on its own.
//
// Position is read from a plain mutable ref, not React state: mousemove can
// fire far faster than React commits, and this only needs to feed useFrame,
// which already runs once per animation frame — a state update per pointer
// event would just be discarded work.
//
// Coordinates convert DOM (top-left origin, +y down) into this orthographic
// scene's convention (origin at viewport centre, +y up, 1 unit = 1 CSS
// pixel) — the same conversion GlobeCollider does for the globe's circle.
// z is fixed in front of the pile (BEAD_RADIUS puts it just past a bead's
// front face) so the light always grazes the beads facing the camera rather
// than sitting behind them.
const MOUSE_LIGHT_Z = BEAD_RADIUS * 4
const MOUSE_LIGHT_LERP = 0.25
// three's point/spot lights have used physically-based inverse-square decay
// (intensity / distance^2, in candela) since r155 — there is no
// "physicallyCorrectLights" toggle to opt out of it anymore. So this has to
// scale with MOUSE_LIGHT_DISTANCE^2 to land in the same visible range as
// the directionalLight above (which has no distance falloff at all), rather
// than being a small unitless number like that light's 0.4.
const MOUSE_LIGHT_DISTANCE = BEAD_RADIUS * 12
const MOUSE_LIGHT_INTENSITY = 0.5 * MOUSE_LIGHT_DISTANCE * MOUSE_LIGHT_DISTANCE

function MouseLight() {
  const { width, height } = useThree((state) => state.size)
  const targetRef = useRef({ x: 0, y: 0 })
  const lightRef = useRef<THREE.PointLight>(null)

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      targetRef.current = { x: e.clientX - width / 2, y: height / 2 - e.clientY }
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [width, height])

  useFrame(() => {
    const light = lightRef.current
    if (!light) return
    light.position.x = THREE.MathUtils.lerp(light.position.x, targetRef.current.x, MOUSE_LIGHT_LERP)
    light.position.y = THREE.MathUtils.lerp(light.position.y, targetRef.current.y, MOUSE_LIGHT_LERP)
  })

  return (
    <pointLight
      ref={lightRef}
      position={[0, 0, MOUSE_LIGHT_Z]}
      intensity={MOUSE_LIGHT_INTENSITY}
      distance={MOUSE_LIGHT_DISTANCE}
      decay={2}
      color="#ffffff"
    />
  )
}

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

// Beads share one geometry and one of a small fixed set of materials (see
// BEAD_GEOMETRY and useBeadMaterials), passed in as a prop rather than
// declared as a child element — declaring it as a child is what would give
// every bead its own copy. `dispose={null}` tells react-three-fiber not to
// dispose these shared objects when an individual bead is removed; their
// lifetimes are owned by the module and by useBeadMaterials.
//
// RigidBody `position` is only read when the body is created, so stable
// React keys matter: a changing key would recreate the body and teleport a
// settled bead back to the spawn point.
//
// Per-bead eviction at MAX_CAPACITY (see that constant's comment): the
// scene marks the oldest live bead `dying` rather than removing it
// outright, so it shrinks away over BEAD_EXIT_MS instead of popping out of
// existence. Physics keeps simulating it while it shrinks (only the mesh's
// own scale changes, not the RigidBody) -- cheap, and matches the original
// design's "quiet visual event" framing. `onDeparture` fires exactly once,
// at the moment `dying` first turns true (the shrink's start, not its
// end, so the leaf's launch is causally simultaneous with the marble
// beginning to vanish) -- guarded by `departedRef` since `dying` stays
// true for the whole shrink. Once the shrink completes, `onExpire` tells
// the parent to actually remove this bead from state, which is the only
// thing that unmounts this component.
// Reused across every bead's departure computation, not allocated fresh
// per-bead per-frame -- see BeadBody's useFrame for why this only ever
// needs to hold one bead's position for the single synchronous instant
// it's read, so one shared scratch vector is safe (JS is single-threaded;
// each bead's useFrame callback fully consumes it before the next runs).
const _departureScratch = new THREE.Vector3()

const BeadBody = memo(function BeadBody({
  bead,
  material,
  color,
  dying,
  onDeparture,
  onExpire,
}: {
  bead: Bead
  material: THREE.Material
  color: string
  dying: boolean
  onDeparture: (x: number, y: number, color: string) => void
  onExpire: (id: number) => void
}) {
  const { width, height } = useThree((state) => state.size)
  const meshRef = useRef<THREE.Mesh>(null)
  const exitElapsedMsRef = useRef(0)
  const departedRef = useRef(false)
  const expiredRef = useRef(false)

  // getWorldPosition (a matrix decompose) is only ever needed once per
  // bead's whole lifetime -- the instant it starts dying, to launch its
  // departure leaf from the right spot. Previously this ran for every
  // live bead on every single frame regardless of whether it was dying,
  // computing a value nothing read until (if ever) that one instant.
  useFrame((_, delta) => {
    if (!dying) return
    const mesh = meshRef.current
    if (!mesh) return
    if (!departedRef.current) {
      departedRef.current = true
      const worldPos = mesh.getWorldPosition(_departureScratch)
      // Orthographic camera, world units == CSS pixels, origin at viewport
      // centre, +y up (see this file's top-of-file comment) — flip to DOM
      // screen space (origin top-left, +y down) for LeafOverlay.
      onDeparture(width / 2 + worldPos.x, height / 2 - worldPos.y, color)
    }
    exitElapsedMsRef.current += delta * 1000
    const t = Math.min(1, exitElapsedMsRef.current / BEAD_EXIT_MS)
    mesh.scale.setScalar(1 - t)
    if (t >= 1 && !expiredRef.current) {
      expiredRef.current = true
      onExpire(bead.id)
    }
  })

  return (
    <RigidBody
      colliders="ball"
      position={[bead.x, height / 2 + BEAD_RADIUS * 2, 0]}
      restitution={0.25}
      friction={0.6}
      linearDamping={0.1}
    >
      <mesh ref={meshRef} geometry={BEAD_GEOMETRY} material={material} dispose={null} />
    </RigidBody>
  )
})

interface BeadSceneProps {
  birthMarbleCount: number
  deathMarbleCount: number
  birthAnnualTotal: number
  deathAnnualTotal: number
  onProgress: (progress: { births: number; deaths: number }) => void
  theme: 'light' | 'dark'
  /** The globe's on-screen circle, measured by GlobeView. Null until the
   * globe canvas has been laid out — the scene simply runs without the
   * globe obstacle until it arrives. */
  globeCircle: GlobeCircle | null
  /** The globe's live <canvas> element, for Backdrop to draw into its own
   * backdrop each frame (see Backdrop's comment for why). Null until
   * GlobeView's canvas has mounted. */
  globeElement: HTMLCanvasElement | null
  /** Called once per marble, at the moment it starts fading out (see
   * BeadBody's dying branch) — fires only on per-bead eviction at
   * MAX_CAPACITY. A full scene teardown (country/year switch or deselect)
   * does NOT fire this for whatever beads were still alive; there is no
   * unmount-based fallback anymore. Drives LeafOverlay
   * (src/components/LeafOverlay.tsx). */
  onDeparture: (x: number, y: number, color: string) => void
}

export const BeadScene = memo(function BeadScene({
  birthMarbleCount,
  deathMarbleCount,
  birthAnnualTotal,
  deathAnnualTotal,
  onProgress,
  theme,
  globeCircle,
  globeElement,
  onDeparture,
}: BeadSceneProps) {
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
  // ids currently mid-shrink-out (evicted at MAX_CAPACITY, or -- once
  // added -- expired via handleExpire). A bead in `beads` but not yet in
  // `dyingIds` is fully live; one in both is fading; handleExpire removes
  // it from both once its shrink finishes.
  const [dyingIds, setDyingIds] = useState<Set<number>>(() => new Set())
  // Mirrors of the two states above, read by spawn() to decide eviction.
  // spawn() is called from setInterval closures that don't see fresh
  // `beads`/`dyingIds` via React's normal closure capture (the same reason
  // the append below already had to use the setBeads updater form) --
  // refs kept in sync post-render give spawn() a same-or-previous-render
  // snapshot, plenty fresh at this spawn cadence (>=40ms, far slower than
  // a commit).
  const beadsRef = useRef<Bead[]>([])
  useEffect(() => {
    beadsRef.current = beads
  }, [beads])
  const dyingIdsRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    dyingIdsRef.current = dyingIds
  }, [dyingIds])
  // Monotonic counter, not Math.random(): React keys must be stable and
  // never collide, or Rapier bodies get torn down and recreated mid-fall.
  const nextIdRef = useRef(0)

  const handleExpire = useCallback((id: number) => {
    setBeads((prev) => prev.filter((b) => b.id !== id))
    setDyingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  useEffect(() => {
    function spawn(kind: 'birth' | 'death') {
      const liveCount = beadsRef.current.length - dyingIdsRef.current.size
      if (liveCount >= MAX_CAPACITY) {
        const oldest = beadsRef.current.find((b) => !dyingIdsRef.current.has(b.id))
        if (oldest) {
          setDyingIds((prev) => {
            const next = new Set(prev)
            next.add(oldest.id)
            return next
          })
        }
      }
      setBeads((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          kind,
          x: (Math.random() - 0.5) * 2 * SPAWN_JITTER_PX,
          variant: Math.floor(Math.random() * MARBLE_VARIANTS),
        },
      ])
    }

    let birthsSpawned = 0
    let deathsSpawned = 0
    let birthTimer: number | null = null
    let deathTimer: number | null = null

    function reportProgress() {
      onProgress({
        births: birthMarbleCount > 0 ? (birthsSpawned / birthMarbleCount) * birthAnnualTotal : 0,
        deaths: deathMarbleCount > 0 ? (deathsSpawned / deathMarbleCount) * deathAnnualTotal : 0,
      })
    }

    if (birthMarbleCount > 0) {
      birthTimer = window.setInterval(() => {
        spawn('birth')
        birthsSpawned += 1
        reportProgress()
        if (birthsSpawned >= birthMarbleCount && birthTimer !== null) {
          window.clearInterval(birthTimer)
          birthTimer = null
        }
      }, BATCH_SPAWN_INTERVAL_MS)
    }

    if (deathMarbleCount > 0) {
      deathTimer = window.setInterval(() => {
        spawn('death')
        deathsSpawned += 1
        reportProgress()
        if (deathsSpawned >= deathMarbleCount && deathTimer !== null) {
          window.clearInterval(deathTimer)
          deathTimer = null
        }
      }, BATCH_SPAWN_INTERVAL_MS)
    }

    // Both counters start at 0 immediately (a batch of 0 for either stream
    // — e.g. missing death-rate data for the year — should still report 0
    // rather than leaving the previous batch's last value on screen).
    reportProgress()

    return () => {
      if (birthTimer) window.clearInterval(birthTimer)
      if (deathTimer) window.clearInterval(deathTimer)
    }
  }, [birthMarbleCount, deathMarbleCount, birthAnnualTotal, deathAnnualTotal, onProgress])

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
        // recorded on, i.e. 4-9x the fragments. Was capped at 1.5, still
        // 2.25x native fragment count on a 2x-DPR display — every one of
        // those fragments re-evaluates BOTH real-time lights (the static
        // directionalLight and MouseLight's moving pointLight; the
        // Lightformer rig is baked once and doesn't cost this) against the
        // full transmission+clearcoat+dispersion glass shader, every frame.
        // MouseLight moving is what makes that cost visible frame-to-frame
        // (the directional light's contribution is just as expensive but
        // doesn't visibly change, so a slow frame reads as "the cursor
        // effect is laggy" rather than "everything is slow"). Flat 1
        // removes the DPR multiplier entirely — the highest-leverage
        // remaining cut without touching the lighting itself.
        dpr={1}
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
        {/* Deliberately subtle: every Lightformer here is desaturated and
            low-intensity so none of them reads as a visible light shape on
            a bead's surface — they only exist to keep the clearcoat/
            transmission shading from going flat (see the "stripped"
            comparison this was restored from). MouseLight supplies the one
            highlight that IS meant to be seen, tracking the cursor. */}
        <BeadEnvironment intensity={theme === 'dark' ? 0.35 : 0.55} resolution={BEAD_ENV_RESOLUTION} />
        <directionalLight position={[200, 400, 300]} intensity={0.4} />
        <MouseLight />
        <Backdrop theme={theme} circle={globeCircle} globeElement={globeElement} />
        {/* Rapier's WASM is loaded via suspend-react, so Physics suspends. */}
        <Suspense fallback={null}>
          {/* interpolate={false} (rather than timeStep="vary") removes the
              per-step previous-state snapshot pass (forEachRigidBody every
              frame) that the default fixed-1/60-with-interpolation mode
              runs -- that snapshot, not the fixed step count itself, was
              the real cost. timeStep="vary" was tried first and reverted:
              at this scene's real-world scale (GRAVITY_PX_PER_S2 = 2000,
              beads reaching ~1900 px/s by the time they hit the floor) and
              with no continuous collision detection on the ball colliders,
              a single slow frame (well within reach during exactly the lag
              this fix is meant to address) lets a bead's one physics step
              advance further than its own radius, tunnelling straight
              through the floor/globe collider and vanishing for good --
              every bead, permanently, since nothing ever recovers a
              tunnelled body. The fixed 1/60 step never lets a single step
              advance that far no matter how slow the frame is, so it
              can't tunnel; interpolate={false} keeps that safety while
              still cutting the snapshot cost. */}
          <Physics gravity={[0, -GRAVITY_PX_PER_S2, 0]} interpolate={false}>
            <Boundaries />
            {globeCircle && <GlobeCollider circle={globeCircle} />}
            {beads.map((bead) => (
              <BeadBody
                key={bead.id}
                bead={bead}
                material={(bead.kind === 'birth' ? materials.birth : materials.death)[bead.variant]}
                color={bead.kind === 'birth' ? colors.birth : colors.death}
                dying={dyingIds.has(bead.id)}
                onDeparture={onDeparture}
                onExpire={handleExpire}
              />
            ))}
          </Physics>
        </Suspense>
      </Canvas>
    </div>
  )
})
