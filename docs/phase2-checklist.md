# Phase 2 核心自用版验收清单

本清单服从 `docs/data-layer-spec-v4.md`，只验收 `docs/phase2-plan.md` 定义的核心自用范围。`[x]` 只能由测试、浏览器结果、diff/commit 与独立 Reviewer 证据共同支持；计划阶段保持 `[ ]`。

## A. 基线、纪律与隔离

- [x] A1 Phase 1 closeout 与最终 Reviewer `PASS` 已作为基线，不重复改写 Phase 1 历史。
- [x] A2 每个 S-step/子单元开工前记录 v4、checklist、文件、验证与不做范围。
- [x] A3 每个单元只有一个最终原子实现 commit；另有一个只含该单元 review-log 条目的 bookkeeping commit；两者都不 push。
- [x] A4 每个实现 commit 由独立只读 Reviewer 审精确 hash，findings 修复复审至 `PASS`；随后 bookkeeping commit 也由独立只读 Reviewer 核对，无未审 post-PASS 修改。
- [x] A5 `docs/phase2-review-log.md` 记录全部实现单元；bookkeeping commit 不递归记录自身。
- [x] A6 53 个 `docs/Draft/` / `docs/ai-context/` 用户未暂存删除未被恢复、覆盖、暂存或提交。
- [x] A7 没有修改 v4、AGENTS.md、CLAUDE.md 或 Phase 1 plan/checklist/review log。
- [x] A8 每个单元执行 direct/full test、typecheck、build、`git diff --check` 与范围相称的浏览器冒烟；数据单元至少验证当前生产入口/核心回归、reload 与 clean console；lint 不存在时如实记录。

## B. DayPlan 预算与今日排期余量

- [x] B1 `freeMin` 仅在所有 deduction `hours*60` 求和后最终 round，负数存 0。
- [x] B2 conservative/optimistic 使用 DayPlan 自身 `settingsSnapshot`，不读取当前 Settings 改写历史解释。
- [x] B3 conservative 使用完整组公式，optimistic 使用 `floor(freeMin/(focus+shortBreak))`。
- [x] B4 workWindow 为非负整数；deduction id 为 UUID v7、label 非空、hours > 0。
- [x] B5 workWindow 更新重算持久化 estimate，并写 `dayPlan.updated`；无变化不写 Event。
- [x] B6 deduction add/update/remove 更新正确内嵌数组，写各自 `dayPlan.deduction*` Event。
- [x] B7 deduction 操作按 deductionId 稳定定位，不用 label 定位。
- [x] B8 估算展示写 `dayPlan.budgetEstimated`，payload 镜像 budgetMode、两种估算和 workWindow。
- [x] B9 预算确认写 `budgetPomodoros`/`budgetMode` 与 `dayPlan.budgetAccepted`，实体/Event 同事务。
- [x] B10 manual 预算为非负整数；conservative/optimistic 确认值来源明确，不触发 P3 `budgetModeChanged`。
- [x] B11 今日 completed focus 数按 Session 事实时间+timezone+当前 offset 派生目标 appDate；不依赖 dayPlanId/localDate。
- [x] B12 per-task completed count 只含非删除 `type=focus,status=completed`，使用 Session 事实。
- [x] B13 `remainingPomodoros=max(0,estimate-completedValidFocusCountForTask)`。
- [x] B14 capacity=`budget - todayCompletedFocus - Σ(today unfinished remaining)`；completed/archived/deleted 不占用，splitNeeded 占用，允许负值。
- [x] B15 查询/命令有公式、边界、appDate、atomic rollback 与 Event mirror 测试。
- [x] B16 既有“估算”入口可用，延续当前布局/样式。
- [x] B17 UI 可编辑 work window 及 fixed/life deduction 的 add/update/remove。
- [x] B18 UI 展示 free time、保守/乐观结果并可确认 conservative/optimistic/manual 预算。
- [x] B19 “余 N”使用 B14 真值；负值明确显示超载但不阻止加任务。
- [x] B20 reload 后预算与扣除项持久化，历史 DayPlan 不被重写。
- [x] B21 浏览器流程及 console warning/error 检查通过。

## C. UnresolvedInterval 检测、恢复与归类

