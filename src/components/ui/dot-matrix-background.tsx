import { useEffect, useRef } from 'react'

// Sheen's resting opacity between flicker bursts (src/index.css previously
// hardcoded this same 0.06 into a CSS keyframes rule before the flicker
// moved to JS for true per-burst randomness).
const SHEEN_BASE_OPACITY = 0.06

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// Decorative texture layer: an invisible dot grid revealed only where the
// cursor "shines light" on it, plus an offset glass-sheen highlight and a
// real glass-texture photo revealed inside it. Pure CSS masking driven by
// two custom properties (--mx/--my) written straight to the DOM from a
// rAF-batched mousemove handler — no per-frame canvas redraw, no React
// state/re-render per pointer move. See
// docs/superpowers/specs/2026-08-03-dot-matrix-background-design.md.
export function DotMatrixBackground() {
  const layerRef = useRef<HTMLDivElement>(null)
  const sheenRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef({ x: -9999, y: -9999 })
  const rafPendingRef = useRef(false)
  // Cached instead of read fresh every mousemove frame (found in a
  // 2026-08-06 performance audit): this layer is `absolute inset-0` on a
  // container that only ever changes size on an actual viewport resize,
  // so re-measuring it 60x/sec while the cursor moves bought nothing but
  // a forced synchronous layout on every one of those frames -- and since
  // the rAF callback below runs before the browser's style/layout step,
  // that reflow also had to first flush whatever cobe-globe's own rAF
  // (see cobe-globe.tsx) had already written to the label pills' styles
  // that same frame. Refreshed on mount and on resize only.
  const rectRef = useRef({ left: 0, top: 0 })

  useEffect(() => {
    function refreshRect() {
      const node = layerRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      rectRef.current = { left: rect.left, top: rect.top }
    }
    refreshRect()
    window.addEventListener('resize', refreshRect)
    return () => window.removeEventListener('resize', refreshRect)
  }, [])

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      latestRef.current = { x: event.clientX, y: event.clientY }
      if (rafPendingRef.current) return
      rafPendingRef.current = true
      requestAnimationFrame(() => {
        rafPendingRef.current = false
        const node = layerRef.current
        if (!node) return
        // Gradient `at X Y` is relative to this element's own box, not the
        // viewport — clientX/clientY are viewport-relative, so they only
        // lined up by coincidence when the layer's box sat exactly at
        // (0, 0). Subtract the layer's own on-screen position (cached, see
        // rectRef above) to convert.
        const { left, top } = rectRef.current
        node.style.setProperty('--mx', `${latestRef.current.x - left}px`)
        node.style.setProperty('--my', `${latestRef.current.y - top}px`)
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Real lamp flicker isn't a repeating pattern — long steady stretches
  // broken by an occasional quick stutter of a few rapid opacity snaps
  // (like a loose connection catching), each burst's timing and magnitude
  // randomized so it never reads as a loop.
  useEffect(() => {
    let cancelled = false
    const timeouts: number[] = []

    function runFlickerBurst() {
      const node = sheenRef.current
      if (!node) return
      // Real flicker is mostly a brief undervoltage dip, not a symmetric
      // wobble -- steps mostly dim, occasionally a slight flare, varied
      // burst length/depth so no two bursts feel the same size.
      const stepCount = 1 + Math.floor(Math.random() * 4)
      const depth = randomBetween(0.5, 1)
      let elapsed = 0
      for (let i = 0; i < stepCount; i++) {
        elapsed += randomBetween(12, 60)
        const isFlare = Math.random() < 0.2
        const opacity = isFlare
          ? SHEEN_BASE_OPACITY + randomBetween(0.005, 0.015)
          : SHEEN_BASE_OPACITY - depth * randomBetween(0.01, 0.025)
        timeouts.push(
          window.setTimeout(() => {
            if (cancelled) return
            sheenRef.current?.style.setProperty('opacity', String(opacity))
          }, elapsed),
        )
      }
      elapsed += randomBetween(15, 45)
      timeouts.push(
        window.setTimeout(() => {
          if (cancelled) return
          sheenRef.current?.style.setProperty('opacity', String(SHEEN_BASE_OPACITY))
        }, elapsed),
      )
    }

    function scheduleNextBurst() {
      // Rare and irregular, not a recurring effect -- a lamp that flickers
      // every second or two reads as broken, not atmospheric. Most gaps
      // are long, with an occasional shorter one to avoid feeling metronomic.
      const delay = Math.random() < 0.2 ? randomBetween(4000, 9000) : randomBetween(9000, 18000)
      timeouts.push(
        window.setTimeout(() => {
          if (cancelled) return
          runFlickerBurst()
          scheduleNextBurst()
        }, delay),
      )
    }

    scheduleNextBurst()

    return () => {
      cancelled = true
      timeouts.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-0"
      style={{ '--mx': '-9999px', '--my': '-9999px' } as React.CSSProperties}
    >
      {/* Dot grid, masked independently of the sheen below — CSS mask-image
          clips an element's entire rendered output including descendants,
          so the sheen must be a sibling here, not a child, or the reveal
          mask would clip it too and contradict its own unmasked falloff. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle at center, var(--foreground) 0 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.18,
          maskImage: [
            'radial-gradient(circle 200px at var(--mx) var(--my), #000 0%, #000 40%, transparent 100%)',
            'radial-gradient(circle 460px at var(--mx) var(--my), rgba(0,0,0,0.5) 0%, transparent 100%)',
          ].join(','),
          WebkitMaskImage: [
            'radial-gradient(circle 200px at var(--mx) var(--my), #000 0%, #000 40%, transparent 100%)',
            'radial-gradient(circle 460px at var(--mx) var(--my), rgba(0,0,0,0.5) 0%, transparent 100%)',
          ].join(','),
          maskComposite: 'add',
          WebkitMaskComposite: 'source-over',
        }}
      />
      <div
        ref={sheenRef}
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 340px at var(--mx) var(--my), var(--sheen), transparent 70%)',
          opacity: SHEEN_BASE_OPACITY,
        }}
      />
      {/* Real glass-texture photo, revealed in the same footprint as the
          sheen above (mask radius intentionally matches its 340px/70%
          falloff) so the two read as one lit patch of glass rather than
          two separate circles. Position/size are fixed, not tied to
          --mx/--my, so the pane itself stays stationary while the reveal
          window slides over it. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(/textures/glass.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'grayscale(1) contrast(1.5) brightness(1.1)',
          mixBlendMode: 'soft-light',
          opacity: 0.23,
          maskImage: 'radial-gradient(circle 340px at var(--mx) var(--my), #000 0%, transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(circle 340px at var(--mx) var(--my), #000 0%, transparent 70%)',
        }}
      />
    </div>
  )
}
