import { useEffect, useRef } from 'react'
import type { GlobeCircle } from '@/components/ui/cobe-globe'
import { resolveAccentColor } from '@/lib/resolveAccentColor'

// Drops respawn this far above/below the viewport rather than exactly at
// its edge, so a drop doesn't visibly pop into existence right at the top
// edge of the screen — it's already off-screen when it (re)starts falling.
const RESPAWN_MARGIN_PX = 60

// Three depth tiers instead of independently randomized speed/width/length
// per drop: correlating them (near = faster/wider/longer/brighter) is what
// actually reads as depth/parallax rather than a flat wall of identical
// lines, and fixing width/length PER TIER (not randomized within it) is
// what makes the batched rendering in GlobeRain's tick() possible — a
// fixed handful of canvas paths, not one beginPath/stroke pair per drop.
//
// Widths are thinner and lengths longer than the pre-overhaul teardrop
// values: the target look is a motion-blurred streak (a long exposure of a
// small fast object), not a droplet with a visible body.
interface DepthTier {
  speedRangePxS: [number, number]
  widthPx: number
  lengthPx: number
  /** Peak alpha at the middle of this tier's streaks, before the per-drop
   * brightness variant, the bottom-edge fade, and lighting are folded in.
   * See dropAlpha. */
  baseAlpha: number
}

const DEPTH_TIERS: readonly DepthTier[] = [
  { speedRangePxS: [340, 420], widthPx: 2, lengthPx: 64, baseAlpha: 0.85 },
  { speedRangePxS: [280, 350], widthPx: 1.5, lengthPx: 48, baseAlpha: 0.6 },
  { speedRangePxS: [220, 280], widthPx: 1, lengthPx: 34, baseAlpha: 0.4 },
]

// Per-drop variation is BRIGHTNESS ONLY — no hue shift, no shape change.
// That is the one axis the reference rain varies on, and it is also the
// only axis that stays free here: brightness already has to be quantized
// per frame for the bottom-edge fade and the lighting, so a per-drop
// multiplier folds into that same quantized level (see dropAlpha) instead
// of adding a batching dimension of its own. Replaces the old
// COLOR_VARIANT_OFFSETS, which varied shade (a real hue/lightness mix) and
// therefore needed its own colour table and its own bucket axis.
const BRIGHTNESS_VARIANTS: readonly number[] = [0.7, 1, 1.3]

// Fraction of spawns pulled toward the globe's own horizontal band rather
// than scattered uniformly across the full viewport width. Lowered from
// 0.82: that value was tuned when drops were thin abstract lines and the
// worry was losing the "rain on the globe" read entirely in ambient
// side-fall. With today's much more prominent streaks — plus the entry
// ripple and the silhouette-hugging wrap trail, both of which are
// per-CROSSING cues that stay legible at a far lower crossing rate — an
// 82% bias no longer reads as a lean toward the globe, it reads as a
// column of rain down the middle of the screen. At 0.35 with the widened
// band below, in-band density is ~1.8x out-of-band rather than ~10x.
const GLOBE_BAND_SPAWN_FRACTION = 0.35
// How far past the globe's own radius that band extends. Widened from 1.15
// for the same reason the fraction dropped: the point is now a soft,
// broad lean toward the globe, so the remaining biased spawns should be
// spread over a wide band rather than concentrated into a narrow one.
const GLOBE_BAND_RADIUS_MULTIPLIER = 1.6
// Of the spawns pulled into the globe band, the fraction that use the
// angle-weighted pick below rather than a flat pick across the band width.
// A flat pick in X under-represents the globe's edges: dx = radius*sin(a),
// so a fixed slice of X near the center covers a much smaller entry-angle
// range than the same width near the edge does (d(angle)/dx = 1/sqrt(r²-dx²)
// is smallest at dx=0 and grows without bound as dx→r) — that's what made
// rain visibly concentrate through dead center. Splitting the biased spawns
// between the two keeps some flat coverage (including the near-miss margin
// past the silhouette) while still meaningfully lifting the edges.
const GLOBE_BAND_ANGLE_WEIGHTED_FRACTION = 0.5

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export interface GlobeCircleLike {
  centerX: number
  centerY: number
  radius: number
}

