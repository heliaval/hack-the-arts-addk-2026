# App Title & Branding

## Problem

The app has no real name — `index.html`'s `<title>` and `PRODUCT.md` both use "Hourglass Earth," a working description of the mechanic, not a name. There's also no in-app title visible to a viewer (judges' primary path is a recorded demo video, so the name should be legible on-screen, not just in a browser tab).

## Decision

Name: **Red Thread**
Subtitle: **We Are All Bound By Fate.**

Both title case. Subtitle carries a trailing period; name does not.

Rationale: the sharper fit isn't the romantic "red string of fate" (a bond between two people) but the Moirai — the Fates who spin each life's thread at birth and cut it at death. That maps directly onto this app's core mechanic: World Bank birth/death data driving a physically-simulated hourglass. "Red Thread" also ties visually to the literal red arc-lines already connecting cities on the globe, and — unlike the old placeholder "Hourglass Earth" — doesn't lock the name to "globe" or "hourglass" language, leaving room for the hourglass scene to be a feature of the story rather than the whole name.

## Placement

A header block pinned to the app's top-left corner (`absolute left-4 top-4`), stacked **above** the existing country "reading" panel rather than replacing it. Both live inside one `flex flex-col gap-2` wrapper at that corner so the reading panel simply appears below the title on selection, with no manual offset math:

- No country selected: top-left shows only the title block.
- Country selected: the reading panel renders directly below the title block, in the same wrapper.

To stay legible over the rotating globe, the title block gets the same `rounded-[var(--radius)] border bg-card/90 backdrop-blur-sm` treatment as the reading panel (contrast against a moving WebGL background), at the same `px-3 py-2`. No explicit `z-index` needed — it's a sibling of the (unset-z) reading panel and both sit under `ControlPanel`'s `z-10`; if the globe canvas ever paints over it, add `z-10` to the wrapper — todo only if actually observed.

## Typography & Color

- Name ("Red Thread"): `font-sans` (Geist), `text-sm font-medium tracking-wide`, `text-card-foreground`. Title Case, no trailing period. No accent-red text — the accent color is already used pervasively elsewhere (thumb, dots, hover), so the title doesn't need to be red itself to read as on-brand. Deliberately Title Case even though the rest of the UI's small labels are lowercase (`cities`, `reading`, `click to toggle`) — the title/subtitle block is the one exception, since it functions as a proper name, not an instrument label.
- Subtitle ("We Are All Bound By Fate."): `text-xs text-muted-foreground`, Title Case, trailing period.

## Scope

- Update `index.html` `<title>` to `Red Thread` (no trailing period — the period is a subtitle-sentence convention, not part of the name).
- Add a title/subtitle block component in `src/App.tsx`, wrapped with the existing reading panel in one `flex flex-col gap-2` container at top-left, replacing the reading panel's current standalone `absolute left-4 top-4` positioning.
- No change to `package.json`'s `name` field (internal repo slug, not user-facing) or to `PRODUCT.md`'s "Hourglass Earth" references — out of scope for this pass; can be revisited separately if desired.
