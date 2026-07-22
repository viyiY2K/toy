# Phase 2 核心自用版实施计划

本文定义 Phase 2 核心自用版的施工顺序与范围。它服从 `docs/data-layer-spec-v4.md`，不改写字段、事件、payload、约束或统计口径。`docs/phase2-checklist.md` 是本阶段验收清单；`docs/phase2-review-log.md` 记录每个施工单元的实施与独立审查结果。

## 0. 基线与权威

- 角色：`Implementer`。
- 分支：`data-layer-refactor`。
- 规划基线 HEAD：`f07c1d90dfe1a6fc62ed7ef2225d521f9c20ef67 docs(phase1): record final closeout`。
- Phase 1 最终审查：`PASS`；被审实现 tip 为 `8b0da3f8a9beb3a1b485e147bfae02ca7a34c7cd`，所有 S-step finding 已关闭。
- 规划时基线验证：Vitest 36 files / 282 tests passed；TypeScript passed；Vite build 67 modules passed；仓库没有 lint script。
- 受保护工作区：53 个位于 `docs/Draft/` 与 `docs/ai-context/` 的用户既有未暂存删除不属于 Phase 2。不得恢复、覆盖、暂存、提交或吸收它们。

权威顺序：

1. `docs/data-layer-spec-v4.md`；
2. 本计划；
3. `docs/phase2-checklist.md`；
4. `AGENTS.md` 与根 `CLAUDE.md`；
5. Phase 1 plan/checklist/review log（只作已完成边界与回归依据）；
6. prototype inventory、UI backlog、历史草稿与附件（只读参考）。

## 1. 自用版范围判断

### 1.1 Phase 1 已真实完成，不重复施工

- Settings 与当前 `appDate` DayPlan 初始化、每日模板任务；
- 活动清单/今日任务创建、标题编辑、两栏移动、今日排序、预估调整、活动任务软删除；
- 标准 focus 开始/完成/主动作废，标准 shortBreak/longBreak 开始/完成；
- 番茄完成后 Task 完成确认；
- 最终 `actualRest`、能量与内/外打扰真实写入；
- IndexedDB 持久化、实体/Event 原子事务、Event append-only、软删除、appDate 与 `actualDuration` 红线；
- 刷新后 active Session 只读门禁，防止按普通流程伪造完成/作废/休息结果。

### 1.2 P2 自用必做

1. DayPlan 可用时段、扣除项、预算估算、预算确认，以及符合 §8.10 的今日排期余量。
2. active standard Session 的 `appReopened` / 明确后台越过计时终点恢复检测；原 Session 收尾；未知剩余时段忽略或单段归类为 extraFocus/extraRest。
3. 自用所需 Task 生命周期：手动完成、取消完成、完成归档、活动清单排序。
4. 标准休息的明确跳过/提前结束，以及 completed focus 后明确“今日收工”。
5. 覆盖以上能力和既有核心闭环的可重复自动回归、浏览器冒烟步骤与自用 bug/流畅度记录入口。

### 1.3 P2 可延后

以下都是 v4 已允许的 P2 行为，但不是当前核心自用闭环的阻塞项；只记录，不提前混入本阶段原子单元：

- 多段 UnresolvedInterval 拆分归类、归类时快捷创建 Task/休息项；
- 完整 task split/subtask/triage 工作流；
- restSuggestion 增删改、展示模式与每日模板管理；
- timer 设置、`appDayStartOffsetMinutes` 设置与历史 DayPlan 专门迁移；默认 25/5/15/4 足以开始核心自用，日界线继续为 0；
- `lifetimePomodoroBaseline` 设置入口；
- 诊断日志导出。当前单用户开发期先用可重复回归、浏览器日志与 review log；若自用期证明排障受阻，再独立立项最小 P2 导出，不与核心流程混做；
- Task note/actualWorkNote 的完整编辑体验、历史管理与复杂批量操作。

