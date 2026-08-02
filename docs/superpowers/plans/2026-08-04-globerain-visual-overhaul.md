# GlobeRain Visual Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `src/components/GlobeRain.tsx` so it reads as classic motion-blurred rain — evenly distributed, uniformly wind-angled, soft-ended streaks whose only variation is brightness — instead of the current centre-heavy field of teardrops with head bulbs and specular dots; plus a much more gradual bottom-edge dissolve and a cursor-tracked light that visibly brightens nearby drops.

**Architecture:** All changes are confined to `src/components/GlobeRain.tsx`. The single structural move that makes all four asks affordable is replacing the current `(depth tier × color variant)` batching key with a `(depth tier × quantized alpha level)` key. Depth tier still fixes *geometry* (width, length, speed); a single per-frame quantized alpha level absorbs *every* brightness input — per-drop brightness variant, bottom-edge fade, cursor light, and fixed-light-direction shading — into one small discrete dimension. Fade and lighting therefore cost zero extra draw calls and zero extra buckets, and the "pull fading drops out and draw them individually" escape hatch (`drawSingleFadingDrop`) is deleted entirely. The teardrop/head-bulb/highlight-dot fill passes are replaced by three overlapping stroke passes per bucket at decreasing width and staggered end insets, which fakes a soft brightness taper at both ends of each streak without any per-drop gradient.

**Tech Stack:** React 19, TypeScript, plain 2D canvas (`CanvasRenderingContext2D`). No new dependencies. **No WebGL/shaders/three.js in this file** — that path was tried this session as `GlassRain` and explicitly reverted by the user; GlobeRain staying cheap-2D-canvas is a current, deliberate decision.

## Global Constraints

- Only `src/components/GlobeRain.tsx` and `PROGRESS.md` are modified. `App.tsx` is untouched — the call site `{!selected && <GlobeRain globeCircle={globeCircle} theme={theme} />}` (`src/App.tsx:466`) and `GlobeRainProps` both stay exactly as they are.
- `DROP_COUNT = 130`, viewport-scale canvas, and `MAX_DEVICE_PIXEL_RATIO = 1.5` are unchanged.
- Every drawn primitive stays batched: the render loop must never issue draw calls proportional to drop count. Per-frame draw calls are bounded by `DEPTH_TIERS.length × ALPHA_LEVELS × TAPER_PASSES.length = 3 × 8 × 3 = 72` strokes, and only non-empty buckets are stroked at all. For comparison: the file's current worst case is 27 batched calls **plus** 3 individual calls for every drop inside `FADE_ZONE_PX` (up to 390 if the field bunches near the bottom), and the pre-batching baseline this session already accepted as workable was 260. 72 is a hard ceiling below both.
- No per-drop `ctx.createLinearGradient`. A canvas gradient's coordinates are per-shape, so one gradient object cannot serve 130 differently-positioned lines in a single path — that is fundamentally unbatchable and is rejected here. The soft-fade-at-both-ends look is approximated instead by `TAPER_PASSES` (Task 3).
- Cursor lighting must not force per-frame re-sorting or any bucket key beyond `(depth tier, alpha level)`. It enters as one multiplier folded into the alpha level that already exists.
- No React state for anything animation- or pointer-driven — refs plus the existing `requestAnimationFrame` loop only, matching `dot-matrix-background.tsx` and `BeadScene.tsx`'s `MouseLight`.
- Hue stays accent-derived. The reference photo is white-on-black; this app has a single-accent identity and a prior explicit rejection of per-drop hue tinting (see PROGRESS.md, 2026-08-04 richness pass). Adopt the reference's *structure* — uniform shape, uniform angle, even distribution, brightness-only variation — not its literal colour.
- Backdate every commit in this plan: `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` both `2026-07-31T19:00:00` (standing instruction for this work session). Do not push.
- Update `PROGRESS.md` with a start entry and an end entry per this project's CLAUDE.md convention.
- Run `graphify update .` after the code changes, before committing.
- No automated tests (this layer is purely decorative and non-interactive, matching the `GlassRain` and `DotMatrixBackground` plans). Geometry/curve math that cannot be seen in this sandbox is verified with a throwaway Node script instead, same precedent as prior GlobeRain entries.
- Known sandbox limitation, do not treat as a bug: this environment's tab reports `document.hidden === true`, so `requestAnimationFrame` never advances and the canvas stays blank. Every prior GlobeRain entry hit this. Verify math numerically; flag the visual check as needing a live human.

---

### Task 1: Rebalance spawn distribution so the field is even edge-to-edge

The user: *"it's seems to be very dominant toward the middle which looks off."*

