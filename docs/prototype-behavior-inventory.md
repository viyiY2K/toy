# 原型行为对照表 / Phase 1 防踩坑清单（prototype-behavior-inventory.md）

> 生成日期：2026-06-04 · 基于当前 Web 原型代码（`app.jsx` / `timer.jsx` / `activities.jsx` / `components.jsx` / `data.jsx` / `stats.jsx`）。

---

## 1. 文档定位与权威边界

**本文档是什么**：Phase 1 数据层重构的"旧原型行为 → v4 映射"对照表与防踩坑清单。说明旧 Web 原型当前有哪些 UI 行为、旧代码大概写在哪、旧数据结构长什么样、这些行为在 v4 下应映射到哪些实体与事件、以及 Phase 1 应**接入 / 后置 / 禁用**的边界。

**本文档不是什么**：不是数据规范，不是第二份实施计划。

**权威边界（必须遵守）**：

权威从高到低：**v4 规范 → `phase1-plan.md` → `phase1-checklist.md` → 本文档（最低）**。本文档是四份中权威最低的"旧原型行为对照参考"，不得新增规范、不得覆盖 v4、不得成为第二份实施计划。

1. `data-layer-spec-v4.md` 是唯一权威数据规范，本文档不得覆盖、改写、替代它。所有字段、事件、payload、Phase 语义一律以 v4 为准。本文出现的旧字段**只用于识别旧行为 / 旧写入路径**，不得作为新模型依据。
2. `phase1-plan.md`（施工计划）、`phase1-checklist.md`（验收清单）均高于本文档。开发顺序：先读 v4 与 `phase1-plan.md`，用 `phase1-checklist.md` 验收，再用本文档核对旧 UI 入口是否被正确处理。
3. **Q3 决策口径**（本文档据此编写）：
   - Phase 1 **不**采取"只真实接入 v4 标注为 P1 的事件"的极窄路线。
   - Phase 1 接入 = "**v4 P1 数据地基 + 当前原型已有、用户正常可触发、且不接会导致核心事实丢失或现有核心流程退化的最小业务集**"。
   - 这**不等于**提前实现完整 P2/P3/P4 功能。
   - 凡 Phase 1 保留给用户正常触发的现有行为，**必须写入 v4 实体字段与 v4 Event**。
   - 凡 Phase 1 不接入 v4 的现有行为，**不得继续写旧结构**；应暂时隐藏、禁用、降级只读、标为 DEV-only，或明确挂账后置。
   - **禁止双轨**（旧结构 + 新结构同时写）；**禁止**以旧原型字段作为新数据真值。

---

## 2. 当前原型数据结构概览（现状，不美化）

所有状态存于 React `App` 单一 state，并镜像持久化到 **`sessionStorage['pomo-state']`**（`__v:5`）。无 IndexedDB，无独立事件存储。

- **任务对象**（`makeTask`，components.jsx:271）：`{ id, name, bucket:'list'|'today', subtasks[], estimates[](各轮预估数), estimated:bool, completed:number(已完成番茄数), pomoEvents[], status:'active'|'done', interrupts:{internal,external}, cancelledPomos:number, finishedAt:'HH:MM', completedDate:'YYYY-MM-DD' }`。
- **子任务**：内嵌对象 `{ id, name, done, doneAt:'HH:MM'|null }`——**非独立实体**。
- **番茄 / timer / session**：没有 Session 实体；只有 `timer:{ running, mode:'focus'|'short'|'long', elapsed(秒), round(1–4), currentTaskId, sessionStartedAt }`。番茄计数靠 `tasks[].completed` / `cancelledPomos` / `pomoEvents[]` 与全局 `log[]` 叠加。
- **今日待办判断**：`t.bucket === 'today'`（v4 已废止 `bucket`）。
- **活动清单判断**：`t.bucket === 'list'`。
- **能量记录**：无独立记录；能量值嵌入 `log[]` 条目（`energy-check` / `focus-end` / `break-end` 的 `energy` 字段）。
- **打扰记录**：两处——任务聚合 `interrupts:{internal,external}` + `log[]` 逐条 `interrupt-internal/-external{taskId}`（含 `HH:MM`）。
- **休息**：`log[]` 的 `break-end`/`long-break-end`（`suggestion/suggested/swapped`）；清单 `restSuggestions:{short:[字符串], long:[字符串]}`（裸字符串，无 key/appliesTo/isBuiltIn）。
- **设置**：`settings:{ focusMin:25, shortMin:5, longMin:20, earlyBreakThresholdMin:5, lifetimePomos:47 }`（**无编辑 UI**）。
- **预算**：`budget:{ start, end, adjust, deductions:[{id,label,hours}] }`。
- **ID**：`uid()`（components.jsx:266）生成 7 位 base36，**非 UUID v7**。

