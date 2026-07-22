# 原始事实维度验收清单（Phase 1 数据结构验收基准）

> 基准文档：`data-layer-spec-v4.md`（4280 行，已通读）
> 用途：作为 Phase 1 数据结构的验收标准。核心原则——只要原始事实被如实记录，后续任何统计都能事后从历史数据算出；漏记的原始事实不可逆。
> 生成日期：2026-06-04

本清单严格分两部分：
- **第一部分**：规范已覆盖的原始事实维度（验收表）。只从 v4 正文摘录，不新增规范没有的维度。
- **第二部分**：后续可复查候选维度（本轮封板不纳入 Phase 1）。除已移入第一部分的原候选 #1 外，其余项本轮均不纳入 Phase 1，仅保留为后续产品阶段复查项。

---

# 第一部分：规范已覆盖的原始事实维度（Phase 1 结构验收表）

## Phase 1 验收使用说明

Phase 1 验收时，只检查本文件第一部分。第一部分即 Phase 1 数据结构验收基准，不需要另建第二套 checklist。

验收重点按「P1 结构状态」区分：

- **【P1 真值】**：Phase 1 必须建字段 / 事件结构，并在对应写入场景中按 v4 语义写真值。
- **【P1 预留·null/默认】**：Phase 1 必须建字段，但按 v4 要求写 `null` 或固定默认值；不要求 UI 或完整业务能力启用。
- **【P1 建结构·写入后置】**：Phase 1 必须建 EventType 枚举、payload schema 或实体字段结构；真实触发写入可按 v4 标注的后续 Phase 接入。

CodeX / 实现方验收时，应逐行检查：

1. 字段 / 事件 / payload schema 是否存在；
2. 类型、可空性、默认值、枚举约束是否符合 v4；
3. P1 真值项是否在对应写入路径中被正确写入；
4. P1 预留项是否按 null / 默认值写入；
5. 写入后置项是否至少完成结构预留，而不是被遗漏。

**「验收结果」列建议取值：未检查 / 通过 / 不通过 / 不适用。**

- `未检查`：默认状态，尚未验收。
- `通过`：结构、字段、类型、默认值、写入口径符合 v4。
- `不通过`：发现缺失、类型不符、默认值不符、写入规则不符等问题。
- `不适用`：该项在当前实现范围内有明确理由暂不验收，但必须在「备注」列说明原因。

第二部分是后续可复查候选维度，不作为 Phase 1 必验清单。本文件仍以 `data-layer-spec-v4.md` 为唯一事实源，不构成第二套规范。

---

## Codex review 后置项 / Deferred review notes

本节只记录 Codex review 中确认可后置的审查项，不新增 v4 数据事实，不改变当前 S 步通过结论。

| 来源 | 对应 S 步 | 后置项 | 状态 / 阻塞性 | 处理时机优先级 |
|---|---|---|---|---|
| Codex review `dd35c3f` | S2 · 单一 ID 生成入口 | `src/data/single-id-source.test.ts` 的 ID 守卫目前检测 `crypto.randomUUID()` 成员调用，但可能漏掉 `import { randomUUID } from 'node:crypto'` 与 `randomUUID()` 裸调用；后续收紧守卫时补上 `node:crypto` / `randomUUID` 直接导入和裸调用检测，如守卫继续扩展，优先考虑 AST 解析而非继续堆叠正则。 | 非阻塞 Minor；当前源码无实际违规；不影响进入 S3。 | 1. S13/S14 清理旧原型或处理旧 UI 文件时，顺手收紧 ID 守卫覆盖范围；2. Phase 1 尾声做整体验收 / 收口时处理；3. 若后续某个 S 步本来就会修改 `single-id-source.test.ts` 或数据层守卫测试，可同范围顺手处理，但不要为了这个 Minor 单独打断当前 S3。 |

---

## 说明与状态口径

「Phase」取规范对该字段/事件的标注。「P1 结构状态」三档：

- **【P1 真值】**：数据地基即按真值写入（身份/业务时间/状态/派生日期等核心事实），只要 P1 建该实体表就必须写对。
- **【P1 预留·null/默认】**：P1 建字段，但按规范写 null 或固定默认值，真值后置。
- **【P1 建结构·写入后置】**：EventType 枚举与 payload schema 必须 P1 建齐（红线 10/11），真实触发写入按事件 Phase（P2+）落地。

> 通用前提：所有实体 `id`=UUID v7（§2.2）；所有可同步实体均带 §2.3 同步预留字段（`createdAt`/`updatedAt`/`schemaVersion`/`deletedAt`/`deviceId`/`syncedAt`）与 §2.5 时区字段；下方各实体表不再逐条重复这些通用字段，仅在 A 段统一登记一次。

---

## A. 跨实体通用事实（同步契约 + 时间）

