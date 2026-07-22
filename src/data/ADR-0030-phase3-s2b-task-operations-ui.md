# ADR-0030: Phase 3 S2b task operations UI

Split remains an explicit action in the task-detail modal. The user supplies one child title and
estimate, then the UI delegates the full archive/lineage/Event transaction to `splitTask`; it never
constructs or mutates lineage data itself. The resulting archived source remains visible in history,
while the single `splitChild` returns through the existing active or detached hierarchy views.

Quick triage capture is rendered only while `canCaptureTriage` confirms an active standard focus
owned by the current runtime and no pending recovery exists. Capture leaves that focus active. The
task page keeps pending triage separate from activity and today collections and exposes exactly the
three command-backed exits: move to today, move to activity list, and dismiss by soft deletion.

Batch mode exposes only candidates returned by the current derived views: top-level activity Tasks
for add-to-today, active top-level today Tasks for move-to-list, and all current completed Tasks
(including children) for archive. Each selection is passed in stable user selection order to the
S1c commands and is reconciled whenever the legal candidate domain changes. The UI explicitly says
that each Task is its own atomic transaction, displays each failed Task and message plus every
not-attempted Task through a live result region, and selects those IDs for retry. It does not imply
cross-Task all-or-nothing behavior.

Split lineage is displayed from retained Task facts in both directions: an archived split source
names its successor, while a successor names `splitFromTaskId`'s source. This presentation remains
derived and reload-stable; the UI does not persist a separate history relationship.

This unit does not add batch completion/deletion, cross-parent movement, notification or prompt
analysis, statistics, deleted restore, a schema migration, or any external dependency.
