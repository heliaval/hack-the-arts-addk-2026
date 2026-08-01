# App Title & Branding

## Problem

The app has no real name — `index.html`'s `<title>` and `PRODUCT.md` both use "Hourglass Earth," a working description of the mechanic, not a name. There's also no in-app title visible to a viewer (judges' primary path is a recorded demo video, so the name should be legible on-screen, not just in a browser tab).

## Decision

Name: **Red Thread**
Subtitle: **We Are All Bound By Fate.**

Both title case. Subtitle carries a trailing period; name does not.

Rationale: the app's core visual is literally red arc-lines connecting cities across a globe — "red thread" (of fate) is the well-known form of the myth (more recognizable than "red string"), and it doesn't lock the name to "globe" or "hourglass" language, leaving room for the still-unbuilt hourglass scene to be a feature of the story rather than the whole name.

## Placement

A small header block pinned to the app's top-left corner (`absolute left-4 top-4`), stacked **above** the existing country "reading" panel rather than replacing it:

- No country selected: top-left shows only the title block.
- Country selected: the reading panel (currently the only occupant of that corner) renders directly below the title block, in the same corner.

## Typography & Color

- Name ("Red Thread"): `font-sans` (Geist), tracked/letter-spaced consistent with the rest of the UI's restrained chrome — not a large hero treatment. Default foreground color (`text-card-foreground` / `text-foreground`), no accent-red text — the accent color is already used pervasively elsewhere (thumb, dots, hover), so the title doesn't need to be red itself to read as on-brand.
- Subtitle ("We Are All Bound By Fate."): smaller, `text-muted-foreground`, same title-case-with-period styling.

## Scope

- Update `index.html` `<title>` to "Red Thread."
- Add a title/subtitle block component in `src/App.tsx`, rendered unconditionally at top-left, positioned above the existing conditional "reading" panel.
- No change to `package.json`'s `name` field (internal repo slug, not user-facing) or to `PRODUCT.md`'s "Hourglass Earth" references — out of scope for this pass; can be revisited separately if desired.