| 原始事实维度 | 字段 | 章节 | Phase | P1 结构状态 | 验收结果 | 备注 |
|---|---|---|---|---|---|---|
| 记录首次写入时刻 | `createdAt` | §2.3 | P1 | 【P1 真值】| 未检查 | — |
| 记录最近修改时刻 | `updatedAt`（Event 无此字段） | §2.3 | P1 | 【P1 真值】| 未检查 | — |
| 写入时 schema 版本 | `schemaVersion` | §2.3 | P1 | 【P1 真值】（写 1） | 未检查 | — |
| 软删除时刻/墓碑 | `deletedAt`（Event 无） | §2.3/§2.4 | P1 | 【P1 真值】（默认 null，删除时写） | 未检查 | — |
| 写入设备标识 | `deviceId` | §2.3 | P5+ | 【P1 预留·null/默认】| 未检查 | — |
| 最近同步成功时刻 | `syncedAt` | §2.3 | P5+ | 【P1 预留·null/默认】| 未检查 | — |
| 写入时设备 IANA 时区 | `timezone`（Session/Event/EnergyRecord/UnresolvedInterval/DayPlan） | §2.5 | P1 | 【P1 真值】| 未检查 | — |
| 事实自然日 | `localDate`（同上各实体） | §2.5 | P1 | 【P1 真值】| 未检查 | — |
| 产品日归属 | `appDate`（仅 DayPlan 落库；其余查询时派生） | §2.5 | P1 | DayPlan【P1 真值】；余者派生不落字段 | 未检查 | — |

---

## B. Task 携带的事实（§3.1）

| 原始事实维度 | 字段 | Phase | P1 结构状态 | 验收结果 | 备注 |
|---|---|---|---|---|---|
| 任务标题 | `title` | P1 | 【P1 真值】| 未检查 | — |
| 母子层级归属 | `parentId` | P1 | 【P1 真值】（默认 null） | 未检查 | — |
| 任务当前状态 | `status`（active/completed/splitNeeded/archived/deleted） | P1 | 【P1 真值】| 未检查 | — |
| 归档结果类型 | `outcome`（null/completed/split） | P1 | 【P1 真值】| 未检查 | — |
| 完成方式 | `completionSource`（null/pomodoro/manual） | P1 | 【P1 真值】| 未检查 | — |
| 当前预估番茄数 | `estimatedPomodoros`（1–7） | P1 | 【P1 真值】| 未检查 | — |
| 每轮预估完整记录（含时间戳） | `estimateRounds[]`（index/pomodoros/occurredAt） | P1 | 【P1 真值】（创建即写 index=1） | 未检查 | — |
| 进行中备注 | `note` | P1 | 【P1 真值】| 未检查 | — |
| 完成后实际完成备注 | `actualWorkNote` | P1 | 【P1 真值】| 未检查 | — |
| 活动清单排序 | `sortIndex` | P1 | 【P1 真值】| 未检查 | — |
| 完成时刻 | `completedAt` | P1 | 【P1 真值】| 未检查 | — |
| 归档时刻 | `archivedAt` | P1 | 【P1 真值】| 未检查 | — |
| 删除原因 | `deletedReason`（枚举） | P1 | 【P1 真值】（默认 null） | 未检查 | — |
| 待分流状态 | `metadata.triageStatus` | P1 | 【P1 真值】| 未检查 | — |
| 颜色标记 | `metadata.color` | P1 | 【P1 预留·null/默认】（可选） | 未检查 | — |
| 标签 | `metadata.tags[]` | P1 | 【P1 预留·null/默认】（可选） | 未检查 | — |
| 来源模板 key | `metadata.templateKey` | P1 | 模板生成时【P1 真值】| 未检查 | — |
| 任务来源标记 | `metadata.source` | P1 | 【P1 真值】| 未检查 | — |
| 血缘链 ID | `lineageId` | P1 | 【P1 真值】| 未检查 | — |
| 拆分自哪个任务 | `splitFromTaskId` | P1 | 【P1 真值】（默认 null） | 未检查 | — |
| 拆分序号 | `splitIndex` | P1 | 【P1 真值】| 未检查 | — |

---

## C. DayPlan 携带的事实（§3.2）

| 原始事实维度 | 字段 | Phase | P1 结构状态 | 验收结果 | 备注 |
|---|---|---|---|---|---|
| 计划所属产品日（业务键） | `appDate` | P1 | 【P1 真值】| 未检查 | — |
| 创建当天事实自然日 | `localDate` | P1 | 【P1 真值】| 未检查 | — |
| 今日待办有序列表 | `taskIds[]` | P1 | 【P1 真值】| 未检查 | — |
| 当天最终番茄预算 | `budgetPomodoros` | P1 | 【P1 真值】| 未检查 | — |
| 预算估算模式 | `budgetMode`（conservative/optimistic/manual） | P1 | 【P1 真值】| 未检查 | — |
| 今日可用总时段 | `estimate.workWindowMin` | P1 | 【P1 真值】| 未检查 | — |
| 固定日程扣除项 | `estimate.fixedDeductions[]`（id/label/hours） | P1 | 【P1 真值】| 未检查 | — |
| 生活时间扣除项 | `estimate.lifeDeductions[]`（id/label/hours） | P1 | 【P1 真值】| 未检查 | — |
| 自由时长（派生存储） | `estimate.freeMin` | P1 | 【P1 真值】| 未检查 | — |
| 保守/乐观估算番茄数 | `estimate.conservativePomodoros`/`optimisticPomodoros` | P1 | 【P1 真值】| 未检查 | — |
| 建立时计时设置快照 | `settingsSnapshot`（focusMinutes/shortBreakMinutes/longBreakMinutes/longBreakEvery） | P1 | 【P1 真值】| 未检查 | — |

---

## D. Session 携带的事实（§3.3）——专注/休息执行单元

