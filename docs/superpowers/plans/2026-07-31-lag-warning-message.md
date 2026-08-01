# 20-City Lag Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a one-time, 5-second, countdown warning in the bottom-right corner (the same spot as the language/theme hover hints) the first time the city-count slider reaches its max (20 cities), advising that WebGL performance may degrade.

**Architecture:** A new `LagWarning` memoized component in `src/App.tsx`, styled like the existing `LanguageHint`/`ThemeHint` (same corner, same fade transition, same absolute positioning) but always-mounted-when-active rather than hover-driven. A `hasShownRef` guards the one-time-per-session trigger. A `remainingSeconds` state (5→0) drives both the countdown label and the unmount, ticking via `setInterval`. The two hover hints are bumped to `z-20` so they visually sit above the lag message (`z-10`) whenever hovered, satisfying "overrideable by any other message."

**Tech Stack:** React 19, TypeScript, Tailwind v4 (existing patterns in `src/App.tsx`). No new dependencies. No test framework exists in this project (no vitest/jest in `package.json`), so verification is via `npm run build`, `oxlint src`, and manual DOM/browser inspection — consistent with how the rest of this session's changes were verified.

## Global Constraints

- Message text (exact, per user): `please be advised that WebGL performance may degrade at 20 cities`
- Countdown suffix format: ` · 5s` ticking down to ` · 1s`, then the message unmounts entirely (no ` · 0s` frame)
- Color: amber/yellow (Tailwind `text-amber-500` light, keep readable in dark mode — reuse the existing hint pattern's `dark:` variant approach)
- Position: `absolute bottom-4 right-4`, same corner as `LanguageHint`/`ThemeHint` in `src/App.tsx`
- Trigger: only the *first* time the throttled `cityCount` (from `App.tsx:244`) equals `MAX_CITY_COUNT` (imported from `GlobeView`, `App.tsx:10`) — once per session, never again even if the user drags away and back
- Hover hints (`LanguageHint`, `ThemeHint`) must visually take priority over the lag message when both would occupy the corner at once

---

### Task 1: Add `LagWarning` component and wire up its trigger

**Files:**
- Modify: `src/App.tsx` (add component near `LanguageHint`/`ThemeHint`, ~line 170; add state/effect in `App()`, ~line 235-246; bump z-index on `LanguageHint`/`ThemeHint`, ~line 104 and 157; render `LagWarning` alongside the other hints, ~line 293-294)

**Interfaces:**
- Consumes: `MAX_CITY_COUNT` (already imported at `App.tsx:10`), `cityCount` (already computed at `App.tsx:244`)
- Produces: nothing consumed by other tasks — this is the whole feature

- [ ] **Step 1: Bump the two existing hint components to `z-20`**

In `src/App.tsx`, find `ThemeHint` (around line 104) and change its className's `z-10` to `z-20`:

```tsx
      className={`pointer-events-none absolute bottom-4 right-4 z-20 font-mono text-xs tracking-wide text-muted-foreground/60 transition-opacity duration-300 dark:text-foreground/70 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
```

Do the same for `LanguageHint` (around line 157) — change its `z-10` to `z-20` in the identical className string.

- [ ] **Step 2: Add the `LagWarning` component**

Insert this new component in `src/App.tsx` directly after the `LanguageHint` component (after its closing `})` around line 170), before the `ControlPanel` comment block:

```tsx
// Shares the language/theme hints' bottom-right corner and fade pattern,
// but unlike those it isn't hover-driven — it's shown once, automatically,
// the first time the city count hits its max. Sits at a lower z-index than
// the hover hints so hovering the language/theme toggle visually covers it
// without needing to coordinate visibility state between the three.
const LagWarning = memo(function LagWarning({ remainingSeconds }: { remainingSeconds: number | null }) {
  const visible = remainingSeconds !== null
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute bottom-4 right-4 z-10 font-mono text-xs tracking-wide text-amber-500 transition-opacity duration-300 dark:text-amber-400 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      please be advised that WebGL performance may degrade at 20 cities
      {visible && ` · ${remainingSeconds}s`}
    </span>
  )
})
```

- [ ] **Step 3: Add the countdown state and one-time trigger effect**

In `src/App.tsx`, inside `function App()`, find the existing state declarations (around line 234-238, right after `langHintVisible`/`themeHintVisible`). Add:

```tsx
  const [lagWarningRemaining, setLagWarningRemaining] = useState<number | null>(null)
  const hasShownLagWarningRef = useRef(false)
