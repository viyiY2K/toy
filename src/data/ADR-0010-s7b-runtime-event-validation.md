# ADR-0010: S7b runtime Event validation

## Scope

S7b completes phase1-plan S7 by validating unknown runtime input against v4 §3.4 and
all payload schemas in §7.1–§7.18.

## Decisions

- `EVENT_TYPES` remains the canonical event-name list from S7a. Runtime payload and
  top-level-association tables are both compile-time required to contain one entry for every
  `EventType`; tests also compare their runtime keys and exercise every entry.
- Payload objects use exact-key validation. All v4 fields are required except the explicit
  Phase 1 `task.deleted.deletedReason` exception; `triage.movedToList` is the only empty schema.
- Scalar rules reuse the S6 UUID v7, offset-time, date, integer, finite-number, and local-date
  primitives. Event-specific enums, nested shapes, conditional fields, and no-op changes are
  validated by the corresponding runtime schema.
- Each event type declares required and optional top-level entity associations. Undeclared
  associations must be null. Every non-null top-level association must resolve through the
  transaction-visible `ValidationContext`, including entities being created in the same future
  S8 transaction.

## Boundary

This unit validates one fully shaped Event before append. It does not append Events, expose an
Event update/delete path, create IndexedDB transactions, or record validation failures as
`error.*`; those integration concerns remain S8/S12.
