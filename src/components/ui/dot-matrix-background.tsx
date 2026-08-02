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
        node.style.setProperty('--mx', `${latestRef.current.x}px`)
        node.style.setProperty('--my', `${latestRef.current.y}px`)
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-0"
      style={
        {
          '--mx': '-9999px',
          '--my': '-9999px',
          backgroundImage: 'radial-gradient(circle at center, var(--border) 0 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.35,
          maskImage: [
            'radial-gradient(circle 140px at var(--mx) var(--my), #000 0%, #000 40%, transparent 100%)',
            'radial-gradient(circle 320px at var(--mx) var(--my), rgba(0,0,0,0.5) 0%, transparent 100%)',
          ].join(','),
          WebkitMaskImage: [
            'radial-gradient(circle 140px at var(--mx) var(--my), #000 0%, #000 40%, transparent 100%)',
            'radial-gradient(circle 320px at var(--mx) var(--my), rgba(0,0,0,0.5) 0%, transparent 100%)',
          ].join(','),
          maskComposite: 'add',
          WebkitMaskComposite: 'source-over',
        } as React.CSSProperties
      }
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 420px 260px at calc(var(--mx) - 70px) calc(var(--my) - 50px), var(--foreground), transparent 70%)',
          opacity: 0.04,
        }}
      />
    </div>
  )
}