---

## 3. 当前原型用户行为总览表

> "未发现" = 代码中无该用户入口。⚠️ = 与 v4 语义/范围有差异。DEV = 测试/演示入口，非正常用户路径。

| 行为 | UI 入口 | 组件/文件:行 | 旧写入位置 | 是否产生 v4 应记录事实 |
|---|---|---|---|---|
| 创建任务（活动清单/今日输入框） | ✅ | activities `startAddDraft`/`addTodayTask`(90/132) | state `tasks[]` | ✅ 任务创建 |
| 编辑任务标题 | ✅ | activities `updateTaskName`(143) | `tasks[].name` | ✅ 标题变更 |
| 删除任务（活动清单，硬删） | ✅ | activities `deleteTask`(142) | `tasks[]` 过滤 | ✅ 删除（v4 应软删） |
| 完成任务（仅计时流程） | ✅ | timer `markTaskDone`/`markDoneFromRest`(180/194) | `status='done'/finishedAt/completedDate` | ✅ 任务完成 |
| 取消完成任务 | ❌ 未发现 | — | — | — |
| 归档任务 | ❌ 未发现 | — | — | — |
| 拆分任务 | ✅ | timer `splitTask`(225) | 改名"｜待拆分"+移回 list+清零，log `task-split` | ⚠️ 与 v4 拆分归档语义差异大 |
| 创建/编辑/完成/删除子任务 | ✅ | timer/activities `addChild`/`toggleSubtask`/`deleteSubtask` 等 | `tasks[].subtasks[]` | ✅（v4 子任务=独立 Task） |
| 调整预估番茄数 | ✅ | activities `setEstimate`(291，限1–9)；timer `continueTask`(217，追加轮次限1–5) | `estimates[]` | ✅（⚠️ 范围与 v4 1–7 不符） |
| 加入今日待办 | ✅ | activities `moveToToday`/`urgentToToday`(239/306) | `bucket='today'` | ✅ |
| 从今日待办移除 | ✅ | activities `moveToList`/`sendTodayToList`(260/295) | `bucket='list'`+清零 | ✅ |
| 今日任务排序 | ✅ | activities `reorderToday`(280) | `tasks[]` 顺序 | ✅ |
| 开始专注 | ✅ | timer `toggleRun`(55) | `timer{}` | ✅ |
| 完成专注 | ✅ | timer `commitStateRecord`(127) | `completed++`，log `focus-end` | ✅✅ 有效番茄（核心） |
| 作废/放弃专注 | ✅ | timer `commitDiscardPomo`(110) | `cancelledPomos++`，log `focus-discarded` | ✅ 作废 |
| 开始短休/长休 | ✅（完成专注后置 break 模式，用户点圆环启动） | timer `toggleRun` | `timer.mode` | ✅ |
| 完成短休/长休 | ✅ | timer `commitRecovery`(162) | log `break-end`/`long-break-end` | ✅ |
| 记录能量 | ✅（开始前 / 专注后 / 休息后 3 处，Bar10 1–10） | timer 73/127/162 | `log[].energy` | ✅✅ 能量（核心） |
| 记录心情/mood | ❌ 未发现 | — | — | —（v4 Phase 1 mood 本写 null） |
| 记录打扰 | ✅（侧栏 brain/bell） | timer `interrupt`(84) | `interrupts++`，log `interrupt-*` | ✅✅ 打扰（核心） |
| 选择/换休息建议 | ✅（rest-recover 选择器 + shuffle） | timer 363/633 | log `suggestion/suggested/swapped` | ✅ 最终选择是事实；过程是 P3 |
| 自定义休息建议 | ✅（选择器内"添加"） | timer 608 | `restSuggestions[mode]` 追加裸字符串 | ✅（⚠️ 旧结构无 key/appliesTo） |
| 计划外紧急（捕获/转今日/转清单/删除） | ✅ | timer `addUrgent`(256)；activities `urgentTo*`(306+) | state `urgent[]` | ✅ 待分流（v4 triage.*） |
| 预算估算（时段/扣除） | ✅（"估算"弹窗） | activities `showPlanner`/`updateBudget` | state `budget{}` | ✅ 属完整 DayPlan 管理 |
| 设置计时时长 | ❌ 未发现编辑 UI（仅侧栏只读展示） | — | — | — |
| 设置每日任务模板 | ❌ 未发现 | — | — | — |
| 数据导入/导出 | ❌ 未发现 | — | — | — |
| **跳到段末** | DEV（"演示：跳到段末"按钮） | timer `skipToEnd`(96/339) | `timer.elapsed` 强推到段末 | ❌ 测试工具，非用户行为 |
| **提早结束（快进到段末）** | DEV（`requestEarlyBreak` 在 break 模式快进） | timer 102 | `timer.elapsed` | ❌ 测试快进，**不是** break.skipped |
| **重置演示** | DEV（侧栏按钮） | app.jsx `reset`(20) | 清 sessionStorage + 重载 INITIAL | DEV（v4: demo.*/data.cleared） |
| 默认加载 demo 数据 | DEV（启动即加载 INITIAL） | data.jsx | 默认 state | DEV（⚠️ 与 v4「新用户空白」冲突） |

