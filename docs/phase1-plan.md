# Phase 1 实施计划（数据地基）

> 基准文档：`data-layer-spec-v4.md`（唯一权威事实源，全文已通读）。
> 本文性质：**实施计划**，只描述"分几步、每步做什么 / 为什么 / 怎么验证、步骤间依赖与顺序"，**不含任何代码**。
> 生成日期：2026-06-04。待用户 review 确认后，再按步骤分批实现。

---

## 0. 本文与其他文档的分工（权威层级）

**权威从高到低**：v4 规范 → 本实施计划 → 验收清单 → 原型行为对照。下层不得覆盖上层；冲突一律以更高层为准，最终以 v4 为准。

| 层级    | 文档                                | 角色                                                      | 与本文关系                                                      |
| ----- | --------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| 1（最高） | `data-layer-spec-v4.md`           | **唯一权威数据规范**：决定字段 / 事件 / payload / 约束 / 统计口径 / Phase 语义 | 本文所有"为什么"一律回指 v4 章节，不重新定义数据                                |
| 2     | `phase1-plan.md`（本文）              | **施工计划**：决定 Phase 1 按什么顺序实现                             | —                                                          |
| 3     | `phase1-checklist.md`             | **验收清单**：逐项检查 Phase 1 是否建齐结构 / 写对真值                     | 本文是"怎么做"，checklist 是"做对没有"；每步完成后用 checklist 对应行验收          |
| 4（最低） | `prototype-behavior-inventory.md` | **旧原型行为对照参考**：识别旧 UI 行为与旧写入路径，供判断"现有 UI 行为如何接入 v4"  | 仅参考；**不得新增规范、不得覆盖 v4、不得成为第二份实施计划**；其旧字段 / 旧状态**不得作为新数据真值** |
| 旁挂    | `ui-behavior-backlog.md`          | UI 行为待办（非数据真值，红线 21）                                    | 不作为数据依据；冲突以 v4 正文为准                                        |
|       |                                   |                                                         |                                                            |

本文不替代 checklist，也不在本文内复制 v4 字段表。**旧原型字段只用于识别旧行为和旧写入路径，绝不作为 v4 新数据真值。**

---

## 1. Phase 1 范围总览

### 1.1 这一阶段要交付什么

Phase 1 **以数据地基重构为主**：不做视觉重设计、不重构主流程、不新增完整 P2/P3/P4 功能流程；但**允许**为让 v4 数据闭环成立、且现有核心功能不退化，补充最小必要的初始化逻辑、数据入口、小型确认 / 错误提示。任何新增交互必须沿用现有原型视觉风格，不得引入新设计体系，不得借数据层重构重做交互（§10、E5）。

**本阶段关键执行口径（不看 §5 也成立的硬结论）**：
1. **DayPlan 最小初始化闭环是 P1 必做**：首次进入 / 首次读取当天今日待办时创建默认 Settings、当前 `appDate` 的 DayPlan、并自动生成「计划准备」任务入列（见 S11）。
2. **当前原型已有核心行为最小集要 P1 真实写入** v4 实体 + v4 Event（见 §1.1 第 3 层、S13）；其他 P2/P3/P4 行为仍后置。
3. **`error.unexpectedState` 仅做写入校验**（writeValidation），不做启动 / 读取巡检（见 S12）。
4. **旧原型数据不迁移，空库起步**（见 S14）。
5. **默认计时设置取 v4**：focus 25 / shortBreak 5 / longBreak 15 / longBreakEvery 4；原型旧 `longMin=20` 不继承（见 S11）。
6. 不做视觉重设计，但允许上述最小必要入口 / 初始化逻辑。

交付物分三层：

1. **完整数据模型与跨端契约（建全 + 预留）**
   - 7 个实体的全字段 schema：Task、DayPlan、Session、Event、EnergyRecord、UnresolvedInterval、Settings（§3.1–§3.7）。
   - 所有可同步实体的同步预留字段（`createdAt/updatedAt/schemaVersion/deletedAt/deviceId/syncedAt`）与时区字段（`timezone`/`localDate`）（§2.3、§2.5）。
   - **结构必须建齐、但 Phase 1 不实现行为**的部分也要建：UnresolvedInterval 全表全字段、`Settings.lifetimePomodoroBaseline`、`EnergyRecord.mood`、`Settings.restSuggestionDisplayMode`、`Settings.appDayStartOffsetMinutes`、`Settings.longBreakEvery`、`deviceId/syncedAt` 预留字段、statsBaseline 相关字段（红线 11、§10.1、§11 #4/#5）。

2. **数据层基础设施**
   - 单一 ID 生成入口（UUID v7，§2.2、红线 1）。
   - `appDate` 派生函数 + 时区 / `localDate` 派生（§2.5、红线 3–6）。
   - 全量 `EventType` 枚举 + 每个事件的 payload 类型表（覆盖 §7 全部事件，红线 10）。
   - 写入校验器（逐实体字段一致性约束，§3.x 各"字段一致性约束"小节）。
   - 实体变更 + 对应 Event 的**原子写入**事务封装（§3.4 关键规则 8、红线 9）。
   - 软删除写入 + 默认读取过滤 `deletedAt != null`（§2.4、红线 12）。
   - `dataStore` 抽象层（组件不直接读写底层存储，§2.1）。