- [x] C0 用户或更高权威文档已明确 interval startedAt/endedAt、原 Session endedAt、恢复 actualDuration 的边界/输入事实；实现和测试没有自行发明时间真值。
- [x] C1 只对 active focus/shortBreak/longBreak 建立恢复流程；不把普通历史或任意手工时间变成 interval。
- [x] C2 检测创建完整有效 UnresolvedInterval，source 只取 appReopened/systemRecovered 等 v4 枚举。
- [x] C3 `interval.detected` 顶层 session/task/dayPlan/interval 关联和 payload 正确。
- [x] C4 同一 active Session 重复加载不会重复创建 pending interval/Event。
- [x] C5 检测实体与 Event 同事务；失败整体回滚。
- [x] C6 recovered focus 可由用户确认 completed 或 discarded；不得自动判定。
- [x] C7 recovery-discard 写 `focus.discarded.reason=userConfirmedAfterRecovery`，不冒充 userInitiated。
- [x] C8 recovered break 可确认 completed 或 skipped。
- [x] C9 recovery-skipped break 写 status=skipped、actualDuration=0、skipKind=missed，只写 interval.sessionResolved，不写 break.skipped。
- [x] C10 recovered completed focus/break 同步写对应 focus.completed/break.completed，与 interval.sessionResolved 同 correlationId。
- [x] C11 恢复提交的 Layer 1 与 Layer 2 在一个事务、一个 correlationId 内完成。
- [x] C12 ignore 更新 interval 为 ignored/ignoredAt/ignoreReason，不建 Session、不软删除，并写 interval.ignored。
- [x] C13 extraFocus 为 completed、taskId 必填、originIntervalId 正确、plannedDuration null、actualDuration 正整数。
- [x] C14 extraRest 为 completed、taskId null、originIntervalId 正确、actualRest 为有效 key 或 null、actualDuration 正整数。
- [x] C15 单段 extra Session 的 startedAt/endedAt/actualDuration 在 interval 边界内一致，不与已确认原 Session 时段重叠。
- [x] C16 interval.classified 顶层关联/payload 镜像 Session 与 interval；interval 最终为 classified。
- [x] C17 已 classified/ignored interval 不能重复提交；重复检测/提交有直接测试。
- [x] C18 标准 Session `actualDuration` 来自明确恢复输入，不用 endedAt-startedAt 反推。
- [x] C19 普通 complete/discard/interrupt/completeBreak 写入口继续拒绝 recovered Session。
- [x] C20 reload/新 runtime 自动进入 appReopened 恢复 UI，不显示普通计时写按钮。
- [x] C21 同 runtime 隐藏后在后台越过计时终点时进入 systemRecovered，不自动完成。
- [x] C22 未越过计时终点的短暂隐藏可继续当前 runtime Session。
- [x] C23 UI 同时收集原 Session 明确结果与剩余时段 ignore/单段 classification 后再原子提交。
- [x] C24 extraFocus 只选择已有有效 Task；extraRest 只选择有效适用休息项；快捷创建后置。
- [x] C25 恢复完成后正常 pending break/focus 流程可继续。
- [x] C26 focus reload、break reload、background boundary、ignore、extraFocus、extraRest 浏览器冒烟通过。
- [x] C27 页面 warning/error 检查与 reload 持久化通过。

## D. 核心 Task 生命周期

- [x] D1 手动完成只允许 active/splitNeeded 有效 Task。
- [x] D2 manual completion 写 status=completed、completedAt、completionSource=manual。
- [x] D3 `task.completed.validFocusCountAtCompletion` 从历史 completed standard focus 派生，可为 0 或 >0，不硬编码 0。
- [x] D4 manual completion 不创建 Session，不伪造番茄。
- [x] D5 取消完成只允许尚未归档 completed Task，恢复 active 并清空 completedAt/completionSource。
- [x] D6 取消完成追加 `task.uncompleted`，不修改/删除原完成 Event。
- [x] D7 完成归档只允许 completed Task，写 archived/outcome=completed/archivedAt，并保留 completedAt/completionSource。
- [x] D8 完成归档追加 `task.archived`。
- [x] D9 归档今日 Task 时同步从 DayPlan.taskIds 移除并写 `dayPlan.taskRemoved(reason=taskArchived)`，共享 correlationId。
- [x] D10 不物理删除 Task；既有软删除路径回归通过。
- [x] D11 活动清单重排只改 Task.sortIndex，写 `task.reordered`，不改 DayPlan.taskIds。
- [x] D12 今日重排仍只改 DayPlan.taskIds，既有路径回归通过。
- [x] D13 list reorder、manual complete/uncomplete/archive 有 Event mirror 与原子回滚测试。
- [x] D14 completed/archived Task 不出现在 active timer picker。
- [x] D15 archived Task 不出现在 today/active/completed-current UI；历史实体/Event 保留。
- [x] D16 不实现 task restored、split/subtask/triage。
- [x] D17 UI 可从活动或今日手动完成 Task。
- [x] D18 已完成区可取消完成。
- [x] D19 已完成区可确认归档。
- [x] D20 活动清单可拖拽重排且 reload 保持顺序。
- [x] D21 UI 延续当前两栏，无新历史页/批量 UI。
- [x] D22 浏览器实体/Event/持久化与 warning/error 检查通过。

