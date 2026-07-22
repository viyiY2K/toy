# ADR-0022: Phase 2 S1a DayPlan budget domain

## Decision

`calculateDayPlanEstimate` is the sole implementation of the v4 §3.2 budget formula. It converts all deduction hours to minutes, rounds only the final free-minute result, clamps that result at zero, and returns the formula's conservative and optimistic estimates without imposing an ordering constraint that v4 does not define.

DayPlan budget commands initialize the current `appDate`, update DayPlan and append their matching Event in one atomic write. Editing the work window or deductions immediately refreshes the stored estimate. `dayPlan.budgetEstimated` records an explicit estimate-display action; `dayPlan.budgetAccepted` persists the selected mode and user-adjustable budget. The P3 `dayPlan.budgetModeChanged` behavior remains reserved.

Current task views derive standard-focus facts from visible `Session` records. A valid pomodoro is exactly a `focus` Session with `status = completed`; today's count derives `appDate` from the Session's `startedAt`, its persisted timezone, and the current app-day offset. Per-task remaining estimate is clamped at zero, while DayPlan capacity remains signed so over-planning is visible.

## Scope

This sub-block adds data-layer calculation, DayPlan commands, task-view capacity projections, tests, and public exports. It does not add DayPlan UI, recovery classification, statistics aggregates, task lifecycle changes, or P3/P4 behavior.
