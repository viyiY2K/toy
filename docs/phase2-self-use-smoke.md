# Phase 2 Core Self-Use Smoke

This runbook repeats the Phase 2 core-self-use acceptance flow without changing data truth or enabling deferred behavior. It follows `docs/data-layer-spec-v4.md`, `docs/phase2-plan.md`, and `docs/phase2-checklist.md`.

## 1. Run metadata

Record before each run:

- Date/time and timezone:
- Branch and exact commit:
- Browser and viewport:
- Origin/port and whether its IndexedDB is fresh or retained:
- Operator:
- Existing user data that must be preserved:

Use a fresh origin for destructive/recovery experiments when existing self-use data must remain intact. Never clear a user's retained origin merely to make the smoke easier.

## 2. Automated preflight

From the repository root, run:

```sh
/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run
/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build --outDir <temporary-directory>
git diff --check
```

Expected: all tests pass, typecheck passes, production build passes, and diff-check is clean. This repository has no lint script; record that fact rather than inventing a lint result. Delete the exact temporary build directory after verification.

## 3. Browser smoke

Keep Developer Tools Console open. For each write, verify the visible result first, then reload where specified. Record any warning/error rather than dismissing it.

### A. Initialization and planning

1. Open the production entry on the chosen origin.
2. Confirm one Settings record and one current-appDate DayPlan are initialized; reload and confirm the template Task is not duplicated.
3. Open the existing estimate modal.
4. Set a work window; add, update, and remove one fixed deduction and one life deduction.
5. Confirm free time plus conservative/optimistic estimates; accept conservative, optimistic, and manual budgets in separate observations.
6. Create a today Task and verify “余 N” changes from Session-derived capacity; allow and visibly label a negative overload.
7. Reload and confirm the budget, deductions, Task membership, and capacity persist.

### B. Task lifecycle and ordering

1. Create one activity-list Task and one today Task.
2. Edit title and estimate, move a Task between list/today, and reorder today Tasks.
3. Reorder activity-list Tasks; reload and confirm both order facts persist independently.
4. Manually complete a list Task, undo completion, complete again, and confirm archive.
5. Repeat completion/uncompletion/archive for a today Task and confirm archive removes its DayPlan membership.
6. Soft-delete a disposable active Task through the existing UI; do not physically delete its record.
7. Confirm manual and pomodoro completion labels remain distinct.

### C. Focus, awareness, and normal rest

1. Explicitly submit day-start energy and start a focus for a today Task.
2. Record one internal and one external interrupt; confirm the counters derive from Events.
3. Complete a focus through the normal timer path when practical; otherwise use the documented recovery confirmation path and record that distinction.
4. Explicitly submit after-focus energy.
5. Start the offered short break, select a final rest item, let it naturally reach `00:00`, and choose “完成休息”.
6. Confirm `Session.actualDuration` equals the submitted/normal timer fact, `actualRest` equals the final selection, and the matching `break.completed` payload mirrors both.
7. Explicitly submit after-short-break energy and confirm it links to the same break Session.
8. Repeat completed focuses until the fourth global completed standard focus; confirm the offered break is longBreak regardless of Task.

### D. Explicit standard-flow exits

1. After a completed focus with no break Session, click “跳过休息”.
2. Confirm a skipped short/long Session exists with `actualDuration=0`, `skipKind=explicitSkip`, and one mirrored `break.skipped`; confirm the next focus can start.
3. After another completed focus, click “今日收工”.
4. Confirm `dayPlan.workEnded` points to that focus, no break Session/`break.skipped` was created, and the pending opportunity does not return after reload.
5. Start a standard break and click “提前结束休息” before zero.
6. Confirm the same Session becomes skipped/explicitSkip and has `break.started → break.skipped`.

### E. Reload and recovery

1. Start a focus, fully reload, and confirm the app routes directly to `appReopened` recovery without ordinary timer write buttons or automatic completion.
2. Submit explicit original-Session result plus ignored remainder; confirm one transaction/correlation and return to normal flow.
3. Repeat with one extraFocus classification linked to an existing Task.
4. Repeat with one extraRest classification using a valid rest item or null.
5. Start a break, reload, and resolve it as not performed; confirm `status=skipped`, `actualDuration=0`, `skipKind=missed`, `interval.sessionResolved`, and no `break.skipped`.
6. In an ordinary browser, hide a same-runtime Session before planned end and return before the boundary; confirm it continues.
7. Repeat and return after crossing planned end; confirm `systemRecovered` appears and no standard result is inferred.

## 4. Data and red-line checks

For representative operations, inspect IndexedDB or a temporary same-origin read-only page:

- Events remain append-only and correlation ids group composite writes.
- Syncable entities use tombstones rather than physical deletion.
- `appDate` drives product-day truth; `localDate` remains a fact date.
- Session duration consumers use `actualDuration`, never recomputed wall-clock differences.
- No legacy storage, demo aggregate, old field, or dual-track write is reachable from production.
- No P3 statistics UI, notification/prompt behavior, cloud/sync, backup/restore, or redesigned navigation appears.

## 5. Completion and cleanup

1. Reload once more and confirm the intended final state persists with no active or pending recovery unless deliberately retained for a follow-up.
2. Remove only disposable smoke Tasks/deductions through supported UI/commands. Do not erase audit Events or clear the database.
3. Confirm application Console has zero warnings/errors. Tool/plugin telemetry errors are recorded separately and are not silently treated as application logs.
4. Confirm temporary pages, build directories, and test services are removed/stopped.
5. Record the run in `docs/phase2-self-use-log.md` and link any bug to exact Session/Event/entity evidence.

The Phase 2 closeout run and exact reviewed commit are recorded in `docs/phase2-review-log.md`. Subsequent self-use runs append observations to the log below; they do not expand Phase 2 scope automatically.