`GLOBE_BAND_SPAWN_FRACTION = 0.82` was chosen when drops were thin abstract 1–3px lines and the risk was that the "rain on the globe" read would vanish into ambient side-fall. Two things changed since: (a) drops became far more visually prominent (filled shapes, ripples, curved wrap trails), so the same 82% bias now reads as a literal column down the centre of the screen rather than a subtle lean; and (b) the globe-crossing read is now carried by *per-event* cues — the entry ripple and the wrap trail hugging the silhouette — which fire once per crossing and are perfectly legible at a much lower crossing rate. The original intent (don't lose the globe interaction) survives at a far weaker bias; the bias itself is what the user is objecting to.

Concretely, on a 1440px-wide viewport with a 300px globe radius: at the current settings the band spans `2 × 300 × 1.15 = 690px` (48% of width) and receives `0.82 + 0.18 × 0.48 = 0.906` of all spawns — **~10.4×** the out-of-band density. After this task the band spans `2 × 300 × 1.6 = 960px` (67% of width) and receives `0.35 + 0.65 × 0.67 = 0.786` — **~1.8×** the out-of-band density. A lean, not a column. The angle-weighted split stays at 0.5: it exists specifically to stop drops piling through dead centre, which is the same complaint, so it is kept as-is.

**Files:**
- Modify: `src/components/GlobeRain.tsx` (constants at lines ~47–67)

**Interfaces:** No signature changes. Constants only.

- [ ] **Step 1: Retune the two band constants and their comments**

Replace the `GLOBE_BAND_SPAWN_FRACTION` and `GLOBE_BAND_RADIUS_MULTIPLIER` declarations (and their comments) with:

```ts
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
```

- [ ] **Step 2: Sanity-check the resulting distribution numerically**

Write a throwaway Node script in the scratchpad (do not commit it) that reimplements `randomSpawnX`'s branching with the new constants, samples 200000 spawns at `viewportWidth = 1440`, `globe = { centerX: 720, centerY: 400, radius: 300 }`, bins them into 24 equal-width columns, and prints per-column counts.

Expected: the peak column's count is no more than ~2.5× the minimum column's count (today the same script on the old constants gives well over 8×). No column is empty.

---

### Task 2: One uniform wind angle for every drop

The reference photo's streaks all share one clear off-vertical angle. Today every falling drop moves at exactly `(0, 1)` — dead vertical — which is the single biggest structural difference from the reference after streak shape.

This is motion, not rendering, so it lands before the render rewrite: the render loop already orients streaks from `dropDirection()`, so once the direction changes the existing renderer follows it for free, and this task can be reviewed on its own.

Wind requires spawn compensation: a drop that drifts right as it falls must be able to start left of the viewport, or the left edge of the screen goes bare and the right edge over-fills. The horizontal drift over a fall of `h` pixels is exactly `h · tan(θ)`, so the uniform spawn range extends left by that amount, and the globe-band spawn centre shifts left by the drift a drop accumulates on its way down to `globe.centerY`.

**Files:**
- Modify: `src/components/GlobeRain.tsx` (add wind constants; rewrite `randomSpawnX`, `spawnDropAbove`, `seedDrop`, the `fall`/`release` branches of `updateDrop`, its recycle test, and `dropDirection`'s non-wrap return; update the initial-pool call in the component)

**Interfaces:**
- Changed: `spawnDropAbove(viewportWidth: number, viewportHeight: number, globe?: GlobeCircleLike | null): Drop` — gains a `viewportHeight` parameter in second position (needed to size the wind overhang). `seedDrop` keeps its existing `(viewportWidth, viewportHeight, globe)` signature.
- Changed (private): `randomSpawnX(viewportWidth: number, viewportHeight: number, spawnY: number, globe: GlobeCircleLike | null): number`.
- Verified: no file outside `GlobeRain.tsx` imports `spawnDropAbove`, `seedDrop`, `updateDrop`, `dropPosition`, `dropDirection`, or `dropFadeAlpha` — they are exported only for testability and are unused elsewhere. Confirm with `grep -rn "spawnDropAbove\|seedDrop" src/ --include=*.tsx --include=*.ts` before editing; it must return matches in `GlobeRain.tsx` only.

- [ ] **Step 1: Add the wind constants**

Insert immediately after `RESPAWN_MARGIN_PX`:

```ts
// One shared wind direction for every drop, instead of everything falling
// dead vertical. A single consistent off-vertical angle across the whole
// field is what makes rain read as weather rather than as a screensaver of
// falling lines — the drops agree with each other about which way the wind
// is blowing. ~16 degrees: enough to be unmistakably diagonal, shallow
// enough that drops still visibly fall rather than streak sideways.
const WIND_ANGLE_RAD = 0.28
// Unit direction of travel, +x right / +y down. Precomputed once — this is
// read for every drop on every frame.
const WIND_DIR = { x: Math.sin(WIND_ANGLE_RAD), y: Math.cos(WIND_ANGLE_RAD) } as const
const WIND_TAN = Math.tan(WIND_ANGLE_RAD)

/** Horizontal drift a drop accumulates while falling `distanceY` pixels. */
function windDriftOver(distanceY: number): number {
  return distanceY * WIND_TAN
}
```

- [ ] **Step 2: Rewrite `randomSpawnX` for wind-compensated spawning**

Replace the whole `randomSpawnX` function with:

```ts
/** Picks a spawn x for a drop starting at `spawnY`, biased toward the globe's
 * own horizontal band (see GLOBE_BAND_SPAWN_FRACTION). Both branches are
 * wind-compensated: because every drop drifts right as it falls (WIND_DIR),
 * the uniform range extends LEFT of the viewport by exactly the drift this
 * drop will accumulate on its way to the bottom, or the left edge of the
 * screen would go bare while the right edge over-filled. Falls back to a
 * plain wind-compensated uniform pick once no globe has been measured yet. */
function randomSpawnX(
  viewportWidth: number,
  viewportHeight: number,
  spawnY: number,
  globe: GlobeCircleLike | null,
): number {
  const overhang = windDriftOver(Math.max(0, viewportHeight - spawnY))

  if (!globe || Math.random() >= GLOBE_BAND_SPAWN_FRACTION) {
    return randomBetween(-overhang, viewportWidth)
  }

  // Biased spawns aim at where the globe WILL be relative to this drop by
  // the time it gets there, not at where it is directly below the spawn
  // point — without this shift the wind carries the whole biased population
  // past the globe's right edge and the bias buys nothing.
  const driftToGlobe = windDriftOver(Math.max(0, globe.centerY - spawnY))
  const aimCenterX = globe.centerX - driftToGlobe

  if (Math.random() < GLOBE_BAND_ANGLE_WEIGHTED_FRACTION) {
    // Sample the entry ANGLE uniformly (0 = dead center top, π/2 = the
    // silhouette's outer edge) rather than x directly, then convert back —
    // see GLOBE_BAND_ANGLE_WEIGHTED_FRACTION for why this is what actually
    // lifts the edges instead of just widening the flat spread.
    const angle = Math.random() * (Math.PI / 2)
    const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1
    const x = aimCenterX + globe.radius * Math.sin(angle) * side
    return Math.min(viewportWidth, Math.max(-overhang, x))
  }

  const bandHalfWidth = globe.radius * GLOBE_BAND_RADIUS_MULTIPLIER
  const min = Math.max(-overhang, aimCenterX - bandHalfWidth)
  const max = Math.min(viewportWidth, aimCenterX + bandHalfWidth)
  return randomBetween(min, max)
}
```

- [ ] **Step 3: Update `spawnDropAbove` and `seedDrop` to pick y before x**

`randomSpawnX` now needs the spawn y, so both callers pick y first. Replace both functions with:

```ts
/** A fresh drop above the viewport, ready to fall in. Used both for the
 * initial pool (see seedDrop) and to recycle a drop that has fallen past
 * the bottom of the viewport (or been blown off its right edge). */
export function spawnDropAbove(
  viewportWidth: number,
  viewportHeight: number,
  globe: GlobeCircleLike | null = null,
): Drop {
  const y = -RESPAWN_MARGIN_PX - Math.random() * RESPAWN_MARGIN_PX
  const x = randomSpawnX(viewportWidth, viewportHeight, y, globe)
  return randomDrop(x, y)
}
```

```ts
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
  const y = randomBetween(-RESPAWN_MARGIN_PX, viewportHeight + RESPAWN_MARGIN_PX)
  const x = randomSpawnX(viewportWidth, viewportHeight, y, globe)
  const drop = randomDrop(x, y)
  if (globe && isInsideGlobe(x, y, globe)) enterWrap(drop, x, y, globe)
  return drop
}
```

- [ ] **Step 4: Move drops along the wind vector in `updateDrop`**

Replace the `fall` case, the `release` case, and the recycle test at the end of `updateDrop`:

```ts
    case 'fall': {
      const nextX = drop.x + drop.speed * WIND_DIR.x * dt
      const nextY = drop.y + drop.speed * WIND_DIR.y * dt
      if (globe && isInsideGlobe(nextX, nextY, globe)) {
        enterWrap(drop, nextX, nextY, globe)
      } else {
        drop.x = nextX
        drop.y = nextY
      }
      break
    }
```

```ts
    case 'release': {
      drop.x += drop.speed * WIND_DIR.x * dt
      drop.y += drop.speed * WIND_DIR.y * dt
      break
    }
```

```ts
  const { x, y } = dropPosition(drop, globe)
  // Wind means a drop can now leave the frame sideways as well as
  // downward — without the x test those drops would keep being simulated
  // (and keep being pushed further right) forever off-screen instead of
  // being recycled.
  const fellPastBottom = y - drop.length > viewportHeight + RESPAWN_MARGIN_PX
  const blownPastRight = x - drop.length > viewportWidth + RESPAWN_MARGIN_PX
  if (fellPastBottom || blownPastRight) {
    Object.assign(drop, spawnDropAbove(viewportWidth, viewportHeight, globe))
  }
```

- [ ] **Step 5: Point `dropDirection` at the wind vector**

In `dropDirection`, replace the final `return { x: 0, y: 1 }` with:

```ts
  return { x: WIND_DIR.x, y: WIND_DIR.y }
```

- [ ] **Step 6: Update the initial-pool construction in the component**

Nothing changes at the `seedDrop` call site (its signature is unchanged); confirm the `dropsRef.current = Array.from(...)` block still typechecks after the `spawnDropAbove` signature change, which is only called from inside `updateDrop`.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run build` (this project's build command is `tsc -b && vite build`; a bare `npx tsc --noEmit` throws an unrelated pre-existing `baseUrl` deprecation error that does not reproduce under `tsc -b` — established precedent in this repo).
Expected: succeeds.

Run: `npx oxlint src/components/GlobeRain.tsx`
Expected: no new errors; the pre-existing `only-export-components` warnings on this file are expected and unchanged in kind.

---

### Task 3: Replace teardrops with soft-tapered motion-blur streaks

The user, on the reference photo: thin, uniform-width, motion-blurred lines whose brightness fades gently at **both** ends — a soft plateau through the middle, no head bulb, no highlight dot, and the only difference between streaks is brightness. Today's `appendTeardrop` (rounded head bulb + tangent lines to a sharp tail) plus the separate specular-dot fill is exactly the shape being pushed back on.

**The batching trade-off, resolved.** The literal way to get "brightness fades at both ends" is a `ctx.createLinearGradient` running along each drop's own line. That is not batchable in any form: a canvas gradient's stops are anchored to absolute coordinates passed at construction, so 130 differently-positioned streaks need 130 gradient objects and 130 `stroke()` calls, and the gradients must be rebuilt every frame because the drops move. Rejected.

The batchable approximation used instead: per bucket, stroke the *same set of streaks* three times, each pass narrower, fainter per-pass, and inset further from both endpoints. Composited source-over, the middle of a streak receives all three passes and the outer ~38% receives only the widest/faintest one, so measured alpha along the streak ramps `0.32 → 0.66 → 0.89 → 0.66 → 0.32` end-to-end. With `lineCap = 'round'` softening each pass's own ends, that reads as a smooth motion-blur taper. Cost is a fixed 3 strokes per non-empty bucket, independent of drop count.

**The bucket restructure.** `(depth tier × color variant)` becomes `(depth tier × quantized alpha level)`. Depth tier keeps owning geometry — width, length, speed. Everything that affects *brightness* (per-drop variant, bottom fade, and in Task 5 the lighting) collapses into one alpha number per drop per frame, quantized to `ALPHA_LEVELS = 8` steps and used as the second key. This is a direct fit to the reference ("the only variation between streaks is brightness"), it lets `ctx.globalAlpha` be set once per bucket instead of once per drop, and — critically — it means `drawSingleFadingDrop` can be deleted, because a fading drop is no longer a special case, it is just a drop in a lower alpha bucket.

Draw-call ceiling after this task: `3 tiers × 8 levels × 3 passes = 72` strokes, and empty buckets are skipped. With 130 drops spread over 24 buckets, expect ~15–22 non-empty → **45–66 strokes per frame**. Today's file is 27 batched calls **plus** 3 individual calls per drop inside the fade zone; this task's ceiling is below that file's realistic worst case and far below the 260-call baseline this session already validated as acceptable in this very file.

**Files:**
- Modify: `src/components/GlobeRain.tsx` (`DepthTier`/`DEPTH_TIERS`; replace `COLOR_VARIANT_OFFSETS`/`COLOR_VARIANT_JITTER`; `Drop.colorVariant` → `Drop.brightnessVariant`; `randomDrop`; `dropFadeAlpha` signature; `TierColors`/`RainColors`/`resolveRainColors`; delete `appendTeardrop` and `drawSingleFadingDrop`; replace `appendWrapTrail` with `appendWrapStreak`; add `appendStreak`, `TAPER_PASSES`, `ALPHA_LEVELS`, `dropAlpha`, `bucketIndex`; rewrite the render section of `tick`)

**Interfaces:**
- Changed: `Drop.colorVariant: number` → `Drop.brightnessVariant: number` (index into `BRIGHTNESS_VARIANTS`). Same lifetime rules as `depth`.
- Changed: `dropFadeAlpha(y: number, viewportHeight: number): number` — now takes the already-computed on-screen y instead of `(drop, globe, viewportHeight)`, since the render loop computes `dropPosition` once per drop per frame anyway and re-deriving it inside the fade helper was pure duplicate work.
- Removed: `appendTeardrop`, `drawSingleFadingDrop`, `appendWrapTrail`, `TierColors`, `COLOR_VARIANT_OFFSETS`, `COLOR_VARIANT_JITTER`, `DepthTier.highlightAlpha`, `DepthTier.bodyAlpha`.
- Added: `BRIGHTNESS_VARIANTS: readonly number[]`, `ALPHA_LEVELS: number`, `TAPER_PASSES: readonly TaperPass[]`, `appendStreak`, `appendWrapStreak`, `dropAlpha`, `bucketIndex`, `DepthTier.baseAlpha`.
- Changed: `RainColors` is now `{ streak: string; ripple: string }` — one opaque hex for every streak, with per-bucket alpha applied via `ctx.globalAlpha`. The `variants: TierColors[][]` table is gone.

- [ ] **Step 1: Replace the depth-tier and variant definitions**

Replace the `DepthTier` interface, `DEPTH_TIERS`, `COLOR_VARIANT_OFFSETS`, and `COLOR_VARIANT_JITTER` with:

```ts
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
```

- [ ] **Step 2: Rename the `Drop` field and update `randomDrop`**

In the `Drop` interface, replace the `colorVariant` field and its doc comment with:

```ts
  /** Index into BRIGHTNESS_VARIANTS — fixes this drop's own brightness
   * multiplier for its whole lifetime, same respawn-refreshes-it rule as
   * depth. */
  brightnessVariant: number
```

In `randomDrop`, replace the `colorVariant` local and property:

```ts
  const brightnessVariant = Math.floor(Math.random() * BRIGHTNESS_VARIANTS.length)
```

```ts
    brightnessVariant,
```

- [ ] **Step 3: Simplify the colour resolution**

Replace the `TierColors` interface, the `RainColors` interface, and `resolveRainColors` with:

```ts
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
```

`hexToRgba` stays (still used for the ripple). `hexToRgb` and `mixHex` stay.

- [ ] **Step 4: Change `dropFadeAlpha` to take y directly**

Replace `dropFadeAlpha` with (the fade *curve* itself is Task 4's job — this step only changes the signature):

```ts
/** 1 while a drop is well above the bottom of the viewport, ramping down
 * to 0 exactly at viewportHeight — see FADE_ZONE_PX. Drops below that (in
 * the RESPAWN_MARGIN_PX gap before actually being recycled, see
 * updateDrop) are already fully transparent, so no visible pop either way.
 * Takes the already-computed on-screen y rather than (drop, globe): the
 * render loop resolves dropPosition once per drop per frame anyway, and
 * re-deriving it in here was duplicate work on the hottest path. */
export function dropFadeAlpha(y: number, viewportHeight: number): number {
  const fadeStart = viewportHeight - FADE_ZONE_PX
  if (y <= fadeStart) return 1
  return Math.max(0, 1 - (y - fadeStart) / FADE_ZONE_PX)
}
```

- [ ] **Step 5: Replace the shape helpers**

Delete `appendTeardrop` and `drawSingleFadingDrop` entirely. Replace `appendWrapTrail` with the two functions below, and add `TAPER_PASSES` above them. `wrapPointAt` and `WRAP_TRAIL_SEGMENTS` are unchanged and still used.

```ts
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
```

- [ ] **Step 6: Add the alpha quantization and bucket indexing**

Add immediately after `TAPER_PASSES`:

```ts
// The number of discrete brightness steps a drop can land in on any given
// frame. This is the SECOND (and last) batching dimension alongside depth
// tier: everything that varies a drop's brightness — its own lifetime
// variant, the bottom-edge fade, and the lighting — is multiplied together
// and snapped to one of these levels, so all of it costs zero extra
// buckets and zero extra draw calls. 8 is fine-grained enough that a drop
// crossing the fade zone steps down invisibly (each step is 12.5% of alpha,
// on shapes whose peak alpha is already under 0.9) and coarse enough that
// the field never spreads across more buckets than there are meaningful
// shades.
const ALPHA_LEVELS = 8

/** Every brightness input for one drop on one frame, multiplied into a
 * single 0..1 value. Quantized by the caller — see ALPHA_LEVELS. */
function dropAlpha(drop: Drop, y: number, viewportHeight: number): number {
  const base = DEPTH_TIERS[drop.depth].baseAlpha * BRIGHTNESS_VARIANTS[drop.brightnessVariant]
  return Math.min(1, base * dropFadeAlpha(y, viewportHeight))
}

/** Flat index into the preallocated bucket array. Level 0 means "invisible"
 * and is never drawn, but it still gets a slot so the arithmetic stays a
 * plain multiply-add. */
function bucketIndex(depth: number, level: number): number {
  return depth * (ALPHA_LEVELS + 1) + level
}

const BUCKET_COUNT = DEPTH_TIERS.length * (ALPHA_LEVELS + 1)
```

- [ ] **Step 7: Rewrite the render section of `tick`**

Inside the main `useEffect`, immediately before `let rafId: number`, add the preallocated buckets:

```ts
    // Preallocated once, reused every frame (length reset to 0 rather than
    // reallocated) — binning 130 drops per frame must not allocate.
    const buckets: Drop[][] = Array.from({ length: BUCKET_COUNT }, () => [])
```

Then replace everything in `tick` from the `ctx.lineCap = 'round'` line down to (and including) the `for (const { drop, alpha } of fadingDrops)` loop with:

```ts
        // Batched by (depth tier, quantized alpha level). Depth tier owns
        // GEOMETRY (line width, streak length); the alpha level owns
        // BRIGHTNESS and absorbs every per-drop and per-frame brightness
        // input at once, so a fading drop is no longer a special case that
        // has to be pulled out and drawn individually — it is just a drop
        // in a lower bucket. Draw-call ceiling is
        // DEPTH_TIERS.length * ALPHA_LEVELS * TAPER_PASSES.length = 72
        // strokes, and empty buckets are skipped entirely.
        const colors = colorsRef.current
        for (const bucket of buckets) bucket.length = 0
        for (const drop of drops) {
          const pos = dropPosition(drop, globe)
          const level = Math.round(dropAlpha(drop, pos.y, viewportHeight) * ALPHA_LEVELS)
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
                  const head = dropPosition(drop, globe)
                  appendStreak(ctx, head, dropDirection(drop, globe), drop.length, pass.endInset)
                }
              }
              ctx.stroke()
            }
          }
        }
        ctx.globalAlpha = 1
