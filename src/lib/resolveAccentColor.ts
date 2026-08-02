// THREE.Color and CSS.supports-style parsing cannot handle every value a
// browser might return for a custom property, and reading `--accent`
// (a literal hex in src/index.css) back through getComputedStyle is
// already safe — but painting it onto a 1x1 canvas and reading the
// rasterised pixel back is the one technique that is guaranteed correct
// regardless of how the browser chooses to serialise the color, and it's
// the same technique BeadScene.tsx's normalizeCssColor already relies on
// (see that file's comment for the full rationale). Duplicated here
// (not imported from BeadScene.tsx) so this file has no dependency on a
// component that may be under concurrent, unrelated edits.
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

/** Resolves the current --accent custom property to a #rrggbb hex string,
 * reflecting whichever theme class is on <html> right now. */
export function resolveAccentColor(): string {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return normalizeCssColor(accent, '#912f40')
}
