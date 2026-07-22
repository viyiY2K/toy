# ADR-0024: Phase 2 S3a Task lifecycle boundary

## Decision

Manual completion, uncompletion, completed-task archival, and activity-list reorder are exposed as validated atomic commands. Manual completion snapshots only visible `focus` Sessions whose status is `completed`; discarded, active, extra-focus, break, and soft-deleted Sessions do not count. It never creates a Session.

Uncompletion restores only an unarchived `completed` Task to `active` and clears its current completion fields while preserving the append-only completion history. Completed-task archival preserves those completion fields, writes `outcome='completed'`, and removes the Task from the current DayPlan in the same transaction when necessary. The archive and DayPlan removal Events share one correlation id.

Activity-list reorder changes Task sort indexes and emits one `task.reordered` Event for the dragged top-level Task. It uses an integer between adjacent indexes when possible and normalizes the current activity list only when no integer gap remains. It never changes `DayPlan.taskIds`; today's existing reorder command remains the sole owner of that array order.

The current Task query exposes every visible `completed` Task in a dedicated current-completed collection. Current-DayPlan members keep DayPlan order, followed by non-DayPlan completed Tasks in activity-list order. Archived and deleted Tasks are excluded while their stored entities and Events remain available as history.

## Scope

This decision covers Phase 2 S3a and checklist D1–D16. It does not add lifecycle UI, split/subtask/triage behavior, archived-task restoration, batch actions, historical management, or new data fields and Events.
