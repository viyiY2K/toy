# ADR-0009: S7a static Event contract

## Scope

S7a implements the compile-time half of v4 §7 and checklist H / I-1–I-10:

- one canonical `EVENT_TYPES` tuple containing all 78 event names;
- `EventType`, `EventPayloadMap`, `EventOf<T>`, and the full discriminated `EventContract` union;
- generic `Event<T>` / `MakeEventInput<T>` so event type and payload cannot drift at call sites;
- compile-time and runtime-list tests for missing, extra, and removed event shapes.

## Decisions

- Every payload field listed in §7 is represented. Generic `field` / `oldValue` / `newValue`
  events retain `unknown` values because v4 intentionally allows multiple entity-field shapes.
- `triage.movedToList` is the only empty-payload event and the only factory input whose payload
  may be omitted. All other event payloads are compile-time required.
- Conditional payload rules such as prompt type/context are represented as payload unions where
  v4 defines a direct relationship.

## Boundary

S7a does not perform runtime validation. Exact runtime keys, scalar constraints, cross-record
references, and top-level association rules are S7b. Persistence and atomic event/entity writes
remain S8.