### 1.4 明确禁止提前实现

- P3 统计页、真实统计 UI、`dayPlan.budgetModeChanged` 行为分析、restItem 展示/洗牌/选择过程事件、notification/prompt；
- P4 全量备份/恢复/清空、正式诊断与正式数据管理体验；
- P5+ 账号、云端、同步、冲突解决；
- 旧数据迁移、demo 真值、新旧双轨写入；
- 视觉重设计、页面布局重构、设计体系替换；
- 自动 push。

## 2. 关键审计结论

### 2.1 今日可用番茄为何尚未实现

Phase 1 只创建全字段 DayPlan，初值为 `budgetPomodoros=0`、空 deduction、0 估算，并把 UI “估算”按钮保持禁用。当前没有命令更新 `workWindowMin`、增删改 deduction、按 `settingsSnapshot` 重算 `freeMin`/保守/乐观番茄、触发 `dayPlan.budgetEstimated`，也没有 `dayPlan.budgetAccepted` 的确认入口。

当前 UI 的“余 N”还是 Phase 1 占位算法：`budgetPomodoros - Σ(todayTasks.estimatedPomodoros)`。S1 必须改为 v4 §8.10：当天 completed standard focus 数 + 每个今日未完成任务的历史 `remainingPomodoros`，结果允许为负。

### 2.2 恢复边界

Phase 1 只阻止跨 runtime active Session 使用普通写路径，没有创建 UnresolvedInterval 或 interval Event。S2 必须延续“不猜测、不自动补完成”的原则：检测只建立待处理事实；所有完成/作废/跳过和 extra Session 均来自用户在恢复 UI 的明确确认；`actualDuration` 由恢复命令的明确输入写入，不用 `endedAt-startedAt` 反推。

最小自用范围只支持一次恢复操作中的“原 Session 收尾 + 忽略未知剩余时段”或“原 Session 收尾 + 单段 extraFocus/extraRest”。v4 支持的多段拆分保持后置。检测、原 Session 收尾和第二层处置必须保持幂等；同一次用户恢复提交的所有实体/Event 写入在一个事务、一个 `correlationId` 中完成。

**S2 用户决策门禁**：v4 没有保存页面关闭/挂起时刻，也没有指定发现旧 active Session 时 `UnresolvedInterval.startedAt/endedAt`、原 Session `endedAt` 与恢复输入 `actualDuration` 之间的精确边界来源。因此计划阶段不得把 wall-clock 差值、Session.startedAt、计划结束时刻或临时浏览器状态擅自提升为数据真值。S1 可以先施工；S2a 开工前必须把可选边界方案、各自数据后果和测试口径交给用户确认，或由更高权威文档先明确。未确认前不得编写 S2 生产实现，Checklist C0 保持未通过。

**已确认（2026-07-21）**：用户选择方案 A。检测时持久化保守事实包络 `[Session.startedAt, detectedAt]`；completed/discarded 原 Session 的 `actualDuration` 由用户输入，`endedAt` 由该输入确定；recovered skipped break 继续使用 v4 明定的确认时刻/0 秒/`missed`；可选单段 extra 使用另一明确正整数时长并限制在包络内。精确命令约束见 S2a ADR 与测试，Checklist C0 已解除开工门禁。

### 2.3 最小 UI 原则

预算编辑、恢复处理、任务操作和休息出口使用现有 card/button/input 与页面结构。允许小型内联面板、确认区和错误提示；仅在现有样式无法承载时局部修改 `styles.css`，不得改变导航骨架、两栏布局或计时主布局。

## 3. S-step 施工顺序

每个 S-step 或列出的独立子单元都必须：实现 → 直接测试 → 全量 test/typecheck/build（lint 若仓库新增则运行）→ 浏览器冒烟 → 自审 diff/红线/范围 → 一个本地原子**实现 commit** → 独立只读 Reviewer 审精确实现 commit → 修复并重测/amend → 复审至 `PASS` → 追加 review log → 创建一个仅含 review-log 的 bookkeeping commit → 独立只读 Reviewer 核对该 bookkeeping commit 与被记录 hash/verdict → 通过后才进入下一单元。绝不 push。