export interface Drop {
  x: number
  y: number
  speed: number
  width: number
  length: number
  /** Index into DEPTH_TIERS — fixes this drop's width/length/color for its
   * whole lifetime (a respawn via spawnDropAbove picks a fresh one). */
  depth: number
  /** Index into BRIGHTNESS_VARIANTS — fixes this drop's own brightness
   * multiplier for its whole lifetime, same respawn-refreshes-it rule as
   * depth. */
  brightnessVariant: number
  phase: 'fall' | 'wrap' | 'release'
  /** Angle in [0, π] around the globe's center, 0 = top (north pole of the
   * visible silhouette), π = bottom. Only meaningful while phase === 'wrap'. */
  wrapAngle: number
  /** The wrapAngle at which this drop peels back off the silhouette into a
   * straight fall — derived per drop from a uniformly sampled exit position
   * (see enterWrap) so drops release at varied,
   * evenly spread points along the bottom curve instead of all converging on
   * the exact same pixel. Only meaningful while phase === 'wrap'. */
  wrapExitAngle: number
  /** Which side of the globe's vertical centerline this drop entered on.
   * Only meaningful while phase === 'wrap'. */
  wrapSide: -1 | 1
}

function randomDrop(x: number, y: number): Drop {
  const depth = Math.floor(Math.random() * DEPTH_TIERS.length)
  const tier = DEPTH_TIERS[depth]
  const brightnessVariant = Math.floor(Math.random() * BRIGHTNESS_VARIANTS.length)
  return {
    x,
    y,
    speed: randomBetween(tier.speedRangePxS[0], tier.speedRangePxS[1]),
    width: tier.widthPx,
    length: tier.lengthPx,
    depth,
    brightnessVariant,
    phase: 'fall',
    wrapAngle: 0,
    wrapExitAngle: Math.PI,
    wrapSide: 1,
  }
}

/** Picks a spawn x biased toward the globe's own horizontal band (see
 * GLOBE_BAND_SPAWN_FRACTION) so a majority of drops visibly cross its
 * silhouette rather than scattering evenly across the full viewport. Falls
 * back to a full-width uniform pick once no globe has been measured yet. */
function randomSpawnX(viewportWidth: number, globe: GlobeCircleLike | null): number {
  if (!globe || Math.random() >= GLOBE_BAND_SPAWN_FRACTION) return Math.random() * viewportWidth

  if (Math.random() < GLOBE_BAND_ANGLE_WEIGHTED_FRACTION) {
    // Sample the entry ANGLE uniformly (0 = dead center top, π/2 = the
    // silhouette's outer edge) rather than x directly, then convert back —
    // see GLOBE_BAND_ANGLE_WEIGHTED_FRACTION for why this is what actually
    // lifts the edges instead of just widening the flat spread.
    const angle = Math.random() * (Math.PI / 2)
    const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1
    const x = globe.centerX + globe.radius * Math.sin(angle) * side
    return Math.min(viewportWidth, Math.max(0, x))
  }

  const bandHalfWidth = globe.radius * GLOBE_BAND_RADIUS_MULTIPLIER
  const min = Math.max(0, globe.centerX - bandHalfWidth)
  const max = Math.min(viewportWidth, globe.centerX + bandHalfWidth)
  return randomBetween(min, max)
}

/** A fresh drop above the viewport, ready to fall in. Used both for the
 * initial pool (see seedDrop) and to recycle a drop that has fallen past
 * the bottom of the viewport. */
export function spawnDropAbove(viewportWidth: number, globe: GlobeCircleLike | null = null): Drop {
  const x = randomSpawnX(viewportWidth, globe)
  const y = -RESPAWN_MARGIN_PX - Math.random() * RESPAWN_MARGIN_PX
  return randomDrop(x, y)
}