---

## 4. 行为到 v4 实体 / 事件映射表

> 事件名严格取自 v4 §7。**注意：v4 没有 `interrupt.recorded`**；正确为 `interrupt.internal` / `interrupt.external`（§7.8）。

| 当前原型行为 | 旧写入 | v4 应写实体 | v4 应写事件 | 同事务 / correlationId | 备注 |
|---|---|---|---|---|---|
| **今日输入框直接新建任务** | `tasks[](bucket=today)` | Task（写 estimateRounds[0]）+ DayPlan.taskIds | `task.created(source='manual')` + `dayPlan.taskAdded` | 共享 correlationId | **新任务诞生后被加入今日**，不是"移入"，**不写 task.movedToToday** |
| **活动清单已有任务拖入/加入今日** | `bucket: list→today` | DayPlan.taskIds + | `dayPlan.taskAdded` + `task.movedToToday` | 共享 correlationId | **已有 Task 的今日安排变化** |
| 系统每日模板生成「计划准备」 | INITIAL/默认 | Settings + DayPlan + Task | `settings.initialized`（首次默认设置时）/ `dayPlan.created` / `task.created(source='systemDailyTemplate')` / `dayPlan.taskAdded(source='systemDailyTemplate')` | 共享合理 correlationId（以 v4 §7.3 与 phase1-plan Q2 决策为准） | DayPlan 最小初始化闭环 |
| 手动创建任务（活动清单） | `tasks[]` | Task（estimateRounds[0]） | `task.created(source='manual')` | 单事件 | 已是 P1 |
| 编辑标题 | `name` | Task | `task.updated(field='title')` | 单事件 | |
| 删除任务（活动清单） | 硬删 splice | Task 软删（`deletedAt`+`status='deleted'`） | `task.deleted` | 实体+事件同事务 | ⚠️ 原型硬删→须改软删 + tombstone |
| 完成任务（计时流程内） | `status='done'` | Task（status/completedAt/completionSource）+ task.completed payload.validFocusCountAtCompletion | `task.completed` | 同事务 | 计时收尾确认→`completionSource='pomodoro'`，带 sessionId；`validFocusCountAtCompletion` 是 `task.completed` 事件 payload 快照，不写入 Task 本体 |
| 调整预估 | `estimates[]` | Task（estimateRounds 追加） | `task.estimateAdjusted(round=2/3)` | 同事务 | ⚠️ 范围 1–9/1–5 → v4 限 1–7；"每轮一个数"→"每轮总量" |
| 移出今日 | `bucket: today→list` | DayPlan.taskIds − | `dayPlan.taskRemoved` + `task.movedToList` | 共享 correlationId | |
| 今日排序 | 数组序 | DayPlan.taskIds 重排 | `dayPlan.taskReordered` | 单事件 | |
| 开始专注 | `timer.running` | Session(focus, active) | `focus.started` | 同事务 | 已是 P1 |
| 完成专注 | `completed++`/log | Session→completed（endedAt/actualDuration） | `focus.completed` | 同事务（常与 afterFocus 能量同次） | ⭐ 不接=有效番茄事实丢失 |
| 作废专注 | `cancelledPomos++` | Session→discarded | `focus.discarded(reason='userInitiated')` | 同事务 | |
| 开始休息 | `timer.mode` | Session(shortBreak/longBreak, active，带 sourceFocusSessionId) | `break.started` | 同事务 | |
| 完成休息 | log break-end | Session→completed（actualRest） | `break.completed`（payload 含 `actualRest`） | 同事务（常与 afterBreak 能量同次） | 见 §6 actualRest 口径 |
| 记录能量 | `log[].energy` | EnergyRecord（energyLevel，source 分类） | `energy.recorded` | 与对应 focus/break 同次共享 correlationId | ⭐ 不接=能量事实丢失；source：dayStart/beforeFocus/onReturn、afterFocus、afterShortBreak/afterLongBreak |
| 记录打扰 | `interrupts++`/log | （仅 Event，无 Session 字段，§3.3 规则 7） | `interrupt.internal` / `interrupt.external`（带 sessionId/taskId） | 单事件 | ⭐ 不接=打扰事实丢失 |
| 休息项目最终选择 | log suggestion | Session.actualRest（引用 restSuggestions.key） | 体现在 `break.completed.payload.actualRest` | 同休息完成事务 | **P1 必接最终结果**；未选写 null |
| 休息建议展示/换一个/选择过程 | log suggested/swapped | —（Session 已存 actualRest） | `restItem.shown`/`restItem.shuffled`/`restItem.selected`/`restItem.changed`（P3） | — | **P3 后置过程事件** |
| 自定义休息建议 | 裸字符串 | Settings.restSuggestions（key/appliesTo/isBuiltIn，统一创建函数生成 key） | `restItem.created`（P2） | 实体+事件同事务 | P2 |
| 子任务全套 | 内嵌 subtasks | 子任务=独立 Task（parentId） | `subtask.added` / `task.updated` / 子 Task `task.completed` / `task.deleted` | 同事务 | P2（模型重构） |
| 拆分任务 | 改名+移回 | 原 Task 归档 + 新 Task | `task.split`+`task.archived(outcome='split')`+`task.created(source='splitChild')` | 三事件共享 correlationId | P2（按 v4 重做） |
| 计划外紧急（捕获/转今日/转清单/删除） | `urgent[]` | Task（metadata.triageStatus='pending'）+ 可能 DayPlan | `triage.captured` / `triage.movedToToday` / `triage.movedToList` / `triage.dismissed` | 共享 correlationId | P2 |
| 预算估算 | `budget{}` | DayPlan.estimate/budget* | `dayPlan.budgetEstimated`/`budgetAccepted`/`deduction*` | 同事务 | P2（完整 DayPlan 管理） |
| 设置计时时长 | —（无 UI） | Settings | `settings.timerUpdated` | — | P2（无入口=无行为） |
| 跳到段末 / 提早快进 | `timer.elapsed` | —— | —— | —— | DEV 测试，不映射；见 §6 |
| 重置演示 / 默认 demo | sessionStorage | —（DEV） | `demo.cleared`/`demo.loaded`/`data.cleared` | — | DEV-only，不进统计 |

