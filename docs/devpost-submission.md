## Inspiration

Right now, somewhere on Earth, a person is being born. Somewhere else, one is dying. It's happening at this exact second, and the only place that fact lives is a spreadsheet cell nobody reads twice. We wanted to build the thing that spreadsheet cell should have been: something you can watch.

## What it does

Spin a globe colored by real population data. City by city, a shockwave ripples outward from wherever someone was just born or just died, red for a birth and black for a death, paced by that country's actual current rate, not a loop. Drag a slider to bring more cities and flight routes onto the globe and watch the arcs draw themselves in as they appear, toggle dark mode, or switch between seven languages for every label on the map.

## How we built it

React, TypeScript, and Vite underneath. The globe runs on cobe (WebGL), fed by live World Bank birth and death rate data. cobe ships no working label or click system of its own: its built-in label mechanism rewrites a stylesheet every frame, which never lets a CSS transition settle, so we rebuilt that layer by hand, deriving the same projection math cobe uses internally and driving it straight off the render loop. Each city accumulates its own real birth/death rate independently of the render loop (animation frames aren't guaranteed to run on schedule), and crosses a threshold to fire a shockwave. That ring isn't a flat circle drawn on the screen: it's an actual geodesic circle computed on the sphere's surface every frame, so it genuinely follows the globe's curvature and disappears once it passes over the horizon, clipped by solving analytically for exactly where the ring stops facing the camera, rather than approximating it by sampling points.

## Challenges we ran into

Getting a WebGL globe library with zero built-in label or click support to feel alive meant rebuilding both from scratch. Making the shockwave rings look right meant solving for a sphere's true horizon in closed form: sampling points and checking each one's visibility independently left the rings looking broken near the edge, and only an exact solve fixed that cleanly. And once real per-second birth/death rates were actually on the table, we had to accept that even the busiest countries only pulse a few times a minute. There's no honest way to make a real rate feel dramatic without either faking the number or choosing a threshold small enough that the truth stays visible.

## Accomplishments that we're proud of

A shockwave driven entirely by real, live World Bank data, not a canned animation: the rate you're watching is the rate that's actually happening right now. The globe, its markers, its flight routes, and its ripples all read as one continuous surface instead of a UI overlaid on a video. Every label, in seven languages, with staggered reveal and draw-in timing tuned so the globe never feels like it's fighting the browser.

## What we learned

A dataset stops feeling abstract the moment it has motion and a real clock behind it. We also learned that "make the physically correct version" and "make the version that reads clearly at a glance" are often the same amount of work in disguise: the closed-form horizon clip ended up both more correct and simpler than the sampling-based approach it replaced.

## What's next

Real click-to-select on the globe (cobe has no hit-testing built in, so this needs to be built from nothing), per-country markers driven by the full dataset instead of a fixed city set, and a deeper view: zooming into a selected country to see its rate up close, with a scrubber to run its whole population history instead of just its current one.