> 5 种 type 共用同一字段集，不适用字段存 null（红线 13）。

| 原始事实维度 | 字段 | Phase | P1 结构状态 | 验收结果 | 备注 |
|---|---|---|---|---|---|
| 会话类型 | `type`（focus/shortBreak/longBreak/extraFocus/extraRest） | P1 | 【P1 真值】| 未检查 | — |
| 会话状态 | `status` | P1 | 【P1 真值】| 未检查 | — |
| 关联任务 | `taskId` | P1 | 【P1 真值】（focus/extraFocus 必填） | 未检查 | — |
| 开始时刻 | `startedAt` | P1 | 【P1 真值】| 未检查 | — |
| 终结时刻 | `endedAt` | P1 | 【P1 真值】| 未检查 | — |
| 计划时长（秒） | `plannedDuration` | P1 | 【P1 真值】| 未检查 | — |
| **实际时长（唯一事实源，秒）** | `actualDuration` | P1 | 【P1 真值】（红线 23） | 未检查 | — |
| 该 Task 下 focus 发生序号 | `pomodoroIndex` | P1 | 【P1 真值】| 未检查 | — |
| 休息未完成原因 | `skipKind`（explicitSkip/noResponse/appClosed/missed） | P1 | 【P1 真值】| 未检查 | — |
| 产生该 extra session 的 interval | `originIntervalId` | P1 | 【P1 建结构·写入后置】（随 interval 归类 P2） | 未检查 | — |
| 触发休息的上一段 focus | `sourceFocusSessionId` | P1 | 【P1 真值】（break 写入时） | 未检查 | — |
| 系统推荐的休息活动 key | `suggestedRest` | P1 | 【P1 真值】（可 null） | 未检查 | — |
| 用户实际选择的休息活动 key | `actualRest` | P1 | 【P1 真值】（可 null） | 未检查 | — |
| 关联 DayPlan | `dayPlanId` | P1 | 【P1 真值】（辅助字段；红线 14） | 未检查 | — |

---

## E. EnergyRecord 携带的事实（§3.5）

| 原始事实维度 | 字段 | Phase | P1 结构状态 | 验收结果 | 备注 |
|---|---|---|---|---|---|
| 能量状态值 | `energyLevel`（1–10） | P1 | 【P1 真值】（用户提交时） | 未检查 | — |
| 情绪状态值 | `mood`（1–10） | P1 | 【P1 预留·null/默认】（P1 写 null） | 未检查 | — |
| 记录触发来源 | `source`（dayStart/beforeFocus/afterFocus/afterShortBreak/afterLongBreak/afterExtraFocus/afterExtraRest/onReturn/manual） | P1 | 【P1 真值】| 未检查 | — |
| 关联 Session | `sessionId` | P1 | 【P1 真值】（按 source 规则） | 未检查 | — |
| 文字备注 | `note` | P1 | 【P1 真值】（可 null） | 未检查 | — |
| 提交时刻 | `occurredAt` | P1 | 【P1 真值】| 未检查 | — |

> 派生指标 `recoveryDelta` **不入本表**（它是统计结果，§3.5/§8.7，事后由 energyLevel + sessionId 链路算出）。

---

## F. UnresolvedInterval 携带的事实（§3.6）

| 原始事实维度 | 字段 | Phase | P1 结构状态 | 验收结果 | 备注 |
|---|---|---|---|---|---|
| 时段产生来源 | `source`（appReopened/systemRecovered/timerStateLost/userNoResponse） | P1（行为 P2） | 【P1 建结构·写入后置】| 未检查 | — |
| 时段开始时刻 | `startedAt` | P1 | 【P1 建结构·写入后置】| 未检查 | — |
| 时段结束时刻 | `endedAt` | P1 | 【P1 建结构·写入后置】| 未检查 | — |
| 归类状态 | `status`（pending/classified/ignored） | P1 | 【P1 建结构·写入后置】| 未检查 | — |
| 归类完成时刻 | `classifiedAt` | P1 | 【P1 建结构·写入后置】| 未检查 | — |
| 忽略时刻 | `ignoredAt` | P1 | 【P1 建结构·写入后置】| 未检查 | — |
| 忽略原因 | `ignoreReason` | P1 | 【P1 建结构·写入后置】| 未检查 | — |

> 红线 11 重点：整张 UnresolvedInterval 表与**全部字段**必须 Phase 1 建齐，即使行为整体标 P2。`duration` 不入本表（派生指标，§3.6）。

---

## G. Settings 携带的事实（§3.7）