// Snaps a drop that has just crossed into the globe's circle into the
// 'wrap' phase, deriving wrapAngle/wrapSide from the (x, y) it crossed at.
// The release angle is derived from a uniformly sampled X FRACTION over the
// full [0, 1] range (i.e. every point across the globe's radius is equally
// likely), not a uniformly sampled angle — solving x/radius = sin(angle) on
// the angle ∈ [π/2, π] branch gives angle = π - asin(x/radius), which lands
// in [π/2, π] for any fraction in [0, 1]. Clamped to be at least the entry
// angle so the drop always makes forward progress even if it entered
// unusually late. Confirmed exactly uniform (flat to within ~5% across 20
// equal-width buckets) by a 20000-sample simulation of this formula.
// y = centerY - radius*cos(angle)  =>  cos(angle) = (centerY - y) / radius
function enterWrap(drop: Drop, x: number, y: number, globe: GlobeCircleLike): void {
  const side: -1 | 1 = x >= globe.centerX ? 1 : -1
  const cosAngle = Math.min(1, Math.max(-1, (globe.centerY - y) / globe.radius))
  const entryAngle = Math.acos(cosAngle)
  const exitXFraction = Math.random()
  const candidateExitAngle = Math.PI - Math.asin(exitXFraction)
  drop.phase = 'wrap'
  drop.wrapAngle = entryAngle
  drop.wrapExitAngle = Math.max(entryAngle, candidateExitAngle)
  drop.wrapSide = side
}

function isInsideGlobe(x: number, y: number, globe: GlobeCircleLike): boolean {
  const dx = x - globe.centerX
  const dy = y - globe.centerY
  return dx * dx + dy * dy < globe.radius * globe.radius
}

/** Places a drop at a random position across the FULL viewport height
 * (not just above it), used only to seed the initial pool so the effect
 * looks already in progress on mount instead of starting from zero. Its y
 * is picked FIRST so randomSpawnX can size that drop's own wind overhang
 * from its remaining fall distance — a drop seeded near the bottom has
 * barely any drift left, so giving it the full-height overhang would leave
 * a visibly empty wedge along the left edge on mount. If the chosen
 * position happens to already be inside the globe's silhouette, the drop
 * starts directly in the 'wrap' phase. */
export function seedDrop(viewportWidth: number, viewportHeight: number, globe: GlobeCircleLike | null): Drop {
  const x = randomSpawnX(viewportWidth, globe)
  const y = randomBetween(-RESPAWN_MARGIN_PX, viewportHeight + RESPAWN_MARGIN_PX)
  const drop = randomDrop(x, y)
  if (globe && isInsideGlobe(x, y, globe)) enterWrap(drop, x, y, globe)
  return drop
}

/** Advances a drop by dt seconds, mutating it in place. Recycles it back
 * above the viewport (spawnDropAbove) once it has fallen past the bottom. */
export function updateDrop(
  drop: Drop,
  dt: number,
  globe: GlobeCircleLike | null,
  viewportWidth: number,
  viewportHeight: number,
): void {
  switch (drop.phase) {
    case 'fall': {
      const nextY = drop.y + drop.speed * dt
      if (globe && isInsideGlobe(drop.x, nextY, globe)) {
        enterWrap(drop, drop.x, nextY, globe)
      } else {
        drop.y = nextY
      }
      break
    }
    case 'wrap': {
      if (!globe) {
        // Globe measurement disappeared (e.g. resize mid-frame) — fall
        // straight from the current position rather than getting stuck.
        drop.phase = 'release'
        break
      }
      drop.wrapAngle += (drop.speed * dt) / globe.radius
      if (drop.wrapAngle >= drop.wrapExitAngle) {
        drop.wrapAngle = drop.wrapExitAngle
        const exitPosition = dropPosition(drop, globe)
        drop.x = exitPosition.x
        drop.y = exitPosition.y
        drop.phase = 'release'
      }
      break
    }
    case 'release': {
      drop.y += drop.speed * dt
      break
    }
  }

  const { y } = dropPosition(drop, globe)
  if (y - drop.length > viewportHeight + RESPAWN_MARGIN_PX) {
    Object.assign(drop, spawnDropAbove(viewportWidth, globe))
  }
}

/** Current on-screen position of a drop, deriving it from wrapAngle while
 * phase === 'wrap' rather than trusting stale x/y fields. `out`, if
 * given, is mutated and returned instead of allocating a fresh object --
 * the render loop below passes a shared scratch object, since this was
 * previously allocating up to several hundred short-lived {x,y} objects
 * per frame across ~130 drops (found in a 2026-08-06 performance audit;
 * same pattern as BeadScene.tsx's `_departureScratch`). Omitting `out`
 * keeps the original allocating behavior for any other caller. */
