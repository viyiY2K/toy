# AGENTS.md

This file defines repository-level rules for Codex work on the Phase 1 data-layer refactor. It is not an implementation plan, and it does not replace `CLAUDE.md` or `docs/data-layer-spec-v4.md`.

## Codex Roles and Workflow

- Every Codex task must declare one role: `Implementer` or `Reviewer`. A task without an explicit role defaults to `Reviewer`.
- Codex must not proactively expand requirements.
- Codex must not proactively refactor UI, visual design, or page layout.

### Implementer

- The Implementer owns work within the currently declared `docs/phase1-plan.md` S step or independently verifiable sub-block. A large S step may be split before work starts, but sub-blocks must not cross S-step scope.
- Before changing files, identify the applicable v4 sections, checklist acceptance items, planned files, verification method, and scope boundary. This small working plan may be produced autonomously; it does not require routine user approval.
- Within the declared scope, the Implementer may implement, run available tests/typecheck/lint, self-review, resolve ordinary review findings, and create or amend an atomic local commit. Never push automatically.
- Each completed S step or independently verified sub-block must have one atomic final commit. Its implementation and review outcome must be recorded in `docs/phase1-review-log.md`.
- Ask the user before changing data truth or product semantics; resolving a conflict among v4, the plan, and the checklist; crossing into another S step, P2+ behavior, or UI work; performing a destructive data/Git operation; adding external services/dependencies with material impact; or pushing to a remote.

### Reviewer

- The Reviewer is read-only and does not modify implementation files.
- Review one exact implementation commit whenever possible, or a small commit range only when necessary. Do not wait for all of Phase 1.
- The Reviewer records a verdict and findings using the format below. The Implementer resolves all in-scope findings and requests another review until the result is `PASS`, unless a user-decision condition above applies.

### Relationship to `CLAUDE.md`

- Both roles use `CLAUDE.md` as the primary Phase 1 construction workflow and red-line reference, and must follow its document hierarchy, S-step discipline, scope limits, testing expectations, Git hygiene, and review handoff requirements.
- For an explicitly declared Codex `Implementer`, this file supersedes only `CLAUDE.md`'s routine user-confirmation gates for a working plan and a local commit. The Implementer still reports scope, test results, risks, and the proposed/created commit; it must not push automatically.
- `docs/CLAUDE.md` remains a historical/document-authoring collaboration guide and is not changed by this workflow.

## Document Authority

When reviewing, use the following authority order:

1. `docs/data-layer-spec-v4.md` is the highest-authority data specification. It decides fields, events, payloads, constraints, statistics semantics, and Phase semantics.
2. `docs/phase1-plan.md` decides implementation order and the current S-step scope.
3. `docs/phase1-checklist.md` is the Phase 1 acceptance checklist. Use it to verify fields, schema, `EventType`, payloads, defaults, nullability, and write paths.
4. `CLAUDE.md` defines the Phase 1 implementation workflow and red lines. Review must also check whether a commit violates its applicable operation constraints or data-layer red lines, subject to the explicit Implementer exception above.
5. `docs/prototype-behavior-inventory.md` is only a reference for old prototype behavior. It must not be treated as data truth.
6. `docs/ui-behavior-backlog.md` is only a UI backlog. It must not be treated as data truth.

If documents conflict, the higher-authority document wins.

## Review Granularity

- Prefer reviewing a single commit.
- Review a small commit range only when necessary.
- Do not wait for all of Phase 1 to finish before reviewing.
- Before reviewing the diff, first identify which S step or sub-block in `docs/phase1-plan.md` the commit corresponds to.
- If a commit has no clear S-step mapping, or spans beyond the current S-step scope, call that out explicitly.

## Priority Review Targets

Codex review should prioritize blocking issues, including but not limited to:

- The commit exceeds the current S-step scope.
- The commit prematurely implements complete P2/P3/P4 behavior that is not included in Phase 1.
- Old prototype fields or old state are kept as new data truth.
- New and old write paths coexist as dual-track writes.
- Fields, enums, payloads, defaults, or nullability violate `docs/data-layer-spec-v4.md`.
- Required Phase 1 reserved structures are missing.
- The full `EventType` enum or payload schema is missing.
- `localDate` is used where `appDate` is required.
- Event append-only semantics are violated.
- Syncable entities are physically deleted instead of soft-deleted.
- Entity changes and Event writes are not guaranteed to be in one atomic transaction.
- `endedAt - startedAt` is used as the fact source instead of `actualDuration`.
- UI, visual design, or page layout is changed under the cover of the data-layer refactor.

## Review Output Format

Start each review with a brief verdict:

- `PASS`: No issue blocks moving forward.
- `NEEDS FIX`: Fixes are needed, but they may not block the whole S step.
- `BLOCKED`: Must fix before moving to the next S step.

The verdict must also state which `docs/phase1-plan.md` S step or sub-block the commit maps to, and whether the next step may proceed.

Group findings by severity:

- **Blocking**: Must fix before moving to the next step.
- **Major**: Should fix; may affect Phase 1 correctness or later migration.
- **Minor**: Non-blocking issue.
- **Question**: Only for product semantics, spec conflicts, missing documentation, or decisions that genuinely require user confirmation.

Do not send ordinary engineering implementation choices to the user as `Question`. For normal implementation issues, Codex should give a suggested direction based on `docs/data-layer-spec-v4.md`, `docs/phase1-plan.md`, and `docs/phase1-checklist.md`.

Each finding must include:

- Location: file, function, or diff position.
- Issue: what is wrong.
- Rule: which document or rule it violates.
- Suggested direction: how to fix or narrow the change.

Lead with concrete findings. If there are no findings in a severity group, omit that group.

## What Not To Do

- Do not output broad, generic advice.
- Do not request a rewrite of the whole project.
- Do not treat style preferences as blocking issues.
- Do not modify code from a Reviewer task. An explicitly declared Implementer may modify code within its declared scope under the autonomous workflow above.
- Do not make this file long. Reference existing documents instead of copying them.
