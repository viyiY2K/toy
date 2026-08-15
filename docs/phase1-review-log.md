# Phase 1 Review Log

This Git-tracked log preserves the implementation and review history of each Phase 1 S step or independently verifiable sub-block. It supplements Git history; it does not override `docs/data-layer-spec-v4.md`, `docs/phase1-plan.md`, or `docs/phase1-checklist.md`.

## Entry template

### Sx / optional sub-block name

- Status: `PASS` / `NEEDS FIX` / `BLOCKED`
- Scope: concise description of the completed unit.
- Commit: final local commit hash and subject.
- Specification: relevant v4 sections, plan step, and checklist items.
- Verification: commands run and their results, or why a project command was unavailable.
- Review: reviewer verdict and whether the next unit may proceed.
- Findings and resolution: `None`, or each finding with its repair and re-review outcome.
- Residual risk or user decision: `None`, or a concise description.

## Recovery verification (S0–S5 current state)

The entries below audit the implementation currently present in recovery baseline
`86ccf2d44eb1226832d83c73ba5d35ade6f0d87b`. That commit is a restored-workspace
snapshot spanning multiple steps and repository content; it is not, and must not be
read as, a reconstruction of the lost atomic S0–S5 commit history.

### S0–S4 / recovered implementation audit

- Status: `PASS`
- Scope: Read-only verification of S0 scaffolding, S1 dataStore/IndexedDB skeleton, S2 UUID v7 single source, S3 timezone/localDate/appDate helpers, and S4 schemaVersion/legacy conventions.
- Commit: `86ccf2d44eb1226832d83c73ba5d35ade6f0d87b chore(recovery): capture restored workspace baseline` (recovery snapshot, not original S-step commits).
- Specification: v4 §2.1–§2.5; phase1-plan S0–S4; checklist A and the shared identity/time/version requirements used by B–H.
- Verification: bundled Node ran `node node_modules/vitest/vitest.mjs run` → 14 files / 81 tests passed; `node node_modules/typescript/bin/tsc --noEmit` → passed; repository provides no lint script.
- Review: Independent read-only Reviewer verdict `PASS` for S0, S1, S2, S3, and S4; S5 verification and then S6 may proceed.
- Findings and resolution: One non-blocking Minor: `src/data/single-id-source.test.ts` does not yet detect direct `randomUUID` imports/bare calls from `node:crypto`; current production source has no violation. Scheduled for the Phase 1 S14/closeout guard tightening without interrupting S6.
- Residual risk or user decision: Lost historical commits remain intentionally unreconstructed. No user decision required.

### S5 / recovered implementation audit

- Status: `PASS`
- Scope: Read-only field-by-field verification of all seven entity schemas, nested structures, defaults, nullability, synchronization reservations, timezone/localDate placement, and built-in Settings seeds.
- Commit: `86ccf2d44eb1226832d83c73ba5d35ade6f0d87b chore(recovery): capture restored workspace baseline` (recovery snapshot, not original S5 commits).
- Specification: v4 §2.3–§2.5 and §3.1–§3.7; phase1-plan S5; checklist A–H.
- Verification: bundled Node ran `node node_modules/vitest/vitest.mjs run` → 14 files / 81 tests passed; `node node_modules/typescript/bin/tsc --noEmit` → passed; repository provides no lint script.
- Review: Independent read-only Reviewer verdict `PASS`; no S5 reconciliation source changes are required and S6 may proceed.
- Findings and resolution: None. Event `type` and `payload` remain deliberate S5 placeholders; the full EventType/payload contract is S7 scope.
- Residual risk or user decision: Lost historical commits remain intentionally unreconstructed. No user decision required.

### Recovery workspace protection

- The user-owned unstaged deletions under `docs/Draft/` and `docs/ai-context/` were not restored, staged, committed, reclassified, or included in either review.
- The recovery baseline remains the ancestor from which new Phase 1 work continues. No second recovery baseline was created.

## New implementation units after recovery

### S6a / common primitives plus Task and DayPlan validation

- Status: `PASS`
- Scope: Added structured validation issues/errors, exact runtime shape and Phase 1 common-field validation, a transaction-aware `ValidationContext`, and strict Task/DayPlan write validators with positive and negative tests. Event validation and the remaining four syncable entities are outside this sub-block.
- Commit: `43f9eced7821d6b6f8048f499d2dc57991b95aaf phase1(S6a): validate Task and DayPlan writes`.
- Specification: v4 §2.2–§2.5 and §3.1–§3.2; phase1-plan S6 Task/DayPlan sub-block; checklist A–C.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 17 files / 133 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check` → passed; repository provides no lint script.
- Review: Independent read-only Reviewer first returned `NEEDS FIX` for candidate `fbdba81`; after amendment, the same Reviewer returned `PASS` for exact final commit `43f9eced7821d6b6f8048f499d2dc57991b95aaf` and confirmed S6b may proceed.
- Findings and resolution: (1) ISO timestamps could accept normalized impossible dates; fixed with explicit calendar/time/UTC-offset bounds and edge tests. (2) DayPlan creation facts were not immutable on update; added prior-record lookup and immutable timezone/localDate/appDate checks. (3) Task current estimate and lineage relations were incomplete; tied the current estimate to the latest round and enforced original/split lineage. (4) Task status checks were one-way; completed the reverse outcome/completion/archive/delete state matrix. Re-review closed all four Major findings with no new findings.
- Residual risk or user decision: None. Cross-record checks deliberately require transaction-aware lookup capabilities; S8 must supply a context that sees pending writes in the same transaction.

### S6b / Session, EnergyRecord, UnresolvedInterval, and Settings validation

- Status: `PASS`
- Scope: Added strict runtime write validators and direct tests for the remaining four syncable entities, including Session's complete type/status field matrix and transaction-visible references, EnergyRecord source-to-Session rules, UnresolvedInterval time/state rules, and Settings singleton/nested-array/key-retention rules. Event validation remains S7 scope.
- Commit: `424b878152fc368df66f5c78e7afb82adba2fc6b phase1(S6b): validate remaining entity writes`.
- Specification: v4 §2.2–§2.5, §3.3, §3.5–§3.7; phase1-plan S6 remaining-entity sub-block; checklist A and D–G.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 21 files / 194 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check` → passed; repository provides no lint script.
- Review: Independent read-only Reviewer first returned `NEEDS FIX` for candidate `c6a3584`; after amendment, the same Reviewer returned `PASS` for exact final commit `424b878152fc368df66f5c78e7afb82adba2fc6b` and confirmed S7 may proceed.
- Findings and resolution: (1) Invalid IANA timezone could leak an Intl `RangeError` during new standard Session appDate derivation; added a pre-derivation timezone guard and regression proving structured `timezone.iana` / `EntityValidationError` rejection. (2) Several explicit §3.3 negative matrix cases lacked direct tests; added skipped, extraFocus, extraRest, discarded, fixed-null, and invalid-timezone cases. The amendment also applied the planned Settings key-prefix × appliesTo guard to built-in and custom rest items. Re-review closed both Major findings with no new findings.
- Residual risk or user decision: None. `actualDuration` is validated only by its own null/zero/positive-integer rules and is deliberately never compared with timestamp differences.