| 原始事实维度 | 字段 | Phase | P1 结构状态 | 验收结果 | 备注 |
|---|---|---|---|---|---|
| 专注/短休/长休时长 | `focusMinutes`/`shortBreakMinutes`/`longBreakMinutes` | P1 | 【P1 真值】| 未检查 | 初始化默认值 25/5/15；原型 longMin=20 不继承，以 v4 默认 longBreakMinutes=15 为准；后续用户改长休属 Settings 后续行为，不影响 Phase 1 默认值 |
| 长休触发间隔 | `longBreakEvery`（固定 4） | P1 | 【P1 预留·null/默认】（固定 4，不开放） | 未检查 | 初始化固定 4；Phase 1 不开放 UI 修改 |
| 休息建议项清单 | `restSuggestions[]`（key/label/appliesTo/isBuiltIn/isEnabled/sortIndex/icon） | P1 | 【P1 真值】（初始化内置 28 项） | 未检查 | — |
| 每日任务模板 | `dailyTaskTemplates[]`（templateKey/title/estimatedPomodoros/autoAddToDayPlan/sortPosition/sortIndex/isBuiltIn） | P1 | 【P1 真值】（初始化内置 1 项） | 未检查 | — |
| 累计完整番茄基数 | `lifetimePomodoroBaseline` | P1（事件/UI P2） | 【P1 预留·null/默认】（P1 写 0；红线 11） | 未检查 | — |
| 休息项展示排序策略 | `restSuggestionDisplayMode`（customOrder/usageFrequency） | P1 | 【P1 预留·null/默认】（默认 customOrder；红线 18） | 未检查 | — |
| 产品日起始偏移 | `appDayStartOffsetMinutes` | P1 | 【P1 预留·null/默认】（固定 0，UI 不开放；红线 4） | 未检查 | — |

---

## H. Event 通用字段携带的事实（§3.4）

| 原始事实维度 | 字段 | Phase | P1 结构状态 | 验收结果 | 备注 |
|---|---|---|---|---|---|
| 事件类型 | `type`（取自 §7 枚举） | P1 | 【P1 建结构】（全量 EventType 枚举 P1 建齐；红线 10） | 未检查 | — |
| 业务发生时刻 | `occurredAt`（统计基准，可早于 createdAt） | P1 | 【P1 真值】| 未检查 | — |
| 事件专属数据 | `payload`（按 §7 各事件 schema） | P1 | 见 I 段 | 未检查 | — |
| 关联实体 id | `taskId`/`sessionId`/`dayPlanId`/`energyRecordId`/`unresolvedIntervalId`/`settingsId` | P1 | 【P1 真值】（适用即写，不省略） | 未检查 | — |
| 同一操作关联 id | `correlationId` | P1 | 【P1 真值】| 未检查 | — |

---

## I. 各 Event payload 携带的事实（§7）

> 红线 10/11：**全量 EventType 枚举 + 每个事件 payload 类型表必须 Phase 1 建齐**，真实触发写入按各事件 Phase。下表「事件独有事实」列标 ⭐ 的，是**只存在于事件、不落在任何实体字段**的原始事实——这些事件若 Phase 1 不建结构、Phase n 不写入，事实将不可逆丢失，是验收重点。
>
> **现有核心行为最小集（已确认，2026-06-04）**：下表中部分标注 P2/P3 的事件，若其对应 UI 入口在 Phase 1 **仍保留给用户正常触发**，则必须在 Phase 1 真实写入 v4 实体 + v4 Event（不得继续写旧结构、不得双轨）。涉及事件：`focus.completed`/`focus.discarded`、`break.started`/`break.completed`、`task.completed`、`task.updated(field='title')`、`task.estimateAdjusted`、`task.deleted`(软删)、`dayPlan.taskAdded`/`dayPlan.taskRemoved`/`dayPlan.taskReordered`、`task.movedToToday`/`task.movedToList`、`energy.recorded`、`interrupt.internal`/`interrupt.external`，以及休息完成时的 `Session.actualRest` + `break.completed.payload.actualRest`。范围与边界以 `phase1-plan.md` S13 为准；`break.skipped` 仍只建结构、不接正式 UI。其余未保留入口的 P2/P3/P4 事件维持"结构 P1 预留、真实写入后置"。

### I-1 Task / Subtask / 排序层级（§7.1/§7.2/§7.4）