实现 commit 与 bookkeeping commit 的职责必须分开：前者是本施工单元唯一实现提交；后者只记录已经稳定的实现 hash 与审查证据，不得混入实现。bookkeeping commit 不在日志中递归记录自身，否则会形成不可终止的自引用；其核对结果由精确 commit review 输出与 Git 历史保留。这样既保证每个单元只有一个原子实现 commit，也避免在 Reviewer PASS 后留下未审文档修改。

### S0 · Phase 2 计划与验收封板

- 依据：v4 §3、§7、§10.3、§11；Phase 1 final closeout。
- 交付：本计划、`phase2-checklist.md`、`phase2-review-log.md` 初始结构。
- 预计文件：仅上述三个文档。
- 验证：文档交叉引用、`git diff --check`、工作区隔离、独立 Reviewer。
- 不做：生产源码、样式、规范/Phase 1 历史文档修改。

### S1a · DayPlan 预算事实、命令与排期查询

- 依据：v4 §3.2、§3.4、§7.3、§8.2、§8.10。
- 验收：Checklist B1–B15。
- 内容：预算纯函数；work window 与 deduction 原子命令；估算展示 Event；预算确认；正确的 per-task remaining 与 today planning capacity 查询。
- 预计文件：
  - 新增 `src/data/planning/dayPlanBudget.ts` 及测试；
  - 新增 `src/data/commands/dayPlanCommands.ts` 及测试；
  - 修改 `src/data/queries/currentTaskViews.ts` 及测试；
  - 修改 `src/data/index.ts`；
  - 新增对应 ADR。
- 验证：公式边界/舍入/扣除超窗；Event mirror；原子回滚；appDate 历史 Session 归属；全量 test/typecheck/build；启动当前 UI 并执行既有初始化/任务核心回归、reload 持久化与 clean console 浏览器冒烟，证明数据单元未破坏生产入口（预算特性浏览器验收由 S1b 承接）。
- 不做：UI、P3 budgetModeChanged、统计页。

### S1b · 最小预算 UI 与真实“余 N”

- 依据：S1a；v4 §3.2、§7.3、§8.10、§10.3。
- 验收：Checklist B16–B21、F1–F3。
- 内容：启用既有“估算”入口；编辑可用时段及固定/生活扣除；展示保守/乐观估算；确认 conservative/optimistic/manual 预算；显示真实 free time/budget/capacity/overload。
- 预计文件：`src/ui/ActivitiesView.jsx`、`src/ui/taskViewModel.js` 及测试；仅必要时局部修改 `styles.css`；可新增小型预算 view-model 文件/测试。
- 浏览器冒烟：新日初始化 → 估算 → 加/改/删 deduction → 确认预算 → 添加/完成任务后余量刷新 → reload 持久化。
- 不做：新计划页、历史 DayPlan、统计 UI、布局重构。

### S2a · UnresolvedInterval 检测与单次恢复原子命令

- 依据：v4 §3.3、§3.4、§3.6、§7.5–§7.6、§7.11、§8.1.3。
- 验收：Checklist C1–C19。
- 开工前置：先通过 §2.2 的 S2 用户决策门禁并在工作计划/review log 中记录确认结果；未确认不得实施。
- 内容：幂等检测 active standard Session；写 `interval.detected`；一个恢复提交原子完成 Layer 1 与 Layer 2；支持 ignore 或单段 extraFocus/extraRest；所有关联与时长边界验证；普通 timer 命令继续拒绝 recovered Session。
- 预计文件：
  - 新增 `src/data/commands/intervalCommands.ts` 及测试；
  - 新增 `src/data/queries/currentRecoveryView.ts` 及测试（或最小并入 currentTimerViews）；
  - 修改 `src/data/queries/currentTimerViews.ts` 及测试；
  - 修改 `src/data/index.ts`；
  - 新增对应 ADR。
