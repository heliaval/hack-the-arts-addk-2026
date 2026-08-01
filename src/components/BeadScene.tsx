import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import type { CountryDemographics } from '@/lib/worldbank'
import { spawnIntervalMs } from '@/lib/beadSpawnRate'

// With <Canvas orthographic> and no manual frustum override, react-three-
// fiber sizes the camera frustum to the canvas's CSS pixel dimensions on
// every resize (see its updateCamera). So every number in this file is in
// CSS pixels, with the origin at the centre of the viewport, +y up.
// Rapier's default -9.81 gravity would therefore be 9.81 px/s^2 — beads
// would float. -2000 px/s^2 reads as roughly earth-like at this scale.
const GRAVITY_PX_PER_S2 = 2000
const BEAD_RADIUS = 14
const WALL_THICKNESS = 40
// Half-width of the horizontal band beads spawn across. Without jitter
// every bead would stack in one perfect column.
export const SPAWN_JITTER_PX = 90
// Live bead cap. Past this, the oldest bead is dropped as each new one
// spawns, so performance stays bounded however long the scene stays open.
export const MAX_BEADS = 180

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

// Invisible static colliders sized to the current viewport: a floor, two
// side walls, and a front/back pair that pins beads to the z=0 plane so the
// pile stays readable from a flat orthographic camera. No ceiling — the
// spawn point is above the top edge.
function Boundaries() {
  const { width, height } = useThree((state) => state.size)
  const halfW = width / 2
  const halfH = height / 2
  const half = WALL_THICKNESS / 2
  // CuboidCollider args are HALF-extents.
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
}

// Phase 1 deliberately uses a plain opaque material — glass refraction
// (drei's MeshTransmissionMaterial) is Phase 2, after the mechanics are
// confirmed. RigidBody `position` is only read when the body is created, so
// stable React keys matter: a changing key would recreate the body and
// teleport a settled bead back to the spawn point.
function BeadBody({ bead, colors }: { bead: Bead; colors: BeadColors }) {
  const height = useThree((state) => state.size.height)
  return (
    <RigidBody
      colliders="ball"
      position={[bead.x, height / 2 + BEAD_RADIUS * 2, 0]}
      restitution={0.25}
      friction={0.6}
      linearDamping={0.1}
    >
      <mesh>
        <sphereGeometry args={[BEAD_RADIUS, 20, 20]} />
        <meshStandardMaterial
          color={bead.kind === 'birth' ? colors.birth : colors.death}
          roughness={0.35}
          metalness={0.05}
        />
      </mesh>
    </RigidBody>
  )
}

interface BeadSceneProps {
  demographics: CountryDemographics
  theme: 'light' | 'dark'
}

export function BeadScene({ demographics, theme }: BeadSceneProps) {
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
    // usable — the shrunken globe's own handler, not this canvas, is the
    // exit. z-0 keeps beads above the globe (earlier in the DOM) but below
    // every z-10/z-20 panel.
    //
    // R3F's <Canvas> unconditionally injects its own wrapper <div> with an
    // inline `pointer-events: auto` (react-three-fiber.esm.js's CanvasImpl,
    // to make sure its own pointer/orbit event handling works by default).
    // That inline style beats our ancestor's `pointer-events-none` class —
    // without overriding it here, this canvas would silently swallow every
    // click over the full viewport, including the shrunken globe's own
    // deselect click. Canvas spreads its `style` prop after its own
    // defaults, so this override wins.
    <div className="pointer-events-none fixed inset-0 z-0">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 600], zoom: 1, near: 0.1, far: 2000 }}
        style={{ pointerEvents: 'none' }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[200, 400, 300]} intensity={2.2} />
        {/* Rapier's WASM is loaded via suspend-react, so Physics suspends. */}
        <Suspense fallback={null}>
          <Physics gravity={[0, -GRAVITY_PX_PER_S2, 0]}>
            <Boundaries />
            {beads.map((bead) => (
              <BeadBody key={bead.id} bead={bead} colors={colors} />
            ))}
          </Physics>
        </Suspense>
      </Canvas>
    </div>
  )
}
