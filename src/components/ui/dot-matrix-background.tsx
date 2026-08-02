import { useEffect, useRef } from 'react'

// Decorative texture layer: an invisible dot grid revealed only where the
// cursor "shines light" on it, plus an offset glass-sheen highlight. Pure
// CSS masking driven by two custom properties (--mx/--my) written straight
// to the DOM from a rAF-batched mousemove handler — no per-frame canvas
// redraw, no React state/re-render per pointer move. See
// docs/superpowers/specs/2026-08-03-dot-matrix-background-design.md.
export function DotMatrixBackground() {
  const layerRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef({ x: -9999, y: -9999 })
  const rafPendingRef = useRef(false)

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
        // (0, 0). Subtract the layer's own on-screen position to convert.
        const rect = node.getBoundingClientRect()
        node.style.setProperty('--mx', `${latestRef.current.x - rect.left}px`)
        node.style.setProperty('--my', `${latestRef.current.y - rect.top}px`)
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
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
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 340px at var(--mx) var(--my), var(--sheen), transparent 70%)',
          opacity: 0.06,
        }}
      />
    </div>
  )
}
