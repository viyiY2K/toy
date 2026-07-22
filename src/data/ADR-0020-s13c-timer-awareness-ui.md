# ADR-0020: S13c standard timer and awareness UI migration

## Decision

The production timer page now derives its state from v4 Task, Session, EnergyRecord, and Event facts through `loadCurrentTimerViews`. It invokes only the reviewed S13a commands for standard focus/break transitions, pomodoro-driven Task completion, explicit energy submissions, and active-focus interrupts. Countdown display may be reconstructed from `startedAt`, but every write passes an explicit duration fact: scheduled completion uses the Session's `plannedDuration`, and user discard uses the UI timer's elapsed value. No data-layer code calculates `endedAt - startedAt`.

Focus completion is one operation and the subsequent energy submission is a separate user action, so they intentionally use separate transactions and correlation IDs. Break completion is also a distinct confirmation action and writes the user's final `actualRest` key, or null when no item is selected. Only enabled Settings suggestions matching the break type are shown.

Post-session energy prompts are transient UI flow state, not inferred forever from the absence of an EnergyRecord. The user may skip them without writing a record, exactly as §7.9 requires. App-level visibility tracking classifies a long page return as `onReturn` from any page; an initial reload with a stale same-day energy record is also classified as `onReturn`, while an uninterrupted long gap before focus remains `beforeFocus`.

Only Sessions successfully started during the current App runtime are eligible for the standard completion, discard, interrupt, and actual-rest controls. If initial load or a later read finds an active Session not registered by this runtime, the timer renders a read-only recovery-required notice and performs no normal Session/Event write. Phase 1 deliberately does not infer how an App-close or lost-timer interval ended; UnresolvedInterval detection, `interval.sessionResolved`, and the recovery UI remain Phase 2 work.

## Scope boundary

The page exposes standard focus/shortBreak/longBreak only. It has no pause fact, production fast-forward, `break.skipped`, extra/recovery Session, restItem process Events, custom rest-item editing, subtasks, triage, full planning, Settings editing, or statistics. Timer state is React display state plus persisted v4 facts; it never reads or writes the legacy `pomo-state` or aggregate Task fields. Existing stylesheet classes and layout are reused without modifying `styles.css`.
