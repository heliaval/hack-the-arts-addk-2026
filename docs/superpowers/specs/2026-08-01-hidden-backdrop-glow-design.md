# Hidden backdrop glow

## Problem

The backdrop bokeh spots (`useBackdropBase`, `BeadScene.tsx:459-483`) are painted onto the
same visible plane the camera renders directly (`Backdrop`, `BeadScene.tsx:488-549`). Because
three's transmission pass samples that literal rendered geometry, the bokeh doubles as both
the marbles' refraction highlights *and* a directly-visible glow in the background. The user
wants the illuminating effect on the marbles kept, but the glow itself no longer visible in
the flat backdrop.

## Approach

Move the glow from the visible backdrop into the existing `Lightformer` rig
(`BeadEnvironment`, `BeadScene.tsx:381-404`). That rig is already invisible outside of bead
reflections — it's baked once into an offscreen cubemap (`Environment` with no `background`
prop) and only shows up as specular highlights on the glass.

- Remove the bokeh spot loop from `useBackdropBase`, leaving just the plain gradient.
- Add additional soft `Lightformer` elements to `BeadEnvironment`, loosely positioned to match
  where the six bokeh spots used to sit, so the beads keep picking up varied, scattered
  highlights.

## Trade-off (accepted)

Highlights shift from refraction-shaped (bending as if seen through the glass) to
reflection-shaped (sitting on the glass surface). For blobs this soft/small the visual
difference is minor, and reflection highlights read as slightly more "glass marble" than the
soft transmission blur did.

## Out of scope

- The four existing Lightformers and the cursor-tracked `MouseLight` are untouched.
- The globe compositing in `Backdrop` is untouched — only the static bokeh base changes.