3. **现有原型核心行为接入（真实写入，已确认）**
   - 范围 = **v4 P1 数据地基 + 当前原型已有、用户正常可触发、不接即丢核心事实或致流程退化的最小业务集**（边界见 §5 D3）。这**不等于**提前实现完整 P2/P3/P4。
   - 含：P1 标注事件（`settings.initialized`、`task.created`、`focus.started`、`error.dataWriteFailed`、`error.unexpectedState`）；DayPlan 最小初始化闭环（`dayPlan.created`、`task.created(systemDailyTemplate)`、`dayPlan.taskAdded(systemDailyTemplate)`，见 S11）；以及原型已具备的核心行为：`focus.completed`/`focus.discarded`、`break.started`/`break.completed`、`task.completed`、`task.updated`、`task.estimateAdjusted`、`task.deleted`(软删)、今日待办 `dayPlan.taskAdded`/`taskRemoved`/`taskReordered` + `task.movedToToday`/`movedToList`、`energy.recorded`、`interrupt.internal`/`interrupt.external`、`Session.actualRest` + `break.completed.payload.actualRest`（详见 S13）。
   - 每个接入行为必须写入 v4 实体字段 + v4 Event；**不得**继续写旧结构、**不得**旧/新双轨写、**不得**以旧字段为真值。本轮不接入的旧 UI 入口须隐藏 / 禁用 / 降级只读 / 标 DEV-only / 明确挂账后置。

### 1.2 明确不做什么

- ❌ 除 **DayPlan 最小初始化闭环**（S11）与 **当前原型核心行为最小集**（S13，§1.1 第 3 层）明确纳入本轮真实写入的事件外，不实现其他 P2/P3/P4 事件的**真实触发行为**；但**所有** P2/P3/P4/DEV 事件的 EventType 枚举与 payload schema 仍必须 Phase 1 建齐（红线 10/11）。未纳入本轮真实接入的旧 UI 入口，不得继续写旧结构，应隐藏 / 禁用 / 降级只读 / 标 DEV-only / 明确挂账后置。
- ❌ 不做统计页真实化（§8 是 P3）；P1 只保证数据能支撑这些统计，不写统计查询本身（P1 必需的派生视图除外，见 S10）。
- ❌ 不做 UnresolvedInterval 的自动检测 / 恢复归类 UI（结构 P1、行为 P2+，§11 #4）。
- ❌ 不开放 `appDayStartOffsetMinutes` 的 UI（固定默认 0，红线 4、§10.2）；不新增其设置更新事件的真实触发（红线 19）。
- ❌ 不做诊断日志 / 全量数据导出的真实导出入口与文件生成（结构 P1、行为 P2+，§10.5、§11 #3）。
- ❌ 不实现多端同步 / 冲突解决（Phase 5+，§2.6）；预留字段写 null。
- ❌ 不做完整 DayPlan 管理能力：完整计划页、预算编辑 UI、固定日程 / 生活扣除项编辑 UI、DayPlan 历史复盘、收工流程、**完整计划页中的复杂排序 / 管理交互**、DayPlan 统计页真实化均属 P2+（§10.2、§7.3）。**注 1**：当前 appDate 的 DayPlan 最小初始化闭环（含每日模板「计划准备」自动生成）是 P1 必做（见 §1.1 关键执行口径第 1 条、S11），不在"不做"之列。**注 2**：当前原型已有且 Phase 1 保留的**今日排序**不在"不做"之列——按现有核心行为最小集接入：更新 `DayPlan.taskIds` 顺序并写 `dayPlan.taskReordered`（见 S13）。即"不做新的复杂 DayPlan 管理，但保留的旧 UI 核心排序入口必须写 v4"。二者边界见 §7.3 Phase 边界说明。
- ❌ 不做视觉重设计、不重构页面布局、不新增完整 P2/P3 功能流程。**但**允许为让 v4 数据闭环成立、现有核心功能不退化，补充最小必要的数据入口 / 初始化逻辑 / 小型确认或错误提示；任何新增交互必须沿用现有原型视觉风格，不得引入新设计体系、不得借数据层重构重做交互（§10 "不改交互的准确边界"）。
- ❌ 不实现 DayPlan 超载拒绝、第 8 个番茄阻断等行为（数据层只"不拒绝写入"，派生提示后置，红线 22、§3.1 规则 10）。

### 1.3 全程必须遵守的硬约束（贯穿所有步骤）