### S7a / complete static Event contract

- Status: `PASS`
- Scope: Added the canonical 78-entry `EVENT_TYPES` tuple, `EventType`, the complete `EventPayloadMap`, distributive `EventOf<T>` / `EventContract`, and a fully discriminated generic `Event<T>` / `MakeEventInput<T>` factory contract. Runtime payload and top-level association validation remains S7b scope.
- Commit: `5f0dce46329da7aa1767d77bc0a260b4c5a20b87 phase1(S7a): define static event contract`.
- Specification: v4 §3.4, §6, and §7.1–§7.18; phase1-plan S7 static-contract sub-block; checklist H and I-1–I-10.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 22 files / 199 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; an exact generated comparison of §7 headings against `EVENT_TYPES` found no difference; `git diff --check` → passed; repository provides no lint script.
- Review: Independent read-only Reviewer first returned `NEEDS FIX` for candidate `5ef39c2073fdafde5db454b4ee871458080dc734`; after amendment, the same Reviewer returned `PASS` for exact final commit `5f0dce46329da7aa1767d77bc0a260b4c5a20b87` and confirmed S7b may proceed.
- Findings and resolution: The original `EventOf<T>` and bare/default `MakeEventInput<T>` did not distribute the complete type/payload pair over a union, allowing pretyped inputs to pair one event type with another event's payload. Both exported types were changed to distributive conditionals, with compile-time negative regression cases for union `EventOf`, bare `MakeEventInput`, and union-typed factory input. Independent compiler probing and re-review confirmed all three escape paths are rejected, with no new findings.
- Residual risk or user decision: None. S7a intentionally provides compile-time structure only; rejecting unknown runtime input, exact runtime payload keys/values, and illegal top-level associations is the declared S7b unit.

### S7b / strict runtime Event validation

- Status: `PASS`
- Scope: Added exact runtime validation for the full Event entity, all 78 payload schemas, event-specific top-level association rules, transaction-visible entity/Event references, and payload-to-entity consistency. Runtime tables and tests are guarded against omissions; append persistence and atomic business writes remain S8.
- Commit: `d67ff14a0b2ef8e14c0faa2b785fb881556d85c3 phase1(S7b): validate runtime event contracts`.
- Specification: v4 §3.4, §6, and §7.1–§7.18; phase1-plan S7 runtime-validation sub-block; checklist H and I-1–I-10.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 23 files / 209 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check` → passed; repository provides no lint script. Tests exercise every runtime schema with one valid case plus missing/extra/invalid-field negatives and direct cross-record contradiction cases.
- Review: Independent read-only Reviewer returned `BLOCKED` for candidate `e048ec82636b3837a082e29f216db0876cea29e8`, returned `BLOCKED` again for amended candidate `11e5b00dfee74e61589949f646bb0bca532c8f6c`, and finally returned `PASS` for exact final commit `d67ff14a0b2ef8e14c0faa2b785fb881556d85c3`, confirming S8 may proceed.
- Findings and resolution: The first review found that association checks proved only existence, Settings-backed rest/template rules were incomplete, `settings.initialized` was too permissive, fixtures could self-pass with empty objects, and inherited properties could impersonate required fields. The repair added per-domain Task/Session/DayPlan/EnergyRecord/UnresolvedInterval/Settings consistency, Settings membership/order/default-count checks, critical-field fixtures and contradiction tests, plus `Object.hasOwn` exact-key checks. The second review found residual conditional relations for pomodoro completion, focus-start estimate snapshots, rest selection results, energy/energy-prompt Session mapping, interval detection without a Session, and selectionChanged.previousKey. Those relations and direct negatives were added; final re-review closed all Blocking/Major/Minor findings with no new finding.
- Residual risk or user decision: None. Validation requires a transaction-visible `ValidationContext`; S8 must implement its getters so pending entity changes and Events in the same atomic operation are visible during validation.

### S8 / atomic entity and Event transactions

- Status: `PASS`
- Scope: Added `runAtomic(storeNames, work)` to the storage adapter and dataStore, with transaction-scoped `get/getAll/put/appendEvent`, one UUID v7 correlationId per business operation, Event insert-only enforcement, and IndexedDB transaction keep-alive through asynchronous callback gaps. S9 soft deletion/filtering and S12 validation/error-event write orchestration remain outside this unit.
- Commit: `0d0263866a53e48d68754180f87a06619d72bfa9 phase1(S8): add atomic entity event transactions`.
- Specification: v4 §3.4 key rules 5 and 8; phase1-plan S8; checklist H `correlationId` and the entity-plus-Event atomic-write acceptance requirement.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 24 files / 217 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check` → passed; repository provides no lint script. Direct fault injection covers callback failure, IndexedDB request/unique-key failure, undeclared-store access, correlation mismatch, and failure after an event-loop delay; all cases roll back without partial entity/Event writes.
- Review: Independent read-only Reviewer returned `PASS` for exact commit `0d0263866a53e48d68754180f87a06619d72bfa9` and confirmed S9 may proceed. Reviewer additionally ran the S8 transaction tests five consecutive times; all passed.
- Findings and resolution: None. Review confirmed one IndexedDB `readwrite` transaction contains the entity plus one/multiple Event writes, all transaction Events share the generated correlationId, request/work failures abort, Event remains append-only, and the transaction surface exposes no physical deletion.
- Residual risk or user decision: None. The public atomic mechanism deliberately does not yet perform write-validation or emit error Events; S12 owns that wrapper and will use the transaction-visible getters introduced here.