```

Check the top of the file for the existing `useRef` import — `App.tsx` already imports from `react`; add `useRef` to that import list if it isn't already there.

Then, after `cityCount` is computed (right after `App.tsx:244`, `const cityCount = useRafThrottled(...)`), add the trigger effect. Place it among the other hooks before the early `return` statements (i.e. before line 262's `if (demographics.status === 'loading')`), since hooks can't run conditionally:

```tsx
  useEffect(() => {
    if (cityCount !== MAX_CITY_COUNT || hasShownLagWarningRef.current) return
    hasShownLagWarningRef.current = true
    setLagWarningRemaining(5)
  }, [cityCount])

  useEffect(() => {
    if (lagWarningRemaining === null) return
    if (lagWarningRemaining === 0) {
      setLagWarningRemaining(null)
      return
    }
    const t = setTimeout(() => setLagWarningRemaining((s) => (s === null ? null : s - 1)), 1000)
    return () => clearTimeout(t)
  }, [lagWarningRemaining])
```

- [ ] **Step 4: Render `LagWarning`**

Find where `LanguageHint` and `ThemeHint` are rendered (around line 293-294):

```tsx
      <LanguageHint lang={lang} visible={langHintVisible} />
      <ThemeHint theme={theme} visible={themeHintVisible} />
```

Add `LagWarning` alongside them:

```tsx
      <LanguageHint lang={lang} visible={langHintVisible} />
      <ThemeHint theme={theme} visible={themeHintVisible} />
      <LagWarning remainingSeconds={lagWarningRemaining} />
```

- [ ] **Step 5: Build and lint**

Run:
```bash
npm run build
```
Expected: succeeds with no TypeScript errors.

Run:
```bash
npx oxlint src
```
Expected: no new errors (pre-existing warnings, if any, are fine).

- [ ] **Step 6: Manual verification in the Browser pane**

1. Navigate to `http://localhost:5173`.
2. Drag the city-count slider to 20 (max). Read the bottom-right corner's DOM text via `javascript_tool` (e.g. `document.querySelector('[class*="amber"]')?.textContent`) — expect it to contain `please be advised that WebGL performance may degrade at 20 cities · 5s`.
3. Wait ~1.5s (`computer` action `wait`) and re-check the text — the trailing number should have decremented (e.g. `· 4s` or `· 3s`).
4. Drag the slider away from 20 and back to 20 again. Confirm the message does **not** reappear (query the DOM again — no amber-colored span with text present, or `opacity-0`).
5. Hover the language toggle while a fresh instance of the message would be visible (not reliably testable post-first-trigger since it's one-shot — instead just confirm statically that `LanguageHint`/`ThemeHint` now carry `z-20` and `LagWarning` carries `z-10` via a source read, since the DOM stacking can't be re-triggered without a full page reload).
6. Reload the page (resets `hasShownLagWarningRef`), drag to 20 again, and this time hover the language toggle icon while the countdown is active — confirm via `read_page` or a screenshot-equivalent DOM check that the language hint's text is present and, given the shared corner and differing z-index, would render above the lag message.
7. Check console for errors via `read_console_messages`.

- [ ] **Step 7: Commit and push**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
Add one-time lag warning at max city count

Shown once per session, 5s countdown, in the same bottom-right
corner as the language/theme hover hints (which now render above
it via z-index so they take visual priority if both are active).
EOF
)"
git push
```