1. 所有实体 ID = UUID v7，统一从单一入口产出（红线 1、2）。
2. 业务统计排序以业务时间（`occurredAt`/`startedAt`/`occurredAt`）为准，不用 ID 时间序替代（红线 2）。
3. 所有"今天 / 每日 / 当日 / 今日列表 / 预算 / 按日统计"一律走 `appDate` 派生，**绝不**直接用 `localDate` 当业务日期（红线 3、4、§2.5）。
4. Event 是 append-only：无 `updatedAt/deletedAt/deviceId/syncedAt`，不修改、不软删、不物删；撤销靠追加修正性 Event（红线 7、8、§3.4）。
5. 实体变更 + Event 写入必须同事务原子提交（红线 9、§3.4 规则 8）。
6. 写入未定义 `EventType` 必须被拒绝；payload 即完整 schema，不得增删字段（§3.4 一致性约束、§7 开头）。
7. 可同步实体禁止物理删除，一律软删 + 保留 tombstone（红线 12、§2.4）。
8. Session 五种 type 共用同一字段集，不适用字段写 null 而非省略（红线 13、§3.3）。
9. `actualDuration` 是 Session 时长唯一事实源，不用 `endedAt − startedAt` 重算（红线 23、§3.3 规则 10）。

---

## 2. 有序实施步骤

> 标注约定：每步给出 **做什么 / 为什么（v4 章节）/ 怎么验证**。验收时用 `phase1-checklist.md` 对应行勾验。

### S0 · 工程脚手架与技术选型确认
- **做什么**：确定 Phase 1 数据层代码的落点（独立模块目录），引入 UUID v7 生成依赖与 IndexedDB 访问方式（原生 / 轻封装）。把数据层与现有 `*.jsx` 原型解耦为一个可单独测试的模块。
- **为什么**：§2.1（Web 用 IndexedDB，经 `dataStore` 抽象层访问，组件不得直接读写底层存储）；红线 1（单一 ID 入口需要确定的 UUID v7 实现）。
- **怎么验证**：数据层模块可被独立 import 并跑单元测试，不依赖 UI；UUID v7 依赖可生成符合 v7 格式（版本位 = 7）的 ID。
- **依赖**：无（最先做）。
- **技术选型口径（实现方决策，不阻塞用户确认）**：IndexedDB 访问方式 / 是否引入轻封装库 / 目录落点属工程实现决策，由实现方按"稳定最小"原则自行决定，无需用户逐项拍板。选择原则：① 优先复用 / 扩展现有工程结构与既有数据访问封装（若已有可用封装，优先扩展而非另起）；② 优先少引入依赖；③ 若确需引入 IndexedDB 封装库，必须在 ADR / implementation note 中说明理由；④ 任何方案必须满足 v4 核心要求——`dataStore` 抽象层、组件不得直接读写底层存储、原子事务、可测试、字段 schema 可校验（§2.1、§3.4）。实现方应将最终选型记录为 ADR / implementation note，但这**不作为阻塞项**。

### S1 · dataStore 抽象层与 IndexedDB objectStore 骨架
- **做什么**：建立 `dataStore` 读写抽象；定义各实体的 objectStore（tasks / dayPlans / sessions / events / energyRecords / unresolvedIntervals / settings）及主键、必要索引。组件只经 `dataStore` 访问，不碰底层 API。
- **为什么**：§2.1（存储抽象、组件不得直接读写底层存储）；§2.2（UUID v7 主键便于按时间范围 / id 范围查询）。
- **怎么验证**：能对每个 store 做基础 CRUD（经抽象层）；底层 API 不在 UI 代码中出现；store 列表与 §3 的 7 实体一一对应。
- **依赖**：S0。

### S2 · 单一 ID 生成入口
- **做什么**：实现唯一的 `newId()` 入口产出 UUID v7，全数据层（实体、Event、扣除项 id、restSuggestions/dailyTemplates 自定义 key 中的 UUID 段）统一调用。
- **为什么**：红线 1（禁止自增 / nanoid / v4）；§2.2；§3.2 扣除项 id 要求 v7；§3.7 自定义 restItem / template key 内嵌 v7。
- **怎么验证**：全代码库 grep 不到第二处 ID 生成；生成值通过 v7 格式校验；连续生成的 ID 单调递增（时间序）。
- **依赖**：S0。

### S3 · 时间、时区与 `appDate` 派生工具
- **做什么**：实现纯函数：① 写入时取设备 IANA 时区；② 由（业务时间 + timezone）派生 `localDate`；③ 由（业务时间 + timezone + `appDayStartOffsetMinutes`）派生 `appDate`（`appDate = localDate of (本地时间 − offset 分钟)`）。offset 来源固定读 Settings（P1 恒为 0）。
- **为什么**：§2.5（localDate / appDate 派生规则、写入时取设备时区且不回算历史）；红线 3/4/5；§3.7（offset 默认 0、字段必须从一开始就存在）。
- **怎么验证**：用 §2.5 示例做单测——`offset=240` 时 02:00 的记录 `localDate=当日 / appDate=前一日`；`offset=0` 时 `appDate==localDate`；派生只依赖记录自带的 timezone，不依赖"当前设备时区"。
- **依赖**：S0；与 S11（Settings）相互：offset 读自 Settings，故 S3 函数签名接受 offset 入参，由调用方注入。

