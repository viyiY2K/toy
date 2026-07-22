# Phase 2 Self-Use Observation Log

This log starts the post-closeout self-use observation and bug-collection stage. It is not a product backlog and does not authorize new scope. Data/spec conflicts still follow the authority and user-decision gates in `AGENTS.md`.

## Status

- Stage: self-use observation and bug collection. The reviewed activation commits are recorded in `docs/phase2-review-log.md`.
- Current open in-scope bugs: none recorded.
- Canonical repeatable run: `docs/phase2-self-use-smoke.md`.
- Closeout evidence and exact commits: `docs/phase2-review-log.md`.
- Protected workspace state: 53 user-owned unstaged deletions under `docs/Draft/` and `docs/ai-context/`; never restore, stage, or commit them as part of self-use work.

## Smoke-run entry template

### RUN-YYYYMMDD-NN

- Date/time and timezone:
- Exact commit and branch:
- Browser/origin/viewport:
- Database: fresh / retained; preservation notes:
- Automated preflight: test / typecheck / build / lint status / diff-check:
- Planning result:
- Task lifecycle/order result:
- Focus/awareness result:
- Normal short/long break result:
- Recovery/reload/background result:
- Skip/workEnded result:
- Persistence and Console result:
- Cleanup result:
- Overall: `PASS` / `PASS WITH OBSERVATIONS` / `FAIL`
- Linked bug or smoothness ids:

## Bug entry template

### BUG-YYYYMMDD-NN · Short title

- Status: `new` / `reproduced` / `fixing` / `ready for regression` / `closed` / `deferred`
- Severity: blocking / major / minor
- Area: planning / Task / timer / awareness / recovery / exit / persistence / layout
- First seen on exact commit:
- Environment and origin:
- Preconditions and retained data:
- Reproduction steps:
- Expected result:
- Actual result:
- Entity/Event evidence: ids, types, correlationId, relevant fields only; do not paste unrelated user content.
- Console warning/error:
- Frequency:
- User impact and safe workaround:
- Authority/scope classification: in-scope defect / deferred P2 / P3+ / needs user decision
- Proposed verification:
- Regression result and closing commit:

Do not delete or rewrite an incorrect Event while investigating. Record corrective behavior through the product's supported append-only path.

## Smoothness entry template

### FLOW-YYYYMMDD-NN · Short observation

- Exact commit/environment:
- Flow and step:
- Observation: hesitation, unclear label, extra click, layout friction, or latency
- Frequency and approximate time cost:
- Data correctness affected: yes / no
- Workaround:
- Classification: in-scope usability bug / deferred enhancement / no action
- Evidence or screenshot:
- Follow-up decision:

A smoothness note is evidence for later prioritization, not permission to redesign the UI or change product semantics.

## Regression matrix

| Area | Last run | Result | Linked issue | Notes |
|---|---|---|---|---|
| Initialization / appDate | S5 closeout | PASS; exact reviewed record in review log | — | Template idempotence and reload |
| DayPlan budget / capacity | S5 closeout | PASS; exact reviewed record in review log | — | Work window, deductions, modes, overload |
| Task lifecycle / order | S5 closeout | PASS; exact reviewed record in review log | — | Both order truths; complete/undo/archive/delete |
| Focus / interrupts / energy | S5 closeout | PASS; exact reviewed record in review log | — | Explicit writes only |
| Normal short/long break | S5 closeout | PASS; exact reviewed record in review log | — | actualDuration and final actualRest |
| Reload / background recovery | S5 closeout | PASS; exact reviewed record in review log | — | No inferred standard result |
| Skip / workEnded | S5 closeout | PASS; exact reviewed record in review log | — | Standard and recovery skip remain distinct |
| Persistence / Console / build | S5 closeout | PASS; exact reviewed record in review log | — | Clean production entry |

Later observation runs append new entries rather than rewriting the reviewed closeout outcome.

## Initial closeout run

### RUN-20260721-01

- Date/time and timezone: 2026-07-21, Asia/Shanghai.
- Exact commit and branch: S5 implementation and bookkeeping hashes are recorded in `docs/phase2-review-log.md`; branch `data-layer-refactor`.
- Browser/origin/viewport: Codex in-app Browser plus user ordinary-browser checks; main origin `http://127.0.0.1:4173/`; viewport visual check 1280×720.
- Database: retained main-origin self-use data for continuity; isolated/fresh origins were used where recovery/destructive evidence required them.
- Automated preflight: 41 files / 316 tests passed; typecheck passed; production build passed with 73 modules; no lint script exists; diff-check passed.
- Planning result: PASS.
- Task lifecycle/order result: PASS, including user-confirmed today and activity reorder persistence.
- Focus/awareness result: PASS.
- Normal short/long break result: PASS; a real 300-second short break persisted final actualRest and linked after-break energy.
- Recovery/reload/background result: PASS, including user-confirmed before/after planned-end background boundaries.
- Skip/workEnded result: PASS; standard explicit skip and recovery skip remained distinct.
- Persistence and Console result: PASS; application warning/error capture was empty. Browser-control Statsig telemetry timeouts were tool-side and recorded separately from application Console.
- Cleanup result: PASS; temporary pages/build artifacts/services were removed and 53 protected user deletions remained untouched.
- Overall: `PASS`.
- Linked bug or smoothness ids: none.

## Explicitly deferred, not bugs by default

- Multi-segment interval classification and recovery-time quick Task/rest creation.
- Split/subtask/triage and archived-task restoration/history/batch management.
- Timer setting UI, app-day offset UI, and dedicated historical DayPlan migration.
- Rest-item CRUD/reorder/process logging and usage-frequency display mode.
- Notifications/prompts, stats UI, full backup/restore/clear, diagnostic export, sync/account/cloud/conflict.
- Visual redesign, new navigation, or new pages.

If self-use shows one of these is genuinely blocking, record an observation and request a separate scoped decision; do not relabel it as completed Phase 2 work.