---

## 5. Q3 · Phase 1 接入分级

### A · Phase 1 必接（P1 数据地基 + 现有核心行为最小集，必须写入 v4 实体与 Event）

**A0. 当前 appDate DayPlan 最小初始化闭环**（与 phase1-plan S11、§10.2 一致）
- 创建默认 Settings；创建当前 `appDate` 的 DayPlan；按 `dailyTaskTemplates(autoAddToDayPlan=true)` 自动生成「计划准备」任务并置于 `DayPlan.taskIds` 第一位。
- 事件：`settings.initialized`（仅首次创建 Settings）/ `dayPlan.created` / `task.created(source='systemDailyTemplate')` / `dayPlan.taskAdded(source='systemDailyTemplate')`，共享同一 correlationId。

**A1. 任务基础行为**
- 手动创建任务 → `task.created(source='manual')`
- 今日输入框创建任务 → `task.created(source='manual')` + `dayPlan.taskAdded`（**不是** task.movedToToday）
- 编辑任务标题 → `task.updated(field='title')`（或 v4 对应字段更新事件）
- 调整预估番茄数 → `task.estimateAdjusted`（收敛到 1–7、轮次总量语义）
- 删除活动清单任务 → v4 软删除（`deletedAt`+`status='deleted'`）+ `task.deleted`
- 计时流程内任务完成 → `task.completed`