### S4 · schemaVersion 常量与 legacy 口径
- **做什么**：定义 `CURRENT_SCHEMA_VERSION = 1`；新写入记录 `schemaVersion = 1`；约定无版本旧数据视为 legacy（0 / unknown）。
- **为什么**：§2.3（schemaVersion 是整数数据结构版本，非文档版本；Phase 1 = 1）。
- **怎么验证**：任意新写入实体 `schemaVersion === 1`；常量集中定义、无散落字面量；不把 `4.0.0` 写进记录。
- **依赖**：S0。

### S5 · 全实体 schema 与类型定义（建全 + 预留）
- **做什么**：为 7 个实体定义完整字段结构与类型，**逐字段对齐 v4 的类型 / 可空 / 默认值 / 枚举**，包括所有"结构预留"字段（见 §1.1 第 1 点列表）。含各嵌套结构：Task.`estimateRounds`/`metadata`、DayPlan.`estimate`(含扣除项数组)/`settingsSnapshot`、Settings.`restSuggestions`/`dailyTaskTemplates`。
- **为什么**：§3.1–§3.7 全部字段定义；红线 11（结构 P1 预留行为 P2 接入）；§2 / §3 跨端契约与字段定义（跨端契约字段不可省略，docs/CLAUDE.md D2）。
- **怎么验证**：逐字段对照 `phase1-checklist.md` 各实体段；预留字段存在且默认写 null / 规定默认值；Session 五 type 共用同一字段集（红线 13）。
- **依赖**：S2、S3、S4（字段默认值用到 ID / 时间 / 版本）。

### S6 · 写入校验器（字段一致性约束）
- **做什么**：为每个实体实现写入 / 更新前校验，覆盖 v4 各实体"字段一致性约束"小节的每一条；违反即拒绝写入。重点：Task（status×completedAt×completionSource×outcome、estimate 1–7、splitFromTaskId×splitIndex）、Session（13 条 type×status×字段适用性、actualDuration 不与 endedAt−startedAt 校验）、DayPlan（appDate 唯一、taskIds 去重、freeMin 取整公式）、EnergyRecord（source×sessionId）、UnresolvedInterval（status×classifiedAt/ignoredAt、endedAt>startedAt）、Settings（单例、longBreakEvery 必须为 4、longBreakMinutes∈{15,20,30}、appliesTo 与 key 前缀一致、offset 范围）。
- **为什么**：§3.1/§3.2/§3.3/§3.5/§3.6/§3.7 各"字段一致性约束"；红线 15/16/18/20/22/23；§2 / §3 跨端契约与字段定义（字段不可省略，docs/CLAUDE.md D2）。
- **怎么验证**：为每条约束写正反单测（合法通过 / 非法被拒）；尤其 `estimatedPomodoros>7`、`longBreakEvery≠4`、Session active 时 endedAt 非 null 等必须被拒。
- **依赖**：S5。

### S7 · 全量 EventType 枚举与 payload 类型表
- **做什么**：建立覆盖 §7 **全部**事件类型的 `EventType` 枚举（含 P2/P3/P4/DEV），并为每个事件定义 payload 类型（即完整 schema，不增不减字段）。写入时校验 `type ∈ 枚举` 且 payload 符合该 type schema。
- **为什么**：红线 10（P1 即建完整枚举 + payload 类型表，覆盖 §7 全部事件）；§3.4 一致性约束 4；§7 开头"payload 即完整 schema"；§6（命名规范）。
- **怎么验证**：枚举条目数 = §7 事件总数（按 §7.1–§7.18 清点）；写未定义 type 被拒；写缺必填 payload 字段 / 多余字段被拒；空 payload 仅在"无专属数据"事件允许。
- **依赖**：S5（payload 中引用的实体语义）。

### S8 · 原子写入策略（实体变更 + Event 同事务）
- **做什么**：封装"一次业务操作"为原子事务：实体 create/update/softDelete 与其对应 Event(s) 在同一 IndexedDB 事务内提交；任一步失败整体回滚；同一操作多条 Event 共享 `correlationId`，与实体同属一事务。
- **为什么**：§3.4 关键规则 8；红线 9；§3.4 关键规则 5（correlationId）。
- **怎么验证**：注入失败用例验证回滚（不出现"实体已变更但 Event 缺失"或反之）；多 Event 操作的 correlationId 一致且与实体同事务。
- **依赖**：S1、S6、S7。

