import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle, memo } from "react"
import type { MutableRefObject } from "react"
import createGlobe, { type COBEOptions } from "cobe"
import { TextRotate, type TextRotateRef } from "@/components/ui/text-rotate"
import { computeSweepDelays } from "@/lib/sweep"

interface Marker {
  id: string
  location: [number, number]
  /** Renders a permanent label pill for this marker when set — one entry per
   * language variant, index-aligned with `activeLabelIndex`. Omit for
   * unlabeled dots. */
  label?: string[]
  /** Overrides the globe-wide `markerSize` prop for this marker. */
  size?: number
}

interface Arc {
  id: string
  from: [number, number]
  to: [number, number]
  label?: string[]
}

interface GlobeProps {
  markers?: Marker[]
  arcs?: Arc[]
  pulses?: { id: string; markerId: string; kind: "birth" | "death"; spawnedAt: number }[]
  className?: string
  markerColor?: [number, number, number]
  baseColor?: [number, number, number]
  arcColor?: [number, number, number]
  glowColor?: [number, number, number]
  dark?: number
  mapBrightness?: number
  markerSize?: number
  markerElevation?: number
  arcWidth?: number
  arcHeight?: number
  speed?: number
  theta?: number
  diffuse?: number
  mapSamples?: number
  /** Which entry of each label's variant array is shown; animates the swap. */
  activeLabelIndex?: number
  /** True when something opaque (BeadScene's backdrop) is covering this
   * canvas's entire viewport, so none of its pixels are directly visible.
   * Skips label/ripple DOM updates only — the WebGL draw itself (
   * globe.update()) still runs every frame regardless, since cobe's
   * context has preserveDrawingBuffer: false and BeadScene's Backdrop
   * reads this canvas's live pixels on its own schedule; skipping frames
   * here would risk it reading a blank buffer (see the comment above
   * animate()'s obscured handling for the full rationale). Does not pause
   * rotation state, so the globe is still in the right position whenever
   * it becomes directly visible again. */
  obscured?: boolean
}

export interface GlobeRef {
  /** Projects a lat/lng to current screen-space fraction (0-1) of the
   * canvas box, using the globe's live rotation — for callers that need to
   * know where something is on screen right now (e.g. to order a sweep
   * animation, or to hit-test a click). `visible` is false when the point
   * is on the far side of the globe. */
  project(location: [number, number]): { x: number; y: number; visible: boolean }
  /** The live <canvas> element. Callers hit-testing pointer events need it
   * to convert clientX/clientY into the same 0-1 fraction space `project()`
   * returns (via getBoundingClientRect). */
  getElement(): HTMLCanvasElement | null
  /** The globe's rendered circle in viewport CSS pixels. Null before the
   * canvas has been laid out (zero-sized). The radius is derived from
   * GLOBE_SURFACE_RADIUS_FRACTION, not from half the canvas box — the
   * sphere does not fill its canvas. */
  getCircle(): GlobeCircle | null
}

// cobe draws the globe's surface at radius 0.8 in the same projection space
// project() below maps onto the canvas box's 0-1 range via (c + 1) / 2 — so
// the rendered sphere's silhouette radius is 0.8 / 2 = 0.4 of the canvas
// box, NOT 0.5. There is a ~10% margin on every side. Anything outside this
// file that needs to know where the globe physically is on screen (the bead
// scene's collider, for one) must use GLOBE_SURFACE_RADIUS_FRACTION rather
// than assuming the sphere fills its square canvas.
const GLOBE_BASE_RADIUS = 0.8
export const GLOBE_SURFACE_RADIUS_FRACTION = GLOBE_BASE_RADIUS / 2

/** The globe's rendered circle in viewport CSS pixels — the same coordinate
 * space getBoundingClientRect() reports in, with the origin at the viewport's
 * top-left. */
export interface GlobeCircle {
  centerX: number
  centerY: number
  radius: number
}

