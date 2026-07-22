# ADR-0029: Phase 3 S2a task-management UI

The existing list page remains the single task-management surface. Top-level today order still
comes only from `DayPlan.taskIds`; top-level activity order remains `Task.sortIndex`; each child
list renders from its own `subtasksByParentId[parentId]` sibling domain. Child up/down controls
therefore call only `reorderSubtask`, while top-level drag behavior is unchanged.

A minimal task-detail modal owns active `note`, completed/archived `actualWorkNote`, child creation,
top-level-to-child selection, child promotion, and lifecycle actions. Current children are rendered
under their visible parent. Current children whose parent is not in any current top-level section
are shown in a separate "待整理子任务" section so retained or restored records never disappear
silently. Deleted Tasks remain absent.

Detached children keep lifecycle, title, estimate, detail, and promote actions, but hide sibling
reorder because their parent cannot satisfy `reorderSubtask`. Indent eligibility treats archived
children as retained hierarchy, matching the command's two-level guard. The detail modal exposes
the remaining legal estimate rounds (1–7), traps Tab focus, closes on Escape, and restores focus;
title editing uses a keyboard-focusable button.

Archive history is a derived view of `archivedTasks` only. It shows persisted outcome, archive time,
completion source, notes, and lineage hints, and delegates restore to `restoreArchivedTask`; it does
not expose deleted restore. Split, triage, and batch interactions remain deferred to S2b, and the
statistics navigation remains unchanged in this unit.