### S9 · 软删除与默认读取过滤
- **做什么**：可同步实体删除一律写 `deletedAt`（+ Task 的 `status='deleted'`），保留 tombstone；默认查询过滤 `deletedAt != null`；提供显式查询已删记录的入口（恢复流程用，P1 不做 UI）。Event 不在软删之列。
- **为什么**：§2.4；红线 12；§3.1 规则 5；§9.2（不提供历史编辑 / 删除，纠错靠软删或追加事实）。
- **怎么验证**：删除后默认查询不返回、tombstone 仍在库；对 Event 调用软删路径应被禁止 / 不存在。
- **依赖**：S1、S5。

### S10 · Phase 1 必需的派生视图查询
- **做什么**：实现"不改交互"所必需的派生查询：今日待办（**必须基于当前 `appDate` 对应 DayPlan 的 `taskIds` 顺序**派生，由 S11 的初始化闭环保证当天 DayPlan 必定存在）、活动清单（status∈{active,splitNeeded} 且不在今日 taskIds 且 triageStatus≠'pending'，**不得再依赖旧 `bucket` 字段**）、待分流清单（status='active' 且 triageStatus='pending'）。**只建 P1 维持现有界面所必需的派生，不做 §8 统计派生。**
- **为什么**：§3.1 规则 3（无 `bucket` 字段，今日 / 活动清单纯派生）；§3.2 关键规则 1/2；红线 3（按 appDate 派生）。
- **怎么验证**：在无 `bucket` 字段的前提下，今日 / 活动 / 待分流三视图与原型现有呈现一致；今日顺序严格取 DayPlan.taskIds 而非 Task.sortIndex；首次读取当天今日待办时「计划准备」任务已由 S11 初始化闭环置于首位。
- **依赖**：S3、S5、S9、**S11（今日待办来源 = S11 保证存在的当天 DayPlan）**。

### S11 · 当前 appDate DayPlan 最小初始化闭环（P1 真实触发，含 Settings + DayPlan + 每日模板任务）
- **做什么**：实现"首次进入应用 / 首次读取当前产品日今日待办"时的最小初始化闭环。三个幂等入口函数，组合在**同一原子事务**内执行，共享同一 `correlationId`：
  1. `ensureSettingsInitialized()`：若库中无有效 Settings，创建默认 Settings（全字段默认值 + 内置 restSuggestions 短休 15 / 长休 13 + 内置「计划准备」模板），写 `settings.initialized`；已存在则跳过、不重复触发；数据异常重建不走本事件。
  2. `ensureDayPlanForAppDate(appDate)`：若当前 `appDate`（由 S3 派生，P1 offset=0）无有效 DayPlan，则创建当天 DayPlan，写 `dayPlan.created`（payload appDate/localDate/budgetMode）。
  3. `createDailyTemplateTasksForDayPlan()`：按 `Settings.dailyTaskTemplates` 中 `autoAddToDayPlan=true` 的模板，为当天 DayPlan 生成专属 Task 并加入 `DayPlan.taskIds`。内置 `planningPreparation` 生成「计划准备」任务：`title='计划准备'`、`estimatedPomodoros=1`、`metadata.templateKey='planningPreparation'`、`metadata.source='systemDailyTemplate'`、`estimateRounds[0]`=`{index:1,pomodoros:1,occurredAt:创建时刻}`，并置于 `taskIds` 首位（模板 `sortPosition='first'`）。每个生成任务写 `task.created(source='systemDailyTemplate')` + `dayPlan.taskAdded(source='systemDailyTemplate')`。
- **P1 真实写入的事件（同一 correlationId）**：`settings.initialized`（仅当本次确创建了 Settings）、`dayPlan.created`、`task.created(source='systemDailyTemplate')`、`dayPlan.taskAdded(source='systemDailyTemplate')`。
- **为什么**：§10.2「当前 appDate DayPlan 最小初始化闭环（P1 必做）」；§3.7 关键规则 2/6；§7.12 `settings.initialized`（payload：focusMinutes/shortBreakMinutes/longBreakMinutes/longBreakEvery/restSuggestionsCount=28/dailyTaskTemplatesCount=1）；§7.3 `dayPlan.created`（P1 最小初始化场景）/ `dayPlan.taskAdded`（source=systemDailyTemplate 场景 P1）；§7.1 `task.created`（P1，estimateRounds 首轮见 §3.1 规则 11）；§3.4 关键规则 5/8（correlationId + 原子写入）。
- **怎么验证**：全新库首次读取今日待办 → 库内出现一条 Settings、一条当天 DayPlan、一条「计划准备」Task，且事件链 `settings.initialized`+`dayPlan.created`+`task.created`+`dayPlan.taskAdded` 共享同一 `correlationId`；DayPlan.taskIds 首位为该 Task；Task.estimateRounds[0].index===1 且 pomodoros===1；二次进入当天不重复创建、不重复发事件（幂等）；非首日 / 已存在 DayPlan 时只读不写。
- **不做（边界）**：不做完整计划页、预算 / 扣除项编辑 UI、DayPlan 历史复盘、收工流程、今日复杂重排、DayPlan 统计真实化、视觉重设计——这些仍属 P2+（§10.2）。
- **依赖**：S2、S3、S5、S6、S8。