// Mirrors cobe's own marker projection (node_modules/cobe/dist/index.esm.js,
// functions U/O/W) so label positions match the WebGL-rendered dots exactly.
// Re-derived here (rather than driven off cobe's built-in CSS-anchor label
// system) because that system rewrites its <style> tag's textContent every
// animation frame, which restarts the CSS opacity transition every frame and
// it never settles — labels never actually become visible.
function projectMarker(
  location: [number, number],
  phi: number,
  theta: number,
  elevation: number,
): { x: number; y: number; visible: boolean } {
  const r = GLOBE_BASE_RADIUS + elevation
  const u = unitSphere(location)
  return project([u[0] * r, u[1] * r, u[2] * r], phi, theta)
}

function unitSphere(location: [number, number]): [number, number, number] {
  const [lat, lon] = location
  const latRad = (lat * Math.PI) / 180
  const lonRad = (lon * Math.PI) / 180 - Math.PI
  const cosLat = Math.cos(latRad)
  return [-cosLat * Math.cos(lonRad), Math.sin(latRad), cosLat * Math.sin(lonRad)]
}

function project(
  point: [number, number, number],
  phi: number,
  theta: number,
): { x: number; y: number; visible: boolean } {
  const cosTheta = Math.cos(theta)
  const sinTheta = Math.sin(theta)
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const [px, py, pz] = point

  const c = cosPhi * px + sinPhi * pz
  const s = sinPhi * sinTheta * px + cosTheta * py - cosPhi * sinTheta * pz
  const facing = -sinPhi * cosTheta * px + sinTheta * py + cosPhi * cosTheta * pz

  return {
    x: (c + 1) / 2,
    y: (-s + 1) / 2,
    visible: facing >= 0 || c * c + s * s >= 0.64,
  }
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
  return [v[0] / len, v[1] / len, v[2] / len]
}

