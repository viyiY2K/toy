# ADR-0018: S13a-3 awareness commands

## Decision

`recordEnergy` is the only Phase 1 product write for EnergyRecord. It accepts the currently triggered standalone sources (`dayStart`, `beforeFocus`, `onReturn`) and completed standard-session sources (`afterFocus`, `afterShortBreak`, `afterLongBreak`), fixes mood to null, and atomically writes `energy.recorded`. Session-backed events carry the stable Task/DayPlan context when it can be derived.

`recordInterrupt` appends `interrupt.internal` or `interrupt.external` only while its standard focus remains active. It does not mutate Session or persist a counter/array; counts remain Event-derived.

## Scope

The product command surface does not expose manual or after-extra energy sources, EnergyRecord edits/deletes, interrupt-derived automatic discard, triage, prompt, or UI behavior. A separately submitted energy response is its own business operation and correlation; UI integration must use a single combined transaction if it defines Session completion and energy submission as one operation.