### S12 · 错误事件接入（`error.dataWriteFailed` / `error.unexpectedState`，P1 真实触发；仅写入校验路径）
- **做什么**：
  - 本地存储写入失败（IndexedDB transaction 失败等）→ 记录 `error.dataWriteFailed`。
  - 每次 create / update / soft-delete / appendEvent **写入前**执行 v4 字段一致性校验；若违反 v4 不变量 / 字段一致性规则 → **拒绝写入** + 记录 `error.unexpectedState`，`context.detectedBy='writeValidation'`。
  - `context`/`errorMessage` 严禁含用户正文（脱敏底线）。
- **P1 不做（错误事件最小范围）**：不做启动时全库一致性扫描（startupCheck）、不做读取时全量巡检（readValidation）、不做旧坏数据自动修复、不做错误修复 UI、不做恢复流程复杂异常处理。
- **两事件分工**：存储写失败 → `error.dataWriteFailed`；数据状态违反 v4 约束 / 不变量 → `error.unexpectedState`。
- **为什么**：§7.17（两事件均 P1）；§9.3（脱敏边界）；红线 6（写未定义状态被拒，配合异常记录）；错误事件最小范围（见 §5 D4）。
- **怎么验证**：模拟写入失败 → 落 `error.dataWriteFailed`（context 含 entityType/operation/storageEngine，无正文）；构造违约写入 → 被拒 + 落 `error.unexpectedState`（detectedBy='writeValidation'）；确认无启动 / 读取巡检逻辑被引入。
- **依赖**：S6、S7、S8。

### S13 · 当前原型核心行为接入（核心行为最小集，P1 真实写入）
- **做什么**：把原型**当前已有、用户正常可触发**的核心行为接到 v4 实体 + Event（真实写入，原子事务，多事件共享 correlationId）。范围依据 `prototype-behavior-inventory.md` 的 A 类清单。逐组：

  **A1 任务基础行为**
  - 手动创建任务（活动清单）→ `task.created(source='manual')`（写 `estimateRounds[0]`：index=1、pomodoros=初始总预估、occurredAt=创建时刻）。
  - 今日输入框直接新建 → `task.created(source='manual')` + `dayPlan.taskAdded`，共享 correlationId。**这是"新任务诞生后加入今日"，不写 `task.movedToToday`**（区别于 A2 已有任务移入）。
  - 编辑任务标题 → `task.updated(field='title')`。
  - 调整预估番茄数 → `task.estimateAdjusted`（**收敛到 v4 1–7 上限**；`estimateRounds` 记每轮"总量"非增量；旧 1–9 / 增量语义不继承）。
  - 删除活动清单任务 → v4 软删除（写 `deletedAt` + `status='deleted'`，保留 tombstone）+ `task.deleted`（**不得沿用原型硬删**）。
  - 计时流程内任务完成 → `task.completed`（`completionSource='pomodoro'`，带 sessionId；`validFocusCountAtCompletion` 写在事件 payload，不写 Task 本体）。

  **A2 今日待办基础行为**
  - 已有任务加入今日 → `dayPlan.taskAdded`(source=drag/button) + `task.movedToToday`，共享 correlationId。
  - 从今日移出 → `dayPlan.taskRemoved` + `task.movedToList`，共享 correlationId。
  - 今日排序 → 更新 `DayPlan.taskIds` 顺序 + `dayPlan.taskReordered`。
  - **禁止用旧 `bucket` 判断今日 / 活动清单**：今日 = 当前 `appDate` 的 `DayPlan.taskIds`；活动清单 = Task 状态 + 不在当天 DayPlan 中派生（见 S10）。

  **A3 标准计时闭环**
  - 开始 focus → `focus.started`（创建 Session type='focus'/status='active'）。
  - 完成 focus → `focus.completed`（Session→completed，写 endedAt / actualDuration）。
  - 作废 focus → `focus.discarded(reason='userInitiated')`。
  - 开始 shortBreak/longBreak → `break.started`（带 sourceFocusSessionId）。
  - 完成 shortBreak/longBreak → `break.completed`。
  - **不新增正式 `break.skipped` UI**；`break.skipped` 只建 schema/EventType/validator 结构。原型的测试快进按钮（skipToEnd / break 模式快进）**不得**映射为正式 `break.skipped`，须标 DEV-only 或移除。

  **A4 自我觉察核心事实**
  - 记录能量 → 创建 `EnergyRecord` + `energy.recorded`（source 按 §3.5 分类：dayStart/beforeFocus/onReturn、afterFocus、afterShortBreak/afterLongBreak；afterX 类常与对应 focus/break 同次共享 correlationId）。
  - 记录打扰 → `interrupt.internal` / `interrupt.external`（带 sessionId/taskId；**v4 无 `interrupt.recorded`**）。
  - 休息完成时最终休息项目 → 写 `Session.actualRest`（引用 restSuggestions.key）+ `break.completed.payload.actualRest`；用户未选写 `null`。**后置的是 restItem 过程事件（shown/shuffled/selected/changed，P3），不是最终结果 actualRest**。