// A pair of unit vectors perpendicular to `center` and to each other --
// the local "east"/"north" basis used to parametrize a circle around
// `center` on the sphere (the standard spherical-cap construction).
function buildTangentBasis(center: [number, number, number]): {
  t1: [number, number, number]
  t2: [number, number, number]
} {
  const ref: [number, number, number] = Math.abs(center[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const t1 = normalize(cross(ref, center))
  const t2 = cross(center, t1)
  return { t1, t2 }
}

// A single point at azimuth `angle` around a circle of angular radius
// (encoded as cosR/sinR) centered at `center`, using the tangent basis
// from buildTangentBasis().
function ringPoint(
  center: [number, number, number],
  t1: [number, number, number],
  t2: [number, number, number],
  cosR: number,
  sinR: number,
  angle: number,
): [number, number, number] {
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  return [
    center[0] * cosR + (t1[0] * cosA + t2[0] * sinA) * sinR,
    center[1] * cosR + (t1[1] * cosA + t2[1] * sinA) * sinR,
    center[2] * cosR + (t1[2] * cosA + t2[2] * sinA) * sinR,
  ]
}

// Analytically finds the sub-arc of the ring (by azimuth angle) that's
// actually facing the camera, instead of sampling points and checking each
// one's visibility individually (which, at this ring's point density, let
// small facing fluctuations near the limb read as multiple scattered gaps
// rather than one clean split). Works because `facing` -- the same
// quantity project() uses -- is a LINEAR function of a 3D point, and a
// ring point is an affine combination of cos(angle)/sin(angle), so
// facing(angle) reduces to a plain sinusoid `C + A*cos(angle) +
// B*sin(angle)`, solvable in closed form. Returns null if the entire ring
// is on the far side, or the arc bounds (which may span the full circle)
// otherwise.
function computeVisibleArc(
  center: [number, number, number],
  t1: [number, number, number],
  t2: [number, number, number],
  cosR: number,
  sinR: number,
  r: number,
  phi: number,
  theta: number,
): { start: number; end: number; full: boolean } | null {
  const cosTheta = Math.cos(theta)
  const sinTheta = Math.sin(theta)
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  // Coefficients of facing(point) = vx*px + vy*py + vz*pz (same formula as
  // project()'s `facing`).
  const vx = -sinPhi * cosTheta
  const vy = sinTheta
  const vz = cosPhi * cosTheta
  const dot = (a: [number, number, number]) => vx * a[0] + vy * a[1] + vz * a[2]

  const C = r * cosR * dot(center)
  const A = r * sinR * dot(t1)
  const B = r * sinR * dot(t2)
  const amplitude = Math.sqrt(A * A + B * B)

  if (amplitude < 1e-9 || Math.abs(C) >= amplitude) {
    // facing never changes sign around the ring -- entirely visible or
    // entirely hidden.
    return C >= 0 ? { start: 0, end: Math.PI * 2, full: true } : null
  }

  // A*cos + B*sin = amplitude*cos(angle - gamma); solve for where that
  // equals -C. The resulting short arc [gamma-delta, gamma+delta] is
  // always the visible side (facing(gamma) = C + amplitude > 0, since
  // |C| < amplitude).
  const gamma = Math.atan2(B, A)
  const delta = Math.acos(Math.max(-1, Math.min(1, -C / amplitude)))
  return { start: gamma - delta, end: gamma + delta, full: false }
}

// Builds an open (or, for a full circle, self-closing) SVG path `d`
// string from a sequence of already-projected points, in order.
function buildRingPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ""
  let d = ""
  points.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)} `
  })
  return d
}

// Kept as a local constant rather than imported from populationPulse.ts --
// cobe-globe.tsx is a generic UI primitive and shouldn't depend on an
// app-specific data-layer file. If this ever drifts from that file's
// PULSE_DURATION_MS, the ring's fade timing and the pulse's
// removal-from-state timing would desync.
const PULSE_MAX_ANGULAR_RADIUS = 1.1
const PULSE_RING_SEGMENTS = 40
const PULSE_DURATION_MS = 1800

// Mirrors cobe's arc-midpoint projection (function X in its source) for
// placing arc labels at the peak of the arc's bulge.
function projectArcMidpoint(
  from: [number, number],
  to: [number, number],
  phi: number,
  theta: number,
  elevation: number,
  arcHeight: number,
): { x: number; y: number; visible: boolean } | null {
  const base = GLOBE_BASE_RADIUS + elevation
  const uFrom = unitSphere(from)
  const uTo = unitSphere(to)
  const sum: [number, number, number] = [uFrom[0] + uTo[0], uFrom[1] + uTo[1], uFrom[2] + uTo[2]]
  const mag = Math.sqrt(sum[0] ** 2 + sum[1] ** 2 + sum[2] ** 2)
  if (mag < 0.001) return null

  const scale = 0.25 * base + (0.5 * (base + arcHeight)) / mag
  return project([sum[0] * scale, sum[1] * scale, sum[2] * scale], phi, theta)
}

export const Globe = forwardRef<GlobeRef, GlobeProps>(function Globe({
  markers = [],
  arcs = [],
  pulses = [],
  className = "",
  markerColor = [0.3, 0.45, 0.85],
  baseColor = [1, 1, 1],
  arcColor = [0.3, 0.45, 0.85],
  glowColor = [0.94, 0.93, 0.91],
  dark = 0,
  mapBrightness = 10,
  markerSize = 0.025,
  markerElevation = 0.01,
  arcWidth = 0.5,
  arcHeight = 0.25,
  speed = 0.003,
  theta = 0.2,
  diffuse = 1.5,
  mapSamples = 16000,
  activeLabelIndex = 0,
  obscured = false,
}: GlobeProps, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The canvas's own on-screen box size in px, tracked live rather than
  // captured once -- see the comment where this is written (below, near
  // the ResizeObserver) for why a one-time snapshot was a real bug, not
  // just imprecise. Initialized to 0 so the very first animation frame
  // (before any measurement lands) skips label positioning entirely
  // rather than positioning against a wrong size.
  const boxSizeRef = useRef(0)
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const arcLabelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // Stable per-id setRef callbacks (created once, cached, reused) rather
  // than a fresh inline arrow per render — LabelPill is memoized below, and
  // a fresh setRef reference every render would defeat that memo for every
  // label on every frame, even ones whose actual content hasn't changed.
  const labelRefSetters = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  const arcLabelRefSetters = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  const pulseRefs = useRef<Map<string, SVGPathElement>>(new Map())
  const pulseRefSetters = useRef<Map<string, (el: SVGPathElement | null) => void>>(new Map())
  function getRefSetter<T extends Element>(
    cache: MutableRefObject<Map<string, (el: T | null) => void>>,
    target: MutableRefObject<Map<string, T>>,
    id: string,
  ) {
    let setter = cache.current.get(id)
    if (!setter) {
      setter = (el) => {
        if (el) target.current.set(id, el)
        else target.current.delete(id)
      }
      cache.current.set(id, setter)
    }
    return setter
  }
  // Live rotation snapshot, updated every animate() frame — lets project()
  // (exposed via ref) and the language-sweep effect below compute current
  // screen position between frames without threading phi/theta as props.
  const currentPhiRef = useRef(0)
  const currentThetaRef = useRef(theta)
  // Read by the animation loop every frame instead of being a useEffect
  // dependency — lets markers/arcs/colors update live without tearing down
  // and recreating the globe, which would reset its rotation to phi=0.
  const liveProps = useRef({
    markers,
    arcs,
    pulses,
    obscured,
    markerColor,
    baseColor,
    arcColor,
    glowColor,
    dark,
    mapBrightness,
    markerSize,
    markerElevation,
    arcWidth,
    arcHeight,
    speed,
  })
  liveProps.current = {
    markers,
    arcs,
    pulses,
    obscured,
    markerColor,
    baseColor,
    arcColor,
    glowColor,
    dark,
    mapBrightness,
    markerSize,
    markerElevation,
    arcWidth,
    arcHeight,
    speed,
  }
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null)
  const lastPointer = useRef<{ x: number; y: number; t: number } | null>(null)
  const dragOffset = useRef({ phi: 0, theta: 0 })
  const velocity = useRef({ phi: 0, theta: 0 })
  const phiOffsetRef = useRef(0)
  const thetaOffsetRef = useRef(0)
  const isPausedRef = useRef(false)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY }
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing"
    isPausedRef.current = true
  }, [])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (pointerInteracting.current !== null) {
      const deltaX = e.clientX - pointerInteracting.current.x
      const deltaY = e.clientY - pointerInteracting.current.y
      dragOffset.current = { phi: deltaX / 300, theta: deltaY / 1000 }
      const now = Date.now()
      if (lastPointer.current) {
        const dt = Math.max(now - lastPointer.current.t, 1)
        const maxVelocity = 0.15
        velocity.current = {
          phi: Math.max(
            -maxVelocity,
            Math.min(maxVelocity, ((e.clientX - lastPointer.current.x) / dt) * 0.3)
          ),
          theta: Math.max(
            -maxVelocity,
            Math.min(maxVelocity, ((e.clientY - lastPointer.current.y) / dt) * 0.08)
          ),
        }
      }
      lastPointer.current = { x: e.clientX, y: e.clientY, t: now }
    }
  }, [])

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi
      thetaOffsetRef.current += dragOffset.current.theta
      dragOffset.current = { phi: 0, theta: 0 }
      lastPointer.current = null
    }
    pointerInteracting.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = "grab"
    isPausedRef.current = false
  }, [])

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("pointerup", handlePointerUp, { passive: true })
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    let globe: ReturnType<typeof createGlobe> | null = null
    let animationId: number
    let phi = 0

    function init() {
      const width = canvas.offsetWidth
      if (width === 0 || globe) return
      boxSizeRef.current = width

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const initial = liveProps.current
      globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width,
        height: width,
        phi: 0,
        theta,
        dark: initial.dark,
        diffuse,
        mapSamples,
        mapBrightness: initial.mapBrightness,
        baseColor: initial.baseColor,
        markerColor: initial.markerColor,
        glowColor: initial.glowColor,
        markerElevation: initial.markerElevation,
        markers: initial.markers.map((m) => ({
          location: m.location,
          size: m.size ?? initial.markerSize,
          id: m.id,
        })),
        arcs: initial.arcs.map((a) => ({
          from: a.from,
          to: a.to,
          id: a.id,
        })),
        arcColor: initial.arcColor,
        arcWidth: initial.arcWidth,
        arcHeight: initial.arcHeight,
        opacity: 0.7,
      })

      // Positions labels via `transform: translate3d(...)` instead of
      // `left`/`top` percentages, and skips redundant opacity writes --
      // found in a 2026-08-06 performance audit. `left`/`top` are layout
      // properties: writing them invalidates layout for the label's
      // subtree (each pill is a TextRotate instance, ~8-13 child spans),
      // and at cityCount=20 this ran for ~24 markers/arcs every animation
      // frame (60x/sec) -- exactly the "20 cities" cost this file's own
      // LagWarning already warns users about. `transform` is
      // compositor-only, so the same positioning work no longer touches
      // layout at all.
      //
      // Reads `boxSizeRef.current` (a live, resize-tracked value -- see
      // the ResizeObserver below), NOT a `width` closed over from this
      // effect's own init-time measurement. That was the very first
      // version of this fix and it was a real regression, found live: CSS
      // percentages (the original `left`/`top` approach) always resolve
      // against the container's CURRENT size, so they self-corrected
      // automatically no matter when the browser read them. A `width`
      // captured once at init doesn't -- if the canvas's `ResizeObserver`
      // fires (as it must, to even get width>0 in the first place) before
      // this page's webfonts (Geist, Cormorant Garamond) finish loading
      // and reflow the layout, every label lands at an offset computed
      // from a stale box size for the component's entire lifetime, which
      // reads as labels scattered miles from their markers, stacked near
      // the document's default flow position. A ref updated on every
      // resize (not just the first) fixes this the same way percentages
      // did, while still avoiding a per-frame layout-forcing read.
      //
      // Multiplying the 0-1 fraction from projectMarker/projectArcMidpoint
      // by this box size converts to the same px space the label's
      // container box uses, since the label pills are siblings of the
      // canvas inside the same aspect-square container. The `-50%,
      // calc(-100% - 10px)` offset (pill anchored above-and-centered on
      // its point) has to be folded into this same transform string
      // rather than left as a separate static one, since an element can
      // only have one `transform`.
      function updateLabels(currentPhi: number, currentTheta: number, markerElevation: number, arcHeight: number) {
        const boxSize = boxSizeRef.current
        if (boxSize <= 0) return
        for (const m of liveProps.current.markers) {
          const el = labelRefs.current.get(m.id)
          if (!el) continue
          const { x, y, visible } = projectMarker(m.location, currentPhi, currentTheta, markerElevation)
          el.style.transform = `translate3d(${x * boxSize}px, ${y * boxSize}px, 0) translate(-50%, calc(-100% - 10px))`
          const opacity = visible ? "1" : "0"
          if (el.style.opacity !== opacity) el.style.opacity = opacity
        }
        for (const a of liveProps.current.arcs) {
          const el = arcLabelRefs.current.get(a.id)
          if (!el) continue
          const projected = projectArcMidpoint(a.from, a.to, currentPhi, currentTheta, markerElevation, arcHeight)
          if (!projected) {
            if (el.style.opacity !== "0") el.style.opacity = "0"
            continue
          }
          el.style.transform = `translate3d(${projected.x * boxSize}px, ${projected.y * boxSize}px, 0) translate(-50%, calc(-100% - 10px))`
          const opacity = projected.visible ? "1" : "0"
          if (el.style.opacity !== opacity) el.style.opacity = opacity
        }
      }

      function updateRipples(currentPhi: number, currentTheta: number, markerElevation: number) {
        const now = Date.now()
        for (const pulse of liveProps.current.pulses) {
          const el = pulseRefs.current.get(pulse.id)
          if (!el) continue
          const marker = liveProps.current.markers.find((m) => m.id === pulse.markerId)
          if (!marker) {
            el.setAttribute("d", "")
            continue
          }
          const p = Math.min(1, Math.max(0, (now - pulse.spawnedAt) / PULSE_DURATION_MS))
          const eased = 1 - (1 - p) ** 2
          const angularRadius = eased * PULSE_MAX_ANGULAR_RADIUS
          const opacity = (1 - p) ** 1.3
          const r = GLOBE_BASE_RADIUS + markerElevation
          const center = unitSphere(marker.location)
          const { t1, t2 } = buildTangentBasis(center)
          const cosR = Math.cos(angularRadius)
          const sinR = Math.sin(angularRadius)

          const arc = computeVisibleArc(center, t1, t2, cosR, sinR, r, currentPhi, currentTheta)
          if (!arc) {
            el.setAttribute("d", "")
            el.style.opacity = "0"
            continue
          }

          const span = arc.end - arc.start
          const segments = arc.full
            ? PULSE_RING_SEGMENTS
            : Math.max(2, Math.round((PULSE_RING_SEGMENTS * span) / (Math.PI * 2)))
          const projected: { x: number; y: number }[] = []
          for (let i = 0; i <= segments; i++) {
            const angle = arc.start + (i / segments) * span
            const pt = ringPoint(center, t1, t2, cosR, sinR, angle)
            projected.push(project([pt[0] * r, pt[1] * r, pt[2] * r], currentPhi, currentTheta))
          }
          el.setAttribute("d", buildRingPath(projected))
          el.style.opacity = String(opacity)
        }
      }

      let lastMarkers: Marker[] | null = null
      let lastArcs: Arc[] | null = null
      // While `obscured` (BeadScene's opaque backdrop is covering the
      // entire viewport, so this canvas's pixels aren't seen directly by
      // the user), still advance rotation state and call globe.update()
      // every frame — cobe's WebGL context is created with
      // preserveDrawingBuffer: false, so the drawing buffer is cleared
      // after every composite; skipping update() on some frames (a
      // previous version of this code did, throttled to every other
      // frame) left BeadScene's Backdrop reading a blank canvas on any
      // frame its own independent throttle didn't line up with this one,
      // which could go permanently out of phase and show no globe image
      // at all. What IS skipped while obscured: the label/ripple DOM
      // writes (inline style + SVG path rebuilds), since those are
      // genuinely never read by anything while obscured.
      function animate() {
        if (!isPausedRef.current) {
          phi += liveProps.current.speed
          if (
            Math.abs(velocity.current.phi) > 0.0001 ||
            Math.abs(velocity.current.theta) > 0.0001
          ) {
            phiOffsetRef.current += velocity.current.phi
            thetaOffsetRef.current += velocity.current.theta
            velocity.current.phi *= 0.95
            velocity.current.theta *= 0.95
          }
          const thetaMin = -0.4,
            thetaMax = 0.4
          if (thetaOffsetRef.current < thetaMin) {
            thetaOffsetRef.current += (thetaMin - thetaOffsetRef.current) * 0.1
          } else if (thetaOffsetRef.current > thetaMax) {
            thetaOffsetRef.current += (thetaMax - thetaOffsetRef.current) * 0.1
          }
        }
        const p = liveProps.current
        const currentPhi = phi + phiOffsetRef.current + dragOffset.current.phi
        const currentTheta = theta + thetaOffsetRef.current + dragOffset.current.theta

        // cobe re-uploads the marker/arc GPU buffers whenever these keys are
        // present in the update payload, even if the data is identical —
        // only include them when the reference actually changed (our marker/
        // arc lists are static after mount, so normally this is just once).
        const updatePayload: Partial<COBEOptions> = {
          phi: currentPhi,
          theta: currentTheta,
          dark: p.dark,
          mapBrightness: p.mapBrightness,
          markerColor: p.markerColor,
          baseColor: p.baseColor,
          glowColor: p.glowColor,
          arcColor: p.arcColor,
          markerElevation: p.markerElevation,
        }
        if (p.markers !== lastMarkers) {
          updatePayload.markers = p.markers.map((m) => ({
            location: m.location,
            size: m.size ?? p.markerSize,
            id: m.id,
          }))
          lastMarkers = p.markers
        }
        if (p.arcs !== lastArcs) {
          updatePayload.arcs = p.arcs.map((a) => ({
            from: a.from,
            to: a.to,
            id: a.id,
          }))
          lastArcs = p.arcs
        }
        globe!.update(updatePayload)
        if (!p.obscured) {
          updateLabels(currentPhi, currentTheta, p.markerElevation, p.arcHeight)
          updateRipples(currentPhi, currentTheta, p.markerElevation)
        }
        currentPhiRef.current = currentPhi
        currentThetaRef.current = currentTheta
        animationId = requestAnimationFrame(animate)
      }
      animate()
      setTimeout(() => canvas && (canvas.style.opacity = "1"))
    }

    if (canvas.offsetWidth > 0) init()

    // Kept alive for the whole effect lifetime (not disconnected after the
    // first fire) so boxSizeRef stays live for as long as this globe is
    // mounted -- see the comment on updateLabels above for why a one-time
    // measurement was a real bug. `init()` itself still only runs once,
    // guarded by `globe` being unset.
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (!width || width <= 0) return
      boxSizeRef.current = width
      if (!globe) init()
    })
    ro.observe(canvas)

    return () => {
      ro.disconnect()
      if (animationId) cancelAnimationFrame(animationId)
      if (globe) globe.destroy()
    }
    // Deliberately excludes markers/arcs/colors/speed/etc — those are read
    // live via liveProps each frame so changing them doesn't reset rotation.
    // Only structural init-time values (read once by createGlobe) go here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theta, diffuse, mapSamples])

  useImperativeHandle(
    ref,
    () => ({
      project(location) {
        return projectMarker(
          location,
          currentPhiRef.current,
          currentThetaRef.current,
          liveProps.current.markerElevation,
        )
      },
      getElement() {
        return canvasRef.current
      },
      getCircle() {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return null
        // The canvas box is aspect-square, so width and height agree; min()
        // is just insurance against a transient non-square layout pass.
        return {
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          radius: Math.min(rect.width, rect.height) * GLOBE_SURFACE_RADIUS_FRACTION,
        }
      },
    }),
    [],
  )

  // Language toggle flips every visible label at once by default. Sweep it
  // instead: on each activeLabelIndex change (skipping the very first
  // render — that's just each label settling to its correct initial
  // language, not a toggle), snapshot every currently-labeled marker/arc's
  // live screen position and stagger their TextRotate.jumpTo() calls
  // top-left to bottom-right. New labels that mount later default to no
  // delay (handled by LabelPill's `?? 0` below) since they're not part of
  // an in-flight toggle.
  const [labelDelays, setLabelDelays] = useState<Map<string, number>>(new Map())
  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    const phi = currentPhiRef.current
    const theta = currentThetaRef.current
    const elevation = liveProps.current.markerElevation
    const arcHeight = liveProps.current.arcHeight
    const items = [
      ...liveProps.current.markers
        .filter((m) => m.label && m.label.length > 0)
        .map((m) => ({ id: m.id, ...projectMarker(m.location, phi, theta, elevation) })),
      ...liveProps.current.arcs
        .filter((a) => a.label && a.label.length > 0)
        .map((a) => {
          const p = projectArcMidpoint(a.from, a.to, phi, theta, elevation, arcHeight)
          return { id: a.id, x: p?.x ?? 0, y: p?.y ?? 0 }
        }),
    ]
    setLabelDelays(computeSweepDelays(items))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLabelIndex])

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: "100%",
          height: "100%",
          cursor: "grab",
          opacity: 0,
          transition: "opacity 1.2s ease",
          borderRadius: "50%",
          touchAction: "none",
        }}
      />
      {markers
        .filter((m) => m.label && m.label.length > 0)
        .map((m) => (
          <LabelPill
            key={m.id}
            texts={m.label!}
            activeIndex={activeLabelIndex}
            sweepDelayMs={labelDelays.get(m.id) ?? 0}
            setRef={getRefSetter(labelRefSetters, labelRefs, m.id)}
          />
        ))}
      {arcs
        .filter((a) => a.label && a.label.length > 0)
        .map((a) => (
          <LabelPill
            key={a.id}
            texts={a.label!}
            activeIndex={activeLabelIndex}
            sweepDelayMs={labelDelays.get(a.id) ?? 0}
            setRef={getRefSetter(arcLabelRefSetters, arcLabelRefs, a.id)}
            inverted
          />
        ))}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      >
        {pulses.map((pulse) => (
          <path
            key={pulse.id}
            ref={getRefSetter(pulseRefSetters, pulseRefs, pulse.id)}
            fill="none"
            stroke={pulse.kind === "birth" ? "var(--accent)" : "#000000"}
            strokeWidth={0.5}
            opacity={0}
          />
        ))}
      </svg>
    </div>
  )
})
Globe.displayName = "Globe"

