import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
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
// Beer-Lambert attenuation: the shorter the distance, the more saturated
// the glass. One bead radius means a bead is fully tinted by the time
// light has crossed half of it.
const BEAD_ATTENUATION_DISTANCE = BEAD_RADIUS
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

// Two materials for the entire scene, not two per bead. Beyond the obvious
// allocation saving, this is what makes glass affordable at all: three
// runs its transmission pass once per camera per frame for every
// transmissive object at once (renderTransmissionPass in WebGLRenderer),
// so the marginal cost of the Nth glass bead is one more draw call, not
// one more render target.
//
// Recreated only when the resolved colours change, i.e. on a theme flip.
// The cleanup disposes the previous pair; by the time it runs, React has
// already committed the render in which every mesh points at the new pair,
// so nothing is disposed while still in use.
function useBeadMaterials(colors: BeadColors) {
  const materials = useMemo(() => {
    function glass(tint: string) {
      const color = new THREE.Color(tint)
      return new THREE.MeshPhysicalMaterial({
        color,
        attenuationColor: color.clone(),
        attenuationDistance: BEAD_ATTENUATION_DISTANCE,
        transmission: BEAD_TRANSMISSION,
        thickness: BEAD_THICKNESS,
        ior: BEAD_IOR,
        roughness: BEAD_ROUGHNESS,
        metalness: 0,
        envMapIntensity: 1.4,
      })
    }
    const birth = glass(colors.birth)
    const death = glass(colors.death)
    // Assigned after construction rather than in the constructor object:
    // the installed @types/three's MeshPhysicalMaterialParameters may lag
    // behind the runtime three version and reject `dispersion` there even
    // though the runtime property exists (three 0.185+).
    birth.dispersion = BEAD_DISPERSION
    death.dispersion = BEAD_DISPERSION
    return { birth, death }
  }, [colors])

  useEffect(
    () => () => {
      materials.birth.dispose()
      materials.death.dispose()
    },
    [materials],
  )

  return materials
}

// A lighting rig built from four emissive planes and baked locally into a
// 64px cube map. Two reasons it is shaped this way rather than
// <Environment preset="studio">: drei's presets fetch a 1-2MB HDRI from
// raw.githack.com at runtime, which is an outbound network dependency on a
// demo machine; and a cube map this small is free, blurs beautifully at
// bead scale, and is deterministic.
//
// memo() is load-bearing, not hygiene. drei's <Environment> re-runs its
// layout effect — and with frames={1} that effect re-renders the whole
// cube map — whenever its `children` element identity changes. BeadScene
// re-renders on every spawn (up to ~8/second), so without this memo the
// cube map would be re-baked several times a second forever.
//
// Positions are CSS pixels from the viewport centre; drei's Lightformer
// geometries are unit-sized, so `scale` is the light's size in pixels.
const BeadEnvironment = memo(function BeadEnvironment({ intensity }: { intensity: number }) {
  return (
    <Environment resolution={64} frames={1} environmentIntensity={intensity}>
      <Lightformer form="rect" intensity={5} color="#ffffff" position={[0, 320, 140]} scale={[700, 320, 1]} />
      <Lightformer form="circle" intensity={3} color="#ffd9c4" position={[-360, 60, 220]} scale={[260, 260, 1]} />
      <Lightformer form="circle" intensity={2.4} color="#c7ddff" position={[360, -40, 220]} scale={[260, 260, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#ffffff" position={[0, -320, 180]} scale={[700, 260, 1]} />
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

// Beads share one geometry and one of two materials (see BEAD_GEOMETRY and
// useBeadMaterials), passed in as a prop rather than declared as a child
// element — declaring it as a child is what would give every bead its own
// copy. `dispose={null}` tells react-three-fiber not to dispose these
// shared objects when an individual bead is culled by the MAX_BEADS cap;
// their lifetimes are owned by the module and by useBeadMaterials.
//
// RigidBody `position` is only read when the body is created, so stable
// React keys matter: a changing key would recreate the body and teleport a
// settled bead back to the spawn point.
const BeadBody = memo(function BeadBody({ bead, material }: { bead: Bead; material: THREE.Material }) {
  const height = useThree((state) => state.size.height)
  return (
    <RigidBody
      colliders="ball"
      position={[bead.x, height / 2 + BEAD_RADIUS * 2, 0]}
      restitution={0.25}
      friction={0.6}
      linearDamping={0.1}
    >
      <mesh geometry={BEAD_GEOMETRY} material={material} dispose={null} />
    </RigidBody>
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

  useEffect(() => {
    function spawn(kind: 'birth' | 'death') {
      setBeads((prev) => {
        // Trim from the front (oldest) so the array never exceeds the cap
        // once the new bead is appended.
        const kept = prev.length >= MAX_BEADS ? prev.slice(prev.length - MAX_BEADS + 1) : prev.slice()
        kept.push({
          id: nextIdRef.current++,
          kind,
          x: (Math.random() - 0.5) * 2 * SPAWN_JITTER_PX,
        })
        return kept
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
        <BeadEnvironment intensity={theme === 'dark' ? 1 : 1.5} />
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
                material={bead.kind === 'birth' ? materials.birth : materials.death}
              />
            ))}
          </Physics>
        </Suspense>
      </Canvas>
    </div>
  )
}
