# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, react-three-fiber + drei + Rapier (physics) for the 3D hourglass scene, react-globe.gl (globe swap to `cobe` under evaluation) for the 3D globe.

## Users

Devpost "Hack the Arts" hackathon judges. Primary evaluation path is a recorded demo video, not live hands-on interaction — first-glance visual impact and a clear, legible narrative arc (globe → click a country → hourglass) matter more than deep exploratory UX, though the app must also hold up if a judge does interact with it directly.

## Product Purpose

"Hourglass Earth": an interactive 3D globe colored/marked by live population growth or decline data (World Bank API). Clicking a country transitions into a 3D hourglass scene where physically-simulated glass beads flow — top to bottom — to represent that country's births vs. deaths happening in real time. Success is a viewer immediately grasping "this globe is alive with real demographic data" and then being struck by the hourglass metaphor translating abstract birth/death rates into something visceral and watchable.

## Positioning

The mechanism a neighboring "population dashboard" or chart-based visualization could not copy: real demographic data (World Bank API, not synthetic) driving an actual physics simulation (Rapier rigid-body beads, not an animated GIF or shader trick) whose flow rate is derived from a country's real birth/death rate. The globe-to-hourglass transition is the core narrative device — zooming from "the whole world" to "one country's human story."

## Operating Context

Single-page web app, no backend/auth. Data fetched client-side from the World Bank API (indicators SP.POP.TOTL, SP.POP.GROW, SP.DYN.CBRT.IN, SP.DYN.CDRT.IN) and a Natural Earth GeoJSON country-boundary dataset. Entered via `npm run dev` (Vite, localhost:5173) during development; deployed as a static site for judging. Deadline: Aug 1 2026, 8:45pm PDT.

## Capabilities and Constraints

- Globe view: currently `react-globe.gl` rendering country polygons colored by growth rate (red→green), with click-to-select wired and verified working.
- Globe swap to `cobe` is planned but **not yet implemented**; open decision on how per-country growth-rate/population data maps onto cobe's marker/arc model (cobe has no polygon/choropleth support) — deferred until after this color-scheme pass.
- Hourglass scene (react-three-fiber + Rapier bead physics) is **not started**.
- No backend, no user accounts, no persistence — everything is derived live from public APIs on each load.

## Evidence on Hand

No existing brand assets, logo, or prior visual identity — this is a from-scratch hackathon build. shadcn's default neutral gray/Geist theme is currently in `src/index.css`, unstyled/unchosen, explicitly flagged for replacement.

## Product Principles

1. Real data, real physics — never fake the demographic-to-visual mapping with arbitrary decorative motion.
2. Legible at a glance and on video — the core interaction (globe → country → hourglass) must read clearly to someone watching a screen recording once, not just to someone clicking through live.
3. The metaphor carries the design — visual choices should reinforce "population as something physical and flowing," not just decorate a generic data dashboard.
4. Two 3D scenes, one coherent world — the globe and the hourglass must feel like the same visual universe, not two unrelated demos stitched together.

## Accessibility & Inclusion

No specific standard established yet; no known constraint beyond general color-contrast good practice for the chosen palette (growth-rate color coding should remain distinguishable, not solely reliant on hue for colorblind viewers if feasible).
