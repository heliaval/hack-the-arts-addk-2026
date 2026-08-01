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
  pulses?: { id: string; markerId: string; kind: "birth" | "death" }[]
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
}

export interface GlobeRef {
  /** Projects a lat/lng to current screen-space fraction (0-1), using the
   * globe's live rotation — for callers that need to know where something
   * is on screen right now (e.g. to order a sweep animation). */
  project(location: [number, number]): { x: number; y: number }
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
  const r = 0.8 + elevation
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
  const base = 0.8 + elevation
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
}: GlobeProps, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const arcLabelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // Stable per-id setRef callbacks (created once, cached, reused) rather
  // than a fresh inline arrow per render — LabelPill is memoized below, and
  // a fresh setRef reference every render would defeat that memo for every
  // label on every frame, even ones whose actual content hasn't changed.
  const labelRefSetters = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  const arcLabelRefSetters = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  const pulseRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const pulseRefSetters = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  function getRefSetter(
    cache: MutableRefObject<Map<string, (el: HTMLDivElement | null) => void>>,
    target: MutableRefObject<Map<string, HTMLDivElement>>,
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

      function updateLabels(currentPhi: number, currentTheta: number, markerElevation: number, arcHeight: number) {
        for (const m of liveProps.current.markers) {
          const el = labelRefs.current.get(m.id)
          if (!el) continue
          const { x, y, visible } = projectMarker(m.location, currentPhi, currentTheta, markerElevation)
          el.style.left = `${x * 100}%`
          el.style.top = `${y * 100}%`
          el.style.opacity = visible ? "1" : "0"
        }
        for (const a of liveProps.current.arcs) {
          const el = arcLabelRefs.current.get(a.id)
          if (!el) continue
          const projected = projectArcMidpoint(a.from, a.to, currentPhi, currentTheta, markerElevation, arcHeight)
          if (!projected) {
            el.style.opacity = "0"
            continue
          }
          el.style.left = `${projected.x * 100}%`
          el.style.top = `${projected.y * 100}%`
          el.style.opacity = projected.visible ? "1" : "0"
        }
      }

      function updatePulses(currentPhi: number, currentTheta: number, markerElevation: number) {
        for (const pulse of liveProps.current.pulses) {
          const el = pulseRefs.current.get(pulse.id)
          if (!el) continue
          const marker = liveProps.current.markers.find((m) => m.id === pulse.markerId)
          if (!marker) {
            el.style.opacity = "0"
            continue
          }
          const { x, y, visible } = projectMarker(marker.location, currentPhi, currentTheta, markerElevation)
          el.style.left = `${x * 100}%`
          el.style.top = `${y * 100}%`
          el.style.opacity = visible ? "1" : "0"
        }
      }

      let lastMarkers: Marker[] | null = null
      let lastArcs: Arc[] | null = null

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
        updateLabels(currentPhi, currentTheta, p.markerElevation, p.arcHeight)
        updatePulses(currentPhi, currentTheta, p.markerElevation)
        currentPhiRef.current = currentPhi
        currentThetaRef.current = currentTheta
        animationId = requestAnimationFrame(animate)
      }
      animate()
      setTimeout(() => canvas && (canvas.style.opacity = "1"))
    }

    if (canvas.offsetWidth > 0) {
      init()
    } else {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width > 0) {
          ro.disconnect()
          init()
        }
      })
      ro.observe(canvas)
    }

    return () => {
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
        const { x, y } = projectMarker(
          location,
          currentPhiRef.current,
          currentThetaRef.current,
          liveProps.current.markerElevation,
        )
        return { x, y }
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
      {pulses.map((pulse) => (
        <Pulse
          key={pulse.id}
          kind={pulse.kind}
          setRef={getRefSetter(pulseRefSetters, pulseRefs, pulse.id)}
        />
      ))}
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
        transform: "translate(-50%, calc(-100% - 10px))",
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

// One-shot expanding ring, spawned by usePopulationPulses (GlobeView.tsx)
// for a single birth/death threshold crossing. Position (left/top) and
// occlusion opacity are imperative, updated every animate() frame like
// labels -- but the ring's own scale/fade is a plain CSS keyframe
// (`pulse-ring` in index.css) on the inner span, so the two don't fight
// over the same `opacity` property.
const Pulse = memo(function Pulse({
  kind,
  setRef,
}: {
  kind: "birth" | "death"
  setRef: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={setRef}
      style={{
        position: "absolute",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        opacity: 0,
      }}
    >
      <span
        className="block size-8 rounded-full border-2 [animation:pulse-ring_1.1s_ease-out_forwards]"
        style={{ borderColor: kind === "birth" ? "var(--accent)" : "#000000" }}
      />
    </div>
  )
})
Pulse.displayName = "Pulse"