```

The `drawRipples(ctx, ripplesRef.current, now, colors.ripple)` call directly below stays exactly as it is.

- [ ] **Step 8: Verify the taper profile numerically**

Write a throwaway Node script in the scratchpad (do not commit it) that composites the three `TAPER_PASSES` alphas source-over at 21 sample points along a streak — at each sample, `alpha = 1 - Π(1 - passAlpha)` over the passes whose `[endInset, 1 - endInset]` span covers that sample.

Expected output: alpha rises monotonically from the tail to the middle and falls monotonically and symmetrically to the head; middle ≈ 0.89, ends ≈ 0.32; no sample point is 0 inside the streak.

- [ ] **Step 9: Typecheck and lint**

Run: `npm run build`
Expected: succeeds. In particular, no leftover references to `colorVariant`, `appendTeardrop`, `drawSingleFadingDrop`, `appendWrapTrail`, `TierColors`, or `colors.variants` anywhere in the file.

Run: `npx oxlint src/components/GlobeRain.tsx`
Expected: no new errors.

---

### Task 4: Make the bottom-edge disappearance far more gradual

The user: *"can it more gradually disappear."* Today the fade is a straight linear ramp over the last 90px, which at 220–420 px/s means a drop goes from fully opaque to invisible in roughly 0.2–0.4 seconds — short enough that it reads as a cut, not a dissolve, and it starts abruptly (the alpha derivative jumps from 0 to a constant the instant a drop crosses `fadeStart`).

Two changes, both cheap now that Task 3 made the fade just another input to the quantized alpha level:

1. **Much longer zone** — `FADE_ZONE_PX` 90 → 300. On a 900px viewport that is the bottom third, giving 0.7–1.4 seconds of dissolve. In the pre-Task-3 architecture this would have been prohibitive (every drop in the zone was pulled out and drawn with three individual calls of its own — 300px of a 900px viewport is ~1/3 of the field, so ~43 drops × 3 = ~129 extra draw calls per frame). After Task 3, a longer zone costs nothing at all: those drops just land in lower buckets.
2. **Smoothstep instead of linear** — zero derivative at both ends of the ramp, so the fade eases in imperceptibly at the top of the zone and eases out to nothing at the bottom edge, rather than switching on and hitting zero at constant speed.

**Files:**
- Modify: `src/components/GlobeRain.tsx` (`FADE_ZONE_PX` and its comment; the body of `dropFadeAlpha`)

**Interfaces:** No signature changes (`dropFadeAlpha(y, viewportHeight)` from Task 3 is unchanged).

- [ ] **Step 1: Widen the fade zone**

Replace the `FADE_ZONE_PX` declaration and comment:

```ts
// A drop fades to fully transparent over this many pixels as it approaches
// the bottom of the viewport, reaching alpha 0 exactly at the visible
// bottom edge (see dropFadeAlpha). Widened from 90: at 220-420 px/s a 90px
// ramp is only ~0.2-0.4 seconds, which reads as a cut rather than a
// dissolve. 300px is ~0.7-1.4 seconds. This costs nothing now that the
// fade is folded into the quantized alpha level the renderer already
// batches on (see dropAlpha / ALPHA_LEVELS) — before that, every drop
// inside this zone had to be drawn individually, and widening it would
// have put roughly a third of the field on the per-drop path.
const FADE_ZONE_PX = 300
```

- [ ] **Step 2: Swap the linear ramp for a smoothstep**

Replace the body of `dropFadeAlpha` (keep the existing doc comment, appending the new sentence):

```ts
/** 1 while a drop is well above the bottom of the viewport, easing down
 * to 0 exactly at viewportHeight — see FADE_ZONE_PX. Drops below that (in
 * the RESPAWN_MARGIN_PX gap before actually being recycled, see
 * updateDrop) are already fully transparent, so no visible pop either way.
 * Takes the already-computed on-screen y rather than (drop, globe): the
 * render loop resolves dropPosition once per drop per frame anyway, and
 * re-deriving it in here was duplicate work on the hottest path.
 *
 * Smoothstep, not linear: 3t^2 - 2t^3 has zero derivative at BOTH t=0 and
 * t=1, so the fade neither switches on abruptly at the top of the zone nor
 * arrives at zero still moving — which is exactly what "more gradual"
 * means here. A linear ramp of the same length still has a visible corner
 * at each end no matter how long it is. */
