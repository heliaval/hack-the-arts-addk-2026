# Fast fill-up bead burst

## Problem

Beads spawn on a per-country demographic-paced interval (`spawnIntervalMs`,
`BeadScene.tsx:9`), which ranges 120ms–1400ms. Reaching the fixed `MAX_BEADS = 70`
cap (`BeadScene.tsx:36`) at the slowest rate can take up to ~98 seconds. The user
wants the pile to fill up much faster, and wants "full" to be a calculated
target rather than a hand-tuned constant.

Beads carry real semantic meaning (each one is a birth or death event, paced by
a country's actual rate) — a permanently fast spawn rate would misrepresent
that. So the fast fill only runs as a one-time-per-trigger burst; normal
demographic pacing resumes once the screen is full.

## Approach

### 1. Dynamic capacity, replacing the fixed `MAX_BEADS`

```
capacity = clamp(
  floor((viewportWidth * viewportHeight) / (BEAD_DIAMETER ** 2) * PACKING_FACTOR),
  MIN_CAPACITY,
  MAX_CAPACITY,
)
```

- `viewportWidth`/`viewportHeight`: CSS pixels, from `useThree((s) => s.size)` —
  already used elsewhere in this file (`Backdrop`).
- `BEAD_DIAMETER`: `BEAD_RADIUS * 2` (existing constant).
- `PACKING_FACTOR`: a constant `< 1` accounting for gaps between circles and
  the fact that beads don't tile the full viewport (they pile under gravity,
  with walls) — tuned by eye during implementation, starting around `0.5`.
- `MIN_CAPACITY` / `MAX_CAPACITY`: clamp guards so a very small window isn't
  empty and a very large monitor doesn't tank the frame rate — starting
  around `30` and `150`, tuned by eye.
- Recomputed on resize (`useThree`'s size is already reactive, so this falls
  out of a `useMemo` keyed on width/height).

This value replaces every use of `MAX_BEADS` in the spawn/eviction logic
(`BeadScene.tsx:863`) — the eviction mechanism itself (oldest-live-bead
flagged `dying`, per the existing comment at `BeadScene.tsx:849-860`) is
unchanged.

### 2. Burst-spawn phase

A new fast fixed interval (`BURST_SPAWN_INTERVAL_MS`, starting around `40ms`)
replaces the two demographic timers while live bead count is below the
computed capacity. Kind alternates birth/death (simple alternation, not
weighted by the country's actual birth/death ratio — the burst is a decorative
fill effect, not a data statement).

Trigger: on mount, and again whenever `selectedIso3` changes. Concretely, the
existing spawn `useEffect` (`BeadScene.tsx:846-887`) gains a burst sub-phase:
while `live < capacity`, spawn on the fast interval; once `live >= capacity`,
switch to the existing `birthIntervalMs`/`deathIntervalMs` timers as today.

Because the normal trickle already evicts-oldest-at-cap continuously, the
pile is normally already at capacity — so re-triggering the burst on country
switch is a no-op in the common case, except it happens to cycle out
old-country beads for new-country ones a bit faster (a side effect, not a
new mechanism).

### 3. No visual "is it full" detection

"Full" is defined purely as "live bead count reached the computed capacity" —
no pixel/coverage inspection of the rendered scene is needed or planned.

## Out of scope

- Tuning `PACKING_FACTOR`/`MIN_CAPACITY`/`MAX_CAPACITY` exact values happens
  during implementation by visual inspection, not fixed in this spec.
- No change to bead physics, colors/variants, or the eviction/fade-out
  mechanism itself.
