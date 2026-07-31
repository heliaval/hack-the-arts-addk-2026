## Workflow: superpowers first

Before any creative or implementation work, invoke `superpowers:brainstorming` (new features/behavior changes) or `superpowers:systematic-debugging` (bugs/unexpected behavior) first. Follow with the matching process skill (`writing-plans`, `test-driven-development`, `executing-plans`, `requesting-code-review`, `verification-before-completion`, etc.) as the task progresses. Do not skip straight to implementation.

## Think-before-coding discipline (karpathy-guidelines)

Apply this whenever writing, reviewing, or refactoring code. Before implementing, surface assumptions explicitly and present competing interpretations instead of silently picking one; name anything confusing and pause to ask for clarity rather than guessing. Ship the minimum code that solves the problem — nothing speculative — and keep edits surgical: touch only what the request requires, match existing style, and flag (don't remove) pre-existing dead code. For multi-step or ambiguous tasks, state testable success criteria and a brief plan with verification checkpoints up front, then loop until those criteria are verified.

## claude-mem: cross-session referencing only

Run `claude-mem:mem-search` before starting work to check whether similar work was already done in a past session. Use `claude-mem:make-plan` / `claude-mem:do` only for large multi-phase efforts spanning many sessions, and only after `superpowers:brainstorming` has run first. Do not use claude-mem for within-session codebase exploration or single-feature planning — codebase structure questions go through `graphify` (below), and single-feature planning stays in the `superpowers` chain (`brainstorming` → `writing-plans` → `executing-plans`).

## Design: avoid AI clichés above all else

For anything touching visual design, layout, components, or styling, invoke `design-taste-frontend` and/or `impeccable`. The explicit goal: the result must **not look AI-generated or templated**, full stop. If a design decision is the obvious, safe, default choice, that's a signal to reconsider it, not a signal it's correct. Actively hunt for and reject boilerplate gradients, default shadcn spacing/shadows, centered-hero-with-emoji layouts, generic rounded cards on a grid, stock "clean SaaS" look, purple/blue gradient backgrounds, and any other recognizable "AI slop" pattern — even ones not explicitly listed. Prefer specific, deliberate, opinionated typography, color, and layout choices over safe/generic ones. Audit existing UI before redesigning it rather than blindly rewriting it. Rule of thumb: if the finished interface would be indistinguishable from a thousand other AI-generated interfaces, the work is not done.

## shadcn: primitives only, not final taste

When a component needs standard, well-tested UI plumbing (dialogs, forms, dropdowns, etc.), pull it from `shadcn` as a functional starting point, then apply the `design-taste-frontend`/`impeccable` pass on top so it doesn't ship looking like default shadcn styling.

## Frontend defaults: React + TypeScript + Tailwind

New frontend code in this repo should use React, TypeScript, and Tailwind CSS, because it's what `shadcn/ui` is built for and expects. Don't hand-roll CSS primitives — no raw CSS files, CSS modules, styled-components, other CSS-in-JS, or bespoke utility class systems; use Tailwind utility classes, matching shadcn's conventions. When a component is needed, pull it from the `shadcn` skill/library first (see above) rather than building one from scratch. If a project already uses a different stack, this is not a mandate to migrate it — the default applies to new frontend work and new projects.

## Model tiering: planning vs. execution

Planning-tier models (currently Opus) are for brainstorming, research, and writing plans; execution-tier models (currently Sonnet) are for implementation. Editing plans, documentation, prompts, or CLAUDE.md itself is fine on any model. If a planning-tier model is active and about to perform an implementation step (writing/editing source code, running state-mutating build/test commands, committing), stop and flag that step instead of proceeding — ask the user to switch to an execution-tier model. If it's unclear which tier the active model belongs to, or whether a step counts as implementation, ask rather than assuming it's allowed.

## Progress log for handoff

Maintain a `PROGRESS.md` at the project root: append a short entry at the start of any non-trivial task/change (date/time, what's being started) and a matching entry at the end (date/time, what was done, status: done/blocked/partial). Terse, newest at the bottom, log not documentation — this exists so the project can be handed off cleanly if usage limits are hit mid-work. Create `PROGRESS.md` the first time a non-trivial task starts and no such file exists yet.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