**A2. 今日待办基础行为**
- 已有任务加入今日 → `dayPlan.taskAdded` + `task.movedToToday`
- 从今日移出 → `dayPlan.taskRemoved` + `task.movedToList`
- 今日排序 → 更新 `DayPlan.taskIds` 顺序 + `dayPlan.taskReordered`
- **明确禁止**继续用旧 `bucket` 判断今日/活动清单（一律由 `DayPlan.taskIds` 与 Task.status 派生）

**A3. 标准计时闭环**
- 开始 focus → `focus.started`
- 完成 focus → `focus.completed`
- 作废 focus → `focus.discarded`
- 开始 shortBreak/longBreak → `break.started`
- 完成 shortBreak/longBreak → `break.completed`
- **不接正式 `break.skipped` UI**；只预留 schema/event type/validator（见 §6）

**A4. 自我觉察核心事实**
- 能量记录 → `EnergyRecord` + `energy.recorded`
- 打扰记录 → `interrupt.internal` / `interrupt.external`
- 休息完成时的最终休息项目 → `Session.actualRest` + `break.completed.payload.actualRest`（未选写 null）

### B · Phase 1 后置（有 UI，但本轮不接 / 不完整接；**后置期间不得继续写旧结构**）

> 原则：若入口本轮仍保留给正常用户使用，就必须按 v4 接入；否则隐藏/禁用/降级只读/标 DEV-only/明确挂账。

- **子任务独立化**（旧内嵌 `subtasks[]` → v4 独立 Task + `parentId`）→ P2
- **拆分归档 / `splitNeeded` / lineage / `task.split` 完整流程** → P2
- **完整 DayPlan 预算、扣除、收工、计划管理流程** → P2
- **triage 全套**（计划外紧急捕获/转今日/转清单/dismiss）→ P2
- **Settings 编辑入口**（计时时长、每日模板、休息建议管理等）→ P2
- **extraFocus/extraRest 与 UnresolvedInterval 真实恢复流程** → P2
- **统计页真实化 / 基础统计接入** → P2
- **restItem 展示、候选、洗牌、选择过程事件**（`restItem.shown/shuffled/selected/changed`）→ P3（注意：最终结果 `actualRest` 不后置，见 A4 / §6）
- **notification / prompt 系统、更完整的 UI 提醒与引导** → P3
- **正式数据导入/导出、清空/备份恢复** → P4
- **诊断日志导出** → P4（当前计划口径）
- **多端同步、云端备份/跨设备合并/同步冲突** → P5+

### C · 无当前 UI，仅结构预留（红线 10/11：建 schema/枚举/字段，行为后置，本轮不接）

