# ADR-0025: Phase 2 S4a standard break exits

## Decision

A completed standard focus has one open standard-break opportunity until one of two explicit user actions closes it: create a short/long break Session, including an immediately skipped Session, or append a `dayPlan.workEnded` anchor for that focus. Both the current timer query and the new-focus guard treat either closure as final.

Skipping before a break starts creates a valid `shortBreak` or `longBreak` Session directly in `skipped` status. Skipping an active same-runtime break updates that Session to `skipped`. Both paths set `endedAt` to the command time, `actualDuration=0`, and `skipKind='explicitSkip'`, then append a mirrored `break.skipped` Event in the same transaction. Cadence remains based on the global visible completed standard-focus ordinal, so every `Settings.longBreakEvery` opportunity is a long break regardless of Task.

An active break with a pending recovery interval cannot use the ordinary skip command. Recovery remains owned by `interval.sessionResolved`; a recovered skipped break uses `skipKind='missed'` and never appends `break.skipped`.

Explicit work end appends `dayPlan.workEnded` for a completed focus and creates no break Session. Its Event associates the current DayPlan, source focus, and source Task, and stores the current derived `appDate`, Event-matching `localDate`, and `reason='userEndedWork'`. It is never inferred from inactivity, reload, close, or a missing next action.

## Scope

This decision covers Phase 2 S4a and checklist E1–E14. It adds data commands, query/guard recognition, and direct tests only. It does not add UI, automatic skip/work-end behavior, notifications, prompts, or change the recovery model.
