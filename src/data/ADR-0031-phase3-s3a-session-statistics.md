# ADR-0031: Phase 3 S3a Session and break statistics

Statistics remain a read-only derived layer. `loadSessionStats` reads visible Session, Event, and
the singleton Settings record, then delegates to pure aggregation; it does not initialize a day,
write a cache, or persist a result. Day/week/month ranges are calendar ranges over derived
`appDate`, with Monday as the first day of a week. Session membership always derives appDate from
`startedAt`, the Session's retained timezone, and the current Settings offset.

Focus time uses only `actualDuration`. Completed standard focus, extraFocus, and discarded standard
focus are kept as separate components; total and lifetime focus time sum those components without
turning extra/discarded time into pomodoro outcomes. Complete cycles require a visible completed
standard focus and its visible completed standard break. A linked skipped break or a later standard
focus starting before a delayed break closes the earlier opportunity; extraFocus does not. Cycle
range ownership follows the source focus appDate, while break counts and durations follow each
break Session's own appDate.

Expected-break denominators start from completed standard focuses whose appDate is in the target
range. A valid `dayPlan.workEnded` anchor exempts only a focus with no visible completed or skipped
standard break. Long-break cadence uses the retained global completed-focus sequence and
`longBreakEvery`; completed/skipped numerators remain break-appDate facts. Missing is the positive
remainder after completed and all four skipped kinds, and every ratio is null when its denominator
is zero.

Lifetime complete pomodoros add `lifetimePomodoroBaseline` only to the all-time complete-cycle
count. The baseline never changes range, focus, rest, or trend metrics. Soft-deleted Sessions are
excluded both by the public store and defensively by the pure aggregator. Ignored unresolved
intervals have no generated Session and therefore contribute nothing.

This unit does not implement Task, EnergyRecord, interrupt, or DayPlan-budget statistics; UI,
caching, schema changes, and any write path remain outside S3a.
