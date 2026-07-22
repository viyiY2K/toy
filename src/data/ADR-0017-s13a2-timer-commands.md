# ADR-0017: S13a-2 standard timer commands

## Decision

Standard focus and break transitions are explicit atomic commands. Starting a focus snapshots the current Settings duration, assigns the next Task-local `pomodoroIndex` from historical Session indexes (including discarded/tombstoned history), and links the current appDate DayPlan. Completion and discard accept `actualDuration` as an explicit fact; they never derive it from timestamps.

Each completed focus receives one standard break opportunity. Break type follows the ordinal of that focus in the global effective completed-focus sequence: every fourth is `longBreak`, the others are `shortBreak`. Break completion stores the final `actualRest` key or null in both Session and Event. Pomodoro Task completion is a separate user-confirmation command and derives `validFocusCountAtCompletion` from completed standard focus Sessions.

## Scope

No production `break.skipped` command is exported. Extra sessions, recovery intervals, prompt/rest-item process Events, timer UI, energy, and interrupts remain outside this sub-unit.
