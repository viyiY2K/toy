# ADR-0032: Phase 3 S3b Task, energy, interrupt, and budget statistics

`loadStatsDashboard` is the single read-only persisted query for S4. It reads all visible fact
stores, builds one appDate range, and composes S3a Session metrics with pure S3b derivations. It
does not initialize the current day, write a cache, mutate retained records, or store any aggregate.

Task focus counts and time come only from visible Session facts. Range focus is the Task's new
focus in the selected period; historical valid focus is an all-time detail. Completion counts come
from range-owned `task.completed` Events whose Task is still visible. Estimate samples require a
pomodoro completion, a numeric completion snapshot, a visible Task, and at least one estimate
round. Accuracy requires exactly one round equal to the first estimate. Values below/above the
first estimate are over/under; a multi-round completion that returns to the first value remains an
explicit adjusted-inaccurate sample rather than being mislabeled accurate.

Energy timelines retain every visible range record in occurredAt order and derive HH:mm in the
record's timezone. Daily trend points preserve sample count and use null for an empty day's average.
Recovery samples join completed standard break → visible completed source focus → exactly one
visible `afterFocus` record and exactly one visible matching after-break record. A missing,
soft-deleted, or ambiguous link yields a missing sample, never zero. `recoveryDelta` remains only in
the returned sample; it is never written to EnergyRecord. Activity summaries exclude null activity
keys while short/long overall summaries retain those breaks.

Interrupt totals use the Event's appDate and require an existing visible standard focus; completed
and discarded focus events both contribute. Per-valid-pomodoro averages instead anchor the range
to visible completed focus Sessions and join all their interrupt Events, so discarded focus is
excluded from the numerator and denominator. Four-hour distribution uses each Event's retained
timezone and occurredAt. Empty denominators return null.

Budget usage matches visible DayPlan by its stored appDate business key and divides all visible
completed standard focus Sessions for that appDate by `budgetPomodoros`. Missing, soft-deleted, or
zero-budget plans return null; a valid nonzero plan with no completed focus returns zero.

This unit does not add mood, task lifecycle/operations analytics, Session review data, UI, caches,
schema changes, or writes.