export function dropFadeAlpha(y: number, viewportHeight: number): number {
  const fadeStart = viewportHeight - FADE_ZONE_PX
  if (y <= fadeStart) return 1
  const t = Math.min(1, (y - fadeStart) / FADE_ZONE_PX)
  return 1 - t * t * (3 - 2 * t)
}
```

- [ ] **Step 3: Verify the fade curve numerically**

Write a throwaway Node script in the scratchpad (do not commit it) that evaluates `dropFadeAlpha` on an 800px-tall viewport at y = 400, 500, 520, 560, 600, 650, 700, 750, 790, 800, 860.

Expected: 1 at y ≤ 500; strictly decreasing and continuous through the zone; ≈0.5 at y = 650 (the midpoint); ≈0 at y = 800; exactly 0 at y = 860. Also confirm the derivative near both ends is small — the drop from y=500 to y=520 and from y=780 to y=800 should each be under 0.02, versus ~0.067 for a linear ramp of the same length.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run build` — expected to succeed.
Run: `npx oxlint src/components/GlobeRain.tsx` — expected: no new errors.

---

### Task 5: Let lighting affect the raindrops

The user: *"can the lighting affect the raindrops?"* — open-ended. This app already establishes what "lighting" means in two places: `BeadScene.tsx`'s `MouseLight` (a cursor-tracked `pointLight` whose specular hot-spot slides across the beads as the mouse moves — the deliberate interactive cue in that scene), and `dot-matrix-background.tsx` (a cursor-tracked CSS reveal on this very page, driven by a rAF-batched `mousemove` handler writing straight to the DOM with no React state).

