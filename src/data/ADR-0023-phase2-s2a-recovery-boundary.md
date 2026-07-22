# ADR-0023: Phase 2 S2a recovery envelope and atomic resolution

## Decision

On 2026-07-21 the user selected recovery policy A. For an active standard Session detected after runtime continuity is lost, the persisted UnresolvedInterval is the conservative evidence envelope `[Session.startedAt, detectedAt]`. No inferred close, sleep, or nominal timer-end timestamp is promoted to truth.

Recovery requires explicit user input for the original Session outcome and its `actualDuration`. For completed/discarded focus and completed break, the persisted `endedAt` is `startedAt + input actualDuration`; `actualDuration` remains the input fact and is never recalculated from stored timestamps. Recovered skipped break follows v4 exactly: confirmation-time `endedAt`, `actualDuration=0`, and `skipKind='missed'`.

The minimal optional extra Session starts at the original Session's confirmed duration boundary and uses another explicit positive duration. Its end must remain within the recovery envelope. For a skipped break the zero-duration coverage boundary is the original `startedAt`, even though the break's audit `endedAt` is the later confirmation time. Ignore creates no extra Session. Layer 1 and Layer 2 entity/Event writes share one transaction and correlation.

## Scope

S2a supports `appReopened` and `systemRecovered`, one original active standard Session, and one ignore/extraFocus/extraRest remainder. It does not add UI, infer behavior, split into multiple extra segments, create Tasks/rest items, or accept arbitrary historical manual entries.