- **与 S11 的分工**：每日模板初始化触发的 `dayPlan.created` / `task.created(systemDailyTemplate)` / `dayPlan.taskAdded(systemDailyTemplate)` 在 **S11** 写入；S13 负责其余用户主动行为。
- **不在本轮接入（保留入口须禁用 / 降级 / 挂账，且不得写旧结构）**：子任务独立化、拆分归档完整流程、完整 DayPlan 预算 / 扣除 / 收工 / 计划管理、triage 全套、Settings 编辑入口、extraFocus/extraRest 与 UnresolvedInterval、统计真实化、restItem 过程事件、notification/prompt、导入导出、诊断日志、多端同步（后置边界见 §5 D3、prototype-inventory §5 B/C 类）。
- **为什么**：核心行为最小集（见 §5 D3）；红线 10（P1 + 已有业务最小集）；§7.1/§7.5/§7.6/§7.9/§7.8/§3.5/§3.3；§3.1 规则 11（estimateRounds 首轮）；§2.4（软删）；prototype-behavior-inventory A 类。
- **怎么验证**：逐组核对——每个保留的旧 UI 入口都写了对应 v4 实体字段 + v4 Event，且无任何旧字段（bucket/completed/cancelledPomos/interrupts{}/pomoEvents/裸字符串 restSuggestions）被当真值写入；focus 完成后 Session=completed 且有 `focus.completed`；break 完成写 `actualRest`（未选=null）；能量 / 打扰各自落 EnergyRecord / interrupt.* 事件；删除走软删 tombstone；估算预估 ≤7。
- **依赖**：S8、S10、S11。

### S14 · 旧原型数据处理（不迁移，空库起步）
- **做什么**：**不迁移**旧 `sessionStorage['pomo-state']` / INITIAL / demo 数据。Phase 1 从**空白正式库**起步，首启走 S11 初始化闭环。检测到旧 storage 时，可忽略 / 清理 / DEV-only 备份后不读取，但**不作为正式迁移流程**。
- **明确不做**：不把旧 demo/INITIAL 伪装成真实用户数据；不把旧 `log[]`/`completed`/`cancelledPomos`/`interrupts{}`/`bucket`/内嵌 `subtasks[]` 还原成 v4 历史 Session/Event/EnergyRecord；不为迁移旧脏数据污染 v4 新模型。
- **demo 边界**：如保留 demo，必须 DEV-only、与真实用户数据隔离、不进统计、不作为新用户默认正式数据（`demo.*` 为 DEV，§7.14）。
- **为什么**：旧数据不迁移（见 §5 D5，旧原型数据均为假 / 乱数据，不复用）；§2.1/§9.1（Web 本地）；E3/E4（v4 唯一基准）。
- **怎么验证**：全新环境首启 = 空库 → S11 写入默认 Settings + 当天 DayPlan + 「计划准备」；确认无任何代码路径把旧 sessionStorage 读为正式数据。
- **依赖**：全部上游（实质只影响首启，S11 之后即可定调）。

---

## 3. 步骤依赖与建议顺序

```
S0 脚手架/选型
 ├─ S2 ID 入口 ─┐
 ├─ S3 时间/appDate ─┤
 ├─ S4 schemaVersion ─┤
 └─ S1 dataStore/store ┤
                       ▼
                  S5 实体 schema ──► S6 校验器 ──► S7 EventType+payload
                                                    │
                                                    ▼
                                              S8 原子写入
                                                    │
                        ┌───────────────┬───────────┐
                        ▼               ▼           ▼
                   S9 软删除/过滤    S12 error 事件  S11 DayPlan 最小初始化闭环
                                                   (Settings+DayPlan+模板任务)
                                                       │
                                          ┌────────────┴────────────┐
                                          ▼                         ▼
                                   S10 派生视图                S13 现有核心行为接入
                                  (今日=DayPlan.taskIds)     (核心行为最小集)
                                                       │
                                                       ▼
                                                S14 旧数据处理 (不迁移/空库)
```

**关键顺序原则**：
- 基础设施（S0–S4）必须先于 schema（S5）。
- schema → 校验器 → 事件类型 → 原子写入，是一条强串行链（S5→S6→S7→S8），后续所有"写入"步骤都挂在 S8 之后。
- S9（软删除）、S12（error）、S11（初始化闭环）可在 S8 完成后并行推进。
- **S10（今日 / 活动派生）依赖 S11**：今日待办来源是 S11 保证存在的当天 DayPlan.taskIds，故 S11 必须先于 S10。
- S13（现有核心行为接入）需要 S11（focus.started 的 plannedDuration 读 Settings；今日列表已就绪）与 S10（today/活动视图）。
- S14（不迁移、空库起步）实质只影响首启，S11 之后即可定调。

---

## 4. 验收对接