**What it should mean here, and why.** Two complementary pieces, both folded into the single alpha level Task 3 established:

1. **A cursor light** — drops near the cursor brighten, with a smooth radial falloff. This is the direct analogue of `MouseLight`, and on this page it also *rhymes* with `DotMatrixBackground`'s reveal, which is already lighting up the same region of screen under the same cursor: the rain and the dot grid start responding to the same implied light source instead of ignoring each other. This is the piece worth having.

2. **A fixed scene-light direction** — a constant, shallow contrast term based on how a streak is oriented relative to one fixed light direction. For straight-falling drops this is a constant (they all share `WIND_DIR`), so it contributes nothing; the payoff is entirely on the **wrap phase**, where a drop's direction sweeps through every angle as it glides around the globe's silhouette, so one side of the globe's rain-halo is consistently brighter than the other. That is a genuine, physically-motivated read of "lighting affects the raindrops," and it replaces something the file *lost* in Task 3 — the old per-drop highlight dot at a fixed `-0.65π` offset from the direction of travel, which was an arbitrary offset with no shared light source behind it. Keep `SCENE_LIGHT_CONTRAST` modest so it does not fight the reference's brightness-only-variation look.

**Why this does not break batching.** Both terms are pure per-drop scalars evaluated once per frame in the existing binning loop, and both multiply into the value that is *already* being quantized to one of `ALPHA_LEVELS` steps. No third bucket dimension, no per-frame re-sort, no change to bucket membership rules — bucket key stays exactly `(depth tier, alpha level)`. A brightly-lit far-tier drop simply lands in the same bucket a dim near-tier drop would, which is correct: they should be drawn the same. The only per-frame cost added is one `Math.hypot` and two multiplies per drop — 130 of each.