### S9 / soft deletion and default read filtering

- Status: `PASS`
- Scope: Added default tombstone filtering for all six syncable entity stores, explicit including-deleted reads, and transaction-scoped type-safe soft deletion. Task deletion also writes `status='deleted'`, advances `updatedAt`, accepts the v4 deletedReason enum, and clears current completion/archive fields that conflict with the deleted state; Event remains outside all deletion paths.
- Commit: `1971c1bbd1827684ef752c75c231560c34c054b3 phase1(S9): add soft delete filtering`.
- Specification: v4 §2.4 and §3.1 key rule 5 / field-consistency rule 3; phase1-plan S9; checklist A sync tombstones and B Task status/deletedAt/deletedReason requirements.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 25 files / 225 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check` → passed; repository provides no lint script. Directed tests cover all six stores, default versus explicit reads both inside and outside a transaction, Task field transitions, repeat-delete rejection, Event runtime/type guards, and atomic rollback when a related Event fails.
- Review: Independent read-only Reviewer returned `PASS` for exact commit `1971c1bbd1827684ef752c75c231560c34c054b3` and confirmed the next unit may proceed.
- Findings and resolution: None. Review confirmed tombstones remain physically present, Event has no deletion semantics, no IndexedDB physical delete/clear/remove implementation exists, and the change does not enter S10, S12, UI, or P2+ behavior.
- Residual risk or user decision: None. S12 will add write validation and error-event reporting around this already-atomic soft-delete primitive.

### S12 / validated atomic writes and sanitized error Events

- Status: `PASS`
- Scope: Added the public `executeAtomicWrite` business-write boundary, transaction-visible S6/S7 validation for all six syncable entities and Event, failure classification, independent best-effort `error.unexpectedState` / `error.dataWriteFailed` persistence, strict diagnostic context sanitization, and non-recursive console/in-memory fallback. The public dataStore facade is now read-only in both its TypeScript and runtime surfaces; raw transaction capabilities remain internal to the data layer.
- Commit: `112e36cfd7971ddb5d61fc276d6c08a73a737499 phase1(S12): record sanitized write errors`.
- Specification: v4 §7.17 and §9.3; phase1-plan S12 and D4; checklist I-10 `error.dataWriteFailed` / `error.unexpectedState` writeValidation acceptance.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 27 files / 237 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check` → passed; repository provides no lint script. Direct tests cover create/update/soft-delete/Event validation, all six validator routes, pending-reference visibility, poisoned transactions, IndexedDB failure rollback, validation/storage/business-error classification, context key/value whitelist, user-text exclusion, error-event persistence failure, and public raw-write API exclusion.
- Review: Independent read-only Reviewer returned `BLOCKED` for candidate `d8408e3` because the public barrel still exposed raw put/appendEvent/runAtomic capabilities. After amendment, the same Reviewer returned `PASS` for exact final commit `112e36cfd7971ddb5d61fc276d6c08a73a737499` and confirmed the next unit may proceed.
- Findings and resolution: The original wrapper correctly validated and reported writes, but callers could bypass it through the public dataStore object and exported raw transaction types. The repair split a runtime-independent read-only public facade from the internal store, removed StorageAdapter/raw transaction types and raw store from the public barrel, moved S1/S8/S9 direct tests to explicit internal imports, and added runtime plus compile-time public-boundary guards. Re-review closed the Blocking finding with no new findings.
- Residual risk or user decision: None. Only `detectedBy='writeValidation'` is implemented; startup/read scans, old-data repair, recovery UI, and diagnostic export remain intentionally absent.

### S11 / current appDate initialization

