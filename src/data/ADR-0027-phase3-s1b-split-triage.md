# ADR-0027: Phase 3 S1b split and triage transactions

Task split archives the source with `outcome='split'`, creates exactly one active successor with
the same `parentId` and lineage, and appends the three v4 `task.*` Events under one correlation.
The successor keeps the source sibling position but is not automatically added to today. If the
source was in the current DayPlan, the same transaction removes it and appends
`dayPlan.taskRemoved(reason='taskArchived')`. Split indexes are allocated from all retained
lineage Tasks, including soft-deleted history, so an index is never reused.

Triage capture is available only during an active standard focus. It creates a top-level active
Task with estimate 1 and `metadata.triageStatus='pending'`; the new Task and `task.created` /
`triage.captured` Events are atomic while the focus remains unchanged. Processing clears pending
state and either adds the Task to today, exposes it in the activity list, or soft-deletes it with
`deletedReason='triageDismissed'`. Dismiss always appends both `triage.dismissed` and
`task.deleted` under one correlation. No interrupt Event is implied.