Cursor tracking follows `BeadScene`'s `MouseLight` rather than `DotMatrixBackground`'s rAF batching: `DotMatrixBackground` needs the rAF gate because its handler *writes to the DOM*, and an unbatched write per `mousemove` would be layout churn. Here the handler only writes a ref that the existing `tick` reads once per frame, so the rAF gate would be pure ceremony — `MouseLight` does exactly this and for exactly this reason (documented in its own comment at `BeadScene.tsx:613`).

**Files:**
- Modify: `src/components/GlobeRain.tsx` (add lighting constants and helpers; add a cursor ref + `pointermove` listener in the component; extend `dropAlpha`; pass direction and cursor through the binning loop)

**Interfaces:**
- Changed: `dropAlpha(drop: Drop, y: number, viewportHeight: number): number` → `dropAlpha(drop: Drop, pos: { x: number; y: number }, dir: { x: number; y: number }, viewportHeight: number, cursor: { x: number; y: number } | null): number`.
- Added: `CURSOR_LIGHT_RADIUS_PX`, `CURSOR_LIGHT_GAIN`, `SCENE_LIGHT_DIR`, `SCENE_LIGHT_CONTRAST`, `cursorLightMul`, `sceneLightMul`.

- [ ] **Step 1: Add the lighting constants and helpers**