- 取消完成 `task.uncompleted`、完成归档 `task.archived`
- mood（EnergyRecord.mood，Phase 1 写 null）
- `break.skipped`（结构可承载，无正式 UI）
- 设置每日任务模板编辑、`settings.timerUpdated`/`settings.appDayStartOffsetUpdated`
- UnresolvedInterval 全表全字段（结构 P1，行为 P2+）
- `statsBaseline.*` / `lifetimePomodoroBaseline`（字段 P1，事件/UI P2+）
- data/demo/diagnosticLog/notification/prompt 全量 EventType 枚举 + payload 类型（结构 P1 建齐）

---

## 6. 已确认修正点

**6.1 今日输入新建 vs 已有任务移入今日（区分两条语义）**
- 今日输入框**直接新建**：`task.created(source='manual')` + `dayPlan.taskAdded`。这是新任务诞生后被加入今日，**不写** `task.movedToToday`。
- 活动清单**已有任务**拖入/加入今日：`dayPlan.taskAdded` + `task.movedToToday`。这是已有 Task 的今日安排变化。
- 每日模板自动生成：`settings.initialized`（首次默认设置）/ `dayPlan.created` / `task.created(source='systemDailyTemplate')` / `dayPlan.taskAdded(source='systemDailyTemplate')`，共享合理 correlationId。

**6.2 测试快进按钮 ≠ 正式 break.skipped**
- 原型的"跳到段末"（`skipToEnd`，timer:96/339，按钮 title="演示：跳到段末"）与"提早结束休息快进"（`requestEarlyBreak` 在 break 模式，timer:102）都是**测试快进工具，不是正常用户路径**。
- Phase 1 **不新增**"跳过休息 / 提前结束休息"的正式入口。正常用户休息路径只接 `break.started` + `break.completed`。
- `break.skipped` 在 Phase 1 只需 schema / event type / validator 可承载，**不接入正常 UI 行为**。
- 测试按钮如保留，必须标为 **DEV-only**，不得写入正式用户数据；也可在重构中移除。
- 未来若正式加入"跳过休息"按钮，再按 v4 写 `break.skipped(skipKind='explicitSkip')`。

**6.3 actualRest（P1 必接）vs restItem 过程事件（P3 后置）**
- 当前 UI 已有休息项目选择框，因此 Phase 1 **必须保存"用户最终实际选择/执行的休息项目"**：写入 `Session.actualRest`（引用 `restSuggestions.key`），并在 `break.completed.payload.actualRest` 同步体现；用户未选择时写 `null`。
- **后置到 P3 的是过程事件**（展示、候选列表、洗牌、换一个、选择过程）：`restItem.shown` / `restItem.shuffled` / `restItem.selected` / `restItem.changed` 等。
- **不要把"最终选择结果 actualRest"也后置**——后置的是 restItem 过程，不是最终结果事实。

---

## 7. 不得继承的旧字段 / 旧写入路径（强风险段）

以下旧结构**只用于识别旧行为，不得继续作为 v4 正式数据写入路径**，也不得作为新数据真值：

- `bucket`（v4 已废止；今日/活动清单一律由 `DayPlan.taskIds` + Task.status 派生）
- `completed`（聚合番茄计数；v4 不在 Task 存番茄数，一律由 Session 派生）
- `cancelledPomos`（作废计数；由 Session `discarded` 派生）
- `interrupts{}`（聚合打扰计数；由 `interrupt.internal/.external` Event 派生）
- `pomoEvents`（原型专用派生标记结构）
- 旧语义的 `estimates[]`（"每轮一个数"；v4 用 `estimateRounds` 每轮记录"总量"对象）
- `log[]` 里 `HH:MM` **无日期、无时区**的历史条目
- 非 UUID v7 的 `uid()`（必须改为单一 ID 入口产出 UUID v7）
- `restSuggestions` 裸字符串（v4 需 key/appliesTo/isBuiltIn/sortIndex 等）
- `settings.longMin = 20`（仅旧原型状态，**不作为 v4 默认值**；v4 默认长休固定为 15，初始化以 v4 为准，见 §8.3）
- `settings.earlyBreakThresholdMin`（v4 无此字段）
- `settings.lifetimePomos`（旧命名/旧语义；v4 为 `lifetimePomodoroBaseline`，语义为"完整番茄循环基数"）
- 内嵌 `subtasks[]`（v4 子任务是独立 Task + `parentId`）