- 验证：focus completed/discarded；break completed/skipped；ignore；extraFocus/extraRest；重复检测/重复提交；Event 集合/correlation；事务失败回滚；`actualDuration` 事实源；启动当前 UI 做既有 focus/break/reload 门禁与 clean console 浏览器回归（恢复特性 UI 验收由 S2b 承接）。
- 不做：UI、多段拆分、快捷创建 Task/rest item、事后手动补录任意 Session。

### S2b · 恢复 UI、reload 与后台越界处理

- 依据：S2a；v4 §3.6、§7.11；Phase 1 recovered-session gate。
- 验收：Checklist C20–C27、F4–F7。
- 内容：把只读“需要恢复处理”升级为最小确认流程；首次启动检测 `appReopened`；同 runtime 页面隐藏后若计时终点在后台越过，则先转为 `systemRecovered` 待确认，不自动完成；未越过终点可继续；提交后恢复正常流程。
- 预计文件：`src/ui/App.jsx`、`src/ui/TimerView.jsx`、`src/ui/timerViewModel.js` 及测试；必要时局部 `styles.css`。
- 浏览器冒烟：focus reload、break reload、后台越过终点、ignore、extraFocus、extraRest、恢复后继续标准 break/focus、无 warning/error。
- 不做：仅凭无键鼠活动检测离开、自动判定用户做了什么、视觉重构。

### S3a · 核心 Task 生命周期命令

- 依据：v4 §3.1–§3.2、§7.1、§7.3–§7.4、§8.5。
- 验收：Checklist D1–D16。
- 内容：手动完成（写真实历史有效 focus 数）、取消完成、完成归档、活动清单重排；归档时若在 DayPlan 中同步移除并写双侧语义所需 Event。
- 预计文件：`src/data/commands/taskCommands.ts` 及测试、`src/data/queries/currentTaskViews.ts` 及测试、`src/data/index.ts`、对应 ADR。
- 验证：状态矩阵、manual completion count、DayPlan 联动、排序、Event mirror、atomic rollback、软删除回归；启动当前 UI 做既有 task create/edit/move/reorder/reload 与 clean console 浏览器回归（新生命周期 UI 验收由 S3b 承接）。
- 不做：split/subtask/triage、恢复 archived Task（P4）、批量操作。

### S3b · Task 自用操作 UI

- 依据：S3a；v4 §3.1、§7.1、§7.4。
- 验收：Checklist D17–D22、F8–F10。
- 内容：活动/今日任务手动完成；已完成区取消完成与归档；活动清单拖拽排序；延续当前两栏和样式。
- 预计文件：`src/ui/ActivitiesView.jsx`、`src/ui/taskViewModel.js` 及测试；必要时局部 `styles.css`。
- 浏览器冒烟：list/today manual complete → undo → complete → archive；active reorder；reload；Event/实体结果检查。
- 不做：新页面、批量归档、历史管理。

### S4a · 标准休息出口与收工命令

- 依据：v4 §3.3、§7.3 `dayPlan.workEnded`、§7.6、§8.4、§8.6.4。
- 验收：Checklist E1–E14。
- 内容：未开始休息机会的明确 skip；active break 的 explicit skip；completed focus 后明确收工；pending-break 查询与新 focus guard 识别 workEnded 豁免。
- 预计文件：`src/data/commands/timerCommands.ts` 及测试、`src/data/queries/currentTimerViews.ts` 及测试、`src/data/index.ts`、对应 ADR。
- 验证：Session 字段、break.skipped/workEnded payload、open-break guard、Event/correlation、恢复 break 与标准 skip 不混用；启动当前 UI 做既有 focus→break、reload recovery gate 与 clean console 浏览器回归（新出口 UI 验收由 S4b 承接）。
- 不做：系统自动收工、把 active recovered break 写 break.skipped、notification。