- Status: `PASS`
- Scope: Added the transaction-scoped Settings, DayPlan, and daily-template initialization helpers plus the combined `ensureCurrentAppDateInitialized` entry point. A fresh product day atomically creates the default Settings when needed, the current appDate DayPlan, and all auto-add daily template Tasks, including the first-position `planningPreparation` Task, with the four required Event kinds sharing one correlationId. Re-entry, concurrent entry, later product days, existing DayPlans, removed template Tasks, and Settings tombstones are handled without duplicate or misleading initialization writes.
- Commit: `f726b3ae70fac799c99f3d6d5af301b84288d4e3 phase1(S11): initialize current app date`.
- Specification: v4 §2.5, §3.1 rule 11, §3.2, §3.4 rules 5/8, §3.7 rules 2/6, §7.1 `task.created`, §7.3 `dayPlan.created` / `dayPlan.taskAdded`, §7.12 `settings.initialized`, and §10.2; phase1-plan S11 and D2; checklist B, C, G, H, I-1, I-2, and I-9 for the P1 initialization paths.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 28 files / 243 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check f726b3a^ f726b3a` → passed; repository provides no lint script. Direct tests cover concurrent empty initialization, same-day idempotency, next-day creation, an existing DayPlan, helper re-entry in one transaction, and a tombstoned Settings singleton.
- Review: Independent read-only Reviewer returned `PASS` for exact commit `f726b3ae70fac799c99f3d6d5af301b84288d4e3` and confirmed S10 may proceed.
- Findings and resolution: None. Review confirmed the default 25/5/15/4 Settings and built-in seed counts, appDate derivation, four-field DayPlan snapshot, planning Task contents/order, exact initial Event chain, atomic correlation, idempotency, user-removal preservation, tombstone behavior, validated write boundary, and strict S11 scope.
- Residual risk or user decision: None. This unit intentionally does not implement full P2 DayPlan management, statistics, or UI behavior.

### S10 / current task derived views

- Status: `PASS`
- Scope: Added `loadCurrentTaskViews`, which first guarantees the S11 current-product-day initialization and then returns Settings, the current appDate DayPlan, today Tasks in exact `taskIds` order, the derived active list, and the derived pending-triage list. Effective-entity reads provide tombstone filtering; non-DayPlan lists use `sortIndex` with a deterministic id tie-breaker.
- Commit: `e86dc92c78b4783dde679a40e5d54d1e017c57b4 phase1(S10): derive current task views`.
- Specification: v4 §2.5, §3.1 rules 3/7, and §3.2 rules 1/2/9; phase1-plan S10; checklist B Task membership/sort truth, C DayPlan `appDate` / ordered `taskIds`, and the P1 appDate acceptance item.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 29 files / 244 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; commit diff check → passed; repository provides no lint script. The direct test uses a UTC timestamp whose Asia/Shanghai product date is the following calendar date, contradicting `sortIndex` and DayPlan order while also covering active, splitNeeded, pending, completed, and tombstoned Tasks.
- Review: Independent read-only Reviewer returned `PASS` for exact commit `e86dc92c78b4783dde679a40e5d54d1e017c57b4` and confirmed the next S13 unit may proceed.
- Findings and resolution: None. Review confirmed S11-first initialization, derived appDate, exact three-view formulas and ordering, default tombstone filtering, public read-only access, and absence of `bucket`, §8 statistics, P2/UI work, and unnecessary indexes.
- Residual risk or user decision: None. This unit intentionally performs no business writes beyond invoking the already-reviewed S11 initializer and adds no IndexedDB schema changes.

### S13a-1 / Task and DayPlan command layer

- Status: `PASS`
- Scope: Added validated atomic commands for manual activity/today Task creation, title changes, second/third total-estimate rounds, activity-list soft deletion, moving existing Tasks into/out of today, and today's-list reordering. Commands re-read affected records in the transaction and write the exact required Event or Event pair with one correlationId.
- Commit: `7341ad05a6181d93d4334d3626de540f0a56a611 phase1(S13a-1): add task commands`.
- Specification: v4 §2.4, §3.1, §3.2, §3.4, §7.1, §7.3, and §7.4; phase1-plan S13 A1/A2 excluding pomodoro-driven completion; checklist B, C, H, I-1, I-2, and I-3.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 30 files / 248 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check` → passed; repository provides no lint script. Direct tests cover list/today creation distinction, first estimate round, title Event snapshots, two valid estimate changes and fourth-round rejection, add/reorder/remove Event chains, duplicate-add no-write behavior, and tombstone visibility.
- Review: Independent read-only Reviewer returned `PASS` for exact commit `7341ad05a6181d93d4334d3626de540f0a56a611` and confirmed the next S13a sub-unit may proceed.
- Findings and resolution: None. Review confirmed list-derived sortIndex, DayPlan-only today ordering, tombstone/Event deletion, exact move/reorder associations, transaction-local re-reads, atomic correlation, public validated-write boundary, and absence of legacy/UI/P2+ expansion.
- Residual risk or user decision: None. Pomodoro-driven Task completion remains intentionally coupled to the S13a-2 Session command unit; energy and interrupt writes remain S13a-3.

### S13a-2 / standard timer command layer

- Status: `PASS`
- Scope: Added atomic commands for focus start/completion/user discard, standard break start/completion, and pomodoro-driven Task completion confirmation. The commands derive Task-local pomodoroIndex and global completed-focus break cadence from Sessions, enforce one active Session and one break opportunity per completed focus, persist the final actualRest, and accept actualDuration only as a caller-provided fact.
- Commit: `0e8073282d823efa65a58e11cba5c87a4f3a8118 phase1(S13a-2): add timer commands`.
- Specification: v4 §3.3, §3.4, §7.1 `task.completed`, §7.5, §7.6, and the §8.4.3 long-break trigger rule; phase1-plan S13 A1 pomodoro completion and A3; checklist D, H, I-1, I-4, and I-5.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 31 files / 251 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check` → passed; repository provides no lint script. Direct tests cover active-session exclusion, focus Event mirrors, intentionally non-derived actual durations, Session-derived Task completion count, short break with final rest, duplicate/open break guards, discarded-index retention, and cross-Task fourth-focus long break.
- Review: Independent read-only Reviewer returned `PASS` for exact commit `0e8073282d823efa65a58e11cba5c87a4f3a8118` and confirmed S13a-3 may proceed.
- Findings and resolution: None. Review confirmed Task/status gates, pomodoroIndex retention including tombstones, focus and break state/Event consistency, explicit actualDuration, non-bypassable and unique break opportunities, global long-break cadence, Settings/DayPlan/source/rest associations, Session-derived completion count, atomic correlation, and the absence of a production `break.skipped` command.
- Residual risk or user decision: None. Extra/recovery Sessions, prompt/rest-item process Events, energy/interrupt facts, and UI integration remain outside this sub-unit.

### S13a-3 / energy and interrupt command layer

- Status: `PASS`
- Scope: Added the explicit Phase 1 energy-submission command for the six currently triggered sources and active-focus internal/external interrupt commands. Energy submission atomically creates EnergyRecord plus `energy.recorded`, fixes mood to null, and mirrors stable Session/Task/DayPlan context; interrupts append only Event facts and never mutate Session with counters or arrays.
- Commit: `47151d562eb4ed9d96ff97059531c591649f6b37 phase1(S13a-3): add awareness commands`.
- Specification: v4 §3.4, §3.5, §7.8, and §7.9; phase1-plan S13 A4 (actualRest completed in S13a-2); checklist E, H, and the interrupt/energy acceptance rows in I.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 32 files / 254 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `git diff --check 47151d5^ 47151d5` → passed; repository provides no lint script. Direct tests cover all three standalone sources, afterFocus/afterShortBreak/afterLongBreak through real standard Session flows, mismatched-session zero writes, both interrupt kinds, unchanged Session state, and post-completion rejection.
- Review: Independent read-only Reviewer returned `PASS` for exact commit `47151d562eb4ed9d96ff97059531c591649f6b37` and confirmed S13b may proceed.
- Findings and resolution: None. Review confirmed the six-source TypeScript boundary (manual/afterExtra excluded), completed Session matching, mood=null, atomic EnergyRecord/Event correlation, active-focus-only interrupts, exact associations, and absence of triage/prompt/edit/delete/UI/legacy/P2+ expansion.
- Residual risk or user decision: None. A separately submitted energy response is its own business operation; if S13c defines Session completion and energy submission as one UI action, that integration must combine them into one transaction/correlation rather than invoke two independent writes.

### S13b / ESM application and Task UI migration

- Status: `PASS`
- Scope: Replaced the production Babel/global-JSX script chain with one Vite ESM entry that imports the public `src/data` barrel, renders the existing sidebar/header/two-column Task shell from S10 views, and routes every enabled A1/A2 mutation through the reviewed S13a command layer. Timer, statistics, budget editing, subtasks, triage, and other unswitched or P2+ controls remain disabled or absent; the legacy files remain unmodified and unreachable from the production entry.
- Commit: `4fafd7e2bc80839b184cd28e59552fbd59279495 phase1(S13b): migrate task UI to ESM`.
- Specification: v4 §2.1, §2.4–§2.5, §3.1–§3.2, §3.4, §7.1, §7.3, and §7.4; phase1-plan S13 A1/A2 and the non-connected behavior boundary; checklist B, C, H, I-1, I-2, and I-3.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 33 files / 257 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build --outDir <temporary-directory>` → 64 modules built successfully; `git diff --check` → passed; repository provides no lint script. In-app Browser smoke covered empty-library initialization, disabled unswitched controls, list/today creation, title and estimate edits, activity soft deletion, moving a today Task back to the list, refresh persistence, next-appDate initialization, and two clean warning/error console checks.
- Review: Independent read-only Reviewer returned `PASS` for exact commit `4fafd7e2bc80839b184cd28e59552fbd59279495` and confirmed S13c may proceed. Reviewer independently reproduced all tests, typecheck, production build, bundle red-line scans, and scope isolation.
- Findings and resolution: No Reviewer findings. Implementer self-review before the candidate commit found that drag indexes based on the active-only presentation subset could misaddress `DayPlan.taskIds` when completed Tasks were interleaved; the implementation now derives every drag index from the complete DayPlan-ordered Task list, with a direct regression test.
- Residual risk or user decision: None. `styles.css` is unchanged, the production graph contains no legacy storage read/write, and the user-owned historical-document deletions were not staged or included.