export function dropPosition(
  drop: Drop,
  globe: GlobeCircleLike | null,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  if (drop.phase === 'wrap' && globe) {
    out.x = globe.centerX + globe.radius * Math.sin(drop.wrapAngle) * drop.wrapSide
    out.y = globe.centerY - globe.radius * Math.cos(drop.wrapAngle)
    return out
  }
  out.x = drop.x
  out.y = drop.y
  return out
}

/** Current unit direction of travel, used to orient the drawn streak. Same
 * optional-`out` scratch pattern as dropPosition above. */
export function dropDirection(
  drop: Drop,
  globe: GlobeCircleLike | null,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  if (drop.phase === 'wrap' && globe) {
    // d/dangle of (centerX + r*sin(a)*side, centerY - r*cos(a)) is
    // (r*cos(a)*side, r*sin(a)) — the radius factor cancels out on
    // normalization, so it's omitted here.
    const dx = Math.cos(drop.wrapAngle) * drop.wrapSide
    const dy = Math.sin(drop.wrapAngle)
    const len = Math.hypot(dx, dy) || 1
    out.x = dx / len
    out.y = dy / len
    return out
  }
  out.x = 0
  out.y = 1
  return out
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface RainColors {
  /** One opaque colour for every streak in the field. Per-drop and
   * per-frame brightness is applied through ctx.globalAlpha per bucket
   * instead of through a table of pre-baked rgba strings — the reference
   * look varies only in brightness, so one colour plus one alpha number
   * covers it, and globalAlpha is what the batched buckets can set once
   * for many drops at a time. */
  streak: string
  /** Base color for the entry-ripple rings (see Ripple, below) — full
   * alpha here, ripple fade is applied separately via ctx.globalAlpha so
   * one color resolve covers every ripple regardless of its age. */
  ripple: string
}

function resolveRainColors(): RainColors {
  const accent = resolveAccentColor()
  // --accent alone read as washed out for rain, especially in dark mode
  // where it's a light pink-red (#c17b8a) rather than a deep red — mixing
  // toward a dark blood-red anchor gives a richer base in both themes
  // without introducing a hue outside the palette. Pulled back from the
  // pre-overhaul 0.4 mix and then lifted toward white: streaks are now
  // thin and soft-ended, and a very dark colour at those widths simply
  // disappears against the background.
  const deepBase = mixHex(accent, '#4a0e14', 0.25)
  return {
    streak: mixHex(deepBase, '#ffffff', 0.3),
    ripple: hexToRgba(mixHex(deepBase, '#ffffff', 0.65), 0.6),
  }
}

const DROP_COUNT = 130
// Capped like BeadScene's Canvas dpr (see BeadScene.tsx's <Canvas dpr={[1, 1.5]}>)
// for the same reason: crisp lines without paying for a full 2-3x device
// pixel ratio's worth of fragments on every frame.
const MAX_DEVICE_PIXEL_RATIO = 1.5

function resizeCanvasToViewport(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
  const width = window.innerWidth
  const height = window.innerHeight
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  // Every subsequent draw call can then be written in CSS pixels, matching
  // how the rest of this file's coordinate math (viewportWidth/Height,
  // globeCircle) is already expressed.
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

// A drop mid-wrap is moving along the globe's circular silhouette, but a
// straight tangent segment would visibly stick off the sphere instead of
// hugging the curve it's supposedly gliding along — the one moment the
// enterWrap/dropPosition curve math exists to sell. Sampling several points
// along the actual arc (via the same sin/cos parametrization dropPosition
// already uses for wrap phase) and connecting them with short line segments
// fixes this without needing canvas arc()'s angle-direction bookkeeping:
// since wrapAngle only ever increases going forward, "behind in time" is
// always simply "a smaller wrapAngle," for either wrapSide.
const WRAP_TRAIL_SEGMENTS = 5

function wrapPointAt(globe: GlobeCircleLike, angle: number, side: -1 | 1): { x: number; y: number } {
  return {
    x: globe.centerX + globe.radius * Math.sin(angle) * side,
    y: globe.centerY - globe.radius * Math.cos(angle),
  }
}

// The soft-fade-at-both-ends look, without per-drop gradients. A canvas
// linear gradient is anchored to absolute coordinates handed to
// createLinearGradient, so one gradient object cannot serve many
// differently-positioned streaks — matching the reference literally would
// mean 130 gradient objects and 130 stroke() calls REBUILT EVERY FRAME,
// which is exactly the per-drop draw cost this file's batching exists to
// avoid. Instead each bucket's streaks are stroked three times: wide and
// faint over the full length, then progressively narrower, stronger, and
// inset further from BOTH endpoints. Composited source-over, alpha along a
// streak lands at roughly 0.32 / 0.66 / 0.89 / 0.66 / 0.32 from tail to
// head — a soft plateau through the middle falling off gently at both
// ends, which is the shape the reference actually has. lineCap 'round'
// rounds off each pass's own ends so the steps don't read as steps.
interface TaperPass {
  /** Multiplier on the tier's own lineWidth. */
  widthScale: number
  /** Multiplier on the bucket's alpha for this pass. */
  alphaScale: number
  /** How far in from EACH end of the streak this pass starts/stops, as a
   * fraction of the streak's total length. */
  endInset: number
}

const TAPER_PASSES: readonly TaperPass[] = [
  { widthScale: 1, alphaScale: 0.32, endInset: 0 },
  { widthScale: 0.62, alphaScale: 0.5, endInset: 0.18 },
  { widthScale: 0.3, alphaScale: 0.68, endInset: 0.38 },
]

// Appends one straight streak's subpath (moveTo + lineTo) to the
// currently-open path without stroking it — callers batch many drops into
// one path per (tier, alpha level) bucket per taper pass and issue a single
// stroke() for all of them at once. `head` is the drop's leading point,
// `dir` its unit direction of travel.
function appendStreak(
  ctx: CanvasRenderingContext2D,
  head: { x: number; y: number },
  dir: { x: number; y: number },
  length: number,
  endInset: number,
): void {
  const inset = length * endInset
  const tailDistance = length - inset
  if (tailDistance <= inset) return
  ctx.moveTo(head.x - dir.x * tailDistance, head.y - dir.y * tailDistance)
  ctx.lineTo(head.x - dir.x * inset, head.y - dir.y * inset)
}

// The wrap-phase equivalent: a drop hugging the globe's silhouette is
// moving along a circular arc, so a straight tangent segment would visibly
// stick off the sphere — the one moment the enterWrap/dropPosition curve
// math exists to sell. Samples points along the actual arc (via the same
// sin/cos parametrization dropPosition already uses) and connects them with
// short line segments, which avoids canvas arc()'s angle-direction
// bookkeeping: since wrapAngle only ever increases going forward, "behind
// in time" is always simply "a smaller wrapAngle," for either wrapSide.
// endInset is applied in ANGLE space (the arc is parametrized by angle, and
// arc length is exactly radius * angle here) so the taper lines up with the
// straight-streak version.
function appendWrapStreak(
  ctx: CanvasRenderingContext2D,
  drop: Drop,
  globe: GlobeCircleLike,
  endInset: number,
): void {
  const fullSpan = drop.length / globe.radius
  const insetSpan = fullSpan * endInset
  const headAngle = drop.wrapAngle - insetSpan
  const tailAngle = Math.max(0, drop.wrapAngle - fullSpan + insetSpan)
  if (headAngle <= tailAngle) return
  for (let i = 0; i <= WRAP_TRAIL_SEGMENTS; i++) {
    const a = tailAngle + (headAngle - tailAngle) * (i / WRAP_TRAIL_SEGMENTS)
    const p = wrapPointAt(globe, a, drop.wrapSide)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
}

// "Lighting affects the raindrops," part one: a soft pool of light that
// follows the cursor and brightens the drops passing through it. Direct
// analogue of BeadScene's MouseLight (a cursor-tracked pointLight whose
// specular hot-spot slides across the beads) and deliberately co-located
// with DotMatrixBackground's cursor reveal, which is already lighting up
// the same patch of screen on this same page — the two now read as
// responding to one implied light source instead of ignoring each other.
//
// Quadratic falloff to zero at the radius: no discontinuity at the edge of
// the pool, and the brightening concentrates near the cursor rather than
// smearing a flat lift across a 380px disc.
const CURSOR_LIGHT_RADIUS_PX = 380
const CURSOR_LIGHT_GAIN = 0.9

function cursorLightMul(x: number, y: number, cursor: { x: number; y: number } | null): number {
  if (!cursor) return 1
  const distance = Math.hypot(x - cursor.x, y - cursor.y)
  if (distance >= CURSOR_LIGHT_RADIUS_PX) return 1
  const t = 1 - distance / CURSOR_LIGHT_RADIUS_PX
  return 1 + CURSOR_LIGHT_GAIN * t * t
}

// "Lighting affects the raindrops," part two: one fixed light direction for
// the whole scene, from the upper left. A streak's broadside catches that
// light most when the streak runs perpendicular to it, so brightness keys
// off |cross(direction, light)| — 1 when perpendicular, 0 when aligned.
//
// For straight-falling drops this is a constant (they all fall straight
// down), which is the point: it is a global tone, not per-drop noise. The visible
// payoff is the WRAP phase, where a drop's direction sweeps through every
// angle as it rides the globe's silhouette, so one side of the globe's rain
// halo stays consistently brighter than the other. That replaces what the
// pre-overhaul renderer was faking with a per-drop highlight dot pinned at
// an arbitrary -0.65π offset from the direction of travel — same intent
// (a droplet catching a glint), but now derived from an actual shared light
// direction instead of a magic constant. Kept shallow so it doesn't fight
// the deliberately narrow brightness-only variation of the overall look.
const SCENE_LIGHT_DIR = (() => {
  const x = -0.6
  const y = -0.8
  const len = Math.hypot(x, y)
  return { x: x / len, y: y / len }
})()
const SCENE_LIGHT_CONTRAST = 0.3

function sceneLightMul(dir: { x: number; y: number }): number {
  const facing = Math.abs(dir.x * SCENE_LIGHT_DIR.y - dir.y * SCENE_LIGHT_DIR.x)
  return 1 - SCENE_LIGHT_CONTRAST + SCENE_LIGHT_CONTRAST * facing
}

// The number of discrete brightness steps a drop can land in on any given
// frame. This is the SECOND (and last) batching dimension alongside depth
// tier: everything that varies a drop's brightness — its own lifetime
// variant and the lighting — is multiplied together and snapped to one of
// these levels, so all of it costs zero extra buckets and zero extra draw
// calls. 8 is coarse enough that the field never spreads across more
// buckets than there are meaningful shades.
const ALPHA_LEVELS = 8

/** Every brightness input for one drop on one frame, multiplied into a
 * single 0..1 value: the tier's base alpha, the drop's own lifetime
 * variant, the cursor light, and the fixed scene light. Quantized by the
 * caller — see ALPHA_LEVELS. Collapsing all of it into one number here is
 * what keeps the renderer's bucket key at (depth tier, alpha level):
 * lighting adds no batching dimension, no per-frame re-sort, and no
 * per-drop draw call. */
function dropAlpha(
  drop: Drop,
  pos: { x: number; y: number },
  dir: { x: number; y: number },
  cursor: { x: number; y: number } | null,
): number {
  const base = DEPTH_TIERS[drop.depth].baseAlpha * BRIGHTNESS_VARIANTS[drop.brightnessVariant]
  return Math.min(1, base * sceneLightMul(dir) * cursorLightMul(pos.x, pos.y, cursor))
}

/** Flat index into the preallocated bucket array. Level 0 means "invisible"
 * and is never drawn, but it still gets a slot so the arithmetic stays a
 * plain multiply-add. */
function bucketIndex(depth: number, level: number): number {
  return depth * (ALPHA_LEVELS + 1) + level
}

const BUCKET_COUNT = DEPTH_TIERS.length * (ALPHA_LEVELS + 1)

// A drop's on-screen entry point into the globe's silhouette, marked by a
// small expanding ring that fades out — a hairline, water-instrument-style
// punctuation for the one moment in a drop's life that previously happened
// silently (see enterWrap). Fixed-cap pool, oldest evicted on overflow —
// no unbounded growth, no per-frame allocation beyond the occasional push.
export interface Ripple {
  x: number
  y: number
  startMs: number
}

const RIPPLE_MAX_COUNT = 24
const RIPPLE_DURATION_MS = 350
const RIPPLE_MAX_RADIUS_PX = 14

function spawnRipple(pool: Ripple[], x: number, y: number, nowMs: number): void {
  if (pool.length >= RIPPLE_MAX_COUNT) pool.shift()
  pool.push({ x, y, startMs: nowMs })
}

// Iterates backward so expired ripples can be spliced out mid-loop without
// skipping the element that shifts into the current index.
function drawRipples(ctx: CanvasRenderingContext2D, pool: Ripple[], nowMs: number, color: string): void {
  if (pool.length === 0) return
  ctx.lineWidth = 1
  ctx.strokeStyle = color
  for (let i = pool.length - 1; i >= 0; i--) {
    const ripple = pool[i]
    const elapsed = nowMs - ripple.startMs
    if (elapsed >= RIPPLE_DURATION_MS) {
      pool.splice(i, 1)
      continue
    }
    const t = elapsed / RIPPLE_DURATION_MS
    ctx.globalAlpha = 1 - t
    ctx.beginPath()
    ctx.arc(ripple.x, ripple.y, RIPPLE_MAX_RADIUS_PX * t, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

export interface GlobeRainProps {
  globeCircle: GlobeCircle | null
  theme: 'light' | 'dark'
}

// Plain 2D canvas, not a second react-three-fiber <Canvas>: this effect is
// procedural curve math over ~130 drops, not physics, so a second WebGL
// context (and its own render overhead, mirroring what BeadScene already
// pays for the beads) would buy nothing. GlobeRain and BeadScene are
// mount-exclusive (see App.tsx), so they never compete for a GPU context
// anyway.
export function GlobeRain({ globeCircle, theme }: GlobeRainProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dropsRef = useRef<Drop[]>([])
  const ripplesRef = useRef<Ripple[]>([])
  const globeRef = useRef<GlobeCircleLike | null>(globeCircle)
  globeRef.current = globeCircle

  // Plain mutable ref, not React state: pointermove fires far faster than
  // React commits, and this only feeds the rAF loop below, which reads it
  // once per frame — a state update per pointer event would be discarded
  // work. Same reasoning (and same shape) as BeadScene's MouseLight. No
  // rAF batching wrapper here, unlike DotMatrixBackground: that component
  // needs one because its handler writes to the DOM, whereas this handler
  // only assigns a ref.
  const cursorRef = useRef<{ x: number; y: number } | null>(null)

  // Re-resolved on theme flip via a rAF, same reasoning as BeadScene's
  // resolveBeadColors effect: the `.dark` class toggle happens in a
  // sibling effect, and child effects run before parent effects, so
  // reading computed style synchronously here could observe the OLD
  // theme's value. One rAF is enough to guarantee the class is applied.
  const colorsRef = useRef<RainColors>(resolveRainColors())
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      colorsRef.current = resolveRainColors()
    })
    return () => cancelAnimationFrame(id)
  }, [theme])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      cursorRef.current = { x: event.clientX, y: event.clientY }
    }
    function handlePointerLeave() {
      cursorRef.current = null
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    document.addEventListener('pointerleave', handlePointerLeave)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    resizeCanvasToViewport(canvas)
    const initialViewportWidth = window.innerWidth
    const initialViewportHeight = window.innerHeight
    dropsRef.current = Array.from({ length: DROP_COUNT }, () =>
      seedDrop(initialViewportWidth, initialViewportHeight, globeRef.current),
    )

    function handleResize() {
      if (canvas) resizeCanvasToViewport(canvas)
    }
    window.addEventListener('resize', handleResize)

    // Preallocated once, reused every frame (length reset to 0 rather than
    // reallocated) — binning 130 drops per frame must not allocate.
    const buckets: Drop[][] = Array.from({ length: BUCKET_COUNT }, () => [])
    // Same reasoning, for dropPosition/dropDirection's optional `out`
    // param (see their definitions above) — up to 5 calls per drop per
    // frame across 130 drops previously each allocated a fresh {x,y}.
    // Two distinct scratch objects (not one shared) because line ~700
    // below needs a position AND a direction simultaneously live; a
    // single shared scratch would corrupt the position while computing
    // direction. Safe to reuse across sequential unrelated call sites
    // otherwise, since every read here extracts x/y (or hands the object
    // straight to a synchronous ctx.moveTo/lineTo call) immediately, never
    // holding a reference across iterations.
    const posScratch = { x: 0, y: 0 }
    const dirScratch = { x: 0, y: 0 }

    let rafId: number
    let lastTime = performance.now()
    function tick(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 1 / 30)
      lastTime = now
      const ctx = canvas?.getContext('2d')
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const globe = globeRef.current
        // Hoisted out of the per-drop loop below — window.innerWidth/
        // innerHeight are layout reads, and reading them once per DROP
        // (previously 130x/frame) rather than once per FRAME was pure
        // waste, not a correctness requirement (the viewport doesn't
        // change mid-frame).
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        const drops = dropsRef.current
        for (const drop of drops) {
          const wasFalling = drop.phase === 'fall'
          const wasAboveBottom = dropPosition(drop, globe, posScratch).y < viewportHeight
          updateDrop(drop, dt, globe, viewportWidth, viewportHeight)
          if (wasFalling && drop.phase === 'wrap' && globe) {
            const entryPoint = dropPosition(drop, globe, posScratch)
            spawnRipple(ripplesRef.current, entryPoint.x, entryPoint.y, now)
          }
          // The same collision cue as a globe entry, now also at the
          // bottom of the screen instead of a fade-out: fires once, the
          // instant a drop's head first reaches the visible bottom edge.
          // No fade means nothing else marks that moment, so this is the
          // only visual cue a drop is about to be recycled.
          const afterPosition = dropPosition(drop, globe, posScratch)
          if (wasAboveBottom && afterPosition.y >= viewportHeight) {
            spawnRipple(ripplesRef.current, afterPosition.x, viewportHeight, now)
          }
        }

        // Batched by (depth tier, quantized alpha level). Depth tier owns
        // GEOMETRY (line width, streak length); the alpha level owns
        // BRIGHTNESS and absorbs every per-drop and per-frame brightness
        // input at once, so a fading drop is no longer a special case that
        // has to be pulled out and drawn individually — it is just a drop
        // in a lower bucket. Draw-call ceiling is
        // DEPTH_TIERS.length * ALPHA_LEVELS * TAPER_PASSES.length = 72
        // strokes, and empty buckets are skipped entirely.
        const colors = colorsRef.current
        const cursor = cursorRef.current
        for (const bucket of buckets) bucket.length = 0
        for (const drop of drops) {
          const pos = dropPosition(drop, globe, posScratch)
          const dir = dropDirection(drop, globe, dirScratch)
          const level = Math.round(dropAlpha(drop, pos, dir, cursor) * ALPHA_LEVELS)
          if (level <= 0) continue
          buckets[bucketIndex(drop.depth, level)].push(drop)
        }

        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = colors.streak
        for (let tier = 0; tier < DEPTH_TIERS.length; tier++) {
          const tierSpec = DEPTH_TIERS[tier]
          for (let level = 1; level <= ALPHA_LEVELS; level++) {
            const bucket = buckets[bucketIndex(tier, level)]
            if (bucket.length === 0) continue
            const bucketAlpha = level / ALPHA_LEVELS
            for (const pass of TAPER_PASSES) {
              ctx.globalAlpha = bucketAlpha * pass.alphaScale
              ctx.lineWidth = tierSpec.widthPx * pass.widthScale
              ctx.beginPath()
              for (const drop of bucket) {
                if (drop.phase === 'wrap' && globe) {
                  appendWrapStreak(ctx, drop, globe, pass.endInset)
                } else {
                  const head = dropPosition(drop, globe, posScratch)
                  appendStreak(ctx, head, dropDirection(drop, globe, dirScratch), drop.length, pass.endInset)
                }
              }
              ctx.stroke()
            }
          }
        }
        ctx.globalAlpha = 1

        drawRipples(ctx, ripplesRef.current, now, colors.ripple)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