每步完成后，用 `phase1-checklist.md` 第一部分对应实体 / 事件行勾验（取值：通过 / 不通过 / 不适用）。本计划的"怎么验证"是步骤级冒烟标准，checklist 是字段级完整验收基准，二者并用。

---

## 5. 已确认决策记录（防回退）

> 本节用途：记录 §1–§4 各执行口径**为什么这样定**，防止后续回退到旧结论，供后续审查者理解背景。它是溯源记录，**不是施工步骤的必要补丁**——§1–§4 正文已自洽，不看本节也能执行。各条均为 2026-06-04 review 已确认决策（原以 Q1–Q6 编号，现固定为 D1–D6）。

**D1 · 技术选型边界。**
IndexedDB 访问方式 / 封装库 / 目录落点由实现方按"稳定最小"原则决定：优先复用 / 扩展现有工程结构、优先少引入依赖、如引入 IndexedDB 封装库须说明理由、必须满足 v4 核心要求（`dataStore` 抽象层、组件不得直接读写底层存储、原子事务、可测试、schema 可校验）。实现方记录为 ADR / implementation note，但不作为阻塞项。详见 S0。

**D2 · DayPlan 最小初始化闭环（P1 必做）。**
首次进入 / 首次读取当天今日待办时：ensureSettingsInitialized → ensureDayPlanForAppDate → createDailyTemplateTasksForDayPlan（「计划准备」1 番茄置顶），写入 `settings.initialized`（仅本次确创建 Settings 时）/ `dayPlan.created` / `task.created(systemDailyTemplate)` / `dayPlan.taskAdded(systemDailyTemplate)`，共享同一 correlationId。详见 S11、§10.2、§7.3。**这是数据地基最小闭环，不等同于提前实现完整 P2 DayPlan 管理**（完整计划页 / 预算编辑 / 扣除项编辑 / 复盘 / 收工 / 复杂重排 / 统计真实化仍 P2+）。

**D3 · 当前原型核心行为接入边界（非极窄路线）。**
总口径：Phase 1 = **v4 P1 数据地基 + 当前原型已有、用户正常可触发、且不接会导致核心事实丢失或现有核心流程退化的最小业务集**；这不等于提前实现完整 P2/P3/P4。判断标准：当前 UI 已存在、用户已能正常触发、不接即丢任务/番茄/能量/打扰/休息最终结果等核心事实、或致现有核心流程退化；每个接入行为必须写 v4 实体 + v4 Event；不得继续写旧结构、不得旧/新双轨写、不得以旧字段为真值。
- **真实接入清单**：见 S13（A1 任务基础 / A2 今日待办 / A3 标准计时闭环 / A4 自我觉察事实）+ S11（DayPlan 初始化闭环）。
- **后置边界（不提前实现为完整功能）**：子任务独立化、拆分归档/`splitNeeded`/lineage/`task.split` 完整流程、完整 DayPlan 预算/扣除/收工/计划管理、triage 全套、Settings 编辑入口、extraFocus/extraRest 与 UnresolvedInterval、统计真实化、restItem 展示/洗牌/选择过程事件、notification/prompt、数据导入导出、诊断日志导出、多端同步。
- 本轮不接入的旧 UI 入口：隐藏 / 禁用 / 降级只读 / 标 DEV-only / 明确挂账后置，且**不得继续写旧结构**。

**D4 · 错误事件最小范围（`error.unexpectedState` 仅做写入校验路径）。**
P1 要做：每次 create/update/soft-delete/appendEvent 前做 v4 字段一致性校验，违反即拒绝写入并记录 `error.unexpectedState`（`context.detectedBy='writeValidation'`）。P1 不做：启动时全库扫描（startupCheck）、读取时全量巡检（readValidation）、旧坏数据自动修复、错误修复 UI、恢复流程复杂异常处理。分工：存储写失败 → `error.dataWriteFailed`；状态违反 v4 约束 → `error.unexpectedState`。详见 S12。

**D5 · 旧数据不迁移（空库起步）。**
不迁移旧 `sessionStorage['pomo-state']`；不把旧 demo/INITIAL 伪装成真实用户数据；不把旧 `log[]`/`completed`/`cancelledPomos`/`interrupts{}`/`bucket`/内嵌 `subtasks[]` 还原成 v4 历史记录；不为迁移旧脏数据污染 v4 新模型。Phase 1 从空白正式库起步；检测到旧 storage 可忽略 / 清理 / DEV-only 备份后不读取，但不作为正式迁移流程。保留 demo 必须 DEV-only、与真实数据隔离、不进统计、不作新用户默认正式数据。详见 S14。

**D6 · 默认计时设置（取 v4）。**
S11 初始化 Settings 取 v4 默认：`focusMinutes=25`、`shortBreakMinutes=5`、`longBreakMinutes=15`、`longBreakEvery=4`。原型旧 `settings.longMin=20` 只是旧状态，**不继承**。用户日后改长休时长属 Settings 后续行为（P2），不影响 Phase 1 默认值。