### S13c / standard timer and awareness UI migration

- Status: `PASS`
- Scope: Connected the production timer page to the reviewed standard focus/break, pomodoro Task-completion, energy, and interrupt commands through a v4-derived timer read model. At this commit, active Sessions loaded from IndexedDB were treated as live timers; the final full-range audit later identified and corrected that cross-runtime interpretation in the S13c reconciliation entry below. Scheduled focus and confirmed break completion pass explicit duration facts; break confirmation writes a final enabled/type-compatible `actualRest` key or null; interrupt counts derive from Event. Session completion and the subsequent optional energy submission remain separate user actions and transactions.
- Commit: `f7c0f0833c046055d41e29dc8e56bc93ae9e48b7 phase1(S13c): connect timer awareness UI`.
- Specification: v4 §3.3–§3.5, §7.1, §7.5–§7.6, §7.8–§7.9, and the standard-break cadence rule; phase1-plan S13 A1/A3/A4; checklist D, E, H, I-1, I-4, I-5, and the energy/interrupt acceptance rows.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 35 files / 263 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build --outDir <temporary-directory>` → 67 modules built successfully; `git diff --check` → passed; repository provides no lint script. In-app Browser smoke covered day-start energy submission, focus start, both interrupt kinds, reload followed by focus discard, layout inspection, and a clean warning/error console; the later final audit used that reload path to expose the recovery-boundary defect. The real-command integration test covers focus completion → optional afterFocus energy → short break → actualRest completion → optional afterShortBreak energy.
- Review: Independent read-only Reviewer returned `BLOCKED` for candidate `ec630d4`; after amendment, the same Reviewer returned `PASS` for exact final commit `f7c0f0833c046055d41e29dc8e56bc93ae9e48b7` and confirmed S14 may proceed. Reviewer independently reproduced 35 files / 263 tests, typecheck, production build, and commit checks.
- Findings and resolution: (1) Missing EnergyRecord rows were incorrectly treated as permanent post-Session prompts, preventing the v4-defined no-write skip path. The repair removed that historical inference; after-* prompts now exist only in the current UI completion context, expose a no-write skip, and disappear on navigation/reload. (2) `onReturn` visibility detection originally existed only while TimerView was mounted. It now lives at the always-mounted App level, classifies stale-energy App reloads as returns, and is cleared by any later successful energy submission so it cannot reappear after a more recent valid record. Re-review closed both findings with no new issue.
- Residual risk or user decision: The final full-range audit later found that a prior-runtime active Session must not use ordinary completion/discard semantics. That Blocking issue is fully resolved by commit `8b0da3f8a9beb3a1b485e147bfae02ca7a34c7cd` in the reconciliation entry below. No pause fact, production fast-forward, `break.skipped`, P2 recovery flow, restItem process Event, custom rest-item editing, subtask, triage, Settings/budget editing, statistics, old aggregate field, or legacy storage path is enabled; `styles.css` remains unchanged.

### S14 / empty-library start and legacy prototype isolation

- Status: `PASS`
- Scope: Made the Vite ESM entry the only production path, proved that its complete project-local UI dependency graph reaches the data layer only through `src/data/index`, and guarded that graph against old sessionStorage/demo truth, legacy aggregate properties, prohibited timer paths, browser-storage access, and alternate ID sources. The retained root prototype files remain unmodified and unreachable; no migration or automatic demo path was added. Presentation-only grouping keys were mechanically renamed so the legacy `completed` property can be rejected without confusing the valid Task status value.
- Commit: `972718b9c694c3b25cdb3f2f28ac21ece4b6f0aa phase1(S14): isolate legacy prototype data`.
- Specification: v4 §2.1, §2.2, §9.1, §10.1–§10.2, and §7.14 DEV/demo boundaries; phase1-plan S14 and D5; checklist shared UUID-v7 requirement, P1 empty-library initialization boundary, and deferred S2 direct-`randomUUID` guard note.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 36 files / 278 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build --outDir <temporary-directory>` → 67 modules built successfully; `git diff --check` → passed; repository provides no lint script. Browser production-entry smoke confirmed the initialized Task UI and a clean warning/error console.
- Review: Independent read-only Reviewer returned `NEEDS FIX` for candidate `454e630a6399b337add1baa9ae0ee04354ad0e80`; after amendment, the same Reviewer returned `PASS` for exact final commit `972718b9c694c3b25cdb3f2f28ac21ece4b6f0aa` and confirmed Phase 1 closeout may proceed. Reviewer independently reproduced 36 files / 278 tests, typecheck, the 67-module production build, and diff checks.
- Findings and resolution: (1) The initial production graph followed only top-level static imports that stayed under `src/ui`, so dynamic imports and project-local wrapper routes could evade inspection. The repair parses static and string-dynamic imports throughout the syntax tree, rejects non-static/external dynamic imports and CommonJS loading, resolves every project-local dependency, and permits leaving `src/ui` only through the exact public data entry. (2) The legacy-property detector missed statically computed property syntax. A shared static-name extractor now covers template element access, computed object properties, and computed destructuring, with positive fixtures plus negative fixtures proving `status === 'completed'` remains valid. Re-review closed both findings with no new issue.
- Residual risk or user decision: None. The recovered S2 guard Minor is closed; old root JSX remains only as untouched historical comparison material and has no production or formal IndexedDB path. User-owned historical-document deletions were not staged or included.

