# ADR-0015: S10 current task views

## Decision

`loadCurrentTaskViews(clock)` first runs the S11 current-product-day initializer and then derives the three Phase 1 task views from the persisted v4 entities:

- today: the effective Tasks named by the current `DayPlan.taskIds`, in that exact array order;
- active list: effective Tasks with `status` in `active | splitNeeded`, absent from today's ids, and not pending triage;
- pending triage: effective `active` Tasks whose `metadata.triageStatus` is `pending`.

Non-DayPlan lists sort by `Task.sortIndex` with id as a deterministic tie-breaker. Default dataStore reads supply the S9 tombstone filter.

## Scope

This query does not persist a `bucket` or `appDate` on Task, compute §8 statistics, write business Events, or implement P2 DayPlan behavior. No IndexedDB index is added: Phase 1 needs the complete effective Task set to derive all three views, so an index would not remove the scan or simplify the truth rules.
