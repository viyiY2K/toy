# ADR-0021: S14 empty-library start and legacy prototype isolation

## Decision

Phase 1 has no migration path from `sessionStorage['pomo-state']`, `INITIAL`, or the old demo object graph. The sole production HTML module entry is `src/ui/main.jsx`; its reachable UI graph imports the public v4 data barrel and cannot reference the retained root prototype JSX files, browser storage, legacy aggregate fields, a formal `break.skipped` trigger, or an automatic demo path. A new library therefore reaches the already-reviewed S11 initializer and receives only default Settings, the current appDate DayPlan, and its `planningPreparation` Task.

The old root JSX files remain unmodified for comparison. They are not a production entry and no DEV demo entry is created in Phase 1, so they cannot connect to the formal IndexedDB or user statistics. This avoids both a destructive cleanup and accidental reuse of prototype facts.

## Guarding

The production-entry test parses static and dynamic imports with the TypeScript syntax tree, rejects non-static dynamic imports and CommonJS loading, and walks every project-local UI dependency reachable from `main.jsx`. A reachable module may leave `src/ui` only through the exact `src/data/index` public boundary; unresolved or other project-local routes fail the guard instead of being ignored. The same AST guard rejects legacy scripts, state/storage access, statically named old Task aggregates (including computed property syntax), and prohibited timer paths. The single-ID guard also rejects `node:crypto` `randomUUID` named/destructured imports and bare calls, closing the recovered S2 review Minor while preserving `newId()` as the sole UUID v7 source.