| 事件 | Phase | payload/关联携带的原始事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `task.created` | P1 | title/parentId/estimatedPomodoros/**source**（manual/systemDailyTemplate/unresolvedIntervalClassification/splitChild/triageCapture） | source ⭐ | 未检查 | source='systemDailyTemplate' 的每日模板初始化场景属 P1 最小初始化闭环真实写入（§10.2、§7.3） |
| `task.updated` | P2 | field/oldValue/newValue（通用字段变更轨迹） | 变更轨迹 ⭐ | 未检查 | — |
| `task.estimateAdjusted` | P2 | round/oldEstimate/newEstimate | 镜像 estimateRounds | 未检查 | — |
| `task.completed` | P2 | completionSource/completedAt/**validFocusCountAtCompletion**（完成时有效 focus 快照） | validFocusCountAtCompletion ⭐（红线 15） | 未检查 | — |
| `task.uncompleted` | P2 | previousCompletedAt/previousCompletionSource | 撤销完成轨迹 ⭐ | 未检查 | — |
| `task.split` | P2 | lineageId/newTaskId | 镜像 lineage 字段 | 未检查 | — |
| `task.archived` | P2 | outcome | 镜像 | 未检查 | — |
| `task.deleted` | P2 | deletedReason | 镜像 Task.deletedReason | 未检查 | — |
| `task.restored` | P4 | restoredFrom（deleted/archived） | 恢复轨迹 ⭐ | 未检查 | — |
| `subtask.added` | P2 | parentId/title/estimatedPomodoros/source（listPage/timerPage） | source ⭐ | 未检查 | — |
| `subtask.reordered` | P2 | parentId/fromIndex/toIndex | 移动轨迹 ⭐ | 未检查 | — |
| `subtask.reparented` | P3 | fromParentId/toParentId | 换父轨迹 ⭐ | 未检查 | — |
| `subtask.unparented` | P2 | previousParentId | 升级轨迹 ⭐ | 未检查 | — |
| `task.reordered` | P2 | fromIndex/toIndex | 重排轨迹 ⭐ | 未检查 | — |
| `task.reparented` | P2 | fromParentId/toParentId/toIndex | 缩进轨迹 ⭐ | 未检查 | — |
| `task.movedToToday` | P2 | appDate/addedAtIndex | 移入轨迹 ⭐ | 未检查 | — |
| `task.movedToList` | P2 | fromAppDate | 移出轨迹 ⭐ | 未检查 | — |

### I-2 DayPlan（§7.3）

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `dayPlan.created` | P1 最小初始化 / 其余 P2 | appDate/localDate/budgetMode | 镜像 | 未检查 | 当前 appDate DayPlan 最小初始化场景 P1 真实写入（§10.2、§7.3）；完整计划页 / 完整创建流程仍 P2 |
| `dayPlan.updated` | P2 | field/oldValue/newValue | 变更轨迹 ⭐ | 未检查 | — |
| `dayPlan.budgetEstimated` | P2 | budgetMode/conservativePomodoros/optimisticPomodoros/workWindowMin（系统估算呈现值） | 估算呈现轨迹 ⭐ | 未检查 | — |
| `dayPlan.budgetAccepted` | P2 | budgetPomodoros/budgetMode（用户确认值） | 确认轨迹 ⭐ | 未检查 | — |
| `dayPlan.budgetModeChanged` | P3 | oldMode/newMode | 模式切换轨迹 ⭐ | 未检查 | — |
| `dayPlan.deductionAdded/Updated/Removed` | P2 | deductionType/deductionId/label/hours（及 old/newHours） | 扣除项增删改轨迹 ⭐ | 未检查 | — |
| `dayPlan.taskAdded` | P1 最小初始化 + 现有核心入口 / 其余 P2 | addedAtIndex/source（drag/button/systemDailyTemplate/unresolvedIntervalClassification） | source ⭐ | 未检查 | 每日模板自动加入 DayPlan 的初始化场景（source='systemDailyTemplate'）P1 真实写入（§10.2、§7.3）；当前原型已有且 Phase 1 保留的「今日输入框创建」(配 task.created source='manual')、「已有任务加入今日」(配 task.movedToToday) 也按现有核心行为最小集 P1 真实写入；其他完整 DayPlan 管理场景仍 P2 |
| `dayPlan.taskRemoved` | P2 | reason（userRemoved/taskDeleted/taskArchived） | reason ⭐ | 未检查 | — |
| `dayPlan.taskReordered` | P2 | fromIndex/toIndex | 重排轨迹 ⭐ | 未检查 | — |
| `dayPlan.workEnded` | P2 | appDate/localDate/**endedAfterFocusSessionId**/reason（收工锚点） | ⭐（休息豁免唯一依据，§8.6.4） | 未检查 | — |