## E. 标准休息出口与收工

- [x] E1 pending completed focus 可明确跳过尚未开始的标准 break。
- [x] E2 pending skip 创建合法 skipped short/long Session，关联 sourceFocusSessionId，actualDuration=0，skipKind=explicitSkip。
- [x] E3 pending skip 写 `break.skipped`，payload 与 Session 镜像。
- [x] E4 active same-runtime break 可明确提前结束为 skipped/explicitSkip，actualDuration=0。
- [x] E5 active standard skip 不用于 recovered break；恢复仍只走 interval.sessionResolved。
- [x] E6 completed focus 后可由用户明确 `dayPlan.workEnded`；系统不得自动推断。
- [x] E7 workEnded payload appDate/localDate/session 关联/reason=userEndedWork 正确。
- [x] E8 workEnded 不创建 break Session，不写 break.skipped。
- [x] E9 pending break query 把 workEnded focus 视为已豁免。
- [x] E10 startFocus open-break guard 把 workEnded focus 视为已豁免。
- [x] E11 standard break cadence 仍从 completed standard focus 计算，第四个是 longBreak。
- [x] E12 skip/workEnded 实体与 Event 同事务，失败回滚。
- [x] E13 active/pending skip、workEnded 有直接命令/查询测试。
- [x] E14 不实现自动 skip、自动 workEnded、notification/prompt。
- [x] E15 pending break UI 提供开始休息、跳过休息、今日收工三个明确入口。
- [x] E16 active break UI 提供明确提前结束入口。
- [x] E17 skip 后可开始下一 focus；workEnded 后不再显示该 focus 的 break 机会。
- [x] E18 focus→shortBreak、第四 focus→longBreak 正常完成流程回归通过。
- [x] E19 final actualRest 与 after-break energy 既有流程回归通过。
- [x] E20 浏览器 Event/Session 与 warning/error 检查通过。

## F. 既有核心行为回归

- [x] F1 当前 appDate 初始化与模板任务幂等。
- [x] F2 list/today create、title/estimate edit、move、today reorder、soft delete。
- [x] F3 DayPlan 预算与任务操作在 reload 后保持。
- [x] F4 focus start/complete/user discard；不得有生产 fast-forward。
- [x] F5 shortBreak/longBreak start/complete 与最终 actualRest。
- [x] F6 energy dayStart/before/after/onReturn 只在用户提交时写；skip 无写入。
- [x] F7 interrupt 只写 Event，计数从 Event 派生。
- [x] F8 manual/pomodoro Task completion 均正确且可区分。
- [x] F9 appDate 不被 localDate 替代。
- [x] F10 Event append-only、syncable entity 软删除与事务原子性红线测试通过。
- [x] F11 `Session.actualDuration` 是时长事实源；统计/查询不重算 endedAt-startedAt。
- [x] F12 生产入口无旧 storage/旧 aggregate/双轨写。
- [x] F13 production build 与 clean console 浏览器流程通过。

## G. 后置与禁止范围

- [x] G1 无 P3 统计页或统计 UI。
- [x] G2 无 P3 budgetModeChanged、restItem process、notification/prompt 真实行为。
- [x] G3 无 P4 全量备份/恢复/清空或正式诊断体验。
- [x] G4 无 P5+ sync/account/cloud/conflict 行为。
- [x] G5 无视觉重设计、导航/两栏/计时主布局重构。
- [x] G6 无旧数据迁移、demo 真值、旧字段或新旧双轨写。
- [x] G7 P2 可延后项在 review log/自用 log 中可追踪，但不假装完成。

## H. 自用 Ready 与反馈闭环

- [x] H1 S0–S5 所有实现 commit 最终 Reviewer `PASS`，对应 log-only bookkeeping commit 也已核对，无未关闭 in-scope finding或未审 post-PASS 修改。
- [x] H2 `docs/phase2-review-log.md` 含每个最终 commit hash、映射、测试、浏览器、review、修复与风险。
- [x] H3 `docs/phase2-self-use-smoke.md` 可由另一轮执行重复完成核心流程。
- [x] H4 `docs/phase2-self-use-log.md` 提供 bug/边界/流畅度记录模板和回归状态。
- [x] H5 一轮完整 smoke 在最终实现 tip 上通过并记录环境/时间/结果。
- [x] H6 full test/typecheck/build 通过；lint 状态如实记录。
- [x] H7 工作区隔离、无 push、无范围外文件已最终确认。
- [x] H8 已进入“用户自用观察与 bug 收集”阶段，未自行推广或扩大上线范围。
