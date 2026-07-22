# ADR-0026: Phase 3 S1a task hierarchy and archived restore

Task remains the only task entity. Direct children reuse `Task.sortIndex`, interpreted only
inside one `parentId` sibling domain; top-level activity order and each parent domain never
compare indexes. `DayPlan.taskIds` continues to contain/order top-level today Tasks only.

Creating a child appends `task.created(source='manual')` and `subtask.added` in one atomic
transaction. Moving a top-level today Task under a parent first removes its DayPlan membership
with the existing correlated DayPlan/Task events, then appends `task.reparented` in that same
transaction. Promotion appends `subtask.unparented` and does not auto-add the Task to today.

Archived restoration is the one user-authorized early P4 capability. A completed archive returns
to `completed` and preserves completion facts; a split archive returns to `active` with null
completion facts. Both clear `outcome`/`archivedAt` and append `task.restored` without changing
old Events. Deleted restoration and cross-parent child movement remain out of scope.