**强调**：禁止"读旧字段当真值"或"旧结构与 v4 结构双轨写"。

---

## 8. 已确认决策（Q4 / Q5 / Q6，2026-06-04）

> Q1–Q6 已在 `phase1-plan.md` §5 全部收口确认，本节登记与本对照表直接相关的 Q4/Q5/Q6（Q3 口径见本文 §1 权威边界第 3 条、§5 A/B/C 分级、§6 已确认修正点）。无任何"待确认"项遗留。

**8.1 Q5 已确认：旧原型数据不迁移，空库起步**
- 旧原型数据均为假 / 乱数据，**不迁移、不复用**。Phase 1 从空白正式库起步，首启走 DayPlan 最小初始化闭环。
- 不迁移旧 `sessionStorage['pomo-state']`；不把旧 demo/INITIAL 伪装成真实用户数据；不把旧 `log[]`/`completed`/`cancelledPomos`/`interrupts{}`/`bucket`/内嵌 `subtasks[]` 还原成 v4 历史 Session/Event/EnergyRecord；**不为迁移旧脏数据污染 v4 新模型**。
- A 类接入是**从重构后向前写 v4 正式数据**，本就不依赖迁移。
- 检测到旧 storage 可忽略 / 清理 / DEV-only 备份后不读取，但不作为正式迁移流程。
- demo 数据若保留必须 **DEV-only**、与真实数据隔离、不进统计、不作新用户默认正式数据；默认加载 demo 与 v4「新用户空白」冲突，按此口径处理（不再挂起）。

**8.2 Q4 已确认：`error.unexpectedState` 只做 writeValidation**
- Phase 1 只在**写入校验**路径触发：每次 create/update/soft-delete/appendEvent 前做 v4 字段一致性校验，违反即拒绝写入并记 `error.unexpectedState`（`context.detectedBy='writeValidation'`）。
- **不做** startupCheck（启动全库扫描）、不做 readValidation（读取全量巡检）、不做旧坏数据自动修复 / 错误修复 UI / 恢复流程复杂异常处理。
- 分工：存储写失败 → `error.dataWriteFailed`；状态违反 v4 约束 → `error.unexpectedState`。

**8.3 Q6 已确认：默认长休 15，以 v4 为准**
- Phase 1 初始化 Settings 取 v4 默认：`focusMinutes=25` / `shortBreakMinutes=5` / `longBreakMinutes=15` / `longBreakEvery=4`。
- 原型旧 `settings.longMin=20` 只是旧状态，**不继承**（见 §7）；用户日后改长休属 Settings 后续行为（P2），不影响 Phase 1 默认值。

---

## 9. 给 Phase 1 开发的检查清单

开发某个旧 UI 入口前，逐条核对：

- [ ] 该入口属于 §5 的 A / B / C 哪一类？
- [ ] 若 A 类：是否已写入 v4 实体字段 **且** 写入对应 v4 Event？是否原子同事务？多事件是否共享 correlationId？
- [ ] 是否仍在读/写任何 §7 列出的旧字段当真值？（若是，必须改为派生或 v4 字段）
- [ ] 今日/活动清单判断是否已改为 `DayPlan.taskIds` + Task.status 派生，彻底弃用 `bucket`？
- [ ] "今日新建"走 `task.created`+`dayPlan.taskAdded`，"已有移入"走 `dayPlan.taskAdded`+`task.movedToToday`，二者未混用？
- [ ] 休息完成是否写了 `Session.actualRest` 与 `break.completed.payload.actualRest`（未选=null）？restItem 过程事件是否正确后置到 P3？
- [ ] 测试快进按钮（skipToEnd / 提早快进）是否未被当成正式 break.skipped？是否标 DEV-only 或移除？
- [ ] ID 是否走单一入口 UUID v7？时间戳是否带日期+时区，业务日是否走 `appDate` 派生？
- [ ] 若该入口本轮不接（B/C 类）：是否已隐藏/禁用/降级只读/标 DEV-only/挂账，而**没有**继续写旧结构？
- [ ] 是否避免了"旧结构 + 新结构双轨写"？