Insert immediately before `ALPHA_LEVELS`:

```ts
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
// For straight-falling drops this is a constant (they all share WIND_DIR),
// which is the point: it is a global tone, not per-drop noise. The visible
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
```

- [ ] **Step 2: Fold both terms into `dropAlpha`**

Replace `dropAlpha` (from Task 3) with:

```ts
/** Every brightness input for one drop on one frame, multiplied into a
 * single 0..1 value: the tier's base alpha, the drop's own lifetime
 * variant, the bottom-edge fade, the cursor light, and the fixed scene
 * light. Quantized by the caller — see ALPHA_LEVELS. Collapsing all of it
 * into one number here is what keeps the renderer's bucket key at
 * (depth tier, alpha level): lighting adds no batching dimension, no
 * per-frame re-sort, and no per-drop draw call. */
function dropAlpha(
  drop: Drop,
  pos: { x: number; y: number },
  dir: { x: number; y: number },
  viewportHeight: number,
  cursor: { x: number; y: number } | null,
): number {
  const base = DEPTH_TIERS[drop.depth].baseAlpha * BRIGHTNESS_VARIANTS[drop.brightnessVariant]
  const lit = base * sceneLightMul(dir) * cursorLightMul(pos.x, pos.y, cursor)
  return Math.min(1, lit * dropFadeAlpha(pos.y, viewportHeight))
}
```

Note the ordering: the fade is applied **last and outside** the lighting, so a drop at the very bottom edge still reaches alpha 0 even if the cursor is sitting right on it. Lighting must not resurrect a drop that is supposed to be gone.

- [ ] **Step 3: Track the cursor in the component**

Inside `GlobeRain`, alongside the other refs (after `globeRef`), add:

```ts
  // Plain mutable ref, not React state: pointermove fires far faster than
  // React commits, and this only feeds the rAF loop below, which reads it
  // once per frame — a state update per pointer event would be discarded
  // work. Same reasoning (and same shape) as BeadScene's MouseLight. No
  // rAF batching wrapper here, unlike DotMatrixBackground: that component
  // needs one because its handler writes to the DOM, whereas this handler
  // only assigns a ref.
  const cursorRef = useRef<{ x: number; y: number } | null>(null)
```

