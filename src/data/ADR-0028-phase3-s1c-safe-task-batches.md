# ADR-0028: Phase 3 S1c safe Task batches

Phase 3 exposes only three batch actions: add eligible top-level activity Tasks to today, move
eligible today Tasks back to the activity list, and archive completed Tasks. Every action first
copies the requested id order and performs one read-only preflight across the whole selection.
Empty, duplicate, missing, deleted, or ineligible inputs fail with structured issues and no
initialization or business write.

After preflight, each Task delegates to the corresponding reviewed single-Task command in input
order. Each successful item therefore keeps its own atomic entity/Event transaction and
correlation id. The batch stops on the first runtime failure, preserves earlier successful items,
and returns ordered `succeeded`, `failed`, and `notAttempted` details for explicit UI reporting and
retry. There is deliberately no cross-Task all-or-nothing transaction and no invented batch Event.

Moving to the activity list does not rewrite `Task.sortIndex`: v4 §7.4 states that
`task.movedToList` does not modify Task fields. The existing top-level `sortIndex`, with id as the
stable tie-break, remains the activity-order fact. Batch manual completion, batch soft deletion,
and batch UI are outside this unit.