### S13c closeout reconciliation / recovered active Session gate

- Status: `PASS`
- Scope: Prevented an active focus/shortBreak/longBreak discovered from a prior App runtime from being treated as a continuous standard timer. Only Sessions successfully started and registered in the current runtime retain normal complete/discard/interrupt/actual-rest write access. Any other active Session is shown as recovery-required and read-only; the P2 UnresolvedInterval detection, resolution Events, and recovery UI remain unimplemented.
- Commit: `8b0da3f8a9beb3a1b485e147bfae02ca7a34c7cd phase1(S13c): gate recovered active sessions`.
- Specification: v4 §7.5 `focus.completed` / `focus.discarded`, §7.6 `break.completed`, and §7.11 recovery semantics and P2 boundary; phase1-plan S13 A3 plus its explicit extra/recovery and UnresolvedInterval exclusion; checklist D, H, I-3, and I-8 structure-versus-trigger boundary.
- Verification: `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run` → 36 files / 282 tests passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` → passed; `/Users/viyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build --outDir <temporary-directory>` → 67 modules built successfully; `git diff --check` → passed; repository provides no lint script. An isolated-origin Browser regression proved that a focus started in the current runtime has standard controls, while a hard reload changes it to the read-only recovery-required view with zero discard/internal-interrupt/external-interrupt/complete-break buttons and no page warning/error.
- Review: The full Phase 1 read-only Reviewer returned `BLOCKED` at reviewed tip `b2d39e9d7b46094552928769309818fd2c5a29cd`; after this atomic repair, the same Reviewer returned `PASS` for exact commit `8b0da3f8a9beb3a1b485e147bfae02ca7a34c7cd` and confirmed final closeout logging may proceed. Reviewer independently reproduced 36 files / 282 tests, typecheck, Vite build, commit/range diff checks, and workspace isolation.
- Findings and resolution: Reloaded active focus could auto-complete from wall-clock time or be discarded with the normal `userInitiated` reason; reloaded active break could complete normally, all without the v4 recovery audit chain. The repair registers startFocus/startBreak results before reloading views, classifies every unregistered active Session as recovery-required, returns a read-only existing-style notice before rendering controls, and adds a second command-level write gate. Focus, shortBreak, and longBreak policy regressions prove pre-existing Sessions cannot use standard writes and current-runtime Sessions can. Re-review closed the Blocking finding with no new finding.
- Residual risk or user decision: The unresolved active Session intentionally remains untouched until the P2 recovery flow exists; Phase 1 neither guesses its outcome nor fabricates UnresolvedInterval/interval Events. No user decision is required.

### Phase 1 closeout / full acceptance audit

- Status: `PASS`
- Scope: Audited the recovery baseline plus every S6–S14 implementation/reconciliation commit against the complete Phase 1 data contract, acceptance checklist first part, red lines, atomic review history, production entry, and protected-workspace boundaries. This is a verification/logging unit and adds no product behavior.
- Commit: Reviewed implementation tip `8b0da3f8a9beb3a1b485e147bfae02ca7a34c7cd`; this log-only follow-up necessarily postdates the reviewed tree.
- Specification: v4 §2–§3, §6–§7, §9, and §10.1–§10.2; phase1-plan S0–S14; phase1-checklist first part A–I. The checklist second part, v4 §8 statistics implementation, and full P2/P3/P4 behaviors remain out of scope.
- Verification: Full Vitest → 36 files / 282 tests passed; TypeScript → passed; Vite production build → 67 modules passed; `git diff --check` → passed; no lint command exists. Red-line scans and AST guards covered old storage/truth fields, the single UUID-v7 source, Event completeness, production dependency reachability, physical deletion, appDate usage, and Session duration facts. Browser smoke covered initialization, Task list/today create, rename, estimate adjustment, soft delete, move-out, energy, focus start, both interrupt kinds, same-runtime timer controls, hard-reload recovery gating, and clean page logs; real command integration tests cover focus completion, Task completion, standard break, actualRest, post-session energy, and atomic Event writes without production fast-forward.
- Review: Independent read-only full-range Reviewer first returned `BLOCKED` only for the recovered-active-Session issue recorded above, then returned `PASS` at exact reviewed tip `8b0da3f8a9beb3a1b485e147bfae02ca7a34c7cd`. All earlier S-step/sub-block reviews are `PASS`, all in-scope findings are closed, and Phase 1 may close.
- Findings and resolution: The sole final-audit Blocking is recorded and closed in the preceding reconciliation entry. The recovered S2 direct-randomUUID guard Minor was closed in S14. Fifteen pre-reconciliation implementation commits plus the reconciliation commit all have explicit full hashes and review outcomes in this log; S0–S5 remain explicitly identified as recovery-snapshot audits rather than reconstructed history.
- Residual risk or user decision: The recovery baseline `86ccf2d44eb1226832d83c73ba5d35ade6f0d87b` remains an ancestor and was not replaced. The index is empty. The only worktree changes are 53 user-owned unstaged deletions (`docs/Draft/`: 38; `docs/ai-context/`: 15); none was restored, staged, committed, reclassified, or overlapped. No push was performed. P2 recovery, full DayPlan management, statistics, migration, import/export, synchronization, and other explicitly deferred behavior remain future work rather than Phase 1 defects.

### S13c bugfix / estimate-reached Task completion entry

- Status: `PASS` (Implementer self-review).
- Scope: When a completed standard focus brings an active/splitNeeded Task to its current `estimatedPomodoros`, the immediate post-focus screen now surfaces a lightweight Task-completion confirmation before the energy card. The same estimate-reached action remains prioritized on the pending-break screen, while Tasks below estimate retain the existing optional completion entry. Confirmation continues to use the reviewed `completeTaskFromPomodoro` atomic command; focus completion alone never auto-completes the Task.
- Commit: This atomic bugfix commit (`fix(phase1-S13c): surface estimate completion check`).
- Specification: v4 §7.1 `task.completed`, §8.5.3 estimate-reached handling, and §7.15's lightweight timer-page completion-entry boundary; phase1-plan S13 A1 pomodoro completion and A3; checklist D, H, I-1, and I-4.
- Verification: direct Timer view-model plus timer command/current-timer query tests → 3 files / 26 tests passed; full Vitest → 50 files / 376 tests passed; TypeScript → passed; Vite production build → 82 modules passed; `git diff --check` → passed; repository provides no lint script. In-app Browser smoke on an isolated origin covered default “计划准备” initialization, day-start energy submission, first focus start, correct Task association, and zero warning/error Console entries. The real 25-minute boundary was not fast-forwarded; threshold behavior is covered directly by the new 1/1, below-estimate, splitNeeded, completed, and null cases plus the existing real command completion tests.
- Review: Implementer self-review returned `PASS`; no independent Reviewer was requested for this focused post-closeout repair. Review confirmed that the UI uses per-Task completed valid standard focus facts, compares against the current estimate with `>=`, excludes already completed Tasks, preserves explicit user confirmation, adds no prompt Event behavior, and leaves data truth/write paths unchanged.
- Residual risk or user decision: None. This deliberately remains the v4-exempt lightweight completion entry rather than introducing the Phase-excluded prompt lifecycle; users may still finish a Task early through the existing post-focus entry. No notification, prompt analytics, timer setting, or layout refactor was added.

### 合并番茄钟 v4.3.1 语义收口 / 数据层实现

- Status: `PASS`（Implementer 自审）。
- Scope: 按 v4.3.1 收口的产品语义重做合并番茄钟数据层，替换「活动 Session 成员可任意同步」与 v4.1/v4.2 旧统计口径。含：Session `taskSegments` 成员分段、MergeGroup `title` / `completedAt` / `status='completed'` 成功终态、`mergeGroup.renamed` 与 `mergeGroup.completed` 两个事件（§7.19 共 8 个）、活动 focus 对当前执行对象的锁定、统计口径改为「番茄归合并组、时间归成员」。**不含 UI**：`src/ui/**`、`styles.css` 与根目录旧原型未改动，计时页/统计页按新语义重接属后续批次。Goal（§3.9、§7.20、§8.13）随 v4.3 规范一并引入文档，本轮不写任何 Goal 代码。
- Commit: `ac074bb` 引入 v4.3 规范；`81cf2dc` v4.3.1 语义收口；`fe6e7df` schema/validator/写入路径；`9c8cabe` 生命周期与锁定；`05660d6` 统计口径；`0433d99` 测试覆盖；本条为随后的 log/文档提交。
- Specification: `docs/data-layer-spec-v4.3.md`（v4.3.1）§3.3（`taskSegments`、关键规则 11/12/13/14、一致性约束 15/16）、§3.8（`title`、关键规则 12/13/14/15/16、一致性约束 1/8/9/10）、§7.1、§7.15、§7.19、§8.3、§8.5（含新增 §8.5.7 MergeGroup 维度）、§10.7、§14。
- Verification: `npm run test:run` → 65 files / 517 tests passed；`npm run typecheck` → passed；`npm run build` → 144 modules built。仓库未提供 lint 命令，故未运行 lint。未做浏览器验证：本轮不含 UI 改动，计时页尚未按新语义重接，无可观察的界面行为可验。
- Review: Implementer 自审 `PASS`。重点核对：Event append-only（迁移一律不动 Event）、实体变更与 Event 同事务原子提交、`actualDuration` 仍是唯一事实源（分段不用 `endedAt − startedAt` 重推）、无新旧双轨统计、无小数番茄、无暂停态。
- Findings and resolution: 自审发现并修掉两个真 bug——（1）迁移链原按版本各开一趟游标，同一 versionchange 事务里两个游标读到的都是原始记录，v3 那趟会覆盖 v2 补的 `mergeGroupId`，改为一趟游标跑完整条链并把 v1 → v3 升级测试扩成回归守卫；（2）`startMergeGroupFocus` 未挡 `completed` 的组，会掉到成员数检查报出文不对题的错误，已补分支并分开文案。另修掉自己引入的一处：锁定校验读 `sessions`，但 `deleteActiveTask` / `adjustTaskEstimate` 未声明该 store，已补声明。
- Residual risk or user decision: （1）用户在本轮明确改判「开新一轮前必须有 ≥ 2 个未完成成员」为通用规则，**推翻**了 commit `5559660`「续轮只剩 1 个未完成成员也照开」的决定；已同步改写 §3.8 新增关键规则 16 与 `CLAUDE.md` 红线 29，并把续轮测试改为三成员场景。存储层 §3.3 一致性约束 15 仍保持 `≥ 1`——已开跑的一轮允许合法缩到 1，门槛只由开轮命令强制。（2）迁移进来的历史合并 Session 没有分段事实（当时没有逐个勾选成员的入口），`taskSegments` 一律留空，统计侧表现为各成员在这些历史 Session 上投入 0；这是有意的诚实少算，不伪造平均分摊数据。（3）UI 尚未按新语义重接，`completeMergeGroup` / `renameMergeGroup` / `settleMergeGroupRound` 三条命令目前只有数据层与测试覆盖，无界面入口。

### 合并番茄钟 v4.3.2 数据层最终整合

- Status: `PASS`（Implementer 自审）。
- Scope: 在 `f2a2c9c` 数据层基线上收口 v4.3.2 独立可验证 sub-block。含：`Task.mergeGroupId` 只表示当前所属，进入 `completed` / `dissolved` 时先清空全部成员指针再写终态；`completeMergeGroup` 必填触发确认的 `sessionId`；允许仍有未完成成员时确认整组完成，并写入 `finalTaskIds` / `incompleteTaskIds`；终态组不得再被 Task 指向、之后只允许重命名；completed 终结快照与已开跑 Session 允许缩到 1；规范升为 v4.3.2 且 V43-1～V43-6 全部结案。**不含 UI**，不改 `src/ui/**` / `styles.css`，也不纳入未跟踪的 `docs/ui-handoff-empty-states-and-beyond.md`。
- Commit: 本原子提交（subject：`feat(data): 收口 v4.3.2 合并番茄数据层最终整合`）。
- Specification: `docs/data-layer-spec-v4.3.md`（v4.3.2）§3.1 `mergeGroupId`、§3.3 关键规则 12/14 与一致性约束 15/16、§3.8 关键规则 10/12–16 与一致性约束 1/9/10/12、§7.1、§7.19 `mergeGroup.completed`、§8.3、§8.5、§10.7、§14；`CLAUDE.md` 红线 24–29；`docs/claude-recovery/01-merge-pomodoro-v43-data-layer.md` §6 数据层验收项。
- Verification: `npm run test:run` → 65 files / 531 tests passed；`npm run typecheck` → passed；`npm run build` → 144 modules built（仅既存单包 >500 kB 警告）；`git diff --check` → passed。仓库未提供 lint 命令，故未运行 lint。未做浏览器验证：本轮不含 UI 改动。
- Review: Implementer 自审 `PASS`。核对写入顺序：complete / dissolve / 成员不足解散均先 `clearMembership` 再写 Group 终态，事务内逐笔校验只看到合法状态，任一步失败整事务回滚。核对 Event 契约：`mergeGroup.completed` 顶层必填 `sessionId`，payload 含完成快照且 `incompleteTaskIds` 必须是 `finalTaskIds` 子集。核对统计不再依赖已清空的 `Task.mergeGroupId`。自审修了一处：`validFocusCountAtCompletion` 补上 `type === 'focus'`，与 §7.19 及 Task 完成快照口径对齐。
- Findings and resolution: （1）Major：完成快照计数原先只滤 `mergeGroupId` + `status='completed'`，未按 §7.19 限制 `type='focus'`。已改为与 `completeTaskFromPomodoro` 相同的标准 focus 口径。无其他 Blocking / Major 项。
- Residual risk or user decision: （1）UI 仍按旧口径展示/写入，下一批才能重接；本 commit 只建立数据层基线。（2）终态 rename-only validator 要求后续本地写入必须改 `title`，并把 `deviceId` / `syncedAt` 一并冻结；当前没有同步回写终态组合并组的路径，云端结构升级与真实多端验收仍需用户另行确认。（3）`markMergeGroupLimitReached` 仍用 `getAllIncludingDeleted` 计完成轮次，与完成快照排除软删 Session 的口径尚未统一；本轮不顺手改相邻命令。（4）工作树仍保留用户原有未跟踪文件 `docs/ui-handoff-empty-states-and-beyond.md`，未纳入本提交。

### 合并番茄钟 v4.3.2 独立 review 缺陷修复

- Status: `PASS`（Implementer 自审；关闭独立 Reviewer 对 `c7e0d75`..`8d6ca03` 的 `BLOCKED`）。
- Scope: 逐条修复独立 review 的 9 个 bug 与 2 个 suggestion：手动完成/取消完成锁定、重排同步活动 Session、合并崩溃恢复写分段、当前视图不再把 completed 组当在用、计时视图按当前未完成成员取值、结算解散保留终态快照、历史空分段可再写入、终态组允许软删/同步簿记、结束本轮拒绝活动 Session、活组成员不能单独 startFocus、修正过时文件头。不含 UI。
- Commit: 本原子提交（subject：`fix(data): 关闭 v4.3.2 合并番茄独立 review 缺陷`）。
- Specification: v4.3.2 §3.3 关键规则 13/14、§3.8 关键规则 11–15、红线 24/27。
- Verification: `npm run test:run` → 65 files / 541 tests passed；`npm run typecheck` → passed；`npm run build` → 144 modules built；`git diff --check` → passed。仓库未提供 lint 命令。未做浏览器验证：本轮仍无 UI 改动。
- Review: Implementer 自审 `PASS`。独立 Reviewer 原 verdict 为 `BLOCKED`，所列 11 条均已在本提交关闭。
- Findings and resolution: 见独立审查记录；本提交按建议方向全部落地，并补对应测试。
- Residual risk or user decision: UI 仍未按新语义重接，但数据层锁定与查询洞已补上，可以开始 UI 重接。`markMergeGroupLimitReached` 软删 Session 计数口径仍未统一。未跟踪的 `docs/ui-handoff-empty-states-and-beyond.md` 仍不纳入。