Add a dedicated effect immediately after the theme-colour effect:

```ts
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
```

- [ ] **Step 4: Pass position, direction and cursor through the binning loop**

In `tick`, replace the binning loop written in Task 3 Step 7 with:

```ts
        const colors = colorsRef.current
        const cursor = cursorRef.current
        for (const bucket of buckets) bucket.length = 0
        for (const drop of drops) {
          const pos = dropPosition(drop, globe)
          const dir = dropDirection(drop, globe)
          const level = Math.round(dropAlpha(drop, pos, dir, viewportHeight, cursor) * ALPHA_LEVELS)
          if (level <= 0) continue
          buckets[bucketIndex(drop.depth, level)].push(drop)
        }
```

- [ ] **Step 5: Verify the lighting math numerically**

Write a throwaway Node script in the scratchpad (do not commit it) that checks:
- `cursorLightMul` returns exactly 1 at and beyond `CURSOR_LIGHT_RADIUS_PX`, exactly `1 + CURSOR_LIGHT_GAIN` (1.9) at distance 0, is monotonically decreasing in distance, and is continuous at the radius boundary (evaluate at 379 and 380 — the difference must be under 0.0001).
- `sceneLightMul` stays inside `[1 - SCENE_LIGHT_CONTRAST, 1]` = `[0.7, 1]` for 360 directions sampled a degree apart, and hits both endpoints (within 0.001) at the aligned and perpendicular directions.
- `dropAlpha` returns 0 at `pos.y === viewportHeight` regardless of cursor position — pass a cursor exactly on the drop and confirm the fade still wins.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run build` — expected to succeed.
Run: `npx oxlint src/components/GlobeRain.tsx` — expected: no new errors beyond the file's pre-existing `only-export-components` warnings.

---

### Task 6: Verify, log, and commit

**Files:**
- Modify: `PROGRESS.md` (start + end entries)

**Interfaces:** None.

- [ ] **Step 1: Final full-file review**

Read `src/components/GlobeRain.tsx` top to bottom and confirm:
- No references remain to `colorVariant`, `COLOR_VARIANT_OFFSETS`, `COLOR_VARIANT_JITTER`, `TierColors`, `colors.variants`, `bodyAlpha`, `highlightAlpha`, `appendTeardrop`, `drawSingleFadingDrop`, or `appendWrapTrail`.
- Every `ctx.globalAlpha` assignment is paired with a reset to 1 before control leaves the render section (the bucket loop resets after itself; `drawRipples` already resets after itself).
- `DROP_COUNT` is still 130 and `MAX_DEVICE_PIXEL_RATIO` is still 1.5.
- No `createLinearGradient`, no `three`/WebGL import, no new dependency.

- [ ] **Step 2: Manual visual check in the running dev server**

Start the dev server preview, open the app with **no country selected**, and confirm in both light and dark mode:
- Streaks are thin, uniform-width lines with soft ends — no round head bulb, no bright dot, no visible teardrop silhouette.
- All streaks share one clear diagonal angle; none are vertical, and none disagree with each other about the direction.
- The field is even edge-to-edge; there is no visible column of rain down the middle over the globe.
- A drop approaching the bottom dissolves slowly over roughly the bottom third of the screen, with no visible moment where it "switches on" fading or snaps out.
- Moving the cursor visibly brightens the drops around it, and the brightening follows the cursor smoothly; moving the cursor off the window returns the field to its unlit brightness.
- Drops crossing the globe still ripple on entry and still hug the silhouette, and the halo of rain around the globe is visibly brighter on one side than the other.
- Selecting a country unmounts the layer cleanly; deselecting remounts it. Framerate is unchanged.

**Expected sandbox outcome:** this environment's tab reports `document.hidden === true`, so `requestAnimationFrame` never advances and the canvas stays blank — every prior GlobeRain entry hit this. If that happens, do NOT treat it as a bug and do NOT start changing code to "fix" it. Confirm the canvas exists at the correct viewport size, record that visual confirmation is pending a live human check, and rely on the numeric verifications from Tasks 1/3/4/5 instead.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Update PROGRESS.md**

Append a start entry (if not already present) and an end entry per this project's terse running-log convention, newest at the bottom, marked `[inline]` or `[agent: <type>]` depending on who executed. The end entry should cover, in one short paragraph each: the four asks and what each turned into; the batching restructure from `(tier × colorVariant)` to `(tier × quantized alpha level)` and the resulting draw-call ceiling of 72; the explicit rejection of per-drop `createLinearGradient` and why; the spawn-bias retune from ~10x to ~1.8x in-band density with the numbers; and the sandbox visual-confirmation limitation.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\Albert.T4\3D Objects\hack-the-arts-addk-2026"
git add src/components/GlobeRain.tsx PROGRESS.md graphify-out
GIT_AUTHOR_DATE="2026-07-31T19:00:00" GIT_COMMITTER_DATE="2026-07-31T19:00:00" git commit -m "GlobeRain: motion-blur streaks, even spread, gradual fade, cursor lighting"
```

Do not push.
