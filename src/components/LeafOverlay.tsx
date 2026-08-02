import type { CSSProperties } from 'react'

/** One in-flight departure leaf. `seed` deterministically derives this
 * leaf's drift distance/sway/rotation/duration so the same leaf never
 * re-rolls its motion across re-renders, but different leaves vary. */
export interface Leaf {
  id: number
  x: number
  y: number
  color: string
  seed: number
}

interface LeafOverlayProps {
  leaves: Leaf[]
  onLeafDone: (id: number) => void
}

const LEAF_SIZE_PX = 22

/** Fixed, full-viewport, pointer-events-none — sits above BeadScene's own
 * `fixed inset-0 z-0` canvas (see App.tsx for the stacking order) so leaves
 * are never blocked by clicks and never block clicks themselves. */
export function LeafOverlay({ leaves, onLeafDone }: LeafOverlayProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
      {leaves.map((leaf) => (
        <LeafSprite key={leaf.id} leaf={leaf} onDone={() => onLeafDone(leaf.id)} />
      ))}
    </div>
  )
}

function LeafSprite({ leaf, onDone }: { leaf: Leaf; onDone: () => void }) {
  // Spread seed into a few independent-looking ranges via different
  // multipliers/moduli, so leaves don't all drift the same distance at the
  // same angle for the same duration even when seeds are close together.
  const dx = 40 + (leaf.seed % 100) // 40-139px horizontal drift
  const sway = 20 + ((leaf.seed * 7) % 40) // 20-59px sway amplitude
  const rot = 180 + ((leaf.seed * 13) % 360) // 180-539deg total rotation
  const dur = 1.6 + ((leaf.seed % 10) / 10) * 0.6 // 1.6-2.2s
  const dir = leaf.seed % 2 === 0 ? 1 : -1

  const style = {
    left: leaf.x,
    top: leaf.y,
    animation: `leaf-drift ${dur}s ease-out forwards`,
    '--leaf-dx': `${(dx * dir).toFixed(1)}px`,
    '--leaf-sway': `${(sway * dir).toFixed(1)}px`,
    '--leaf-rot': `${(rot * dir).toFixed(1)}deg`,
  } as CSSProperties & Record<'--leaf-dx' | '--leaf-sway' | '--leaf-rot', string>

  return (
    <svg
      className="absolute"
      style={style}
      width={LEAF_SIZE_PX}
      height={LEAF_SIZE_PX}
      viewBox="0 0 24 24"
      onAnimationEnd={onDone}
    >
      <path d="M12 2C7 6 3 10 3 15a9 9 0 0 0 9 7 9 9 0 0 0 9-7C21 10 17 6 12 2Z" fill={leaf.color} />
      <path d="M12 4v16" stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" fill="none" />
    </svg>
  )
}
