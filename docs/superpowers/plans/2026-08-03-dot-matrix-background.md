# Dot-Matrix Cursor-Reveal Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an invisible dot-matrix background layer to the app that reveals itself with a soft glow (plus a glass-sheen highlight) wherever the cursor hovers, using pure CSS masking driven by two cursor-tracked custom properties — no per-frame canvas drawing.

**Architecture:** One new presentational component (`DotMatrixBackground`) owns the dot grid, the two-layer reveal mask, the sheen highlight, and the `mousemove` → `requestAnimationFrame` → CSS custom property pipeline. It is mounted once as the first child of `App.tsx`'s root container so it paints behind the globe wrapper (both are unpositioned/`z-0`, so DOM order decides paint order). No new dependencies, no React state, no props needed from `App`.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (utility classes only — no new CSS file; inline styles for the two dynamic gradients since Tailwind can't express `var(--mx)`-based gradients as utilities).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-dot-matrix-background-design.md` — follow it exactly; values below are copied verbatim from it.
- Layer classes: `pointer-events-none absolute inset-0 z-0`, mounted as the **first** child of `App.tsx`'s outer `relative h-full w-full` container (before the `absolute inset-0` GlobeView wrapper).
- Dot tile: `radial-gradient(circle at center, var(--border) 0 1px, transparent 1px)`, `background-size: 24px 24px`, layer `opacity: 0.35`.
- Reveal mask: two stacked radial gradients centered on `var(--mx) var(--my)` — inner `circle 140px` (`#000 0%, #000 40%, transparent 100%`), outer `circle 320px` (`rgba(0,0,0,0.5) 0%, transparent 100%`), composited additively (`mask-composite: add`, `-webkit-mask-composite: source-over`). `--mx`/`--my` default to `-9999px` (no reveal before first `mousemove`).
- Sheen: separate child element, `radial-gradient(ellipse 420px 260px at calc(var(--mx) - 70px) calc(var(--my) - 50px), var(--foreground), transparent 70%)`, opacity in the 3–5% range (use `0.04`). Not masked.
- Cursor tracking: one `window` `mousemove` listener registered in a `useEffect`, ref-stored latest coordinates, one `requestAnimationFrame` in flight at a time, frame callback writes `--mx`/`--my` via `style.setProperty` on a ref'd DOM node. No React state.
- Theming: colors are `var(--border)` / `var(--foreground)` only — no `dark:` variants, no `useTheme` import.
- No touch handling, no configurability, no tests beyond a manual visual check (per spec's "Out of scope"). Do not add a test file.
- Backdate this task's commit: `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` both `2026-07-31T19:00:00` (standing instruction for this work session).
- Update `PROGRESS.md` with a start entry and an end entry per this project's CLAUDE.md convention.
- Run `graphify update .` after the code change, before committing.

---

### Task 1: Build and integrate `DotMatrixBackground`

**Files:**
- Create: `src/components/ui/dot-matrix-background.tsx`
- Modify: `src/App.tsx` (add import; insert `<DotMatrixBackground />` as first child of the root `<div className="relative h-full w-full">`, around line 432)
- Modify: `PROGRESS.md` (start + end entries)

**Interfaces:**
- Produces: `DotMatrixBackground` — a zero-prop React component (`function DotMatrixBackground(): JSX.Element`), default export not used (named export, matching this repo's convention — see `GlobeRain`, `LeafOverlay` which use named exports).
- Consumes: nothing from other components. Reads `--border`/`--foreground` CSS custom properties already defined globally in `src/index.css` (both `:root` and `.dat` `.dark` blocks) — no new tokens needed.

- [ ] **Step 1: Create the component file**

Write `src/components/ui/dot-matrix-background.tsx`:

```tsx
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
```

- [ ] **Step 2: Wire it into `App.tsx`**

Add the import near the other component imports (after the `LeafOverlay` import, `src/App.tsx:7`):

```tsx
import { DotMatrixBackground } from '@/components/ui/dot-matrix-background'
```

Insert as the first child of the root container (`src/App.tsx:432`), immediately before the existing globe-wrapper comment/`<div className="absolute inset-0">`:

```tsx
  return (
    <div className="relative h-full w-full">
      <DotMatrixBackground />
      {/* The globe stays centered and full-size while a country is selected
          — it IS the obstacle the beads fall onto (see BeadScene's
          GlobeCollider), so it must never move or shrink out from under the
          physics collider that mirrors it. */}
      <div className="absolute inset-0">
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx oxlint src/components/ui/dot-matrix-background.tsx src/App.tsx`
Expected: no errors (warnings about the two `WebkitMask*`/`maskComposite` camelCase inline-style keys are expected to be clean since they're valid `React.CSSProperties` extensions — if oxlint/tsc flags them as unknown properties, cast the whole style object `as React.CSSProperties` as already shown above, which covers this).

- [ ] **Step 4: Manual visual check in the running dev server**

Start the dev server preview, open the app, and confirm in both light and dark mode:
- No dots visible anywhere on load (before moving the mouse).
- Moving the mouse over an empty corner/margin area (outside the globe circle) reveals a soft cluster of dots under the cursor that fades out over a couple hundred pixels, with a faint offset highlight.
- The dot field never appears to sit on top of the globe, any panel, or any text (it's the bottom-most layer, so it shouldn't — visually confirm anyway).
- Hovering over buttons/panels still works normally (the layer is `pointer-events-none`, so clicks/hovers pass through to the real UI beneath it — confirm the theme toggle and country selection still work while the mouse is moving).

- [ ] **Step 5: Update PROGRESS.md**

Append a start entry (if not already present from this task) and an end entry describing what was built, per this project's terse running-log convention. Mark `[inline]` or `[agent: <type>]` depending on who executed this task.

- [ ] **Step 6: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\Albert.T4\3D Objects\hack-the-arts-addk-2026"
git add src/components/ui/dot-matrix-background.tsx src/App.tsx PROGRESS.md
GIT_AUTHOR_DATE="2026-07-31T19:00:00" GIT_COMMITTER_DATE="2026-07-31T19:00:00" git commit -m "Add cursor-revealed dot-matrix background layer"
```
