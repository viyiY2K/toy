# ADR-0019: S13b ESM application and Task UI migration

## Decision

The production HTML now loads one Vite ESM entry. That entry imports the reviewed `src/data` public barrel and renders the existing sidebar/two-column kanban visual structure using the existing stylesheet. Its state is refreshed from `loadCurrentTaskViews`; every enabled mutation invokes an S13a Task/DayPlan command and then reloads the derived views.

The legacy Babel/global JSX files remain in the repository for comparison but are no longer loaded by production HTML. The application never initializes, reads, or writes the legacy object graph or `sessionStorage['pomo-state']`.

## Scope

S13b enables manual list/today creation, title and estimate changes, activity soft deletion, cross-column movement, and today ordering. Timer and statistics navigation plus planning, subtasks, triage, and other P2+ controls remain disabled or absent until their authorized unit. `styles.css` is unchanged; the app shell, main header, and two-column class/layout structure are retained.