### S4b · 标准流程出口 UI

- 依据：S4a；v4 §7.3、§7.6。
- 验收：Checklist E15–E20、F11–F13。
- 内容：pending break 的“跳过休息/今日收工”；active break 的“提前结束休息”；操作后可继续或收尾。
- 预计文件：`src/ui/TimerView.jsx`、`src/ui/timerViewModel.js` 及测试；必要时局部 `styles.css`。
- 浏览器冒烟：focus → skip → next focus；focus → workEnded；break active → explicitSkip；第四个 completed focus 仍给 longBreak。
- 不做：自动 skip、自动 workEnded、页面重构。

### S5 · 自用回归、冒烟手册与 Phase 2 closeout

- 依据：本计划、完整 Phase 2 checklist、Phase 1 review log。
- 验收：Checklist A–H 全部。
- 内容：跨域真实命令集成回归；可重复浏览器冒烟手册；bug/流畅度记录模板；完整红线扫描与全范围独立 Reviewer。
- 预计文件：新增 `src/data/commands/coreSelfUseFlow.test.ts`（若现有测试已充分可由等价聚合回归替代）、`docs/phase2-self-use-smoke.md`、`docs/phase2-self-use-log.md`，更新 `docs/phase2-review-log.md`。
- 验证：全量 test/typecheck/build；无 lint 时如实记录；`git diff --check`；独立浏览器全流程；精确 commit/range review；工作区隔离。
- 不做：为 closeout 顺手补后置功能。

## 4. 依赖顺序

```text
S0
 └─ S1a → S1b
     └─ S2a → S2b
         └─ S3a → S3b
             └─ S4a → S4b
                 └─ S5
```

顺序理由：先让 DayPlan 计划真值可用，再处理会永久阻塞 timer 的异常恢复；随后补 Task 整理和标准流程出口；最后做跨域回归。任何子单元未获 Reviewer PASS，不进入下一子单元。

## 5. 每个施工单元的固定工作计划

开工前必须记录：当前 S-step/子单元、对应 v4 章节、Checklist 项、精确文件、直接测试、该单元的浏览器冒烟（数据单元也必须做当前生产入口/核心回归与 clean console）、明确不做、是否触及用户修改。默认结论是“不触及 53 个历史文档删除”。

提交前必须确认：

- 只包含本单元文件；
- 实体与 Event 同事务；Event append-only；
- 日归属用 appDate；
- syncable entity 无物理删除；
- Session 时长事实只读 `actualDuration`；
- 无旧字段/旧存储/双轨写；
- 无 P3+ 行为；
- test/typecheck/build 结果；
- 浏览器 warning/error 与持久化结果；
- `git diff --check`、diff stat、用户删除隔离；
- 一个原子本地 commit，绝不 push。

## 6. Phase 2 自用 Ready 定义

只有以下全部成立才可标记 Ready：

1. S0–S5 每个施工单元均有一个最终原子实现 commit 和独立 Reviewer `PASS`，其 log-only bookkeeping commit 也经独立只读核对；
2. Checklist A–H 无未完成必做项；
3. 全量 test/typecheck/build 通过，lint 状态如实记录；
4. 预算、恢复、Task 生命周期、focus/shortBreak/longBreak、休息最终项、能量、打扰、skip/workEnded 的可重复浏览器冒烟通过；
5. reload/close/background 场景不自动伪造标准 Session 结果；
6. Phase 2 review log 含 hash、映射、验证、审查、findings 修复和遗留风险；
7. self-use smoke 与 bug/流畅度模板可供重复使用；
8. 53 个用户历史文档删除保持未触碰，未 push，未扩大至 P3+。

Ready 后进入“用户自用观察与 bug 收集”，不自行推广、不扩大上线范围。
