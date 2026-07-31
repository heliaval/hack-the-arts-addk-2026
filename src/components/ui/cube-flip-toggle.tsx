import type { ReactNode } from 'react'

interface CubeFlipToggleProps {
  frontIcon?: ReactNode
  frontLabel: string
  backIcon?: ReactNode
  backLabel: string
  onClick: () => void
  ariaLabel: string
}

/**
 * A small header toggle that turns like a cube on hover: the front face
 * swings away and an adjacent face (joined at the shared top edge) rotates
 * into view. translateZ on each face must stay half the button height
 * (h-7 = 28px -> 14px) or the two faces stop meeting at an edge.
 *
 * Convention: front face previews the state a click switches TO; the back
 * face, revealed on hover, shows the currently active state.
 */
export function CubeFlipToggle({
  frontIcon,
  frontLabel,
  backIcon,
  backLabel,
  onClick,
  ariaLabel,
}: CubeFlipToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="group/flip relative h-7 w-[74px] shrink-0 cursor-pointer border-0 bg-transparent p-0"
      style={{ perspective: '600px' }}
    >
      <span
        className="absolute inset-0 [transform:rotateX(0deg)] group-hover/flip:[transform:rotateX(-90deg)] motion-reduce:transition-none"
        style={{
          transformStyle: 'preserve-3d',
          transitionProperty: 'transform',
          transitionDuration: '480ms',
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <span
          className="absolute inset-0 flex items-center justify-center gap-1 rounded-[3px] border border-border bg-card font-mono text-[0.6rem] tracking-wider text-muted-foreground uppercase group-hover/flip:border-accent group-hover/flip:text-accent [&_svg]:size-3"
          style={{ backfaceVisibility: 'hidden', transform: 'translateZ(14px)' }}
        >
          {frontIcon}
          {frontLabel}
        </span>
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center gap-1 rounded-[3px] border border-accent bg-card font-mono text-[0.6rem] tracking-wider text-accent uppercase [&_svg]:size-3"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateX(90deg) translateZ(14px)' }}
        >
          {backIcon}
          {backLabel}
        </span>
      </span>
    </button>
  )
}