### I-3 Focus / Break（§7.5/§7.6）

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `focus.started` | P1 | pomodoroIndex/plannedDuration/**taskEstimateAtStart**（开始时预估快照） | taskEstimateAtStart ⭐ | 未检查 | — |
| `focus.completed` | P2 | pomodoroIndex/plannedDuration/actualDuration | 镜像 Session | 未检查 | — |
| `focus.discarded` | P2 | pomodoroIndex/actualDuration/**reason**（userInitiated/userConfirmedAfterRecovery）/**triggeredByInterruptEventId**（可空；用户明确确认本次作废主要由某条 interrupt 触发时写入，否则 null；不自动推断、不打断工作流） | reason ⭐；triggeredByInterruptEventId ⭐（导致 focus 作废的 interrupt 关联，Session 不存） | 未检查 | — |
| `break.started` | P2 | breakType/plannedDuration/sourceFocusSessionId | 镜像 Session | 未检查 | — |
| `break.completed` | P2 | breakType/plannedDuration/actualDuration/actualRest | 镜像 Session | 未检查 | — |
| `break.skipped` | P2 | breakType/skipKind/plannedDuration | 镜像 Session.skipKind | 未检查 | — |

> **本轮封板新增（§7.5）**：`focus.discarded.payload.triggeredByInterruptEventId`
> - 原始事实维度：导致 focus 作废的 interrupt 事件关联（"哪条打扰最终让这个番茄被放弃"）。
> - 字段：`focus.discarded.payload.triggeredByInterruptEventId`；类型 `string | null`；默认 `null`。
> - P1 结构状态：**【P1 建结构·写入后置】**——Phase 1 建 payload 结构，真实写入取决于放弃确认流程。
> - 说明：不自动推断、不强制填写、不打断专注流程；只引用同一 focus session（`sessionId` 相同）内已写入的 `interrupt.internal` / `interrupt.external` Event id；**不在 Session 实体新增字段**。
> - 由第二部分原候选 #1 经本轮"原始事实维度封板"确认后移入。

### I-4 RestItem（§7.7）——休息建议项选择过程 + 设置级增删改

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `restItem.shown` | P3 | breakType/**shownKeys**（展示快照+顺序）/eligibleCount | ⭐（展示位置事实，只在事件） | 未检查 | — |
| `restItem.shuffled` | P3 | breakType/shuffleCount（本次洗牌累计次数） | ⭐ | 未检查 | — |
| `restItem.selected` | P3 | breakType/selectedKey/selectedIndex/sourceShownEventId | ⭐（首次选定过程） | 未检查 | — |
| `restItem.selectionChanged` | P3 | breakType/previousKey/newKey/newIndex/sourceShownEventId | ⭐（改选过程） | 未检查 | — |
| `restItem.created` | P2 | key/label/appliesTo/sortIndex | 镜像 Settings 项；创建轨迹 ⭐ | 未检查 | — |
| `restItem.updated` | P2 | key/changedFields（label/icon/sortIndex） | 变更轨迹 ⭐ | 未检查 | — |
| `restItem.disabled`/`enabled` | P2 | key | 启停轨迹 ⭐ | 未检查 | — |
| `restItem.deleted` | P2 | key/label | 删除轨迹 ⭐ | 未检查 | — |
| `restItem.reordered` | P2 | breakType/orderedKeys | 重排轨迹 ⭐ | 未检查 | — |

### I-5 Interrupt（§7.8）——打扰（只存事件，Session 不存）

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `interrupt.internal` | P2 | **offsetSeconds**（打扰在番茄中的位置）/**note** + 顶层 sessionId/taskId | ⭐⭐（打扰次数/位置/来源全靠事件，§3.3 红线 7） | 未检查 | — |
| `interrupt.external` | P2 | offsetSeconds/note + sessionId/taskId | ⭐⭐（内/外来源由事件类型本身区分） | 未检查 | — |

### I-6 Energy（§7.9）

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `energy.recorded` | P2 | source/energyLevel/mood/note + energyRecordId/sessionId | 镜像 EnergyRecord | 未检查 | — |

### I-7 Triage（§7.10）——待分流捕获与处置

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `triage.captured` | P2 | title + sessionId（捕获时所在 focus） | ⭐（计划外事项捕获时点+所属 session） | 未检查 | — |
| `triage.movedToToday` | P2 | addedAtIndex | 处置轨迹 ⭐ | 未检查 | — |
| `triage.movedToList` | P2 | `{}` + taskId | 处置轨迹 ⭐ | 未检查 | — |
| `triage.dismissed` | P2 | **dismissReason** | ⭐（放弃原因） | 未检查 | — |

### I-8 Interval / UnresolvedInterval（§7.11）

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `interval.detected` | P2 | source/detectedSessionType + 关联 session/task/dayPlan | 镜像 interval 来源 | 未检查 | — |
| `interval.sessionResolved` | P2 | sessionType/**resolvedAs**（completed/discarded/skipped） | ⭐（原 active session 最终判定，只在事件） | 未检查 | — |
| `interval.classified` | P2 | classificationType（extraFocus/extraRest） | 归类方向 ⭐ | 未检查 | — |
| `interval.ignored` | P2 | ignoreReason | 镜像 interval.ignoreReason | 未检查 | — |

### I-9 Settings / StatsBaseline（§7.12/§7.13）——设置变更历史（只存事件）

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `settings.initialized` | P1 | focusMinutes/shortBreakMinutes/longBreakMinutes/longBreakEvery/restSuggestionsCount/dailyTaskTemplatesCount | 初始化快照 ⭐ | 未检查 | — |
| `settings.timerUpdated` | P2 | field/oldValue/newValue | 计时参数变更史 ⭐ | 未检查 | — |
| `settings.appDayStartOffsetUpdated` | P2 | oldValue/newValue/changedBy（user/migration/system） | ⭐（日界线变更史；红线 19） | 未检查 | — |
| `settings.dailyTaskTemplateAdded/Updated/Removed/Reordered` | P2 | templateKey/title/estimatedPomodoros/autoAddToDayPlan/sortPosition/sortIndex（及 field/old/new、wasAutoAddEnabled、orderedTemplateKeys） | 模板增删改排序史 ⭐ | 未检查 | — |
| `settings.restSuggestionDisplayModeUpdated` | P2 | field/oldValue/newValue/changedBy | 展示模式切换史 ⭐ | 未检查 | — |
| `statsBaseline.updated` | P2 | oldValue/newValue | ⭐（累计基数调整史） | 未检查 | — |

### I-10 Data / Demo / Notification / Prompt / Error / Diagnostic（§7.14–§7.18）

> 整体均**不进用户统计**（§8.1.3），但仍是被持久化、可供审计/诊断/产品分析的原始事实。

| 事件 | Phase | payload 携带事实 | 事件独有? | 验收结果 | 备注 |
|---|---|---|---|---|---|
| `data.migrationCompleted` | DEV | fromSchemaVersion/toSchemaVersion/durationMs | 迁移审计 ⭐ | 未检查 | — |
| `data.migrationFailed` | DEV | fromSchemaVersion/toSchemaVersion/errorCode/errorMessage | 迁移失败审计 ⭐ | 未检查 | — |
| `data.exported` | P4 | format/schemaVersion/totalRecords | 导出审计 ⭐ | 未检查 | — |
| `data.imported` | P4 | format/sourceSchemaVersion/totalRecords | 导入审计 ⭐ | 未检查 | — |
| `data.cleared` | P4 | scope | 清空审计 ⭐ | 未检查 | — |
| `demo.loaded`/`demo.cleared` | DEV | demoVersion/recordCount | 演示数据审计 ⭐ | 未检查 | — |
| `notification.shown` | P3 | notificationType（focusCompleted/breakCompleted） | ⭐（系统通知展示事实） | 未检查 | — |
| `prompt.shown` | P3 | promptType（taskCompletionCheck/energyRecording/taskSplitSuggestion）/**promptContext**（8 节点） | ⭐（提示展示事实+触发节点） | 未检查 | — |
| `prompt.dismissed` | P3 | promptType/promptContext | ⭐（提示被关闭/跳过/超时事实） | 未检查 | — |
| `error.dataWriteFailed` | P1 | errorCode/errorMessage/context（脱敏） | ⭐（写入失败事实） | 未检查 | — |
| `error.unexpectedState` | P1 | errorCode/errorMessage/context（invariant 等） | ⭐（意外状态事实） | 未检查 | P1 真实触发范围限 writeValidation：create/update/soft-delete/appendEvent 前发现违反 v4 字段一致性/不变量时，拒绝写入并记录本事件（context.detectedBy='writeValidation'）；startupCheck/readValidation/全库扫描/自动修复旧坏数据均后置。写入失败归 `error.dataWriteFailed`，数据不变量违约归 `error.unexpectedState`，二者不混 |
| `diagnosticLog.exported` | P2 | format/rangeDays/includedEventTypes/exportedEventCount | ⭐（诊断导出审计） | 未检查 | — |

---

# 第二部分：后续可复查候选维度（本轮封板不纳入 Phase 1）

> 以下项目已经过本轮"原始事实维度封板"讨论评估。**除原候选 #1（导致 focus 作废的 interrupt 关联）已确认并移入第一部分外，其余项目本轮均不纳入 Phase 1。** 保留它们是为了后续产品阶段复查，**不表示当前 v4 存在阻塞性缺口，也不是 Phase 1 必须补的字段清单**。每项下方附"本轮封板结论"。标【需确认】者为后续启用前需再确认口径，不影响本轮 Phase 1 封板。
>
> （原候选 #1"打扰 → 是否导致放弃番茄的因果"已落地为 `focus.discarded.payload.triggeredByInterruptEventId`，见第一部分 I-3。本节不再保留为未决缺口。）

1. **打扰的结构化来源标签**
   - 想回顾："我最常见的打扰来源排行（手机/同事/微信/家人）"。
   - 现状缺失：打扰只有 `internal`/`external` 二分 + 自由文本 `note`；**没有结构化来源标签**，排行只能从 note 文本人工翻，算不出统计。
   - 若要补：interrupt payload 加可选 `sourceTag`（枚举或用户自定义标签 key）。
   - **本轮封板结论**：暂不纳入 Phase 1；现有 `interrupt.internal`/`external` + `note` 可支持基础回看，结构化 `sourceTag` 后续再考虑。

2. **打扰持续多久 / 打断了多久**
   - 想回顾："每次打扰平均占用我多少时间"。
   - 现状缺失：interrupt 只有 `offsetSeconds`（发生位置），**无打扰时长/结束位置**；且 v4 不支持暂停（§7.5），无中断时长事实。
   - 若要补：interrupt payload 加可选 `durationSeconds` 或 `endOffsetSeconds`。
   - **本轮封板结论**：暂不纳入 Phase 1；当前不做暂停/恢复或打扰计时流程。

3. **主动跳过休息的原因**
   - 想回顾："我为什么总跳过休息（太忙/不想停/在状态）"。
   - 现状缺失：`break.skipped` 的 `skipKind` 只区分 explicitSkip/noResponse/appClosed/missed，`explicitSkip` 下**无进一步原因**。
   - 若要补：`break.skipped.payload` 加可选 `skipReason`（自由文本或枚举）。
   - **本轮封板结论**：确认不补；`skipKind='explicitSkip'` 已表达主动跳过，产品语义上通常等价于维持专注流。

4. **任务/会话完成时的主观成就感 / 满意度**
   - 想回顾："哪天最有成就感、哪类任务做完最满足"。
   - 现状缺失：只有 `energyLevel`/`mood`（且 mood 暂缓）；**没有成就感/满意度维度**，无法回顾。
   - 若要补：在 `task.completed.payload` 或新增一条 energy 类记录加 `satisfaction`（1–10）。
   - **本轮封板结论**：暂不纳入 Phase 1；Phase 1 保留 `energyLevel` 作为综合主观状态量表。

5. **专注质量自评（深度/分心程度）**
   - 想回顾："哪天专注最深"。
   - 现状缺失：专注质量只能用打扰次数代理；**无主观专注深度评分**。
   - 若要补：在 focus 收尾流程加可选 `focusQuality`（1–10），写入 focus.completed payload 或配套 EnergyRecord。
   - **本轮封板结论**：暂不纳入 Phase 1；不新增额外评分。

6. **休息活动"是否真的做了 / 完成质量"**
   - 想回顾："我选了深呼吸，但实际有没有做、效果如何"。
   - 现状缺失：`actualRest` 只记**选了哪个 key**，不记"是否真正执行/执行质量"；recoveryDelta 是能量差，不等于"做没做"。
   - 若要补：`break.completed.payload` 加可选 `restPerformed`（bool）或 `restQuality`。
   - **本轮封板结论**：不新增 `restQuality`；但沿用 v4 口径——`actualRest` 表示本次休息完成时最终确认的实际休息项，用户可在休息完成确认时修正。

7. **拆分/重新评估的原因**
   - 想回顾："为什么这个任务被拆 / 反复加预估"。
   - 现状缺失：`task.split` 只记 lineage/newTaskId，`task.estimateAdjusted` 只记数值；**无拆分/调整原因**。
   - 若要补：对应事件 payload 加可选 `reason`。
   - **本轮封板结论**：确认不补；工作流本身已表达任务颗粒度过大或边界过宽，过程可由 `estimateRounds`、有效 focus 数和 `task.split` 血缘链还原。

8. **计划 vs 实际偏离的原因**
   - 想回顾："今天没完成计划，是因为被会议占用还是状态差"。
   - 现状缺失：DayPlan 偏差可算（§8.10），但**偏离原因无任何记录**。
   - 若要补：新增一条 dayPlan 复盘事件，或在 `dayPlan.workEnded.payload` 加可选 `reflectionNote`。
   - **本轮封板结论**：暂不纳入 Phase 1；属于日复盘/计划复盘后续功能。

9. **任务的项目/类别归属用于统计**【需确认】
   - 想回顾："工作 vs 个人的专注时长占比、各项目投入排行"。
   - 现状：`Task.metadata.tags[]`/`color` **结构存在**（§3.1），但**没有标签变更事件、§8 也无任何按 tag 聚合的统计口径**，且 tags 标为可选。需确认这是否足以支撑"按类别回顾"。
   - 若要补：确立 tag 统计口径，并视需要补 tag 变更事件。
   - **本轮封板结论**：暂不纳入 Phase 1；`Task.metadata.tags[]` 已有预留，未来做领域统计再启用。

10. **情绪（mood）的采集时机与窗口**【需确认】
    - 想回顾："情绪随时间/随专注的变化"。
    - 现状：`mood` 字段已预留但 P1 写 null（§3.5、§8.8.3），**采集触发时机、量表、统计窗口均未定**。需确认是否要在 Phase 1 就锁定采集口径（否则启用时缺历史）。
    - **本轮封板结论**：暂不纳入 Phase 1；`mood` 字段维持预留但 P1 不启用。

11. **作息 / 睡眠等外部状态**
    - 想回顾："睡眠、运动、饮食与我的专注/能量的关系"。
    - 现状缺失：产品**完全无睡眠/作息/外部健康数据**。可能超出当前 scope，但对"自我觉察"是高价值维度。
    - 若要补：新增独立记录实体或每日打卡字段（需新设计）。
    - **本轮封板结论**：暂不纳入 Phase 1；属于外部生活状态记录新实体域。

12. **每轮专注的具体产出 / 意图**
    - 想回顾："这一轮番茄我具体做了什么、原本想做什么"。
    - 现状缺失：§7.16 **明确不做** session note / 每轮备注 / 日总结；只有任务级 `actualWorkNote`。这是规范的有意取舍，但若日后想要"每轮回顾"，当前事实不可逆缺失。
    - 若要补：需按 §7.16 所述作为新后置功能重新设计，不在当前模型预留。
    - **本轮封板结论**：暂不纳入 Phase 1；v4 当前不做 Session Note / Review。

13. **正常"离开/暂停"时长（非异常断裂）**
    - 想回顾："我一天里主动离开工具多久、节奏如何"。
    - 现状缺失：`UnresolvedInterval` 只覆盖**异常断裂/超时**（§3.6），正常主动暂停因 v4 不支持暂停而无记录。
    - 若要补：需引入暂停/离开事实（改动较大，需新设计）。
    - **本轮封板结论**：暂不纳入 Phase 1；当前不做暂停状态机。

14. **物理位置 / 场景**【需确认】
    - 想回顾："在家 vs 公司 vs 咖啡馆，哪种环境专注质量最高"。
    - 现状：`timezone` 每条记录都存，**可勉强派生跨时区/旅行**，但**无显式位置/场景标签**，无法做"按场景"回顾。
    - 若要补：在 Session 加可选 `contextTag`/`location`。
    - **本轮封板结论**：暂不纳入 Phase 1；属于后续可选自我量化维度。

---

## 附：方法与边界说明

- **第一部分「P1 结构状态」三档**（真值 / 预留·null/默认 / 建结构·写入后置）是为便于验收自拟的分类口径；规范本身只给 Phase 标注、未给此三分法。如需改用别的口径（如直接用 P1/P2 原标）可据此重排。
- **「原始事实 vs 统计结果」切分**：明确"不存储、查询时算"的派生量（`recoveryDelta`、UnresolvedInterval `duration` 等）未列入第一部分；规范要求**落库的派生字段**（如 DayPlan 的 `freeMin`/`conservativePomodoros`）因被持久化仍列入。
- **推断/还原**：第一部分全部来自 v4 正文摘录，无推断；第二部分原候选 #1 已确认并移入第一部分（I-3），其余项均附"本轮封板结论"，第 9/10/14 条标【需确认】（后续启用前再确认口径，不影响本轮 Phase 1 封板）。
- **本轮封板范围**：仅 `focus.discarded.payload.triggeredByInterruptEventId` 一项缺口确认进 Phase 1 并补入 v4；第二部分其余项均为"后续可复查候选"，不得反向解读为 Phase 1 必须补的字段。