// Memoized — Globe re-renders on every animation frame while any marker or
// arc is mid-draw-in (necessary: that's how the moving endpoint reaches the
// canvas), but that shouldn't force every OTHER already-settled label to
// re-render too. Requires `texts`/`setRef` to be stable references, which
// they now are (see CITY_LABELS/ARC_ROUTES.label in GlobeView.tsx and
// getRefSetter above) — without that, memo would never actually hit.
const LabelPill = memo(function LabelPill({
  texts,
  activeIndex,
  sweepDelayMs = 0,
  setRef,
  inverted = false,
}: {
  texts: string[]
  activeIndex: number
  sweepDelayMs?: number
  setRef: (el: HTMLDivElement | null) => void
  inverted?: boolean
}) {
  const rotateRef = useRef<TextRotateRef>(null)

  useEffect(() => {
    const t = setTimeout(() => rotateRef.current?.jumpTo(activeIndex), sweepDelayMs)
    return () => clearTimeout(t)
  }, [activeIndex, sweepDelayMs])

  return (
    <div
      ref={setRef}
      style={{
        position: "absolute",
        // Explicit left/top: 0 is load-bearing, not decorative. `transform`
        // moves an element FROM its resolved layout position -- and with
        // `top`/`left` left unset (auto), an absolutely positioned element
        // resolves to its CSS "static position" (roughly: where it would
        // have landed in normal flow), not the container's origin. Found
        // live, the hard way: this container's only other child is the
        // canvas, occupying the full box, so every label's static position
        // fell BELOW it -- one full container-height off -- and the
        // per-frame `translate3d(...)` (see updateLabels in Globe, above)
        // was then offsetting FROM that wrong point instead of from
        // (0, 0). Pinning left/top to 0 makes the container's own origin
        // the transform's reference point, matching what the old
        // percentage-based `left`/`top` approach did implicitly (a
        // percentage always resolves against the containing block's
        // origin, regardless of static-position quirks).
        left: 0,
        top: 0,
        // No static transform here -- the per-frame animation loop
        // (updateLabels in Globe, above) now writes the full
        // translate3d(...) translate(-50%, calc(-100% - 10px)) transform
        // itself every frame, since an element can only have one
        // `transform` and the position component has to live in the same
        // string. Fine to start with none: opacity is 0 until the first
        // real frame positions this correctly.
        pointerEvents: "none",
        opacity: 0,
        transition: "opacity 1.4s ease",
      }}
    >
      <TextRotate
        ref={rotateRef}
        texts={texts}
        auto={false}
        loop={false}
        splitBy="characters"
        staggerDuration={0.015}
        animatePresenceMode="popLayout"
        transition={{ type: "spring", damping: 30, stiffness: 400 }}
        mainClassName={
          inverted
            ? "rounded-[3px] border border-foreground/10 bg-background px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wider text-foreground uppercase whitespace-nowrap shadow-sm"
            : "rounded-[3px] bg-foreground px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wider text-background uppercase whitespace-nowrap shadow-sm"
        }
      />
      <span
        className={inverted ? "border border-foreground/10 bg-background" : "bg-foreground"}
        style={{
          position: "absolute",
          bottom: -3,
          left: "50%",
          width: 6,
          height: 6,
          transform: "translateX(-50%) rotate(45deg)",
        }}
      />
    </div>
  )
})
LabelPill.displayName = "LabelPill"
