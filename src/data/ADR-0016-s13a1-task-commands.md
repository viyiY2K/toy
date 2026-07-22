# ADR-0016: S13a-1 Task and DayPlan commands

## Decision

Phase 1 user-triggered Task and today's-list mutations are exposed as explicit command functions. Every command re-reads its affected records inside `executeAtomicWrite`, persists the v4 entity change, and appends the exact corresponding Event or Event pair in the same transaction.

Manual creation writes the first total-estimate round. Creating directly into today emits `task.created` plus `dayPlan.taskAdded` and deliberately does not emit `task.movedToToday`; that latter Event is reserved for moving an existing Task. Today membership and ordering mutate only `DayPlan.taskIds`. Activity-list deletion is a Task tombstone plus `task.deleted` and refuses a Task still in the current DayPlan.

## Scope

This sub-unit covers S13 A1/A2 except pomodoro-driven completion, which remains coupled to the Session command sub-unit. It does not implement manual completion, triage, split/archive, P2 DayPlan management, UI integration, or legacy writes.
