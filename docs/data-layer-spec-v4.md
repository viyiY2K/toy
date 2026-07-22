# 番茄钟数据层规范 v4

> **正式基准文档。本文件取代 v1 / v2 / v2.1 / v3。后续所有开发仅参考 v4。**
> 版本：4.0.0 | 制定日期：2026-05-29

---

## 目录

1. 文档定位与适用范围
2. 跨端数据契约原则
3. 核心数据模型
6. Event type 命名规范
7. 完整事件分类表
8. 统计口径
9. 可运营性数据要求
10. Phase 分级实施计划
11. 后置实现清单
14. 待用户复核清单

---

## 1. 文档定位与适用范围

### 1.1 本文档的角色

本文件是**番茄钟产品的统一数据规范**，定位为：

1. **产品数据契约**：规定本产品所有实体的字段、类型、语义、约束。任何实现端（Web、iOS、macOS）在读写数据时，以本文件为唯一参考标准。
2. **跨端共用基准**：v4 明确"存什么"，不规定"用什么存"。不同平台可选用不同存储引擎（Web 用 IndexedDB、iOS 和 macOS 均用 SQLite），但所有端的数据结构必须满足本文件规定的字段和语义，且数据可互转。
3. **事件行为时间线的建模规范**：规定哪些用户行为必须被记录为 Event，哪些是统计输入，哪些是审计留存。
4. **Phase 实施路线图**：明确每个数据能力在哪个阶段落地，避免"字段预留了但没说什么时候接入"的模糊。

本文件不包含：
- 具体的存储引擎 API 使用方式（如 IndexedDB 的 objectStore 名称、事务写法）
- UI 交互设计或组件实现细节
- 服务端架构（当前阶段不涉及自建服务端架构）

### 1.2 与 v1 / v2 / v2.1 / v3 的关系

| 历史版本 | 主要贡献 | v4 中的状态 |
|---|---|---|
| v1 | 初版数据模型草稿，确立了扁平 Task + parentId 思路 | 已归档，内容已内嵌进 v4 |
| v2 | 确立 D1–D6 核心决策（D5 自 v2.1 起合并进 D1 描述），SessionStorage 过渡方案 | 已归档，内容已内嵌进 v4 |
| v2.1 | 修订 R1–R14，确立 D7–D12，完善数据模型字段 | 已归档，内容已内嵌进 v4 |
| v3 | 补全完整事件清单（14 个 domain，100+ 事件类型），引入 Phase 分级 | 已归档，内容已内嵌进 v4 |
| **v4（本文）** | 自包含正式基准，新增跨端契约、可运营性章节，修订若干歧义 | **唯一有效版本** |

**声明**：自本文件制定之日起，v1 / v2 / v2.1 / v3 均降级为历史归档，仅供溯源查阅，**不再作为任何开发决策的依据**。如历史版本内容与本文有出入，以本文为准。

### 1.3 阅读对象与使用方式

**主要阅读对象**：

- **产品/设计**：阅读 §1、§2、§10（Phase 路线图），理解产品数据结构的边界和演进计划。
- **实现方（目前主要是用户与 Claude Code 协作完成，未来可能扩展到独立工程师）**：重点阅读 §3（数据模型）、§7（事件清单）、§8（统计口径）、§10（Phase 计划），作为实现依据。
- **未来 iOS/macOS 端开发者**：从 §2（跨端契约原则）入手，再阅读 §3，理解数据结构的平台无关部分。

**使用方式**：

- 遇到"这个字段叫什么、类型是什么"→ 查 §3（数据模型）。
- 遇到"这个用户行为要记什么事件"→ 查 §7（事件分类表）。
- 遇到"哪些数据进统计，哪些只审计"→ 查 §8（统计口径）。
- 遇到"这个功能第几阶段做"→ 查 §10（Phase 计划）。
- 遇到"后置未实现功能"→ 查 §11（后置实现清单）。
- 遇到"未决或待落地事项"→ 查 §14（待用户复核清单）。

---

## 2. 跨端数据契约原则

本章规定所有实现端（Web、iOS、macOS 等）在数据结构层面必须共同遵守的原则。这些原则与存储引擎无关，是产品在所有平台上数据一致性的基础。

### 2.1 存储抽象

**v4 只规定"存什么"（schema），不规定"用什么存"（storage engine）。**

各平台可自行选择适合的存储引擎，不同端之间的数据结构必须可以互转：

| 平台 | 推荐存储引擎 |
|---|---|
| Web | IndexedDB（通过 `dataStore` 抽象层访问；组件不得直接读写底层存储） |
| iOS | SQLite |
| macOS | SQLite |
| 其他平台 | 任何能满足本文 §3 数据模型的引擎 |

上述是各端推荐存储引擎，不改变 v4 的核心原则：本文只规定数据结构与语义，不规定所有平台必须使用同一种底层存储。

**"可以互转"的含义**：任意端写入的数据，另一端能读取并正确理解每个字段的语义，不会因存储引擎差异而产生字段丢失或语义偏差。具体序列化格式（如跨端传输时使用何种格式）在 Phase 5 同步实现阶段详细规定；Phase 1–4 阶段，Web 端数据不离开用户本地浏览器。

### 2.2 全局唯一 ID

**所有实体 ID 必须使用 UUID v7（含时间序，便于按时间范围查询和索引）。不得使用 UUID v4 或其他 ID 生成方式。**

适用实体：Task、DayPlan、Session（Focus 和 Break 共用）、Event、EnergyRecord、UnresolvedInterval、Settings。

> Settings 虽然在 Phase 1–4 单用户场景下通常只有一条记录，但跨端同步和未来可能的多配置场景仍需 UUID v7 作为定位标识。

**UUID v7 的优势**：
- 前 48 位是毫秒级 Unix 时间戳，ID 天然按时间排序。
- 在 IndexedDB、SQLite 等按 key 查询的存储中，可用 ID 范围查询代替时间字段扫描，查询效率更高。
- 跨端生成的 ID 不会碰撞，无需中央分配。

**禁止的 ID 生成方式**：
- 本地自增整数（跨端会碰撞）
- `nanoid` 或其他非 UUID 格式（不保证时间序，不符合跨端互转要求）
- UUID v4（随机生成，无时间序）

### 2.3 同步预留字段

**所有可同步实体**（Task、DayPlan、Session、EnergyRecord、UnresolvedInterval、Settings）必须包含以下字段：

| 字段名 | 类型 | 是否可空 | 说明 |
|---|---|---|---|
| `createdAt` | `string` | 否 | 记录首次写入时间，ISO 8601 带时区，例 `2026-05-24T14:37:12+08:00` |
| `updatedAt` | `string` | 否 | 记录最近一次修改时间，格式同上；创建时与 createdAt 相同 |
| `schemaVersion` | `number` | 否 | 该条记录写入时的 schema 版本号（整数），用于迁移判断 |
| `deletedAt` | `string \| null` | 是 | 软删除时间戳；null 表示未删除；非 null 表示已软删除（见 §2.4） |
| `deviceId` | `string \| null` | 是 | （可选预留）写入该条记录的设备标识；Phase 1 可写 null |
| `syncedAt` | `string \| null` | 是 | （可选预留）最近一次同步成功的时间戳；Phase 1 写 null |

> `deviceId` 和 `syncedAt` 为预留字段，Phase 1–4 写 null 即可，Phase 5+ 实现多端同步时启用。

> **`schemaVersion` 口径（数据结构版本，非文档版本）**：`schemaVersion` 是用于数据迁移判断的**整数**，与文档版本号（当前 `v4.0.0`）是两个独立概念，不可混用。Phase 1 建立第一版正式数据地基，`CURRENT_SCHEMA_VERSION = 1`，新写入记录的 `schemaVersion` 一律写 `1`。旧原型数据若不含 `schemaVersion`，迁移时视为 legacy（按 `schemaVersion = 0` 或 unknown legacy schema 处理）。此后每次**真实修改数据结构**，才把 `CURRENT_SCHEMA_VERSION` 递增为 2、3、4……；**不得**把文档版本 `4.0.0` 直接当作每条记录的 `schemaVersion` 写入。

---

**Event 实体例外**

Event 是 append-only 不可变历史记录（详见 §3.4 Event），不适用以下字段：
- `updatedAt`：Event 写入后永不修改，该字段无意义，故不挂。
- `deletedAt`：Event 不允许删除。如需"撤销"一条已写入的 Event，正确做法是追加一条修正性 Event（如 `task.uncompleted` 修正 `task.completed`），而非软删除原事件。

Event 实体必须挂的字段为：`createdAt`（记录写入存储的时刻，用于审计和同步参考；与 `occurredAt` 的语义区别见 §3.4）和 `schemaVersion`。
不允许任何实现端为 Event 增加 updatedAt 或 deletedAt 字段。

> Event 虽不可修改 / 删除，但其**写入**与触发它的实体变更必须在同一事务内原子提交，二者不得出现一方成功一方失败的半成功状态，详见 §3.4 关键规则第 8 条。

---

### 2.4 软删除规则

**软删除适用于所有可同步实体（Task、DayPlan、Session、EnergyRecord、UnresolvedInterval、Settings），Event 除外。**

规则：
1. 任何可同步实体，**禁止物理删除（硬删除）**。
2. 删除操作一律写入 `deletedAt` 时间戳，并将该条记录保留在存储中作为 tombstone（墓碑记录）。
3. 应用层读取数据时，默认过滤 `deletedAt != null` 的记录；需要时可显式查询已删除记录（如误删恢复流程）。
4. Phase 1 不要求 UI 支持恢复已删除记录，但数据层**必须**保留 tombstone，不得清除。

**Event 的撤销机制（非软删除）**：

Event 在设计上是不可删除的历史记录。如果一条 Event 因程序 bug 或用户误操作被错误写入，正确的处理方式是**追加一条修正性 Event**（例如：`task.completed` 被错误写入后，追加 `task.uncompleted` 修正），而不是给原 Event 打 `deletedAt`。

任何为 Event 实现软删除逻辑的代码均属违反本规范，应在 code review 阶段拒绝。

### 2.5 时区与 localDate

**基本规则**：`occurredAt` 和其他带时区的时间戳（`createdAt`、`updatedAt`、`startedAt`、`endedAt` 等）必须携带 UTC 偏移量，格式为 ISO 8601 带时区，例：`2026-05-24T14:37:12+08:00`。这些时间戳是**事实源**，所有时间派生计算（如 `localDate`、`offsetSeconds`）以此为基础。

**timezone 字段（所有按本地日期聚合的实体）**

凡是存储 `localDate` 且需要按本地日期聚合统计的实体，必须同时存储 `timezone` 字段（IANA 时区名称，例 `"Asia/Shanghai"`）。

理由：UTC 偏移量（如 `+08:00`）不能唯一确定 IANA 时区（同一偏移量对应多个时区，且夏令时规则不同）。为了在用户跨时区或时区规则发生变化时仍能正确重新计算本地日期，必须保留写入时的 IANA 时区。

适用实体（当前版本）：
- Event（所有事件类型）——`localDate` 由 `occurredAt` 派生，是事实自然日；事件按日统计按派生 `appDate` 归属
- Session（专注与休息会话）——`localDate` 由 `startedAt` 派生，是事实自然日；今日番茄、今日专注时长、休息统计按派生 `appDate` 归属
- EnergyRecord（能量记录）——`localDate` 由 `occurredAt` 派生，是事实自然日；能量按日 / 趋势统计按派生 `appDate` 归属
- UnresolvedInterval（未归类时间段）——`localDate` 由 `startedAt` 派生，是事实自然日；按日归属按派生 `appDate`
- DayPlan（当天执行计划）——`appDate` 为业务键、`localDate` 为事实自然日辅助字段，均由创建时间与 `timezone` 派生（见 §3.2）

未来新增的、存储 `localDate` 且按本地日期聚合的实体，均自动适用本规则，无需单独标注例外。

> 上列各实体的 `localDate` 是**事实自然日**；`timezone` 之所以必须保留，正是为了能由事实时间重新派生本地日期。用户可见的"今日 / 按日"统计与日 / 周 / 月 / 年聚合，其业务日归属按下文 `appDate` 规则派生（`appDayStartOffsetMinutes = 0` 时与 `localDate` 一致），不直接以 `localDate` 为业务日期。

写入规则：`timezone` 在记录写入时取设备当前时区，与业务发生时间字段（`occurredAt` 或 `startedAt`，视实体而定）同时记录，**写入后不修改**（即使用户后续修改了设备时区设置）。

**localDate 计算规则**：

`localDate`（格式 `'YYYY-MM-DD'`）**按记录写入时设备所在时区计算**，即从业务发生时间字段（`occurredAt` 或 `startedAt`）与 `timezone` 共同推导出用户本地日期。跨时区使用场景（如用户旅行中）下，`localDate` 反映的是业务事件发生时用户的本地日历日期，不是 UTC 日期。

示例：
- `occurredAt` = `2026-05-24T23:50:00+08:00`，`timezone` = `"Asia/Shanghai"`
- `localDate` = `"2026-05-24"`（北京时间 23:50，属于 5 月 24 日）
- 同一时刻的 UTC 时间为 `2026-05-24T15:50:00Z`，但 `localDate` 不取 UTC 日期

**appDate 派生规则（产品日归属）**：

`localDate` 是**事实自然日**，不受用户设置影响。在此之上，产品需要一个统一的"产品日"概念来判断"今天 / 每日 / 当日"，这一概念由 `appDate` 表达：

```text
localDate = 真实自然日事实日期，不受用户设置影响。
appDate   = 按 appDayStartOffsetMinutes 派生出的产品日归属，用于产品内"今天 / 每日 / 当日统计"的业务归属。
```

`appDate`（格式 `'YYYY-MM-DD'`）按同一业务发生时间字段（`occurredAt` / `startedAt`）、`timezone`，以及 `Settings.appDayStartOffsetMinutes`（产品日开始时间相对自然日 00:00 的分钟偏移，默认 0，见 §3.7）共同派生：

```text
若某条记录在 timezone 下的本地时间早于当天 appDayStartOffsetMinutes（即落在产品日起点之前），则 appDate 归属前一个自然日；否则归属当前自然日。
```

等价表述：`appDate = local date of (本地时间 − appDayStartOffsetMinutes 分钟)`。

规则要点：

1. `localDate` 按 `occurredAt` / `startedAt` 与 `timezone` 派生，是事实日期，**不因用户修改 `appDayStartOffsetMinutes` 而重写**。
2. `appDate` 按同一业务时间字段、`timezone` 与 `appDayStartOffsetMinutes` 派生，用于产品日归属。
3. 当 `appDayStartOffsetMinutes = 0` 时，`appDate` 与 `localDate` 通常一致；当其 ≠ 0 时，凌晨时段可能归属前一个 `appDate`。
4. `appDate` 可以作为查询时派生值，也可以在需要性能优化时写入具体实体，但其语义必须始终可由"事实时间 + timezone + appDayStartOffsetMinutes"重新计算。
5. 本节列出的按本地日期聚合的实体——Event、Session、EnergyRecord、UnresolvedInterval——其产品日归属（`appDate`）统一按本规则在查询 / 统计时派生，当前**不在这些实体上新增 `appDate` 存储字段**；它们的 `localDate` 仍作为事实自然日保留，用于事实记录、跨时区溯源与底层时间校验。这类实体可按当前或指定的 `appDayStartOffsetMinutes` 在统计查询时重新派生产品日归属。**DayPlan 为例外**：DayPlan 需要明确的产品日业务键，单独存储 `appDate`（见 §3.2）。
6. **DayPlan.appDate 是创建时确定的业务键，不随 offset 修改而重写**：`DayPlan.appDate` 在该 DayPlan 创建时按当时的 `timezone` 与 `appDayStartOffsetMinutes` 派生并落库。用户后续修改 `Settings.appDayStartOffsetMinutes` 时，历史 `DayPlan.appDate` **不自动重写、不自动改名、不自动迁移**；`localDate` 同样永远是事实自然日，不因 offset 修改而改变。若未来确需"历史 DayPlan 重新归属 / 批量迁移 / 改名"，必须另开专门的数据迁移设计，不在 Phase 1 承诺（见 §3.2、§11）。

示例（`appDayStartOffsetMinutes = 240`，即产品日从 04:00 开始）：

- 2026-06-04 02:00 发生的 focus：`localDate = 2026-06-04`，`appDate = 2026-06-03`（凌晨 2 点仍属前一个产品日）。

---

### 2.6 冲突解决（Phase 5+ 预留）

> **本节所有策略均标注为 Phase 5+ 实现。Phase 1–4 仅预留字段，不实现多端同步逻辑。**

当同一份数据在多个设备上被独立修改后进行同步，需要冲突解决策略。v4 规定以下方向：

**Event（append-only）：天然无冲突**

Event 是只追加不修改的历史记录。不同设备写入的 Event 在合并时直接按 `occurredAt` 排序追加，不存在覆盖问题。唯一需要处理的是重复写入（相同 `id` 的 Event 在两端都存在），策略为：相同 `id` 视为同一条记录，保留任意一份即可（两份内容应完全一致）。

**其他可同步实体（Task、DayPlan、Session、EnergyRecord、UnresolvedInterval）：last-write-wins by updatedAt**

当同一实体（相同 `id`）在两端均有修改时，选择 `updatedAt` 较晚的版本作为最终结果（最后写入者胜出）。Phase 5 实现时需注意设备时钟偏差问题，可配合 `deviceId` 辅助判断。

---

**Settings 冲突解决：Phase 5+ 详细设计，本文仅说明方向**

Settings 不适用 last-write-wins by updatedAt，因为：
- Settings 是多字段对象（focusMinutes、shortBreakMinutes、longBreakMinutes、longBreakEvery、restSuggestions 等）。
- 不同设备可能同时修改不同字段（如 A 端改专注时长、B 端改短休时长）。这些修改在语义上不冲突，但整体覆盖会丢失其中一边。
- 因此 Settings 同步需要**字段级合并（field-level merge）**，而非对象级覆盖。

具体合并策略（每个字段单独的冲突解决规则、`restSuggestions` 数组类字段如何 diff、迁移导致的设置变更如何处理等）留待 Phase 5 详细设计。

---

**statsBaseline 冲突解决：Phase 5+ 详细设计，本文仅留提示**

`Settings.lifetimePomodoroBaseline`（累计番茄基数，见 §3.7 / 决策 D11 相关 / §7.13 statsBaseline 事件域）是一个特殊字段，既不适用 last-write-wins，也不适用字段级合并。

原因：
- 该字段是用户手动设置的"历史累计起点"（例如从其他工具迁移过来，导入 300 个番茄）。
- 如果用户在 A 端将基数从 0 改为 300，同时在 B 端从 0 改为 500，两个改动都是有意为之，机械地选择"较晚的那个"会无声地丢失另一端的用户决定，且用户无法察觉。
- 这类冲突需要**用户介入决策**（例如：同步时检测到两端基数不一致，弹窗让用户选择保留哪个、或合并求和、或手动输入新值）。

具体决策机制（如何检测、如何展示给用户、是否允许"合并求和"语义等）留待 Phase 5 详细设计。

> 给 Phase 5 实现者的提示：本字段的冲突属于"语义冲突"而非"技术冲突"，任何不询问用户而自动决定的策略都会导致数据信任度受损。请勿默认套用 Settings 字段级合并方案。

---

## 3. 核心数据模型

本章列出本产品所有核心实体的完整字段定义。每个字段均注明类型、是否可空、默认值和含义说明。

**通用约定**：
- 所有实体的 `id` 字段均为 UUID v7 字符串（见 §2.2）。
- 所有带时区的时间戳字段格式为 ISO 8601 带时区，例 `"2026-05-24T14:37:12+08:00"`。
- `createdAt`、`updatedAt`、`schemaVersion`、`deletedAt`、`deviceId`、`syncedAt` 为同步预留字段（见 §2.3），适用于所有可同步实体，下文不再每次单独解释语义。
- `schemaVersion` 是**数据结构版本号（整数）**，用于数据迁移判断，与文档版本号 `v4.0.0` 是两个独立概念。Phase 1 `CURRENT_SCHEMA_VERSION = 1`，新写入记录写 `1`；旧原型无版本数据视为 legacy（`0` / unknown）。详见 §2.3。
- "可空"列中，"否"表示该字段不允许为 null，写入时必须有有效值；"是"表示允许为 null。

---

### 3.1 Task（任务本体）

Task 是产品的核心实体，表示一个待办事项或子任务。子任务也是 Task，通过 `parentId` 关联母任务，层级最多 2 层。番茄数、专注时长等统计数据**不存在 Task 上**，一律从 Session 和 Event 派生；具体统计口径见 §8。

**完整字段定义**

| 字段名 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `id` | `string` (UUID v7) | 否 | 写入时生成 | 实体唯一标识；取值约束：UUID v7 格式 |
| `parentId` | `string \| null` | 是 | `null` | 母任务 id；`null` 表示顶层任务；有值表示子任务（层级上限 2 层，子任务下不允许再有子任务）；取值约束：null 或合法的 Task UUID v7 |
| `title` | `string` | 否 | 无 | 任务标题；取值约束：非空字符串，最大长度 200 字符 |
| `status` | `string` (枚举) | 否 | `'active'` | 任务状态，枚举值见下方；取值约束：必须取自枚举值之一（active / completed / splitNeeded / archived / deleted） |
| `outcome` | `string \| null` | 是 | `null` | 归档结果；`null` = 未归档；`'completed'` = 完成归档；`'split'` = 拆分归档；取值约束：取值为 null / 'completed' / 'split' 之一 |
| `completionSource` | `string \| null` | 是 | `null` | 完成方式；`null` = 未完成；`'pomodoro'` = 番茄完成；`'manual'` = 手动勾选完成（手动完成不计入番茄统计，见 §8）；任务被取消完成时改回 null，与 `completedAt` 保持同步；取值约束：取值为 null / 'pomodoro' / 'manual' 之一 |
| `estimatedPomodoros` | `number` | 否 | `1` | 当前预估番茄数；取值约束：整数，1–7；1–4 为正常颗粒度，5–6 为偏大提醒区（允许写入，UI 可给出非阻断式软提醒），7 为最大允许值；`>7` 的写入必须被数据层拒绝 |
| `estimateRounds` | `array` | 否 | `[]` | 每次预估的完整记录，含时间戳，结构见下方；取值约束：数组（可为空），元素须符合下方 estimateRounds 结构定义 |
| `actualWorkNote` | `string \| null` | 是 | `null` | 已完成任务的"实际完成了什么"备注，归档后可补充编辑；取值约束：无特殊约束 |
| `note` | `string \| null` | 是 | `null` | 任务进行中的备注（与 `actualWorkNote` 区分：本字段用于进行中的随时记录）（原 v2.1 metadata.note 已上移至顶层，自 v4 起作为 Task 直接字段）；取值约束：无特殊约束 |
| `sortIndex` | `number` | 否 | 当前列表最大 sortIndex + 1000；列表为空时为 1000 | 在活动清单 / 非 DayPlan 视图中的排序索引；不用于今日待办排序。今日待办排序以 `DayPlan.taskIds` 数组顺序为唯一依据。步长 1000 便于拖拽时取中间值插入，避免全表重排；取值约束：整数，≥ 0 |
| `createdAt` | `string` | 否 | 写入时生成 | 记录首次写入时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `updatedAt` | `string` | 否 | 写入时生成 | 记录最近修改时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `completedAt` | `string \| null` | 是 | `null` | 任务完成时间；未完成时为 null；任务被取消完成（`task.uncompleted` 事件）时改回 null，历史完成轨迹通过 Event 追溯，Task 本体只反映当前状态；取值约束：ISO 8601 带时区格式或 null |
| `deletedAt` | `string \| null` | 是 | `null` | 软删除时间戳（同时用作 §2.3 同步 tombstone）；`null` = 未删除；取值约束：ISO 8601 带时区格式或 null |
| `archivedAt` | `string \| null` | 是 | `null` | 归档时间（拆分归档或完成归档时写入）；取值约束：ISO 8601 带时区格式或 null |
| `deletedReason` | `string \| null` | 是 | `null` | 删除原因，可选；Phase 1 默认 null；取值约束：`null` / `'userDeleted'` / `'triageDismissed'` / `'dataCleanup'` 之一，不允许写入任意自由文本；`status='deleted'` 时 `deletedAt` 必须非 null，`deletedReason` 可为 null，但若非 null 必须符合上述枚举；枚举语义见 §7.1 `task.deleted` payload 说明 |
| `metadata` | `object` | 否 | `{}` | 附加元数据对象，永远不为 null（可为空对象），内部字段均可选，见下方；取值约束：必须为非 null 对象，内部字段均为可选 |
| `lineageId` | `string` | 否 | 新建时等于 `task.id` | 血缘链接 ID；同一拆分链上的任务共享同一 lineageId；新建任务的 lineageId 等于自身 id；取值约束：UUID v7 格式 |
| `splitFromTaskId` | `string \| null` | 是 | `null` | 从哪个任务拆分而来；`null` = 原始任务，未经拆分；取值约束：null 或合法的 Task UUID v7 |
| `splitIndex` | `number` | 否 | `0` | 拆分序号；`0` = 原始任务；拆分产生的新任务从 `1` 开始递增；取值约束：整数，≥ 0 |
| `schemaVersion` | `number` | 否 | 写入时取当前 schema 版本 | 该条记录写入时的 schema 版本号（见 §2.3）；取值约束：正整数，≥ 1 |
| `deviceId` | `string \| null` | 是 | `null` | （可选预留）写入设备标识（见 §2.3，Phase 5+ 启用）；取值约束：null 或非空字符串 |
| `syncedAt` | `string \| null` | 是 | `null` | （可选预留）最近一次同步成功时间（见 §2.3，Phase 5+ 启用）；取值约束：ISO 8601 带时区格式或 null |

**status 枚举值说明**

| 值 | 含义 |
|---|---|
| `'active'` | 活动中，尚未完成，可在活动清单和今日待办中显示 |
| `'completed'` | 已完成，已写入 `completedAt` |
| `'splitNeeded'` | 已达到需要拆分 / 重新处理的状态（如已用满 7 个有效标准 focus 仍未完成，或第三轮预估后），尚未完成拆分 / 归档；处于该状态时**不允许直接开启新的标准 focus**，直至经拆分 / 归档 / 重新处理流程解除 |
| `'archived'` | 已归档（拆分归档或完成归档），`outcome` 字段记录归档类型 |
| `'deleted'` | 软删除，`deletedAt` 非 null，正常查询中不显示 |

**estimateRounds 数组元素结构**

```
{
  index:      number    预估轮次；取值约束：整数，固定为 1 / 2 / 3（1 = 方/初次预估，2 = 圆/二次预估，3 = 三角/三次预估）；第三轮预估后强制触发拆分归档，不存在 index > 3 的记录
  pomodoros:  number    该轮预估后单个 Task 的总预估番茄数（不是增量，是总量）；取值约束：整数，1–7；不允许通过二次 / 三次预估把总预估提高到 7 以上；`>7` 的写入必须被数据层拒绝
  occurredAt: string    预估发生时间；取值约束：ISO 8601 带时区格式
}
```


**metadata 对象结构**

```
{
  triageStatus?: 'pending' | null    待分流状态；`'pending'` 表示该 Task 当前处于待分流清单中；`null` 或字段不存在表示不在待分流清单中；当前只使用 `'pending'` 与 `null` 两个值；未来如需表达更细状态可扩展（如 `'resolvedToToday'` / `'resolvedToList'` / `'dismissed'`），但当前不预设（配合 §7.10 triage 事件域）
  color?:        string     任务颜色标记（如 "#FF6B6B"），可选
  tags?:         string[]   标签数组，可选
  templateKey?:  string     由 dailyTaskTemplates 自动生成的 Task 使用，记录来源模板 key；普通手动创建任务可为空
  source?:       string     任务来源标记；每日模板生成时为 'systemDailyTemplate'；其他 source 枚举待 §7 task.created 事件统一定义
}
```


**关键规则**

1. 番茄数、专注时长、打扰次数**不存在 Task 上**，一律从 `sessions`/`events` 派生。
2. `estimatedPomodoros` 和 `estimateRounds` 是计划数据，保留在 Task 上；两者均不参与番茄统计派生。
3. `bucket` 字段**不存在**。"今日"或"活动清单"完全由 DayPlan 成员关系派生。
4. 删除今日待办 = 从当天 DayPlan 移除 taskId，**不改 Task 任何字段**。
5. 删除活动清单任务 = 软删除（写 `deletedAt`，`status` 改为 `'deleted'`），**不物理删除**，历史 session/event 关联保留。
6. `completionSource='manual'` 的完成任务，**不计入**番茄统计；详见 §8（manual 完成不计入番茄统计的口径见 §8.5）。
7. `Task.sortIndex` 只用于活动清单 / 非 DayPlan 视图排序；今日待办列表的顺序由对应 `DayPlan.taskIds` 数组顺序决定。调整今日待办顺序时，只更新 `DayPlan.taskIds`，不修改 `Task.sortIndex`。
8. **Task 有效番茄数**（本规则定义，§8 展开统计口径）= 该 Task 下 `Session.type='focus'` 且 `Session.status='completed'` 的标准 focus Session 数。以下不计入 Task 有效番茄数：`discarded` focus；`extraFocus`；`shortBreak` / `longBreak` / `extraRest`；break 是否完成不影响 Task 有效番茄数（break 完成状态只影响完整番茄循环统计、休息统计与恢复统计，完整番茄循环统计口径见 §8）。
9. **单个 Task 总预估上限为 7 个番茄**。`estimatedPomodoros` 取值范围：1–7；1–4 属于正常颗粒度；5–6 属于偏大提醒区，允许写入，UI 可给出非阻断式软提醒（如"此任务已偏大，建议拆分"），该提醒不必触发 `prompt.shown`；7 为最大允许值，允许写入；`>7` 必须被数据层拒绝，不允许创建或调整到 8 个番茄以上的任务。三轮预估规则仍保留（index 最多为 3），但第三轮预估不是唯一拆分触发点。
10. **达到 7 个有效标准 focus 后仍未完成，采用严格拆分路线（路线 A）**。第 7 个有效标准 focus 完成后，应等其对应 break 完成 / 跳过 / 经恢复流程收尾后，触发 `prompt.shown`（promptType=`'taskSplitSuggestion'`），并使该 Task 进入需要拆分 / 重新处理的状态（`splitNeeded` 语义见上方 status 枚举）。在用户完成拆分、完成归档，或通过明确的重新处理流程解除前，**不允许**该 Task 直接开启第 8 个标准 focus。用户关闭、跳过或暂不处理该提示**不等于解除限制**——`prompt.dismissed(taskSplitSuggestion)` 只记录提示被关闭，不放开第 8 个标准 focus（见 §7.15）。Phase 1 只要求数据结构、事件类型与字段可承载该规则，真实阻断逻辑在后续 Phase 接入。
11. **`estimateRounds` 第一轮（`index=1`）在创建任务时写入**：用户创建任务时的初始预估也应作为 `estimateRounds` 第一轮记录写入，`index=1`，`pomodoros` 为创建时的初始总预估番茄数（与 `estimatedPomodoros` 一致），`occurredAt` 为创建时刻；后续二次 / 三次预估分别写 `index=2` / `index=3`（由 `task.estimateAdjusted` 承接，见 §7.1）。`estimateRounds[].pomodoros` 始终表示**该轮预估后的总预估番茄数**（不是增量）。历史旧数据 / 迁移数据若缺少第一轮记录，可在迁移说明中作为 legacy 兼容处理，但**新写入数据必须完整记录 `index=1`**。

**字段一致性约束**

以下跨字段一致性规则必须由数据层强制保证，任何写入操作不得违反：

1. `status='completed'` 时，`completedAt` 必须非 null，`completionSource` 必须非 null（`'pomodoro'` 或 `'manual'`）。
2. `status='archived'` 时，`archivedAt` 必须非 null，`outcome` 必须非 null（`'completed'` 或 `'split'`）。
3. `status='deleted'` 时，`deletedAt` 必须非 null。
4. `completionSource` 非 null 时，任务必须处于以下状态之一：`status='completed'`，或 `status='archived' && outcome='completed'`。完成方式（`'manual'` / `'pomodoro'`）只在"当前已完成"或"完成后归档"两种状态下存在；其余状态（`active` / `splitNeeded` / `archived && outcome='split'` / `deleted`）下 `completionSource` 必须为 null。
4a. **完成后归档**（任务先完成、再走完成归档）：`status='archived'`、`outcome='completed'`、`archivedAt` 非 null；若该任务此前已完成，则原 `completedAt` 与 `completionSource`（`'manual'` 或 `'pomodoro'`）必须保留、不得清空，以便归档后仍能追溯任务当初是手动完成还是番茄完成。
4b. **拆分归档**：`status='archived'`、`outcome='split'`、`archivedAt` 非 null；**不强制要求** `completedAt` / `completionSource` 非 null（拆分归档语义由 `outcome='split'`、`task.split`、新任务 `task.created(source='splitChild')` 与 `lineageId` / `splitFromTaskId` / `splitIndex` 字段表达，见 §7.1）。
5. `parentId` 非 null 时，该 Task 不允许再有子任务（2 层上限）。
6. `splitFromTaskId` 非 null 时，`splitIndex` 必须 ≥ 1；`splitFromTaskId` 为 null 时，`splitIndex` 必须为 0。
7. 任务被取消完成（`task.uncompleted` 事件）时，以下字段必须同时改回 null：`completedAt`、`completionSource`；同时 `status` 改为 `'active'`。`task.uncompleted` **只适用于尚未归档的 `completed` 状态**；已归档任务（`status='archived'`，无论 `outcome` 为 `'completed'` 还是 `'split'`）若未来需要恢复，走 `task.restored`（§7.1，P4）或后续恢复流程，不通过 `task.uncompleted` 直接处理，以免清空完成归档保留的 `completedAt` / `completionSource` 追溯信息。
8. `estimatedPomodoros` 必须满足 `1 ≤ estimatedPomodoros ≤ 7`；写入超出此范围的值应被拒绝。
9. `estimateRounds` 数组每个元素的 `pomodoros` 必须满足 `1 ≤ pomodoros ≤ 7`；`index` 必须为 1 / 2 / 3；不允许写入 `index > 3` 或 `pomodoros > 7` 的记录。

实现端在写入或更新 Task 时，必须验证以上规则，违反规则的写入操作应被拒绝。

---

### 3.2 DayPlan（当天执行计划）

DayPlan 表示用户某一天的执行计划，包含今日任务列表、番茄预算及时段估算。每个用户每天最多只有一条有效（未软删除）的 DayPlan 记录。历史 DayPlan 永久保留，作为计划偏差和完成率分析的数据来源（见关键规则第 6 条）。

**完整字段定义**

| 字段名 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `id` | `string` (UUID v7) | 否 | 写入时生成 | 存储主键，实体唯一标识；取值约束：UUID v7 格式 |
| `appDate` | `string` | 否 | 无 | **业务唯一键**，该计划所属的**产品日**；同一 appDate 下未软删除的 DayPlan 不得超过一条（见字段一致性约束第 1 条）；创建 / 查询 DayPlan 时，按当前 `Settings.appDayStartOffsetMinutes` 与 `timezone` 派生（见 §2.5）；取值约束：ISO 8601 日期格式 `YYYY-MM-DD` |
| `localDate` | `string` | 否 | 无 | 创建当天的**自然日辅助字段**（非业务唯一键），记录 DayPlan 创建时的事实自然日，用于跨时区溯源与底层校验；按创建时间与 `timezone` 派生（见 §2.5），不因用户修改 `appDayStartOffsetMinutes` 而重写；DayPlan 的业务归属一律以 `appDate` 为准，不以 `localDate` 为业务键；取值约束：ISO 8601 日期格式 `YYYY-MM-DD` |
| `timezone` | `string` | 否 | 写入时取设备时区 | 写入时设备所在的 IANA 时区名（见 §2.5）；写入后不修改；用于派生 `appDate` / `localDate`；取值约束：合法 IANA 时区名，如 `"Asia/Shanghai"` |
| `taskIds` | `string[]` | 否 | `[]` | 今日待办任务的有序列表，数组顺序即页面展示顺序；取值约束：数组（可为空），每个元素为合法的 Task UUID v7，数组内不允许重复 |
| `budgetPomodoros` | `number` | 否 | `0` | 用户当天最终采用的番茄预算；conservative / optimistic 模式下由估算派生后用户确认，manual 模式下直接输入；取值约束：整数，≥ 0 |
| `budgetMode` | `string` (枚举) | 否 | `'conservative'` | 预算估算模式，枚举值见下方；取值约束：取值为 `'conservative'` / `'optimistic'` / `'manual'` 之一 |
| `estimate` | `object` | 否 | 见下方 | 当天时段与番茄数估算，嵌套结构见下方；取值约束：必须为非 null 对象 |
| `settingsSnapshot` | `object` | 否 | 建立时取当前 Settings | 建立当天 DayPlan 时用于预算解释的计时设置快照，仅包含 `focusMinutes`、`shortBreakMinutes`、`longBreakMinutes`、`longBreakEvery` 四个字段；取值约束：必须为非 null 对象，字段说明参见下方 settingsSnapshot 说明 |
| `createdAt` | `string` | 否 | 写入时生成 | 记录首次写入时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `updatedAt` | `string` | 否 | 写入时生成 | 记录最近修改时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `deletedAt` | `string \| null` | 是 | `null` | 软删除时间戳（见 §2.4）；`null` = 未删除；取值约束：ISO 8601 带时区格式或 null |
| `schemaVersion` | `number` | 否 | 写入时取当前版本 | 该条记录写入时的 schema 版本号（见 §2.3）；取值约束：正整数，≥ 1 |
| `deviceId` | `string \| null` | 是 | `null` | （可选预留）写入设备标识（见 §2.3，Phase 5+ 启用）；取值约束：null 或非空字符串 |
| `syncedAt` | `string \| null` | 是 | `null` | （可选预留）最近一次同步成功时间（见 §2.3，Phase 5+ 启用）；取值约束：ISO 8601 带时区格式或 null |

**budgetMode 枚举值说明**

| 值 | 含义 |
|---|---|
| `'conservative'` | 保守估算模式：budgetPomodoros 默认等于 estimate.conservativePomodoros，用户可在确认时调整 |
| `'optimistic'` | 乐观估算模式：budgetPomodoros 默认等于 estimate.optimisticPomodoros，用户可在确认时调整 |
| `'manual'` | 手动输入模式：用户直接输入 budgetPomodoros，estimate 估算数据仅供参考，不约束最终值 |

**estimate 对象结构**

```
{
  workWindowMin:         number  今日可用总时段（分钟）；取值约束：整数，≥ 0
  fixedDeductions:       array   固定日程扣除项（会议、站会等），结构见下方；取值约束：数组（可为空）
  lifeDeductions:        array   必要生活时间扣除项（午餐、通勤等），结构见下方；取值约束：数组（可为空）
  freeMin:               number  自由时长（分钟）；派生值，计算规则见"派生字段计算规则"；取值约束：整数，≥ 0
  conservativePomodoros: number  保守估算最大番茄数；派生值，计算规则见"派生字段计算规则"；取值约束：整数，≥ 0
  optimisticPomodoros:   number  乐观估算最大番茄数；派生值，计算规则见"派生字段计算规则"；取值约束：整数，≥ 0
}
```

**扣除项数组元素结构**（`fixedDeductions` 和 `lifeDeductions` 共用）

```
{
  id:    string  扣除项唯一标识；取值约束：UUID v7 格式
  label: string  扣除项名称，如"站会"、"午餐"；取值约束：非空字符串
  hours: number  扣除时长（小时，允许小数）；取值约束：数字，> 0，如 0.5 表示 30 分钟
}
```

> 扣除项是 DayPlan 内嵌于 `estimate.fixedDeductions` / `estimate.lifeDeductions` 的**数组元素，不是独立顶层实体**：其 `id` 仍要求 UUID v7 格式（用于 §7.3 `dayPlan.deduction*` 事件稳定定位被改 / 被删的具体一项），但**不要求**为扣除项单独建 store，也**不**登记进 §2.2 的顶层实体列表。`label` 仅作可读信息，不再作为定位依据（可能出现同名同时长的两条）。

**settingsSnapshot 说明**

`settingsSnapshot` 存储建立当天 DayPlan 时用于预算解释的计时设置快照，而不是 Settings 完整副本。当前仅包含以下四个字段：

| 字段 | 含义 |
|---|---|
| `focusMinutes` | 单次专注时长（分钟） |
| `shortBreakMinutes` | 短休时长（分钟） |
| `longBreakMinutes` | 长休时长（分钟） |
| `longBreakEvery` | 每隔几个番茄触发一次长休（当前产品口径固定为 4，快照值随之恒为 4；见 §3.7） |

**不复制**以下 Settings 字段：`lifetimePomodoroBaseline`（累计基数，与单日预算无关）、`restSuggestions`（休息建议清单，不参与预算公式）、`dailyTaskTemplates`（每日任务模板，不参与预算公式），以及其他不直接参与 DayPlan 预算公式的设置字段。

该快照用于保证历史 DayPlan 的 `conservativePomodoros` / `optimisticPomodoros` 可解释：用户日后修改全局 Settings，不会反向改变历史 DayPlan 的预算解释。未来 Settings 新增字段时，**只有该字段会直接影响 DayPlan 预算公式，才允许进入 `settingsSnapshot`**；非预算字段不得自动进入快照。

**关键规则**

> 本节及 DayPlan 相关章节中出现的"今天 / 今日 / 当天"一律指**当前产品日 `appDate`**（按 `Settings.appDayStartOffsetMinutes` 与 `timezone` 派生，见 §2.5），而非自然日 `localDate`。今日任务列表、今日排期余量、今日预算估算均跟随当前 `appDate`。

1. 今日待办 = 当前产品日 `appDate` 对应的 `DayPlan.taskIds`；**不要**用任何 Task 字段判断"在不在今日"。
2. 活动清单（纯派生视图）= `status ∈ {active, splitNeeded}` 且 `taskId` **不在**当天 `DayPlan.taskIds` 里，且 `metadata.triageStatus ≠ 'pending'`。待分流清单（纯派生视图）= `status='active'` 且 `metadata.triageStatus='pending'`；待分流事项不自动混入活动清单，须经 `triage.movedToToday` / `triage.movedToList` / `triage.dismissed` 处理后才流入对应视图（见 §7.10）。
3. 移入今日 = 把 `taskId` 追加进当天 `DayPlan.taskIds`，**不复制任务、不改任何 Task 字段**。
4. 移回清单 = 从当天 `DayPlan.taskIds` 移除 `taskId`，**不删任务、不改任何 Task 字段**。
5. 昨天未完成的任务不自动滚入第二天 DayPlan；任务仍为 `active` 状态，因不在新一天 `DayPlan.taskIds` 里，自然出现在活动清单视图。
6. 历史 DayPlan **不软删除**，永久保留作为历史计划记录（用于计算计划偏差、完成率）；`deletedAt` 字段在正常流程中始终为 null，仅在数据修复等特殊情况下使用。
7. 今日排期余量（展示用）= `DayPlan.budgetPomodoros − 今日已完成有效标准 focus 数 − Σ(今日未完成任务 remainingPomodoros)`，其中 `remainingPomodoros = max(0, Task.estimatedPomodoros − completedValidFocusCountForTask)`；结果可为负数（超载状态），超出只提示超载，Phase 1 不强制禁止添加。旧写法"budgetPomodoros − Σ(今日任务 estimatedPomodoros)"已废止，完整口径见 §8.10。
8. 昨日未完成的任务不滚入第二天 DayPlan，不发起"是否带入今天"的提示流程。用户如需继续昨日任务，自行从活动清单手动加入今日（→ `dayPlan.taskAdded`）。历史专注进度由 Session 按 `taskId` 保留，不因跨天而丢失。
9. `DayPlan.taskIds` 是今日待办的唯一排序来源。今日列表拖拽排序时，只重排 `taskIds` 数组，不修改 `Task.sortIndex`。
10. **`DayPlan.appDate` 是创建时确定的业务键，offset 修改后不自动重写**：`appDate` 在 DayPlan 创建时按当时 `timezone` 与 `appDayStartOffsetMinutes` 派生并落库（field 说明中"按当前 `appDayStartOffsetMinutes` 派生"指的是**创建 / 首次查询当天 DayPlan 那一刻**的取值）。用户日后修改 `Settings.appDayStartOffsetMinutes` 时，历史 `DayPlan.appDate` **不自动重写、不自动改名、不自动迁移**；预算使用率、今日任务列表、每日模板生成等涉及 DayPlan 的逻辑，一律以该 DayPlan **已存的 `appDate`** 为准，不隐含承诺 offset 修改后会自动重排历史 DayPlan。若未来要支持历史 DayPlan 重新归属 / 批量迁移 / 改名，必须另开专门的数据迁移设计，不在 Phase 1 承诺（见 §2.5 规则 6、§11）。

**字段一致性约束**

以下跨字段一致性规则必须由数据层强制保证，任何写入操作不得违反：

1. 同一 `appDate` 下，`deletedAt = null` 的 DayPlan 记录不得超过一条（业务唯一键约束）。`localDate` 仅为创建时自然日辅助字段，不作为唯一键。
2. `taskIds` 数组内不允许有重复的 Task ID。
3. `estimate.freeMin` 写入时必须满足：`freeMin = round( workWindowMin - Σ(fixedDeductions[i].hours × 60) - Σ(lifeDeductions[i].hours × 60) )`；每个扣除项的分钟数（`hours × 60`）先各自**不取整**参与求和，仅对**最终结果**四舍五入到整数分钟（避免逐项取整的累积舍入误差）；四舍五入后结果 < 0 时存 0。
4. `budgetPomodoros ≥ 0`；当今日任务预估总和超过 `budgetPomodoros` 时，数据层记录超载但不拒绝写入。

实现端在写入或更新 DayPlan 时，必须验证以上规则，违反第 1、2、3 条的写入操作应被拒绝。

**派生字段计算规则**

**freeMin**（完全派生，可由其他字段计算）：

```
freeMin = round(
            workWindowMin
            - Σ( fixedDeductions[i].hours × 60 )
            - Σ( lifeDeductions[i].hours × 60 )
          )
```

单位：分钟。取整规则：每个扣除项的分钟数（`hours × 60`，`hours` 允许小数，如 0.333 小时 = 19.98 分钟）**先各自不取整**参与求和，**只对最终结果**四舍五入到整数分钟——**不是**对每个扣除项单独取整，以避免多项累积舍入误差。若四舍五入后结果 < 0，存储为 0（扣除时间超出工作窗口属异常情况，前端应给出提示）。

**conservativePomodoros 和 optimisticPomodoros**（基于 settingsSnapshot 动态计算）：

**基础参数**（取自本条 DayPlan 自身的 `settingsSnapshot`，不实时读取当前 Settings）：

```js
focusMin       = settingsSnapshot.focusMinutes
shortBreakMin  = settingsSnapshot.shortBreakMinutes
longBreakMin   = settingsSnapshot.longBreakMinutes
longBreakEvery = settingsSnapshot.longBreakEvery
```

**派生耗时**：

```js
singlePomodoroMin = focusMin + shortBreakMin

pomodoroGroupMin =
  longBreakEvery * focusMin
  + (longBreakEvery - 1) * shortBreakMin
  + longBreakMin
```

- `singlePomodoroMin`：一个零头番茄的预算耗时（一次 focus + 一次 shortBreak）。
- `pomodoroGroupMin`：一个完整番茄组的预算耗时（`longBreakEvery` 次 focus，加中间 `longBreakEvery − 1` 次 shortBreak，再加一次 longBreak）。
- 默认设置下（focus=25、shortBreak=5、longBreak=15、longBreakEvery=4）：`singlePomodoroMin = 30`，`pomodoroGroupMin = 4×25 + 3×5 + 15 = 130` 分钟。

**optimisticPomodoros**（乐观算法，按单个番茄计）：

```js
optimisticPomodoros = floor(freeMin / singlePomodoroMin)
```

语义：假设生活事项都能塞进长休，直接用自由时长除以单个番茄耗时，向下取整。`longBreakMinutes` 不直接影响此算法。

**conservativePomodoros**（保守算法，整组 + 零头折算，零头番茄同样含短休）：

```js
完整番茄组数 = floor(freeMin / pomodoroGroupMin)
完整组番茄数 = 完整番茄组数 × longBreakEvery
剩余零头时间 = freeMin − (完整番茄组数 × pomodoroGroupMin)
零头番茄数   = floor(剩余零头时间 / singlePomodoroMin)

conservativePomodoros = 完整组番茄数 + 零头番茄数
```

验证示例（默认设置，freeMin = 360 即 6 小时）：
- singlePomodoroMin = 30，pomodoroGroupMin = 130
- 完整组 = floor(360 / 130) = 2，完整组番茄 = 2 × 4 = 8
- 零头时间 = 360 − 2×130 = 100 分钟
- 零头番茄 = floor(100 / 30) = 3
- conservativePomodoros = 8 + 3 = **11**
- optimisticPomodoros = floor(360 / 30) = **12**

> 历史注：v4 早期草稿曾将番茄组耗时写为固定常量 2.5 小时（150 分钟），与默认设置实算值 130 分钟不符。本次修订以公式为准，固定常量写法已废止。

**关键规则**：DayPlan 创建时，应先读取当前有效 Settings，写入 `settingsSnapshot`。之后该 DayPlan 的 `conservativePomodoros` / `optimisticPomodoros` 均使用本条 DayPlan 自己的 `settingsSnapshot` 计算，而不实时读取当前 Settings。用户日后修改 Settings，不会反向改变历史 DayPlan 的预算解释。

两字段取值约束保持"整数，≥ 0"不变。Phase 1 由前端直接计算并存储结果到 `estimate.conservativePomodoros` / `estimate.optimisticPomodoros`，数据层不强制验证公式正确性（与 `freeMin` 一致）。

---

### 3.3 Session（专注与休息会话）

Session 表示一次用户行为执行单元，可以是一段专注计时（type 为 `focus` 或 `extraFocus`），或一次休息（type 为 `shortBreak`、`longBreak` 或 `extraRest`）。5 种 type 共用同一套字段；对某 type 不适用的字段，存储为 null，而非省略该字段。

**完整字段定义**

| 字段名 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `id` | `string` (UUID v7) | 否 | 写入时生成 | 实体唯一标识；取值约束：UUID v7 格式 |
| `type` | `string`（枚举） | 否 | 无 | 会话类型，枚举值见下方；取值约束：取值为 `'focus'` / `'shortBreak'` / `'longBreak'` / `'extraFocus'` / `'extraRest'` 之一 |
| `status` | `string`（枚举） | 否 | `'active'` | 会话状态；focus 合法值为 `'active'` / `'completed'` / `'discarded'`；extraFocus 固定为 `'completed'`；shortBreak / longBreak 合法值为 `'active'` / `'completed'` / `'skipped'`；extraRest 固定为 `'completed'`；取值约束：必须取自该 type 对应的合法集合，且不得将 extraFocus / extraRest 写入其他状态。 |
| `taskId` | `string \| null` | 是 | 见含义说明 | 关联任务 ID；focus / extraFocus 必填（不允许 null，产品不支持无任务自由专注）；shortBreak / longBreak / extraRest 固定 null；取值约束：null 或合法的 Task UUID v7 |
| `startedAt` | `string` | 否 | 写入时生成 | session 开始时刻（session 创建即开始计时）；5 种 type 均必填；取值约束：ISO 8601 带时区格式，不允许 null |
| `endedAt` | `string \| null` | 是 | `null` | session 终结时刻；status=`'active'` 时为 null；status ∈ {`'completed'`, `'discarded'`, `'skipped'`} 时必须非 null；extraFocus / extraRest（status 恒为 `'completed'`）的 endedAt 始终非 null；取值约束：ISO 8601 带时区格式或 null |
| `plannedDuration` | `number \| null` | 是 | `null` | 计划时长，单位秒；focus / shortBreak / longBreak 必填，取写入时 Settings 对应时长配置（如 focus 默认 1500 秒 = 25 分钟）；extraFocus / extraRest 无计划时长概念，固定为 null；取值约束：type ∈ {`'focus'`, `'shortBreak'`, `'longBreak'`} 时必须为正整数（> 0）；type ∈ {`'extraFocus'`, `'extraRest'`} 时必须为 null |
| `actualDuration` | `number \| null` | 是 | `null` | 实际持续时长，单位秒；status=`'active'` 时为 null；status=`'skipped'` 时固定存 `0`（明确表示 0 秒，区别于 null 的"未知"语义）；status ∈ {`'completed'`, `'discarded'`} 时为实际经过秒数；type=`'extraFocus'` 或 type=`'extraRest'` 时，由于 status 固定为 `'completed'`，actualDuration 必须为正整数（> 0），不得为 null 或 0；取值约束：null、0 或正整数 |
| `pomodoroIndex` | `number \| null` | 是 | `null` | 该 Task 下当前 focus 的发生序号，从 1 起递增；focus 必填；shortBreak / longBreak / extraFocus / extraRest 固定 null；discarded 的 focus 也占用序号，不回收（序号记发生顺序，不等于有效番茄数）；取值约束：正整数（≥ 1）或 null |
| `skipKind` | `string \| null` | 是 | `null` | 休息未完成的原因；仅 shortBreak / longBreak 在 status=`'skipped'` 时适用（此时必须非 null），status=`'completed'` 时必须为 null；extraRest 虽属休息类，但 status 固定为 `'completed'`，因此 skipKind 固定 null；focus / extraFocus 固定 null；枚举值见下方；取值约束：null 或枚举值之一 |
| `originIntervalId` | `string \| null` | 是 | `null` | 产生该 extra session 的 UnresolvedInterval 的 id；extraFocus / extraRest 必填（不允许 null）；同一 UnresolvedInterval 拆多 segment 时多条 extra session 可共享同一 originIntervalId；focus / shortBreak / longBreak 固定 null；取值约束：null 或合法的 UnresolvedInterval UUID v7 |
| `sourceFocusSessionId` | `string \| null` | 是 | `null` | 触发该休息的上一段 focus session 的 id；shortBreak / longBreak 必填；focus / extraFocus / extraRest 固定 null；引用目标必须是一条已存在的标准 focus Session（type=`'focus'` 且 status=`'completed'`），不得引用 extraFocus、shortBreak、longBreak、extraRest，也不得引用 status=`'active'` 或 status=`'discarded'` 的 focus；取值约束：null 或合法的 focus Session UUID v7（且该 Session 满足 type=`'focus'` 且 status=`'completed'`） |
| `suggestedRest` | `string \| null` | 是 | `null` | 系统向用户推荐的休息活动，存 Settings.restSuggestions 某项的 key（不存 label，label 可变而 key 稳定）；shortBreak / longBreak / extraRest 适用，可为 null；focus / extraFocus 固定 null；shortBreak 只能引用 `appliesTo` 包含 `'shortBreak'` 的项，longBreak 只能引用 `appliesTo` 包含 `'longBreak'` 的项；extraRest 暂保持宽松，可为 null；取值约束：null 或 Settings.restSuggestions 中存在的 key |
| `actualRest` | `string \| null` | 是 | `null` | 用户实际选择的休息活动，存 Settings.restSuggestions 某项的 key；shortBreak / longBreak / extraRest 适用，均可为 null（用户未选择时）；focus / extraFocus 固定 null；shortBreak 只能引用 `appliesTo` 包含 `'shortBreak'` 的项，longBreak 只能引用 `appliesTo` 包含 `'longBreak'` 的项；extraRest 暂保持宽松，可为 null；取值约束：null 或 Settings.restSuggestions 中存在的 key |
| `localDate` | `string` | 否 | 由 startedAt 派生 | 该 session 所属的用户本地日期；按 startedAt 在 timezone 对应时区计算，跨天 session 归属 startedAt 所在日；5 种 type 均必填；取值约束：ISO 8601 日期格式 `YYYY-MM-DD` |
| `timezone` | `string` | 否 | 写入时取设备时区 | 写入时设备所在的 IANA 时区名（见 §2.5）；写入后不修改；5 种 type 均必填；取值约束：合法 IANA 时区名，如 `"Asia/Shanghai"` |
| `dayPlanId` | `string \| null` | 是 | `null` | 关联到某天 DayPlan 的 id，辅助字段，主要用于计划偏差分析与关联查询；对标准 focus / shortBreak / longBreak，**如果写入时存在与该 Session 产品日 `appDate` 对应的有效 DayPlan（DayPlan 业务键为 `appDate`，见 §3.2），则 `dayPlanId` 必须写入该 DayPlan 的 id**；只有在不存在对应 DayPlan，或属于 extraFocus / extraRest、历史迁移、数据修复等场景时，才允许 `dayPlanId = null`；按日统计的日归属以 §8 口径为准（用户可见的"今日 / 当日"按 `appDate` 派生，见 §2.5、§8.2），**仍不得依赖 `dayPlanId`**——它只是计划偏差分析和关联查询辅助字段；取值约束：null 或合法的 DayPlan UUID v7 |
| `createdAt` | `string` | 否 | 写入时生成 | 记录首次写入时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `updatedAt` | `string` | 否 | 写入时生成 | 记录最近修改时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `deletedAt` | `string \| null` | 是 | `null` | 软删除时间戳（见 §2.4）；`null` = 未删除；取值约束：ISO 8601 带时区格式或 null |
| `schemaVersion` | `number` | 否 | 写入时取当前版本 | 该条记录写入时的 schema 版本号（见 §2.3）；取值约束：正整数，≥ 1 |
| `deviceId` | `string \| null` | 是 | `null` | （可选预留）写入设备标识（见 §2.3，Phase 5+ 启用）；取值约束：null 或非空字符串 |
| `syncedAt` | `string \| null` | 是 | `null` | （可选预留）最近一次同步成功时间（见 §2.3，Phase 5+ 启用）；取值约束：ISO 8601 带时区格式或 null |

**type 枚举值说明**

| 值 | 含义 |
|---|---|
| `'focus'` | 标准专注计时，关联一个 Task，正常完成计入有效番茄统计 |
| `'shortBreak'` | 短休，在完成一个 focus 后触发；时长由 Settings.shortBreakMinutes 决定 |
| `'longBreak'` | 长休，在完成一组番茄（默认 4 个）后触发；时长由 Settings.longBreakMinutes 决定 |
| `'extraFocus'` | 额外专注，由用户对 UnresolvedInterval 分类归入后生成；不计入有效番茄统计，只计额外专注时长 |
| `'extraRest'` | 额外休息，由用户对 UnresolvedInterval 分类归入后生成 |

**status 枚举值说明**

focus / extraFocus 适用值：

| 值 | 含义 |
|---|---|
| `'active'` | 专注计时进行中 |
| `'completed'` | 正常响铃完成，计入有效专注 |
| `'discarded'` | 中途停止或主动作废，不计入有效番茄 |

> extraFocus 的 status 固定为 `'completed'`，写入时直接设定，不经过 `'active'` 或 `'discarded'` 状态。

shortBreak / longBreak / extraRest 适用值：

| 值 | 含义 |
|---|---|
| `'active'` | 休息进行中 |
| `'completed'` | 正常完成休息 |
| `'skipped'` | 未完成（主动跳过 / 未响应 / 页面关闭 / 错过），具体原因见 skipKind |

> extraRest 的 status 固定为 `'completed'`，写入时直接设定，不经过 `'active'` 或 `'skipped'` 状态。

**skipKind 枚举值说明**（仅 shortBreak / longBreak 适用）

| 值 | 含义 |
|---|---|
| `'explicitSkip'` | 用户明确点击跳过休息 |
| `'noResponse'` | 用户未回应 / 超时 / 没回来选择 |
| `'appClosed'` | 页面关闭、App 退出或崩溃导致休息流程未完成 |
| `'missed'` | 其他错过或未完成、无法归入前三类的情形 |

**各 type 字段适用性速查表**

| 字段名 | focus | shortBreak | longBreak | extraFocus | extraRest |
|---|---|---|---|---|---|
| `id` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `type` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `status` | 必填 | 必填 | 必填 | 必填（固定 `'completed'`） | 必填（固定 `'completed'`） |
| `taskId` | 必填 | 不适用（固定 null） | 不适用（固定 null） | 必填 | 不适用（固定 null） |
| `startedAt` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `endedAt` | 可选 | 可选 | 可选 | 必填 | 必填 |
| `plannedDuration` | 必填 | 必填 | 必填 | 不适用（固定 null） | 不适用（固定 null） |
| `actualDuration` | 可选 | 可选 | 可选 | 必填（正整数 > 0） | 必填（正整数 > 0） |
| `pomodoroIndex` | 必填 | 不适用（固定 null） | 不适用（固定 null） | 不适用（固定 null） | 不适用（固定 null） |
| `skipKind` | 不适用（固定 null） | 可选 | 可选 | 不适用（固定 null） | 不适用（固定 null） |
| `originIntervalId` | 不适用（固定 null） | 不适用（固定 null） | 不适用（固定 null） | 必填 | 必填 |
| `sourceFocusSessionId` | 不适用（固定 null） | 必填 | 必填 | 不适用（固定 null） | 不适用（固定 null） |
| `suggestedRest` | 不适用（固定 null） | 可选 | 可选 | 不适用（固定 null） | 可选 |
| `actualRest` | 不适用（固定 null） | 可选 | 可选 | 不适用（固定 null） | 可选 |
| `localDate` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `timezone` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `dayPlanId` | 存在对应 DayPlan 时必填，否则 null（见字段说明） | 存在对应 DayPlan 时必填，否则 null | 存在对应 DayPlan 时必填，否则 null | 可选 | 可选 |
| `createdAt` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `updatedAt` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `deletedAt` | 可选 | 可选 | 可选 | 可选 | 可选 |
| `schemaVersion` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `deviceId` | 可选 | 可选 | 可选 | 可选 | 可选 |
| `syncedAt` | 可选 | 可选 | 可选 | 可选 | 可选 |

**关键规则**

1. 5 种 type 共用同一套字段；不适用字段存 null，不省略。数据层写入时，所有 type 的字段集完全相同。
2. status 枚举按 type 分流：focus / extraFocus 只可取 `'active'` / `'completed'` / `'discarded'`；shortBreak / longBreak / extraRest 只可取 `'active'` / `'completed'` / `'skipped'`；两组状态集不得混用。
3. extraFocus 和 extraRest 的 status 恒为 `'completed'`，写入时直接设定，不经过 `'active'` 状态。
4. 产品不支持无任务的自由专注；focus 的 taskId 不允许为 null。extraFocus 的 taskId 继承归类时确认的 Task（已有 Task 或快捷创建的新 Task）。
5. pomodoroIndex 记该 Task 下 focus 的发生序号，从 1 起递增；discarded 的 focus 占用序号不回收。pomodoroIndex 不等于有效番茄数（有效番茄统计规则见 §8.3）。
6. sourceFocusSessionId 用于关联 shortBreak / longBreak 和其上一段 focus，供统计"完整番茄循环"使用；普通 focus 之间的先后顺序不通过此字段表达，通过 startedAt 计算。
7. 打扰次数不存在 Session 字段上；通过 interrupt.internal / interrupt.external 事件（含 sessionId）写入 Event，次数从事件派生（见 §7.8 interrupt 事件）。
8. `dayPlanId` 虽允许为 null，但对标准 focus / shortBreak / longBreak，写入时若存在与该 Session 产品日 `appDate` 对应的有效 DayPlan，则**必须**写入该 DayPlan.id；仅在不存在对应 DayPlan、extraFocus / extraRest、历史迁移、数据修复等场景下才为 null。详见字段说明。
9. dayPlanId 不作为按日统计依据；今日番茄数、今日专注时长、今日休息统计等按 §8 口径归属（用户可见的"今日 / 当日"按产品日 `appDate` 派生，见 §2.5、§8.2；`appDayStartOffsetMinutes = 0` 时与 `localDate` 一致）。dayPlanId 仅用于分析计划偏差，例如"计划内执行情况"。
10. `actualDuration` 是 Session 实际时长的**唯一事实源**。所有依赖"实际专注 / 休息时长"的统计（§8）一律以 `actualDuration` 为准，**不得**用 `endedAt − startedAt` 重算。`endedAt` 仅为终结时刻的事实记录；因倒计时漂移、浏览器后台节流等原因，`(endedAt − startedAt)` 与 `actualDuration` 可存在差异，数据层不要求二者严格相等，也不据此校验或拒绝写入。

**字段一致性约束**

以下跨字段一致性规则必须由数据层强制保证，任何写入操作不得违反：

1. status=`'active'` 时，`endedAt` 必须为 null，`actualDuration` 必须为 null。
2. status ∈ {`'completed'`, `'discarded'`, `'skipped'`} 时，`endedAt` 必须非 null，`actualDuration` 必须非 null。
3. status=`'skipped'` 时，`actualDuration` 必须为 `0`，`skipKind` 必须非 null。
4. status ∈ {`'active'`, `'completed'`, `'discarded'`} 时，`skipKind` 必须为 null。
5. type=`'focus'` 时：`taskId` 必须非 null；`pomodoroIndex` 必须非 null（≥ 1）；`sourceFocusSessionId` / `originIntervalId` / `skipKind` / `suggestedRest` / `actualRest` 必须为 null。
6. type=`'extraFocus'` 时：`taskId` 必须非 null；`status` 必须为 `'completed'`；`originIntervalId` 必须非 null；`pomodoroIndex` / `sourceFocusSessionId` / `skipKind` / `suggestedRest` / `actualRest` 必须为 null。
7. type ∈ {`'shortBreak'`, `'longBreak'`} 时：`taskId` / `pomodoroIndex` / `originIntervalId` 必须为 null；`sourceFocusSessionId` 必须非 null，且其引用的 Session 必须满足 type=`'focus'` 且 status=`'completed'`。
8. type=`'extraRest'` 时：`taskId` / `pomodoroIndex` / `sourceFocusSessionId` / `skipKind` 必须为 null；`status` 必须为 `'completed'`；`originIntervalId` 必须非 null。
9. status=`'discarded'` 只允许出现在 type=`'focus'` 中（extraFocus 恒为 `'completed'`）。
10. status=`'skipped'` 只允许出现在 type ∈ {`'shortBreak'`, `'longBreak'`} 中（extraRest 恒为 `'completed'`）。
11. `localDate` 必须与 `startedAt` 及 `timezone` 保持一致（localDate = 按 timezone 从 startedAt 派生的本地日期）。
12. type ∈ {`'extraFocus'`, `'extraRest'`} 时，`actualDuration` 必须为正整数（> 0），不得为 null 或 0。
13. type ∈ {`'focus'`, `'shortBreak'`, `'longBreak'`} 时，`plannedDuration` 必须为正整数（> 0）；type ∈ {`'extraFocus'`, `'extraRest'`} 时，`plannedDuration` 必须为 null。
14. **不**校验 `actualDuration` 与 `(endedAt − startedAt)` 的一致性；validator 仅按字段表规则校验 `actualDuration` 自身的非空与范围（active=null、skipped=0、completed / discarded 为实际经过秒数、extraFocus / extraRest 为正整数 > 0）。`actualDuration` 为实际时长唯一事实源，见关键规则第 10 条。

---

### 3.4 Event（事件记录）

Event 是产品行为时间线的基础单元，记录用户和系统在产品中发生的每一个可观测动作。Event 是 **append-only 不可变历史记录**：写入后不允许修改任何字段，不允许软删除，不允许物理删除。如需"撤销"一条已写入的 Event，正确做法是追加一条修正性 Event（见关键规则第 2 条）。

Event 的完整事件类型分类表见 §7；命名规范见 §6；统计口径（哪些 Event 入统计、哪些只审计）见 §8。

**完整字段定义**

| 字段名 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `id` | `string`（UUID v7） | 否 | 写入时生成 | 实体唯一标识；取值约束：UUID v7 格式 |
| `type` | `string`（枚举） | 否 | 无 | 事件类型，格式为 `domain.action`（如 `task.completed`）；完整枚举值见 §7；取值约束：必须取自 §7 中已定义的事件类型之一，不允许写入未定义的自定义类型 |
| `occurredAt` | `string` | 否 | 写入时生成 | 事件业务发生时刻（用户行为发生的时间）；正常情况下与 `createdAt` 相近；异常回补场景（如离线补录）下可早于 `createdAt`；统计以 `occurredAt` 为准；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `localDate` | `string` | 否 | 由 `occurredAt` 和 `timezone` 派生 | 事件所属的用户本地日期；按 `occurredAt` 在 `timezone` 对应时区计算（见 §2.5）；取值约束：ISO 8601 日期格式 `YYYY-MM-DD` |
| `timezone` | `string` | 否 | 写入时取设备时区 | 写入时设备所在的 IANA 时区名（见 §2.5）；写入后不修改；取值约束：合法 IANA 时区名，如 `"Asia/Shanghai"` |
| `payload` | `object` | 否 | `{}` | 事件专属数据；结构随 `type` 不同而不同，完整定义见 §7 各事件类型描述；如 §7 对该 `type` 定义了必填 payload 字段，则必须按 §7 写入，不允许省略；只有该事件类型确实没有专属数据时，payload 才允许为空对象 `{}`；取值约束：必须为非 null 对象 |
| `taskId` | `string \| null` | 是 | `null` | 关联 Task 的 id；适用于与某个 Task 相关的事件；不适用时存 null；取值约束：null 或合法的 Task UUID v7 |
| `sessionId` | `string \| null` | 是 | `null` | 关联 Session 的 id；适用于与某个 Session 相关的事件；不适用时存 null；取值约束：null 或合法的 Session UUID v7 |
| `dayPlanId` | `string \| null` | 是 | `null` | 关联 DayPlan 的 id；适用于与某天计划相关的事件；不适用时存 null；取值约束：null 或合法的 DayPlan UUID v7 |
| `energyRecordId` | `string \| null` | 是 | `null` | 关联 EnergyRecord 的 id；适用于与某条能量记录相关的事件；不适用时存 null；取值约束：null 或合法的 EnergyRecord UUID v7 |
| `unresolvedIntervalId` | `string \| null` | 是 | `null` | 关联 UnresolvedInterval 的 id；适用于与某个待归类时段相关的事件；不适用时存 null；取值约束：null 或合法的 UnresolvedInterval UUID v7 |
| `settingsId` | `string \| null` | 是 | `null` | 关联 Settings 的 id；适用于设置变更等事件；不适用时存 null；取值约束：null 或合法的 Settings UUID v7 |
| `correlationId` | `string \| null` | 是 | `null` | 同一次用户操作产生多条 Event 时共享的关联 id（如"每日模板生成任务并加入 DayPlan"同时产生 `task.created` 和 `dayPlan.taskAdded`，两条 Event 共享同一 `correlationId`）；单事件操作可为 null；取值约束：null 或 UUID v7 格式 |
| `createdAt` | `string` | 否 | 写入时生成 | 记录写入存储的时刻；正常情况下与 `occurredAt` 相近；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `schemaVersion` | `number` | 否 | 写入时取当前 schema 版本 | 该条记录写入时的 schema 版本号（见 §2.3）；取值约束：正整数，≥ 1 |

**关键规则**

1. Event 是 append-only 不可变历史记录。写入后不允许修改任何字段，不允许软删除（无 `deletedAt` 字段），不允许物理删除。
2. 如需"撤销"已写入的 Event，正确做法是**追加一条修正性 Event**（如 `task.completed` 被错误写入后，追加 `task.uncompleted` 修正），而非删除或修改原事件。任何为 Event 实现修改或删除逻辑的代码属违反本规范，应在 code review 阶段拒绝。
3. `payload` 统一存放事件专属数据（如旧值、新值、原因等）；顶层关联字段（`taskId` / `sessionId` 等）只存实体 id，不在顶层存名称、状态等派生属性。
4. 所有顶层关联字段（`taskId` / `sessionId` / `dayPlanId` / `energyRecordId` / `unresolvedIntervalId` / `settingsId`）不适用时一律存 null，字段本身不省略。这样可稳定查询"某个实体相关的所有事件"，也便于未来在 SQLite 中按 id 建立索引。
5. 一个 Event 可以同时填写多个顶层关联字段，不要求只能有一个非 null。例：`dayPlan.taskAdded` 可同时填写 `dayPlanId` 和 `taskId`；与某段专注相关的任务事件，可同时填写 `sessionId` 和 `taskId`；同一次操作引发多条 Event 时，这些 Event 可共享同一个 `correlationId`。
6. `occurredAt` 是事件的业务发生时刻；`createdAt` 是记录写入存储的时刻。统计一律以 `occurredAt` 为准，`createdAt` 仅用于审计和同步参考。
7. Event 不挂 `updatedAt`、`deletedAt`、`deviceId`、`syncedAt`。Phase 5 如需同步状态，在同步层另行处理，不修改 Event schema。
8. **原子写入**：当一次业务操作同时产生"实体变更（创建 / 更新 / 软删除可同步实体）"与"对应 Event 写入"时，二者必须在同一存储事务内原子提交；任一步失败则整体回滚，不允许出现"实体已变更但 Event 缺失"或"Event 已写入但其引用的实体变更未生效"的中间状态。一次操作产生多条 Event（共享 `correlationId`）时，这些 Event 与相关实体变更同属一个原子事务。该约束在 Web（IndexedDB transaction）与未来 SQLite 端均适用；具体事务 API 由各端实现，但原子性语义不可降级。

**字段一致性约束**

以下跨字段一致性规则必须由数据层强制保证，任何写入操作不得违反：

1. `payload` 不允许为 null。§7 中每个事件列出的 payload 字段集即该事件的**完整 schema**：如 §7 对该 `type` 定义了必填 payload 字段，则必须按 §7 写入，不允许省略；实现端**不得**向 payload 添加 §7 未定义的字段（确需新增字段必须先修订 v4 文档，见 §7 开头"payload 即完整 schema"）；只有该事件类型确实没有专属数据时，`payload` 才允许为空对象 `{}`。
2. `localDate` 必须与 `occurredAt` 及 `timezone` 保持一致（localDate = 按 timezone 从 occurredAt 派生的本地日期）。
3. 顶层关联字段（`taskId` / `sessionId` / `dayPlanId` / `energyRecordId` / `unresolvedIntervalId` / `settingsId`）如写入非 null 值，写入完成后必须能通过该 id 找到对应实体。对 `task.created` 等新建类事件，允许在同一次写入流程中先生成实体 id、再写入 Event，不要求实体在 Event 写入前已长期存在；写入完成后仍找不到对应实体的，视为悬空引用，应被拒绝。
4. `type` 必须取自 §7 中已定义的事件类型，不允许写入未定义类型。

实现端在写入 Event 时，必须验证以上规则，违反任意一条的写入操作应被拒绝。

---

### 3.5 EnergyRecord（能量记录）

EnergyRecord 表示用户在某个时刻主动提交的能量与状态记录。与 Session 不同，EnergyRecord 不是计时结束后自动写入，而是在用户提交记录时才生成——若用户未提交，则不产生记录。EnergyRecord 是分析用户精力变化趋势、评估休息恢复效果的核心数据来源。

**完整字段定义**

| 字段名 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `id` | `string`（UUID v7） | 否 | 写入时生成 | 实体唯一标识；取值约束：UUID v7 格式 |
| `energyLevel` | `number` | 否 | 无 | 用户当次记录的能量状态值；取值约束：整数，1 ≤ energyLevel ≤ 10 |
| `mood` | `number \| null` | 是 | `null` | 用户当次记录的情绪状态；Phase 1 暂缓采集，默认写 null；未来启用时使用 1–10 情绪量表；取值约束：null 或整数，1 ≤ mood ≤ 10 |
| `source` | `string`（枚举） | 否 | 无 | 本条记录的触发来源，枚举值见下方；取值约束：必须取自枚举值之一 |
| `sessionId` | `string \| null` | 是 | `null` | 关联 Session 的 id；当 source 为 `'afterFocus'` / `'afterShortBreak'` / `'afterLongBreak'` / `'afterExtraFocus'` / `'afterExtraRest'` 时，指向对应的 Session；当 source=`'manual'` 时固定为 null；取值约束：null 或合法的 Session UUID v7 |
| `note` | `string \| null` | 是 | `null` | 用户对本次能量与状态的文字备注；Phase 1 UI 可暂不突出，但数据层支持写入；取值约束：无特殊约束，可为 null |
| `occurredAt` | `string` | 否 | 写入时生成 | 用户提交本条记录的时刻；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `localDate` | `string` | 否 | 由 `occurredAt` 和 `timezone` 派生 | 记录所属的用户本地日期；按 `occurredAt` 在 `timezone` 对应时区计算（见 §2.5）；取值约束：ISO 8601 日期格式 `YYYY-MM-DD` |
| `timezone` | `string` | 否 | 写入时取设备时区 | 写入时设备所在的 IANA 时区名（见 §2.5）；写入后不修改；取值约束：合法 IANA 时区名，如 `"Asia/Shanghai"` |
| `createdAt` | `string` | 否 | 写入时生成 | 记录首次写入时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `updatedAt` | `string` | 否 | 写入时生成 | 记录最近修改时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `deletedAt` | `string \| null` | 是 | `null` | 软删除时间戳（见 §2.4）；`null` = 未删除；取值约束：ISO 8601 带时区格式或 null |
| `schemaVersion` | `number` | 否 | 写入时取当前版本 | 该条记录写入时的 schema 版本号（见 §2.3）；取值约束：正整数，≥ 1 |
| `deviceId` | `string \| null` | 是 | `null` | （可选预留）写入设备标识（见 §2.3，Phase 5+ 启用）；取值约束：null 或非空字符串 |
| `syncedAt` | `string \| null` | 是 | `null` | （可选预留）最近一次同步成功时间（见 §2.3，Phase 5+ 启用）；取值约束：ISO 8601 带时区格式或 null |

**source 枚举值说明**

| 值 | 含义 |
|---|---|
| `'dayStart'` | 每日开始时的能量打卡；通常发生在用户当天第一次进入工作流前；不依附于任何 Session |
| `'beforeFocus'` | 标准 focus 开始前的能量记录；非每个番茄前强制触发，仅在当天首次开始 focus 前、或距上一条可用能量记录已超过一个长休时长后重新开始 focus 前触发（具体提示策略可在 UI / Settings 规则中细化）；`onReturn` 后立即开始 focus 时不重复触发本 source；不依附于任何 Session |
| `'afterFocus'` | 专注结束后用户提交的状态记录 |
| `'afterShortBreak'` | 短休结束后用户提交的恢复记录 |
| `'afterLongBreak'` | 长休结束后用户提交的恢复记录 |
| `'afterExtraFocus'` | extraFocus 归类或结束后用户提交的状态记录 |
| `'afterExtraRest'` | extraRest 归类或结束后用户提交的恢复记录 |
| `'onReturn'` | 用户离开 / 中断 / 恢复后返回工具时记录的当前状态；核心语义是"回来时的状态"，不等同于"开始专注前"；App 重新打开、页面恢复、用户长时间无响应后回来均适用；`onReturn` 后立即开始 focus 时不再另行触发 `beforeFocus`；不依附于任何 Session |
| `'manual'` | 用户手动触发的独立记录，与任何 Session 无关 |

**关键规则**

1. EnergyRecord 在用户主动提交时写入；若用户未提交，不自动生成记录。
2. `recoveryDelta` 不是 EnergyRecord 的存储字段，不允许写入 EnergyRecord 本体。恢复量在统计和展示时动态计算（见下方"派生指标说明"）。
3. `mood` 字段在 Phase 1 默认写 null，不要求前端采集；schema 层面已预留，待未来启用时直接写入，无需修改 schema。
4. `localDate` 按 `occurredAt` 和 `timezone` 派生，是事实自然日，跨时区场景下反映用户提交记录时的本地日历日期（见 §2.5）；用户可见的按日 / 趋势统计按产品日 `appDate` 归属（由 `occurredAt` + `timezone` + `appDayStartOffsetMinutes` 派生，见 §2.5、§8.2、§8.8；`offset = 0` 时与 `localDate` 一致）。
5. EnergyRecord 适用软删除（`deletedAt`），不允许物理删除（见 §2.4）。

**字段一致性约束**

以下跨字段一致性规则必须由数据层强制保证，任何写入操作不得违反：

1. `energyLevel` 必须为整数，且满足 1 ≤ energyLevel ≤ 10。
2. `mood` 如非 null，必须为整数，且满足 1 ≤ mood ≤ 10。
3. `localDate` 必须与 `occurredAt` 及 `timezone` 保持一致（localDate = 按 timezone 从 occurredAt 派生的本地日期）。
4. `source` 必须取自枚举值之一，不允许写入未定义值。
5. `source='manual'` 时，`sessionId` 必须为 null。
5a. `source ∈ {'dayStart', 'beforeFocus', 'onReturn'}` 时，`sessionId` 必须为 null（这三类记录发生在 Session 之外；`beforeFocus` 在 focus 创建之前触发，不引用尚未存在的 Session）。
6. `source ∈ {'afterFocus', 'afterShortBreak', 'afterLongBreak', 'afterExtraFocus', 'afterExtraRest'}` 时，`sessionId` 必须非 null，且其引用的 Session 必须满足对应 type：`afterFocus` → type=`'focus'`；`afterShortBreak` → type=`'shortBreak'`；`afterLongBreak` → type=`'longBreak'`；`afterExtraFocus` → type=`'extraFocus'`；`afterExtraRest` → type=`'extraRest'`。

实现端在写入或更新 EnergyRecord 时，必须验证以上规则，违反任意一条的写入操作应被拒绝。

**派生指标说明：recoveryDelta**

`recoveryDelta` 是反映某次休息对能量恢复效果的派生指标，不存入 EnergyRecord 本体，仅在统计或展示时动态计算。

基础计算方式：

```
recoveryDelta = 休息后 EnergyRecord.energyLevel
              − 休息前最近一次相关 EnergyRecord.energyLevel
```

示例：专注结束后记录 energyLevel=2（source=`'afterFocus'`），短休结束后记录 energyLevel=4（source=`'afterShortBreak'`），则本次短休的 recoveryDelta = +2。

计算时应优先通过 `EnergyRecord.sessionId` 与 Session 的链路判断前后关系，而非单纯依赖时间顺序推断。没有足够前后关联记录时，不计算 recoveryDelta。完整统计口径（计算范围、关联规则、正负含义等）在 §8 统计口径中展开。

---

### 3.6 UnresolvedInterval（未归类时段）

UnresolvedInterval 表示系统发现的一段"无法可靠判断用户在做什么"的时间——例如 App 重新打开时发现计时器未正常闭合、系统从睡眠恢复后时间线断裂、或产品流程等待用户回应但长时间无响应。用户需要在事后主动归类这段时间（归为额外专注、额外休息，或选择忽略），系统才会生成对应的 extraFocus / extraRest Session。

UnresolvedInterval 本体不存储归类结果数组。归类产生的 Session 通过 `Session.originIntervalId` 指向原 UnresolvedInterval；查询拆分结果时，反向查询 `Session.originIntervalId = UnresolvedInterval.id`。

**完整字段定义**

| 字段名 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `id` | `string`（UUID v7） | 否 | 写入时生成 | 实体唯一标识；取值约束：UUID v7 格式 |
| `source` | `string`（枚举） | 否 | 无 | 该时段的产生来源，枚举值见下方；取值约束：必须取自枚举值之一 |
| `startedAt` | `string` | 否 | 无 | 未归类时段的开始时刻；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `endedAt` | `string` | 否 | 无 | 未归类时段的结束时刻；必须晚于 `startedAt`；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `status` | `string`（枚举） | 否 | `'pending'` | 归类状态，枚举值见下方；取值约束：必须取自枚举值之一 |
| `localDate` | `string` | 否 | 由 `startedAt` 和 `timezone` 派生 | 该时段所属的用户本地日期；按 `startedAt` 在 `timezone` 对应时区计算（见 §2.5）；归类操作时间不改变此字段；取值约束：ISO 8601 日期格式 `YYYY-MM-DD` |
| `timezone` | `string` | 否 | 写入时取设备时区 | interval 产生时设备所在的 IANA 时区名（见 §2.5）；写入后不修改；取值约束：合法 IANA 时区名，如 `"Asia/Shanghai"` |
| `classifiedAt` | `string \| null` | 是 | `null` | 用户完成归类的时刻；status=`'classified'` 时必须非 null；其他 status 时为 null；不参与 UnresolvedInterval 的按日归属（localDate 仍由 startedAt 决定）；取值约束：ISO 8601 带时区格式或 null |
| `ignoredAt` | `string \| null` | 是 | `null` | 用户选择忽略的时刻；status=`'ignored'` 时必须非 null；其他 status 时为 null；取值约束：ISO 8601 带时区格式或 null |
| `ignoreReason` | `string \| null` | 是 | `null` | 用户选择忽略时附加的原因说明（可选）；取值约束：无特殊约束，可为 null |
| `createdAt` | `string` | 否 | 写入时生成 | 记录首次写入时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `updatedAt` | `string` | 否 | 写入时生成 | 记录最近修改时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `deletedAt` | `string \| null` | 是 | `null` | 软删除时间戳（见 §2.4）；`null` = 未删除；正常流程中 ignored 的记录不写 deletedAt，作为审计记录保留；取值约束：ISO 8601 带时区格式或 null |
| `schemaVersion` | `number` | 否 | 写入时取当前版本 | 该条记录写入时的 schema 版本号（见 §2.3）；取值约束：正整数，≥ 1 |
| `deviceId` | `string \| null` | 是 | `null` | （可选预留）写入设备标识（见 §2.3，Phase 5+ 启用）；取值约束：null 或非空字符串 |
| `syncedAt` | `string \| null` | 是 | `null` | （可选预留）最近一次同步成功时间（见 §2.3，Phase 5+ 启用）；取值约束：ISO 8601 带时区格式或 null |

**source 枚举值说明**

| 值 | 含义 |
|---|---|
| `'appReopened'` | App / 网页关闭后重新打开，发现存在未正常结束或未归类的时间段 |
| `'systemRecovered'` | 浏览器休眠、系统睡眠或后台挂起后恢复，导致计时器连续性不可靠 |
| `'timerStateLost'` | 计时器状态丢失或 App 崩溃后恢复，无法确定时间段的归属 |
| `'userNoResponse'` | 产品流程需要用户回应（如选择休息活动、确认番茄收尾），但用户长时间未回应，导致系统无法可靠判断这段时间的归属；语义是"产品层面等待超时"，不等于系统判断用户未专注；实现端不得仅凭无键鼠/触控操作判断用户离开（用户可能正在读书、闭眼休息、伸展、看纸质资料或继续专注） |

**status 枚举值说明**

| 值 | 含义 |
|---|---|
| `'pending'` | 待用户归类；尚未处理 |
| `'classified'` | 已归类；已生成一条或多条 extraFocus / extraRest Session（通过 `Session.originIntervalId` 关联） |
| `'ignored'` | 用户选择忽略；不生成 Session，不进入专注/休息统计；本体保留作为审计记录 |

**关键规则**

1. UnresolvedInterval 本体不存储归类结果数组。归类产生的 Session 通过 `Session.originIntervalId` 指向本记录；查询拆分结果时，反向查询 `Session.originIntervalId = UnresolvedInterval.id`。
2. 一个 UnresolvedInterval 可拆分为多条 extraFocus / extraRest Session（多段归类），这些 Session 共享同一 `originIntervalId`（见 §3.3）。
3. extraFocus 归类时，用户可选择关联已有 Task，或快捷创建新 Task。最终生成的 type=`'extraFocus'` Session，其 `taskId` 必须指向用户最终确认的 Task。若为快捷创建的新 Task，该 Task 的创建来源后续在 §7 事件表中通过 `task.created` 的 source=`'unresolvedIntervalClassification'` 表达。
4. extraRest 归类时，用户可选择已有休息项，或快捷创建新休息项。最终生成的 type=`'extraRest'` Session，其 `actualRest` 应指向用户最终确认的休息项 key。若为快捷创建的新休息项，该 key 的生成规则以 §3.7 Settings.restSuggestions 为准，相关事件在 §7 事件表展开。
5. status=`'ignored'` 的记录不写 `deletedAt`，不软删除，不物理删除，作为完整审计记录永久保留。
6. `duration`（持续时长）不作为存储字段，由 `endedAt - startedAt` 在统计或展示时派生（见下方"派生指标说明"）。
7. `localDate` 按 `startedAt` 计算，表示"这段未归类时间本身发生在哪天"，而非"用户在哪天处理它"。`classifiedAt` 不影响 `localDate`。
8. `source='userNoResponse'` 表示产品流程等待用户回应、但用户长时间未回应而形成的时间不确定段，与系统崩溃 / 强制关闭属不同来源，但均等价于"系统无法可靠判断这段时间用户在做什么"。实现端不得仅凭"没有鼠标 / 键盘 / 触控操作"判断用户离开（用户可能正在读书、闭眼休息、伸展或继续专注），只能在产品流程层面（如休息选择界面长时间未响应、番茄结束提示长时间未确认）才可触发 `userNoResponse` 来源的 UnresolvedInterval。最终这段时间如何处置（extraFocus、extraRest 或 ignored），须等用户在恢复流程中确认。

**字段一致性约束**

以下跨字段一致性规则必须由数据层强制保证，任何写入操作不得违反：

1. `endedAt` 必须晚于 `startedAt`。
2. `status='classified'` 时，`classifiedAt` 必须非 null；`ignoredAt` 必须为 null。
3. `status='ignored'` 时，`ignoredAt` 必须非 null；`classifiedAt` 必须为 null。
4. `status='pending'` 时，`classifiedAt` 和 `ignoredAt` 均必须为 null。
5. `source` 必须取自枚举值之一，不允许写入未定义值。
6. `localDate` 必须与 `startedAt` 及 `timezone` 保持一致（localDate = 按 timezone 从 startedAt 派生的本地日期）。

实现端在写入或更新 UnresolvedInterval 时，必须验证以上规则，违反任意一条的写入操作应被拒绝。

**派生指标说明：duration**

持续时长不作为存储字段，在展示或统计时按以下方式计算：

```
duration（秒）= ( endedAt 时间戳毫秒 − startedAt 时间戳毫秒 ) / 1000
```

---

### 3.7 Settings（用户偏好设置）

Settings 存储用户对番茄钟产品的个人偏好配置，包括计时时长、休息建议项、每日任务模板，以及累计番茄基数。Settings 是**单条当前生效记录**：同一时间最多只有一条 `deletedAt = null` 的有效 Settings。正常使用中直接更新该记录，不每次新建；Settings 修改历史通过 Event 记录，不通过多条 Settings 版本表达（见关键规则第 1 条）。

Settings 在建立每天 DayPlan 时以快照形式（`settingsSnapshot`）写入 DayPlan，使历史 DayPlan 可以用当时的配置解释其番茄预算，而无需追溯 Settings 的历史版本（见 §3.2）。`lifetimePomodoroBaseline` 不放入快照（见关键规则第 8 条）。

**完整字段定义**

| 字段名 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `id` | `string`（UUID v7） | 否 | 写入时生成 | 实体唯一标识；取值约束：UUID v7 格式 |
| `focusMinutes` | `number` | 否 | `25` | 标准 focus Session 的计划专注时长，单位分钟；写入 Session 时 `plannedDuration = focusMinutes × 60`（秒）；取值约束：整数，5 ≤ focusMinutes ≤ 120 |
| `shortBreakMinutes` | `number` | 否 | `5` | 标准 shortBreak Session 的计划短休时长，单位分钟；写入 Session 时 `plannedDuration = shortBreakMinutes × 60`（秒）；取值约束：整数，1 ≤ shortBreakMinutes ≤ 30 |
| `longBreakMinutes` | `number` | 否 | `15` | 标准 longBreak Session 的计划长休时长，单位分钟；写入 Session 时 `plannedDuration = longBreakMinutes × 60`（秒）；取值约束：只允许 `15 / 20 / 30` 三个固定值，不允许其他整数 |
| `longBreakEvery` | `number` | 否 | `4` | 每完成多少个有效标准 focus 后触发一次 longBreak；**字段保留作为未来预留 / 历史兼容字段；Phase 1–4 普通写入必须为 `4`，UI 不开放修改**，不通过 `settings.timerUpdated` 变更；取值约束：整数；Phase 1–4 普通写入只接受 `4`，数据层 validator 必须拒绝非 4 的普通写入（不放行 3 / 5 / 6 等），不得理解为"整数 ≥ 1 即可写" |
| `restSuggestions` | `array` | 否 | 内置默认清单（见本节内置默认清单说明） | 休息建议项列表；Session 的 `suggestedRest` / `actualRest` 字段引用数组内元素的 `key`；数组元素结构见下方；取值约束：数组（可为空），元素须符合下方 restSuggestions 元素结构定义 |
| `dailyTaskTemplates` | `array` | 否 | `[]`（内置"计划准备"模板由初始化写入） | 每日任务模板列表；首次创建 DayPlan 时按 `autoAddToDayPlan=true` 的模板自动生成当天专属 Task；数组元素结构见下方；取值约束：数组（可为空），元素须符合下方 dailyTaskTemplates 元素结构定义 |
| `lifetimePomodoroBaseline` | `number` | 否 | `0` | 用户从其他工具或历史记录手动带入的累计完整番茄基数（语义已由"有效 focus 基数"收紧为"完整番茄循环基数"，见 §8.11）；统计累计完整番茄数 = `lifetimePomodoroBaseline + 本工具内全时间段完整番茄循环数`；该字段**不放入** DayPlan.settingsSnapshot；用户修改时必须写入 §7.13 `statsBaseline.updated` 事件；取值约束：整数，≥ 0，不允许小数或负数 |
| `restSuggestionDisplayMode` | `string`（枚举） | 否 | `'customOrder'` | 休息建议项的展示排序策略；`'customOrder'` = 按 `restSuggestions.sortIndex` 展示（含用户手动拖拽后的自定义顺序）；`'usageFrequency'` = 按历史 `Session.actualRest` 统计的使用频次动态展示，不修改 `restSuggestions.sortIndex`，不触发 `restItem.reordered`，无历史数据或多项频次相同时回退到 `sortIndex`；频次统计窗口（最近 30 天 / 90 天 / 全部历史）待 §8 统计口径或 UI 设计确定；取值约束：取值为 `'customOrder'` / `'usageFrequency'` 之一 |
| `appDayStartOffsetMinutes` | `number` | 否 | `0` | 产品日开始时间相对自然日 00:00 的分钟偏移；用于派生产品日归属 `appDate`（见 §2.5）；`0` = 产品日从 00:00 开始，`240` = 从 04:00 开始；该设置是整个产品判断"今天 / 每日 / 当日"的全局日边界规则，影响 DayPlan 产品日归属、今日任务列表、每日模板生成、今日预算估算以及统计页日 / 周 / 月 / 年聚合，不只是统计页偏好；不改变历史记录的 `localDate`；取值约束：整数，0 ≤ appDayStartOffsetMinutes ≤ 1439 |
| `createdAt` | `string` | 否 | 写入时生成 | 记录首次写入时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `updatedAt` | `string` | 否 | 写入时生成 | 记录最近修改时间；取值约束：ISO 8601 带时区格式，不允许缺省时区 |
| `schemaVersion` | `number` | 否 | 写入时取当前版本 | 该条记录写入时的 schema 版本号（见 §2.3）；取值约束：正整数，≥ 1 |
| `deletedAt` | `string \| null` | 是 | `null` | 软删除时间戳（见 §2.4）；正常设置修改不软删除；仅用于数据修复、重置、迁移等特殊场景；`null` = 当前有效；取值约束：ISO 8601 带时区格式或 null |
| `deviceId` | `string \| null` | 是 | `null` | （可选预留）写入设备标识（见 §2.3，Phase 5+ 启用）；取值约束：null 或非空字符串 |
| `syncedAt` | `string \| null` | 是 | `null` | （可选预留）最近一次同步成功时间（见 §2.3，Phase 5+ 启用）；取值约束：ISO 8601 带时区格式或 null |

**restSuggestions 数组元素结构**

```
{
  key:        string                              休息项稳定标识；内置短休项以 short_ 开头，内置长休项以 long_ 开头；用户新增休息项 key 格式为 '<scope>_custom_' + UUID v7：短休自定义项为 'short_custom_' + UUID v7，长休自定义项为 'long_custom_' + UUID v7；历史 Session 的 suggestedRest / actualRest 引用此 key；key 写入后不随改名变化；取值约束：非空字符串，数组内唯一
  label:      string                              用户可见名称；可改名；改名不影响历史 Session（历史 Session 引用的是 key）；取值约束：非空字符串
  appliesTo:  ('shortBreak' | 'longBreak')[]      适用的休息类型；短休项写 ['shortBreak']，长休项写 ['longBreak']；实现端不得仅靠 key 前缀判断展示范围，应以 appliesTo 为准；取值约束：非空数组，每个值为 'shortBreak' 或 'longBreak'
  isBuiltIn:  boolean                             是否为系统内置休息项；内置项 key 不允许修改；取值约束：boolean
  isEnabled:  boolean                             是否启用；false 表示不再出现在新的推荐 / 选择列表中；历史曾使用的休息项禁止物理删除，否则旧 Session 的 key 失去可解释性；取值约束：boolean
  sortIndex:  number                              排序索引；sortIndex 只需在同一展示分组（shortBreak / longBreak）内排序稳定即可，短休与长休项的 sortIndex 互不影响；取值约束：整数，≥ 0
  icon:       string | null                       可选图标 / emoji；仅用于展示，不参与统计；默认 null；取值约束：字符串或 null
}
```

**内置 restSuggestions 默认清单（已确认）**

> 内置短休息清单共 15 项，`appliesTo: ['shortBreak']`，`isBuiltIn: true`，`isEnabled: true`，`icon: null`，`sortIndex` 从 1000 起步长 1000 递增。

```js
[
  { key: 'short_scalp_massage',       label: '梳头皮',         appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 1000,  icon: null },
  { key: 'short_shoulder_rolls',      label: '绕肩',           appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 2000,  icon: null },
  { key: 'short_march_in_place',      label: '原地踏步',       appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 3000,  icon: null },
  { key: 'short_self_hug',            label: '拥抱',           appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 4000,  icon: null },
  { key: 'short_temple_massage',      label: '揉太阳穴',       appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 5000,  icon: null },
  { key: 'short_butterfly_tapping',   label: '蝴蝶拍',         appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 6000,  icon: null },
  { key: 'short_stretch_up',          label: '伸懒腰',         appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 7000,  icon: null },
  { key: 'short_deep_breathing',      label: '深呼吸',         appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 8000,  icon: null },
  { key: 'short_toe_dance',           label: '脚趾舞',         appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 9000,  icon: null },
  { key: 'short_full_body_stretch',   label: '站姿全身伸展',   appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 10000, icon: null },
  { key: 'short_drink_water',         label: '喝水',           appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 11000, icon: null },
  { key: 'short_gaze_distance',       label: '远眺',           appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 12000, icon: null },
  { key: 'short_neck_shoulder_stretch', label: '拉伸肩颈',     appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 13000, icon: null },
  { key: 'short_touch_leaf',          label: '抚摸叶子',       appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 14000, icon: null },
  { key: 'short_feeling_note',        label: '写下此刻的感受', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 15000, icon: null }
]
```

> 内置长休息清单共 13 项，`appliesTo: ['longBreak']`，`isBuiltIn: true`，`isEnabled: true`，`icon: null`，`sortIndex` 在长休分组内从 1000 起步长 1000 递增（与短休 sortIndex 互不干扰）。

```js
[
  { key: 'long_listen_music',        label: '听音乐',           appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 1000,  icon: null },
  { key: 'long_screen_free_walk',    label: '不看屏幕的散步',   appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 2000,  icon: null },
  { key: 'long_enjoy_view',          label: '看风景',           appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 3000,  icon: null },
  { key: 'long_mindful_breathing',   label: '正念呼吸',         appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 4000,  icon: null },
  { key: 'long_jigsaw_puzzle',       label: '拼拼图',           appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 5000,  icon: null },
  { key: 'long_hold_plush_toy',      label: '把玩毛绒玩具',     appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 6000,  icon: null },
  { key: 'long_eat_fruit_slowly',    label: '慢慢吃点水果',     appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 7000,  icon: null },
  { key: 'long_gentle_yoga',         label: '做舒缓瑜伽',       appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 8000,  icon: null },
  { key: 'long_simple_stretch',      label: '简单拉伸',         appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 9000,  icon: null },
  { key: 'long_wall_stand',          label: '靠墙站立',         appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 10000, icon: null },
  { key: 'long_balcony_daydream',    label: '在阳台发呆',       appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 11000, icon: null },
  { key: 'long_tidy_desk',           label: '收拾桌面',         appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 12000, icon: null },
  { key: 'long_sip_water',           label: '小口慢慢喝水',     appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 13000, icon: null }
]
```

**dailyTaskTemplates 数组元素结构**

```
{
  templateKey:        string   模板稳定标识；默认内置模板为 'planningPreparation'；用户新增模板 key 格式为 'custom_' + UUID v7；key 不随 title 改名变化；取值约束：非空字符串，数组内唯一
  title:              string   生成 Task 时使用的默认标题；取值约束：非空字符串
  estimatedPomodoros: number   生成 Task 时使用的默认预估番茄数；取值约束：整数，1–7；每日模板自动生成 Task 时该值写入 Task.estimatedPomodoros，因此必须满足 §3.1 Task 的单任务预估上限；不允许通过模板生成 8+ 番茄任务
  autoAddToDayPlan:   boolean  是否在每天首次创建 DayPlan 时自动生成当天专属 Task；取值约束：boolean
  sortPosition:       string   生成 Task 加入今日列表时的插入位置；取值约束：'first' | 'last'
  sortIndex:          number   该模板在设置列表中的排序索引；取值约束：整数，≥ 0
  isBuiltIn:          boolean  是否为系统内置模板；内置模板 key 不允许修改，但 title / estimatedPomodoros / autoAddToDayPlan 可由用户调整；取值约束：boolean
}
```

> **内置"计划准备"模板默认值**：
> ```
> {
>   templateKey:        'planningPreparation'
>   title:              '计划准备'
>   estimatedPomodoros: 1
>   autoAddToDayPlan:   true
>   sortPosition:       'first'
>   sortIndex:          0
>   isBuiltIn:          true
> }
> ```

**关键规则**

1. Settings 是**单条当前生效记录**：同一时间最多允许一条 `deletedAt = null` 的有效 Settings（见字段一致性约束第 1 条）。正常使用中更新同一条 Settings，不每次新建；Settings 修改历史通过 Event 记录（§7.12 Settings 事件域），不通过多条 Settings 版本表达。
2. 首次启动时，如不存在 Settings，系统创建一条默认 Settings（id 使用 UUID v7 生成，所有字段取默认值），并写入已确认的内置 `restSuggestions` 与内置 `dailyTaskTemplates`。内置 `restSuggestions` 见本节内置默认清单（短休 15 项、长休 13 项）；每一项 `isBuiltIn=true`、`isEnabled=true`，`sortIndex` 按清单顺序以 1000 为步长递增，`icon` 初始为 null。
3. `focusMinutes` / `shortBreakMinutes` / `longBreakMinutes` 的值决定每次创建对应 Session 时的 `plannedDuration`：`plannedDuration（秒）= 对应分钟数 × 60`。Session 写入后其 `plannedDuration` 不随 Settings 后续变化而追溯修改——历史 Session 保留写入时的值。
4. `longBreakMinutes` 只允许 `15 / 20 / 30` 三个固定值。实现端应在 UI 层限制选择范围，数据层写入时也必须验证（见字段一致性约束第 4 条）。
5. `restSuggestions` 中已启用（`isEnabled = true`）的项才出现在新的推荐 / 选择列表中。历史曾使用的休息项（历史 Session 的 `suggestedRest` / `actualRest` 曾引用过其 key 的项）**不允许物理删除**；如用户不再使用，将 `isEnabled` 改为 `false` 保留本体，否则旧 Session 的 key 无法被解释。
5a. 展示短休建议时，只读取 `appliesTo` 包含 `'shortBreak'` 且 `isEnabled=true` 的项；展示长休建议时，只读取 `appliesTo` 包含 `'longBreak'` 且 `isEnabled=true` 的项。实现端**不得**仅通过 `key` 的 `short_` / `long_` 前缀判断适用范围；前缀只是命名辅助，真实适用范围以 `appliesTo` 字段为准。
5b. `restSuggestions` 元素的 `key` 是稳定数据标识，写入 Session 时引用 `key`，不引用 `label`。`label` 可在未来调整展示文案，但已存在的 `key` 不得因 `label` 文案变化而改变。
5c. **用户自定义休息项归属规则（Phase 1）**：用户新增的单个 restSuggestion 只允许归属一个休息类型（短休或长休）。若用户希望同一 label 同时出现在短休和长休中，应创建两条 restSuggestion，分别使用不同 key（`short_custom_<UUIDv7>` 和 `long_custom_<UUIDv7>`）。Phase 1 不设计"一条 restSuggestion 同时适用于 shortBreak 和 longBreak"的用户自定义项。

  示例：
  ```js
  // 用户在短休设置中新增"用户输入的短休项目名称"
  { key: 'short_custom_018f2c3a-...', label: '用户输入的短休项目名称', appliesTo: ['shortBreak'], isBuiltIn: false, isEnabled: true, sortIndex: 16000, icon: null }

  // 用户在长休设置中新增"用户输入的长休项目名称"
  { key: 'long_custom_018f2c3b-...', label: '用户输入的长休项目名称', appliesTo: ['longBreak'], isBuiltIn: false, isEnabled: true, sortIndex: 14000, icon: null }
  ```

5d. **用户新增 restSuggestion 时，必须显式传入 `targetBreakType`**，取值为 `'shortBreak'` 或 `'longBreak'`。数据层根据 `targetBreakType` 生成 `key` 与 `appliesTo`，不允许实现端根据 UI 文案、页面标题、key 前缀、label 内容或当前 Session 状态自行推断归属。

  统一创建函数伪代码：
  ```
  createCustomRestSuggestion(input: { label: string, targetBreakType: 'shortBreak' | 'longBreak' })

  if input.targetBreakType === 'shortBreak':
    key = 'short_custom_' + uuidv7()
    appliesTo = ['shortBreak']

  if input.targetBreakType === 'longBreak':
    key = 'long_custom_' + uuidv7()
    appliesTo = ['longBreak']
  ```

  前端不应手写 `key`；`key` 由数据层或统一创建函数生成，避免不同入口规则不一致。本文不规定具体 UI 形态（分区入口或统一入口均可），但写入时必须明确传入 `targetBreakType`，不允许推断。

5e. **用户自定义休息项的禁用与删除规则**：
  - 若该 key 已出现在历史 Session 的 `suggestedRest` 或 `actualRest` 中，**不得物理删除**，应将 `isEnabled` 改为 `false`。
  - 若该 key 从未被任何历史 Session 引用，Phase 1 可允许物理移除；但更稳妥的统一实现是始终使用 `isEnabled=false`。
  - 内置项（`isBuiltIn=true`）无论有无历史引用，均不得物理删除，只能通过 `isEnabled=false` 关闭展示。

6. `dailyTaskTemplates` 中 `autoAddToDayPlan = true` 的模板，在每天**首次创建 DayPlan** 时自动生成当天专属 Task 实例，加入当天 `DayPlan.taskIds`。不复用历史日期的 Task 实例，每天新建。生成的 Task 在 `metadata` 中标记 `templateKey` 与 `source = 'systemDailyTemplate'`（见 §3.1 metadata 对象结构）。此处"每天 / 当天"按当前**产品日 `appDate`**（见 §2.5、§3.2）判断，不按自然日 00:00 固定切换：当 `appDayStartOffsetMinutes = 240` 时，凌晨 02:00 仍属于前一个产品日，不应据此生成新一天的模板任务。
7. 用户从当天 DayPlan 移除模板生成的 Task，只影响当天，不影响模板配置，也不影响未来日期的自动生成。
8. `lifetimePomodoroBaseline` **不放入 DayPlan.settingsSnapshot**。该字段是用户手动带入的累计历史起点，与单日番茄预算无关；如写入快照，会导致每次调整基数时快照随之变化（见 §3.2 settingsSnapshot 说明）。
9. Settings 的多端同步冲突解决策略不适用 last-write-wins by updatedAt，需要字段级合并（field-level merge）；`lifetimePomodoroBaseline` 的冲突属于语义冲突，需用户介入决策。具体策略见 §2.6（Phase 5+ 详细设计）。
10. `appDayStartOffsetMinutes` 是全局产品日边界设置，用于派生 `appDate`（见 §2.5）：
   - **Phase 1 默认值为 `0`**；Phase 1 可暂不开放 UI 修改，但数据层从一开始必须有该字段，且所有"今天 / 每日 / DayPlan / 今日任务列表 / 预算估算 / 统计按日归属"的内部逻辑都应基于 `appDate` 派生函数，而不是直接把 `localDate` 当业务日期。
   - 后续开放 UI 后，用户修改该字段会影响产品日归属与统计视图；该设置**不改变历史记录的 `localDate`**，统计 / 今日 / DayPlan 等业务视图按派生 `appDate` 重新解释历史记录。
   - 该字段的修改由 §7.12 `settings.appDayStartOffsetUpdated` 事件承载，**不通过** `settings.timerUpdated`（它不是计时时长参数）。Phase 1 默认值为 `0`、UI 不开放修改，因此 Phase 1 不会真实触发该事件；P2+ 若开放设置入口，对该字段的每次修改都必须触发 `settings.appDayStartOffsetUpdated`（见 §7.12）。

**字段一致性约束**

以下跨字段一致性规则必须由数据层强制保证，任何写入操作不得违反：

1. 同一时间最多允许一条 `deletedAt = null` 的有效 Settings 记录（单例约束）。
2. `focusMinutes` 必须为整数，且满足 5 ≤ focusMinutes ≤ 120。
3. `shortBreakMinutes` 必须为整数，且满足 1 ≤ shortBreakMinutes ≤ 30。
4. `longBreakMinutes` 必须为 15、20 或 30 之一。
5. `longBreakEvery` 字段保留作为未来预留 / 历史兼容字段；**Phase 1–4 普通写入必须为 `4`**，UI 不开放修改，不通过 `settings.timerUpdated` 变更；数据层 validator 在普通写入中必须拒绝非 4 的值（不接受 3 / 5 / 6 等，不得简单写成"整数 ≥ 1"）。未来若开放"每几个番茄进入长休"配置，必须另行补充变更事件、统计归属，以及"未完成番茄组期间修改设置"的处理规则后，方可放开非 4 取值。
6. `lifetimePomodoroBaseline` 必须为整数，且 ≥ 0，不允许小数或负数。
7. `restSuggestions` 数组中每个元素的 `key` 在数组内不允许重复。
8. `dailyTaskTemplates` 数组中每个元素的 `templateKey` 在数组内不允许重复。
9. `restSuggestions` 每个元素的 `appliesTo` 不得为空数组；每个值必须是 `'shortBreak'` 或 `'longBreak'`，不允许其他值。
10. `restSuggestions` 用户自定义项（`isBuiltIn=false`）的 key 前缀必须与 `appliesTo` 保持一致：key 以 `short_custom_` 开头时，`appliesTo` 必须为 `['shortBreak']`；key 以 `long_custom_` 开头时，`appliesTo` 必须为 `['longBreak']`。前缀与 `appliesTo` 不一致的写入操作应被拒绝。
11. `appDayStartOffsetMinutes` 必须为整数，且满足 0 ≤ appDayStartOffsetMinutes ≤ 1439。

实现端在写入或更新 Settings 时，必须验证以上规则，违反第 1–11 条的写入操作应被拒绝。

---

## 6. Event type 命名规范

本章规定所有事件类型的命名格式与约束。§7 完整事件分类表中的所有事件类型命名，以及所有实现端写入 Event 时选取的 `type` 值，均须遵守本章规则。

### 6.1 格式

统一格式：`domain.action`

- **domain**：标识事件所属的业务实体或功能域，camelCase，首字母小写。
- **action**：描述发生了什么动作，英文动词或动词短语；简单动作用过去式（如 `completed`、`deleted`）；需要区分操作对象时可使用复合形式（如 `movedToToday`、`estimateAdjusted`）。

示例：`task.completed`、`focus.started`、`interval.classified`。

### 6.2 Domain 列表

| Domain | 含义 | §7 对应节 | 备注 |
|---|---|---|---|
| `task` | 任务本体变化，以及任务排序与层级操作 | §7.1 / §7.4 | 排序与层级事件（`task.reordered` 等）归入 `task` 域；§7.4 单列为独立分节，方便查阅，不另立 domain 前缀 |
| `subtask` | 子任务特有行为 | §7.2 | 子任务本体仍是 Task 记录（有 `parentId`），但子任务语境特有操作用 `subtask.` 前缀 |
| `dayPlan` | 当天计划与今日待办变化 | §7.3 | |
| `focus` | 专注 session 行为 | §7.5 | |
| `break` | 休息 session 行为 | §7.6 | |
| `restItem` | 休息建议项的创建与修改 | §7.7 | v4 新增；对应 `Settings.restSuggestions` 元素的增删改操作 |
| `interrupt` | 专注中打扰行为 | §7.8 | |
| `energy` | 能量记录 | §7.9 | |
| `triage` | 待分流事项（专注中捕获计划外事项） | §7.10 | |
| `interval` | 未归类时段（UnresolvedInterval）处置 | §7.11 | 实体名 UnresolvedInterval，domain 名取短形 `interval` |
| `settings` | 全局设置变更 | §7.12 | |
| `statsBaseline` | 历史累计番茄基数变更 | §7.13 | |
| `data` | 数据初始化 / 迁移 / 导入导出 | §7.14 | Dev-only；不进用户统计 |
| `demo` | 演示数据操作 | §7.14 | Dev-only；不进用户统计 |
| `notification` | 系统通知可见性 | §7.15 | |
| `prompt` | 弹窗与用户决策过程 | §7.15 | |
| `session` | 当前不定义事件 | §7.16 | 计时行为归 `focus` / `break`；本域当前无事件 |
| `error` | 运行时异常 | §7.17 | v4 新增；不进用户统计；不允许 `error.migrationFailed`（迁移失败见 `data.migrationFailed`） |
| `diagnosticLog` | 用户主动导出诊断日志（排障用） | §7.18 | v4 新增；不进用户统计；与 §7.14 `data.*` 全量数据导出分离 |

### 6.3 Action 动词规范

§7 事件分类表中所有事件的 action 部分，应优先使用以下批准列表中的动词。§7 撰写过程中如发现现有动词不足以准确描述某个用户行为，可在 §7 中先行使用新动词，但必须同步补入本节列表，并在章节汇报中列出新增动词及原因，等用户确认后固定。

| 动词 / 复合动词 | 用途 |
|---|---|
| `created` | 新建实体 |
| `updated` | 一般性字段更新（用于无法单独命名字段的通用更新）|
| `deleted` | 软删除实体 |
| `completed` | 标记完成（任务 / session / break）|
| `uncompleted` | 撤销完成 |
| `discarded` | 作废（focus session 中途停止）|
| `skipped` | 跳过（break）|
| `started` | 开始计时 |
| `added` | 添加到集合（子任务添加到母任务、任务加入 DayPlan）|
| `removed` | 从集合移除（任务从 DayPlan 移除）|
| `reordered` | 在同一列表内调整排列顺序 |
| `reparented` | 父任务变化（子任务换绑到另一母任务）|
| `unparented` | 升级为独立顶层任务（原子任务脱离母任务）|
| `movedToToday` | 从活动清单加入今日待办 |
| `movedToList` | 从今日待办移回活动清单 |
| `archived` | 归档（拆分归档或完成归档）|
| `split` | 发起拆分归档 |
| `adjusted` | 局部数值调整（如预估番茄数追加）|
| `recorded` | 记录观测值（能量记录）|
| `classified` | 用户对未归类时段完成归类 |
| `ignored` | 用户选择忽略未归类时段 |
| `restored` | 恢复已删除实体 |
| `shown` | 内容展示给用户（通知 / 弹窗 / 推荐）|
| `dismissed` | 用户关闭 / 忽略通知弹窗，或放弃一个待处理事项（如待分流事项）；不表示系统异常删除，而是用户主动决定不再跟进 |
| `enabled` | 启用某项配置（如启用休息建议项）|
| `disabled` | 禁用某项配置（如禁用休息建议项）|
| `changed` | 特定已命名字段发生变化（配合字段名构成复合 action，如 `settings.focusMinutesChanged`）|
| `estimated` | 系统完成估算计算并呈现结果（如预算估算）|
| `accepted` | 用户接受 / 确认系统给出的值或建议 |
| `shuffled` | 用户触发洗牌 / 刷新候选项列表（如休息建议项"换一组"）|
| `selected` | 用户从候选列表中主动选定某个具体项（区别于 `accepted`：`accepted` 用于"接受系统给出的值"，`selected` 用于"从列表中主动挑选"）|
| `captured` | 用户在专注中通过快捷入口捕获一个计划外事项，创建 Task 并放入待分流清单 |
| `initialized` | 系统首次创建默认实体（如 Settings 首次初始化）；产品生命周期内只触发一次，已存在时不触发 |
| `timerUpdated` | 计时参数（focusMinutes / shortBreakMinutes / longBreakMinutes）字段变更（§7.12；`longBreakEvery` 固定为 4、不开放修改，不在此列）|
| `detected` | 系统检测到异常状态并创建对应记录（如发现未正常闭合的 session 后创建 UnresolvedInterval，§7.11）|
| `sessionResolved` | 在恢复流程中确认原 active session 的最终状态（§7.11 interval 域）|
| `workEnded` | 用户明确结束当前产品日的番茄工作流程 / 停止当日番茄流程（§7.3 dayPlan 域；收工锚点，用于休息豁免；作为整体复合动作登记，区别于 v4 已移除的 `break.ended`）|
| `migrationCompleted` | schema 迁移成功执行完毕（§7.14 data 域）|
| `migrationFailed` | schema 迁移执行失败（§7.14 data 域）；迁移失败的唯一权威 action，不允许在 error 域重复使用 |
| `exported` | 用户主动导出：本地数据全量备份（§7.14 data 域）/ 诊断日志（§7.18 diagnosticLog 域）|
| `imported` | 用户主动从本地备份文件导入 / 恢复数据（§7.14 data 域）|
| `cleared` | 清空全部本地数据 / 重置应用，或清除演示数据（§7.14 data.cleared / demo.cleared）|
| `loaded` | 加载演示数据（§7.14 demo 域）|
| `dataWriteFailed` | 本地数据库写入操作失败（§7.17 error 域）|
| `unexpectedState` | 系统检测到数据处于违反业务约束的意外状态（§7.17 error 域）|

**复合 action 规则**：§7 中允许使用由业务对象名 + §6.3 基础 action 组合而成的复合 action，例如 `budgetAccepted` = `budget` + `accepted`，`deductionRemoved` = `deduction` + `removed`，`estimateAdjusted` = `estimate` + `adjusted`，`taskAdded` = `task` + `added`。此类复合 action 只要基础动作词已在本节列表中登记，即视为合法，无需逐个单列。若未来引入无法由现有基础动作词解释的新 action，仍必须同步补入本节列表。

**命名特例：`interrupt` 域**：`interrupt.internal` 和 `interrupt.external` 中的 `internal` / `external` 不是普通动作动词，而是打扰来源分类，用于在事件类型层面直接区分内部打扰与外部打扰，便于查询和统计。该命名特例仅适用于 `interrupt` 域，不得扩展为其他 domain 随意使用形容词或分类词作为 action。

### 6.4 禁止混用规则

1. **`done` 与 `completed` 不混用** → 统一用 `completed`。

2. **`task` 与 `subtask` 不混用** → 子任务语境特有操作用 `subtask.` 前缀；子任务本体的通用字段变更（如标题修改）可用 `task.updated`，但计时页中途添加 / 完成子任务等特有行为用 `subtask.`。

3. **`archived` 与 `deleted` 语义不同** → `archived` 表示主动归档（完成归档或拆分归档，`outcome` 字段记录类型）；`deleted` 表示软删除（写 `deletedAt`）。两者不混用，不能以 `deleted` 事件表达归档行为。

4. **`budget` 与 `estimate` 区分** → `estimate` 描述计算过程中的估算数据；`budget` 描述用户最终确认的预算值。事件命名遵循同一区分。

5. **`task.positionChanged` 已废弃** → 不允许在 v4 中使用此事件。一次拖拽操作根据语义分别写 `task.reordered`（同列表内重排）、`task.reparented`（父任务变化）、`task.movedToToday`（加入今日）、`task.movedToList`（移回清单）等具体事件。若单次操作同时产生多条事件，通过 `correlationId` 关联。

6. **`error.migrationFailed` 不允许存在** → 迁移失败的权威事件为 `data.migrationFailed`；`error.*` 域仅用于运行时异常（如 `error.dataWriteFailed`、`error.unexpectedState`），不用于迁移流程。

7. **`focus` 与 `session` 不混用** → `focus.` 前缀描述专注 session 的计时行为（开始、结束、作废等）；`session.` 域当前不定义事件，不用于描述计时流程本身（见 §7.16）。

---

## 7. 完整事件分类表

本章按 domain 列出产品所有已定义事件类型。每个事件包含：Phase、顶层关联字段、payload（完整 schema）、说明、典型触发场景、不应触发的反例。命名格式与 domain 列表见 §6。

**Phase 标注**：

| 标注 | 含义 |
|---|---|
| P1 | 数据地基阶段：必须建模 / 预留，必要时接入 |
| P2 | Phase 2：接现有功能真实数据 |
| P3 | Phase 3：统计页真实化 |
| P4 | Phase 4：上线前完善 |
| DEV | Dev-only：迁移审计 / 演示数据，不进用户统计 |

Event 顶层关联字段（`taskId`、`sessionId` 等）定义见 §3.4；不适用时存 null，不省略。

**payload 即完整 schema（实现端必读）**：

§7 中每个事件列出的 `payload` 字段集**即该事件的完整 payload schema**，不是"仅列出重要字段、其余可由实现端自由添加"：

- 除非字段明确标注为可空 / 可选，否则该字段必须写入，实现端**不得省略必填字段**。
- 实现端**不得**向 payload 添加文档未定义的字段；如确需新增字段，必须**先修订本 v4 文档**，再在实现中写入。
- 仅当某事件明确没有专属数据时，`payload` 才允许为空对象 `{}`（见 §3.4）。

本规则与 §3.4 Event 的 `payload` 字段定义及字段一致性约束第 1 条一致。

---

### 7.1 Task（任务本体）

本节定义 Task 生命周期相关事件。任务排序 / 层级 / 位置变化（重排、换父任务、加入今日、移回清单）见 §7.4；子任务语境特有行为见 §7.2；DayPlan 侧变更见 §7.3。

---

#### task.created（P1）

**顶层关联字段**：`taskId`；`source='systemDailyTemplate'` 时同步填写 `dayPlanId`；`source='unresolvedIntervalClassification'` 时同步填写 `unresolvedIntervalId`。

**payload**：`{ title, parentId, estimatedPomodoros, source }`

`source` 取值：

| 值 | 含义 |
|---|---|
| `'manual'` | 用户手动新建 |
| `'systemDailyTemplate'` | 每日模板在 DayPlan 首次创建时自动生成 |
| `'unresolvedIntervalClassification'` | 归类 UnresolvedInterval 时快捷创建 |
| `'splitChild'` | 拆分归档流程中产生的新任务 |
| `'triageCapture'` | 计时页快速捕获计划外事项时产生的待分流 Task |

**说明**：Task 实体首次写入存储时触发，来源通过 `source` 区分。`source='systemDailyTemplate'` 时，与 `dayPlan.taskAdded` 共享 `correlationId`；`source='splitChild'` 时，与同次操作的 `task.split`、`task.archived`（原任务）共享 `correlationId`。payload 中 `estimatedPomodoros` 必须为 1–7；用户输入 5–6 时允许写入，UI 可给出非阻断式软提醒；用户输入 7 时允许写入（最大允许值）；用户输入 `>7` 时不允许写入，应提示用户拆分（→ `prompt.shown`，promptType=`'taskSplitSuggestion'`），直至预估回到合法范围后再写入。创建任务时，初始预估同时作为 `estimateRounds` 第一轮记录写入 Task（`index=1`、`pomodoros` = 初始总预估、`occurredAt` = 创建时刻，见 §3.1 关键规则 11）；本事件 payload 不重复携带 `estimateRounds`，第二 / 三轮才由 `task.estimateAdjusted` 承接。

**典型触发**：用户在活动清单点击新建并确认（estimatedPomodoros 取值 1–7）；当天首次创建 DayPlan，每日模板自动生成计划准备任务；用户对 UnresolvedInterval 完成归类并快捷创建关联任务；拆分归档流程写入新任务。

**不应触发**：任务已存在后的任何字段修改（→ `task.updated` 或对应专属事件）；任务被移入今日待办（→ `dayPlan.taskAdded`）；用户输入 `estimatedPomodoros > 7`（→ 拒绝写入，触发拆分提示）。

---

#### task.updated（P2）

**顶层关联字段**：`taskId`。

**payload**：`{ field, oldValue, newValue }`

`field` 为 §3.1 Task 中发生变更的字段名，常见取值：`'title'`、`'note'`、`'actualWorkNote'`、`'metadata'`。状态变更类字段（`status`、`completedAt`、`archivedAt`、`deletedAt`）不使用本事件，触发各自专属事件。

**说明**：Task 某个一般性字段内容变更时触发，用于无专属事件的通用字段更新记录。

**典型触发**：用户编辑任务标题；用户修改任务进行中备注（`note`）；用户在任务归档后补充实际完成内容（`actualWorkNote`）。

**不应触发**：任务完成（→ `task.completed`）；任务归档（→ `task.archived`）；任务软删除（→ `task.deleted`）；正式追加预估（→ `task.estimateAdjusted`）；排序或位置变化（→ §7.4）。

---

#### task.estimateAdjusted（P2）

**顶层关联字段**：`taskId`。

**payload**：`{ round, oldEstimate, newEstimate }`

`round` 为 2 或 3，对应 `estimateRounds` 数组中本轮的 `index`（第 1 轮已随 `task.created` 记录于 `Task.estimateRounds`（`index=1`，见 §3.1 关键规则 11），不触发本事件）。

**说明**：用户正式追加第二次或第三次预估，`estimateRounds` 数组新增一条记录时触发。`newEstimate` 表示该轮预估后单个 Task 的**总预估番茄数**（不是增量）；执行中用户 UI 可输入"还需追加几个番茄"，写入前必须换算为新总预估值再存入 `newEstimate`。`newEstimate` 为 5–6 时允许写入，UI 可给出非阻断式软提醒；`newEstimate` 为 7 时允许写入（最大允许值）；`newEstimate > 7` 时不允许写入，应触发拆分提示（→ `prompt.shown`，promptType=`'taskSplitSuggestion'`）。第三轮（round=3）后产品强制引导拆分归档，不存在 round > 3 的记录。第三轮后触发拆分提示不是唯一触发条件：若该 Task 已完成 7 个有效标准 focus 仍未完成，同样触发拆分提示（见 §3.1 关键规则第 10 条）。

**典型触发**：一个番茄完成后用户认为任务比预期复杂，点击"调整预估"发起第二次预估（newEstimate 为换算后总预估值，1–7）；第二次预估后仍未完成，发起第三次预估。

**不应触发**：创建任务时设置初始预估（→ `task.created`）；用户随意改动数字但未正式进入追加预估流程（→ `task.updated`，`field='estimatedPomodoros'`）；换算后 `newEstimate > 7`（→ 拒绝写入，触发拆分提示）。

---

#### task.completed（P2）

**顶层关联字段**：`taskId`；`completionSource='pomodoro'` 时可填写 `sessionId`（触发完成确认的 focus session）；任务或子任务在计时页 session 过程中被手动勾选完成时，也可填写 `sessionId` 记录计时上下文——此时 `completionSource` 仍为 `'manual'`，`sessionId` 仅表示"发生在哪个 session 期间"，不改变完成方式的语义。

**payload**：`{ completionSource, completedAt, validFocusCountAtCompletion }`

`completionSource` 取值：`'manual'`（手动勾选）| `'pomodoro'`（番茄结束后确认完成）。

`validFocusCountAtCompletion`：任务完成时该 Task 下已累计的有效标准 focus Session 数（快照值）；取值约束：整数，≥ 0；用于稳定计算预估准确率和预估偏差（见 §8.5），写入后不随后续 Session 派生结果变化；`completionSource='manual'` 时也必须写入，取该 Task 完成时已累计的有效标准 focus 数（可为 0，也可大于 0），不得因 `completionSource='manual'` 而固定写 0；进行中但尚未 `completed` 的 focus 不计入该值；不得写入 Task 本体（Task 不存储衍生番茄数，见 §3.1 关键规则 1）。

**说明**：任务 `status` 变更为 `'completed'`，`completedAt` 写入时触发。`completionSource='manual'` 的完成不计入番茄统计（统计口径见 §8）。任务完成后若再走完成归档（`task.archived`，outcome=`'completed'`），`completedAt` 与 `completionSource` 必须保留，不在归档时清空（见 §3.1 字段一致性约束第 4a 条）。

当 `completionSource='pomodoro'` 时，本事件由番茄结束后的任务完成确认流程触发，而非由 `focus.completed` 直接自动写入。任务完成确认的 UI 形态不限于弹窗：当它以需要用户回应的显著提示形式出现时，系统展示 `prompt.shown`（promptType=`'taskCompletionCheck'`，见 §7.15），用户在该提示中**明确确认**任务已完成后才写入 `task.completed`；若用户选择"还没完成"、关闭或跳过该提示，则不触发 `task.completed`，改由 §7.15 `prompt.dismissed` 记录。若实现为计时页常驻复选框 / 轻量完成入口（未形成需用户回应的显著提示），则不触发 `prompt.shown(taskCompletionCheck)`，用户确认完成时直接写入 `task.completed`，不补写 `prompt.shown`（已确认，见 §7.15）。无论确认形态如何，`task.completed`（`completionSource='pomodoro'`）仅在用户于 completed 标准 focus 后的收尾 / 确认流程中明确确认任务完成后写入，并在顶层 `sessionId` 填写触发该确认流程的 focus Session id。

**典型触发**：用户在活动清单或今日列表手动勾选完成；番茄收尾流程中用户确认该任务已完成。

**不应触发**：子任务勾选完成（子任务是独立 Task，触发自己的 `task.completed`，特有场景可同时触发 §7.2 事件）；任务归档（→ `task.archived`）；拆分归档（→ `task.split` + `task.archived`）。

---

#### task.uncompleted（P2）

**顶层关联字段**：`taskId`。

**payload**：`{ previousCompletedAt, previousCompletionSource }`

**说明**：用户撤销任务完成，`status` 回到 `'active'`，`completedAt` 和 `completionSource` 同时清空时触发。

**典型触发**：用户发现误勾完成立刻撤销；归档前发现任务尚未真正完成，撤销完成状态。

**不应触发**：任务从归档或删除状态恢复（→ `task.restored`）；任务首次标记完成（→ `task.completed`）。

---

#### task.split（P2）

**顶层关联字段**：`taskId`（原任务）。

**payload**：`{ lineageId, newTaskId }`

**说明**：用户确认拆分归档时触发，记录原任务与新任务的血缘关系。同次操作产生三条事件，共享同一 `correlationId`：`task.split`（原任务，本事件）、`task.archived`（原任务，outcome=`'split'`）、`task.created`（新任务，source=`'splitChild'`）。`newTaskId` 记录新任务 id，便于直接关联查询，无需遍历 `correlationId`。原任务走拆分归档后字段状态机见 §3.1 字段一致性约束第 4b 条：`status='archived'`、`outcome='split'`、`archivedAt` 非 null，**不要求** `completedAt` / `completionSource` 非 null。

**典型触发**：第三轮预估后系统引导拆分流程；用户在归档弹窗中选择"拆分为下一个任务"。

**不应触发**：完成归档（→ `task.archived`，outcome=`'completed'`）；任务软删除（→ `task.deleted`）；任务字段普通编辑（→ `task.updated`）。

---

#### task.archived（P2）

**顶层关联字段**：`taskId`。

**payload**：`{ outcome }`

`outcome` 取值：`'completed'`（完成归档）| `'split'`（拆分归档，与 `task.split` 共享 `correlationId`）。

**说明**：任务 `status` 变更为 `'archived'`，`archivedAt` 写入时触发。归档后的字段状态机见 §3.1 字段一致性约束第 4a / 4b 条：

- `outcome='completed'`（完成后归档）：任务此前已完成，归档时**保留**原 `completedAt` 与 `completionSource`（`'manual'` 或 `'pomodoro'`），以便归档后仍能追溯当初是手动完成还是番茄完成；不得在归档时清空这两个字段。
- `outcome='split'`（拆分归档）：**不要求** `completedAt` / `completionSource` 非 null；拆分语义由 `outcome='split'`、`task.split`、`task.created(source='splitChild')` 与 lineage 字段表达。

**典型触发**：用户完成归档流程选择完成归档（outcome=`'completed'`，原 completedAt / completionSource 保留）；拆分归档流程中原任务被系统自动归档（outcome=`'split'`，与 `task.split` 共享 `correlationId`）。

**不应触发**：任务软删除（→ `task.deleted`）；任务完成但尚未归档（→ `task.completed`）。

---

#### task.deleted（P2）

**顶层关联字段**：`taskId`。

**payload**：`{ deletedReason: null | 'userDeleted' | 'triageDismissed' | 'dataCleanup' }`

`deletedReason` Phase 1 允许省略或写 null；如写入则必须取以下枚举之一，不允许自由文本：
- `null`：未记录删除原因，或旧数据 / 未接入原因记录时产生的删除；
- `'userDeleted'`：用户在普通任务列表、活动清单等常规入口中主动删除；
- `'triageDismissed'`：待分流任务被用户放弃 / dismiss，应与同一次操作产生的 `triage.dismissed` 共享 `correlationId`（见 §7.10）；
- `'dataCleanup'`：数据修复、迁移、清理异常数据等非普通用户删除场景。

`payload.deletedReason` 必须与 Task 本体的 `deletedReason` 字段保持一致，不得出现事件与实体字段枚举值不同的情况。

**说明**：用户对任务执行软删除（写入 `deletedAt`，`status` 变更为 `'deleted'`）时触发；`triage.dismissed` 流程执行软删除时也触发本事件（见 §7.10）。不允许物理删除（见 §2.4）。

**典型触发**：用户在活动清单中长按或右键选择删除任务（`deletedReason='userDeleted'`）；用户在待分流清单中放弃事项（`deletedReason='triageDismissed'`，与 `triage.dismissed` 共享 `correlationId`）。

**不应触发**：任务归档（→ `task.archived`）；从今日待办移回活动清单（→ §7.4 / `dayPlan.taskRemoved`，不修改 Task 字段）；子任务软删除（子任务同样触发 `task.deleted`，但特有场景可同时触发 §7.2 事件）。

---

#### task.restored（P4）

**顶层关联字段**：`taskId`。

**payload**：`{ restoredFrom }`

`restoredFrom` 取值：`'deleted'`（从软删除恢复）| `'archived'`（从归档状态恢复）。

**说明**：用户恢复已删除或已归档的任务时触发。Phase 1–3 数据层预留字段，Phase 4 前端实现恢复 UI 后实际写入。

**典型触发**：用户在"最近删除"视图中点击恢复。

**不应触发**：任务正常状态变更；`task.uncompleted`（撤销完成，不是从删除 / 归档状态恢复）。

---

### 7.2 Subtask（子任务）

本节定义子任务语境特有行为的事件。

**Domain 级说明**：子任务本体是 Task 实体（`parentId` 非 null 的 Task）。子任务的创建、字段编辑、完成 / 取消完成、软删除、归档，均触发对应的 `task.*` 事件（见 §7.1）——这些事件适用于所有 Task 实体，不区分是否有 parentId。本节只定义对子任务场景有额外语义价值的特有行为：加入母任务、在同母任务下重排、换绑母任务、升级为顶层任务。

> 规则提醒：子任务完成不自动完成母任务；子任务删除 / 归档不影响其他兄弟子任务；软删除 / 归档不断裂已有 session / event 关联（见 §2.4）。

---

#### subtask.added（P2）

**顶层关联字段**：`taskId`（子任务）；计时页添加时填写 `sessionId`。

**payload**：`{ parentId, title, estimatedPomodoros, source }`

`source` 取值：`'listPage'`（任务详情页或活动清单）| `'timerPage'`（计时页中途添加）。

**说明**：新子任务写入存储并加入母任务时触发，同时与 `task.created`（source=`'manual'`）共享 `correlationId`。计时页中途添加时 source=`'timerPage'`，并在 Event 顶层填写 `sessionId`，不另设独立的"计时页添加"事件。

**典型触发**：用户在任务详情页点击"添加子任务"并确认；计时进行中用户在计时页新增一条子任务。

**不应触发**：子任务字段编辑（→ `task.updated`）；子任务完成（→ `task.completed`）；已有顶层任务被设置 parentId（属于 `task.reparented`，非新建）。

---

#### subtask.reordered（P2）

**顶层关联字段**：`taskId`（被移动的子任务）。

**payload**：`{ parentId, fromIndex, toIndex }`

`fromIndex` / `toIndex` 为操作前后该子任务在同级列表中的下标（0 起始）。

**说明**：用户在母任务的子任务列表内拖拽调整子任务顺序时触发。

**典型触发**：用户在任务详情页拖拽子任务上移或下移。

**不应触发**：顶层任务在活动清单重排（→ §7.4 `task.reordered`）；今日待办列表重排（→ §7.3 `dayPlan.taskReordered`）；子任务换绑母任务（→ `subtask.reparented`）。

---

#### subtask.reparented（P3）

**顶层关联字段**：`taskId`（被移动的子任务）。

**payload**：`{ fromParentId, toParentId }`

两个字段均不允许为 null。升级为顶层任务（目标无父任务）用 `subtask.unparented`，不用本事件。

**说明**：子任务从一个母任务换绑到另一个母任务时触发。Phase 3 实现，因为跨母任务移动是低频操作，Phase 2 不要求 UI 支持。

**典型触发**：用户拖拽子任务，将其从母任务 A 移至母任务 B 的子任务列表。

**不应触发**：升级为顶层任务（→ `subtask.unparented`）；顶层任务层级变化（→ §7.4）；子任务在同母任务内重排（→ `subtask.reordered`）。

---

#### subtask.unparented（P2）

**顶层关联字段**：`taskId`（被升级的子任务）。

**payload**：`{ previousParentId }`

**说明**：子任务脱离母任务、升级为独立顶层任务时触发。操作完成后该 Task 的 `parentId` 变为 null。

**典型触发**：用户在子任务操作菜单选择"升级为独立任务"；用户拖拽子任务脱离母任务列表。

**不应触发**：换绑到另一个母任务（→ `subtask.reparented`）；顶层任务被设置到某个母任务下（→ §7.4 `task.reparented`）。

---

### 7.3 DayPlan（今日计划）

本节定义 DayPlan 生命周期与今日计划操作相关事件。

**Domain 级说明**：今日待办任务的移入 / 移出操作同时影响 DayPlan 和 Task 两侧——`dayPlan.taskAdded` / `dayPlan.taskRemoved` 记录 DayPlan 侧视角，`task.movedToToday` / `task.movedToList`（见 §7.4）记录 Task 侧视角，两者共享 `correlationId`。今日列表内重排只写 `dayPlan.taskReordered`，不写 `task.reordered`（见 §3.2 关键规则第 9 条）。昨日未完成任务不自动带入今日、不发起"是否带入今天"的提示流程，`dayPlan.*` 域不定义 carriedOver 类事件（见 §3.2 关键规则第 8 条）。

---

#### dayPlan.created（P1 最小初始化场景 / 其余 P2）

**顶层关联字段**：`dayPlanId`。

**payload**：`{ appDate, localDate, budgetMode }`（`appDate` 为该 DayPlan 所属产品日，即业务键，见 §3.2；`localDate` 为创建时事实自然日辅助值；`appDayStartOffsetMinutes = 0` 时二者一致）

**Phase 边界**：本事件分两类触发场景，Phase 归属不同：
- **P1（最小初始化闭环，真实写入）**：用户首次进入应用 / 首次读取当前产品日今日待办时，系统发现当前 `appDate` 尚无有效 DayPlan 而自动创建当天 DayPlan——此场景 Phase 1 即真实写入本事件。此举是数据地基的最小闭环（v4 已取消 `bucket`，今日待办必须由 `DayPlan.taskIds` 派生，见 §3.1 关键规则 3、§3.2 关键规则 1），**不等同于**提前实现完整 P2 DayPlan 管理能力（见 §10.2）。
- **P2（完整 DayPlan 创建 / 计划页行为）**：经完整计划页、预算编辑流程等产生的 DayPlan 创建仍按 P2。

**说明**：用户当前产品日（`appDate`，见 §2.5）首次创建 DayPlan 时触发。每个产品日最多一条有效 DayPlan（见 §3.2 字段一致性约束第 1 条）。如当天同时触发每日模板自动生成任务，本事件与同次初始化的 `task.created`、`dayPlan.taskAdded`（以及若本次确实创建了 Settings，则还含 `settings.initialized`）共享同一 `correlationId`。

**典型触发**：用户首次进入应用 / 首次读取当天今日待办，系统发现今日 DayPlan 尚未创建，自动建立（P1 最小初始化）；用户打开当日计划页触发完整创建流程（P2）。

**不应触发**：修改当天 DayPlan 字段（→ `dayPlan.updated` 或各专属事件）；跨日查看历史 DayPlan。

---

#### dayPlan.updated（P2）

**顶层关联字段**：`dayPlanId`。

**payload**：`{ field, oldValue, newValue }`

`field` 为 §3.2 DayPlan 字段名，用于有专属事件未覆盖的一般性字段更新。预算相关变更优先使用专属事件（见下方）。

**说明**：DayPlan 某个一般性字段内容变更时触发，作为兜底记录。

**典型触发**：修改 `estimate.workWindowMin`（可用时段）后尚未触发完整预算重新估算流程。

**不应触发**：任何有专属事件覆盖的操作（预算估算 → `dayPlan.budgetEstimated`；预算确认 → `dayPlan.budgetAccepted`；扣除项增删改 → `dayPlan.deductionAdded` / `deductionUpdated` / `deductionRemoved`；任务加入/移出/重排 → `dayPlan.taskAdded` / `taskRemoved` / `taskReordered`）。

---

#### dayPlan.budgetEstimated（P2）

**顶层关联字段**：`dayPlanId`。

**payload**：`{ budgetMode, conservativePomodoros, optimisticPomodoros, workWindowMin }`

**说明**：系统根据当天可用时段和 `settingsSnapshot` 完成番茄预算估算、将结果展示给用户时触发。用户尚未确认，`DayPlan.budgetPomodoros` 此时仍为初始值。

**典型触发**：用户填写完今日可用时段和扣除项后，系统即时计算并展示保守 / 乐观估算数。

**不应触发**：用户确认预算（→ `dayPlan.budgetAccepted`）；手动切换模式（→ `dayPlan.budgetModeChanged`）。

---

#### dayPlan.budgetAccepted（P2）

**顶层关联字段**：`dayPlanId`。

**payload**：`{ budgetPomodoros, budgetMode }`

**说明**：用户确认当天最终番茄预算时触发。`budgetMode='conservative'` 或 `'optimistic'` 时，用户从系统估算结果中确认；`budgetMode='manual'` 时，用户直接输入自定义数值并确认。覆盖所有模式下的预算确认，无需分设独立的"手动设置"事件。

**典型触发**：用户在计划页点击"确认今日预算"；用户在 manual 模式直接输入番茄数并确认。

**不应触发**：系统展示估算（→ `dayPlan.budgetEstimated`）；切换预算模式（→ `dayPlan.budgetModeChanged`）。

---

#### dayPlan.budgetModeChanged（P3）

**顶层关联字段**：`dayPlanId`。

**payload**：`{ oldMode, newMode }`

`oldMode` / `newMode` 取值：`'conservative'` | `'optimistic'` | `'manual'`。

**说明**：用户在预算模式之间切换时触发。Phase 3 实现，用于分析用户对不同估算模式的偏好。

**典型触发**：用户在预算页将模式从"保守"切换为"手动"。

**不应触发**：用户确认预算数值（→ `dayPlan.budgetAccepted`）；DayPlan 初次创建时写入默认 budgetMode（→ `dayPlan.created`）。

---

#### dayPlan.deductionAdded（P2）

**顶层关联字段**：`dayPlanId`。

**payload**：`{ deductionType, deductionId, label, hours }`

`deductionType` 取值：`'fixed'`（固定日程）| `'life'`（生活时间）。`deductionId` 为该扣除项数组元素的 `id`（UUID v7，见 §3.2 扣除项结构），作为后续修改 / 删除的稳定定位键。

**说明**：用户在当天计划中新增一条扣除项时触发，对应 `estimate.fixedDeductions` 或 `estimate.lifeDeductions` 数组追加元素。

**典型触发**：用户在计划页新增"站会 0.5 小时"；新增"午餐 1 小时"。

**不应触发**：修改已有扣除项（→ `dayPlan.deductionUpdated`）；删除扣除项（→ `dayPlan.deductionRemoved`）。

---

#### dayPlan.deductionUpdated（P2）

**顶层关联字段**：`dayPlanId`。

**payload**：`{ deductionType, deductionId, label, oldHours, newHours }`

**说明**：用户修改已有扣除项的时长时触发。`deductionId`（被改扣除项的 `id`，UUID v7）为稳定定位键；`label` 仅作可读信息，不用于定位（见 §3.2 扣除项结构）。

**典型触发**：用户将"午餐"从 1 小时改为 0.5 小时。

**不应触发**：新增扣除项（→ `dayPlan.deductionAdded`）；删除扣除项（→ `dayPlan.deductionRemoved`）。

---

#### dayPlan.deductionRemoved（P2）

**顶层关联字段**：`dayPlanId`。

**payload**：`{ deductionType, deductionId, label, hours }`

**说明**：用户从当天计划中删除一条扣除项时触发。`deductionId`（被删扣除项的 `id`，UUID v7）为稳定定位键；`label` 仅作可读信息，不用于定位（见 §3.2 扣除项结构）。

**典型触发**：用户删除今天不需要的"通勤"扣除项。

**不应触发**：修改扣除项（→ `dayPlan.deductionUpdated`）；新增（→ `dayPlan.deductionAdded`）。

---

#### dayPlan.taskAdded（P1 每日模板初始化场景 / 其余 P2）

**顶层关联字段**：`dayPlanId`、`taskId`；`source='unresolvedIntervalClassification'` 时同步填写 `unresolvedIntervalId`。

**payload**：`{ addedAtIndex, source }`

`source` 取值：

| 值 | 含义 |
|---|---|
| `'drag'` | 用户从活动清单拖拽至今日 |
| `'button'` | 用户点击"加入今日"按钮 |
| `'systemDailyTemplate'` | 每日模板自动生成并加入今日 |
| `'unresolvedIntervalClassification'` | 归类 UnresolvedInterval 时快捷创建并加入今日 |

**Phase 边界**：
- **P1（最小初始化闭环，真实写入）**：`source='systemDailyTemplate'`——即 DayPlan 最小初始化时，由 `dailyTaskTemplates` 中 `autoAddToDayPlan=true` 的模板自动生成当天 Task 并加入 `DayPlan.taskIds` 的场景，Phase 1 即真实写入本事件。
- **P2（完整今日待办管理）**：用户手动加入今日（`source='drag'` / `'button'`）、归类 UnresolvedInterval 快捷加入、复杂重排、计划页管理等仍按 P2。

**说明**：任务被加入当天 `DayPlan.taskIds` 时触发（DayPlan 侧视角）。用户主动移入时，与 §7.4 `task.movedToToday` 共享 `correlationId`；模板自动生成时，与同次初始化的 `task.created`、`dayPlan.created`（及可能的 `settings.initialized`）共享同一 `correlationId`。

**典型触发**：每日模板在 DayPlan 最小初始化时自动填入「计划准备」任务（P1）；用户将活动清单任务拖入今日列表（P2）。

**不应触发**：修改今日任务顺序（→ `dayPlan.taskReordered`）；任务从今日移出（→ `dayPlan.taskRemoved`）。

---

#### dayPlan.taskRemoved（P2）

**顶层关联字段**：`dayPlanId`、`taskId`。

**payload**：`{ reason }`

`reason` 取值：`'userRemoved'`（用户手动移出今日）| `'taskDeleted'`（任务被软删除）| `'taskArchived'`（任务被归档）。

**说明**：任务从当天 `DayPlan.taskIds` 中移除时触发（DayPlan 侧视角）。`reason='userRemoved'` 时与 §7.4 `task.movedToList` 共享 `correlationId`；不修改 Task 任何字段（见 §3.2 关键规则第 4 条）。

**典型触发**：用户将今日任务拖回活动清单；任务被软删除，系统自动将其从 DayPlan 移除。

**不应触发**：任务在今日列表内重排（→ `dayPlan.taskReordered`）；任务完成（任务完成不自动移出 DayPlan）。

---

#### dayPlan.taskReordered（P2）

**顶层关联字段**：`dayPlanId`、`taskId`。

**payload**：`{ fromIndex, toIndex }`

**说明**：用户在今日待办列表内拖拽调整任务顺序时触发，同步更新 `DayPlan.taskIds` 数组。不触发 `task.reordered`（今日列表排序由 DayPlan 管理，不修改 `Task.sortIndex`，见 §3.2 关键规则第 9 条）。

**典型触发**：用户在今日列表中将某任务上移至第一位。

**不应触发**：活动清单内任务排序（→ §7.4 `task.reordered`）；今日任务移入 / 移出（→ `dayPlan.taskAdded` / `taskRemoved`）。

---

#### dayPlan.workEnded（P2）

**顶层关联字段**：`dayPlanId`；若存在 `endedAfterFocusSessionId`，可同步将顶层 `sessionId` 设为该 focus Session id（依 §3.4 第 5 条，一个 Event 允许填写多个顶层关联字段），否则 `sessionId` 为 null；`taskId` 如能从该 focus Session 推导可选填写，不强制。

**payload**：`{ appDate, localDate, endedAfterFocusSessionId, reason }`

| 字段 | 类型 | 含义 |
|---|---|---|
| `appDate` | `string` | 本次收工所属**产品日**，按 `Settings.appDayStartOffsetMinutes` 与 `timezone` 派生（见 §2.5、§3.2）；格式 `YYYY-MM-DD` |
| `localDate` | `string` | 收工事件发生时的事实自然日，与 Event.localDate 一致；`appDayStartOffsetMinutes = 0` 时与 `appDate` 一致；格式 `YYYY-MM-DD` |
| `endedAfterFocusSessionId` | `string \| null` | 若用户在某个 completed 标准 focus 后立即收工，指向该 focus Session id（须 `type='focus'` 且 `status='completed'`）；若从今日页面主动点击收工、无明确对应 focus，则为 null |
| `reason` | `string` | 收工原因；当前仅枚举 `'userEndedWork'`，不允许自由文本 |

**说明**：用户在产品中明确结束当前产品日的番茄工作流程 / 停止当日番茄流程时触发。本事件是"收工锚点"，用于让最后一个 completed 标准 focus 后未进入 break 的情况从休息缺失统计中**豁免**（见 §8.6.4 收工豁免）。收工豁免**不是**跳过休息，也不写成 `break.skipped`，不写 `skipKind`；它表示"本次标准 break 机会被收工豁免、应休息机会不存在"。本事件必须由明确用户入口或明确恢复流程选择产生，**不得**由系统自动写入。

**典型触发**：用户点击"今天收工"；点击"停止今日番茄流程"；在 focus 完成后的收尾流程中选择"结束工作 / 不再继续"；其他等价的明确产品入口。

**不应触发**：仅仅关闭页面；仅仅窗口失焦；仅仅长时间无鼠标 / 键盘操作；仅仅没有开始下一轮 break；仅仅没有开始下一轮 focus——这些情况属于 §8.4.2 流程连续性判定或 §7.11 恢复 / 未响应流程，不属于收工豁免，不得据此自动写入本事件。

---

### 7.4 Task 排序与层级

本节定义活动清单内排序、任务层级变化（顶层任务成为子任务）、以及活动清单与今日待办之间移动的事件。所有事件使用 `task.` 前缀。

**Domain 级说明**：
- 子任务特有的层级变化（已有子任务换绑母任务 → §7.2 `subtask.reparented`；子任务升级为顶层 → §7.2 `subtask.unparented`）在 §7.2 定义，不在本节重复。
- 今日列表内重排 → §7.3 `dayPlan.taskReordered`，不在本节定义。
- `task.positionChanged`（v3 已废弃）不在 v4 使用，不允许恢复（见 §6.4 禁止混用规则第 5 条）。

---

#### task.reordered（P2）

**顶层关联字段**：`taskId`。

**payload**：`{ fromIndex, toIndex }`

**说明**：用户在活动清单内拖拽调整任务排列顺序时触发，同步更新 `Task.sortIndex`。仅适用于活动清单内的排序；今日列表内排序见 §7.3 `dayPlan.taskReordered`。

**典型触发**：用户在活动清单将某任务拖至更高或更低位置。

**不应触发**：今日待办列表内重排（→ `dayPlan.taskReordered`）；子任务在同一母任务下重排（→ `subtask.reordered`）；任务跨列表移动（→ `task.movedToToday` / `task.movedToList`）。

---

#### task.reparented（P2）

**顶层关联字段**：`taskId`。

**payload**：`{ fromParentId, toParentId, toIndex }`

`fromParentId` 在本事件中固定为 null（本事件专指顶层任务成为子任务；已有子任务换绑另一母任务见 §7.2 `subtask.reparented`）。`toParentId` 必须指向一个顶层任务（`parentId=null` 的 Task），以满足层级 2 层上限（见 §3.1 字段一致性约束第 5 条）。`toIndex` 为任务插入新母任务子任务列表中的下标（0 起始）。

**说明**：一个原本无父任务的顶层任务被设置了父任务，成为子任务时触发。涵盖"向右缩进"等 UI 操作的语义结果。

**典型触发**：用户将一个顶层任务拖入另一个任务的子任务区域；用户通过键盘快捷键将任务缩进为子任务。

**不应触发**：已有子任务换绑母任务（→ §7.2 `subtask.reparented`）；子任务升级为顶层（→ §7.2 `subtask.unparented`）；任务在同一层级内重排（→ `task.reordered`）。

---

#### task.movedToToday（P2）

**顶层关联字段**：`taskId`、`dayPlanId`。

**payload**：`{ appDate, addedAtIndex }`

`appDate` 为移入目标产品日，即该 DayPlan 的业务键（§3.2）；目标 DayPlan 亦可由顶层 `dayPlanId` 定位。`addedAtIndex` 为任务在目标 `DayPlan.taskIds` 中的插入位置。

**说明**：用户将活动清单中的已有任务移入今日待办时触发（Task 侧视角）。本事件与 `dayPlan.taskAdded`（source=`'drag'` 或 `'button'`）共享 `correlationId`。仅适用于用户手动移入；每日模板自动生成任务的场景不触发本事件（见下方"不应触发"）。

**典型触发**：用户从活动清单拖拽任务至今日列表；用户点击任务旁的"加入今日"按钮。

**不应触发**：每日模板自动生成并加入今日（→ `task.created` source=`'systemDailyTemplate'` + `dayPlan.taskAdded`，不触发本事件）；归类 UnresolvedInterval 快捷创建并加入今日（→ `task.created` source=`'unresolvedIntervalClassification'` + `dayPlan.taskAdded`，不触发本事件）；任务完成不触发本事件。

---

#### task.movedToList（P2）

**顶层关联字段**：`taskId`、`dayPlanId`。

**payload**：`{ fromAppDate }`

`fromAppDate` 为移出来源产品日，即该 DayPlan 的业务键（§3.2）；来源 DayPlan 亦可由顶层 `dayPlanId` 定位。移出操作保留 `from` 前缀以表达"来源"语义，故用 `fromAppDate` 而非裸 `appDate`。

**说明**：用户将今日待办中的任务移回活动清单时触发（Task 侧视角），不修改 Task 任何字段（见 §3.2 关键规则第 4 条）。本事件与 `dayPlan.taskRemoved`（reason=`'userRemoved'`）共享 `correlationId`。

**典型触发**：用户将今日任务拖回活动清单；用户点击"移出今日"按钮。

**不应触发**：任务被软删除（→ `task.deleted` + `dayPlan.taskRemoved` reason=`'taskDeleted'`，不触发本事件）；任务归档（→ `task.archived` + `dayPlan.taskRemoved` reason=`'taskArchived'`，不触发本事件）；任务完成（任务完成不自动移出今日）。

---

### 7.5 Focus Session（专注会话）

本节定义标准专注会话（Session.type=`'focus'`）生命周期相关事件。

**Domain 级说明**：
- `focus.*` 事件只描述标准专注计时行为（开始 / 完成 / 作废）。
- 打扰行为见 §7.8（interrupt 域）。
- extraFocus Session 由用户对 UnresolvedInterval 执行归类操作产生，不通过 `focus.*` 事件触发，相关事件见 §7.11（interval 域）。
- v4 不支持暂停 / 恢复功能。focus Session 的合法状态仅为 `'active'` / `'completed'` / `'discarded'`；历史 v3 的 `focus.paused` / `focus.resumed` 不迁移。用户在专注中遇到打扰但继续专注时，由 §7.8 interrupt 事件记录；若因此放弃本次番茄，则结束为 `focus.discarded`。
- v3 的 `focus.earlyEnded` 在 v4 中不定义。v4 只区分正常完成（响铃）与作废（中途停止）；提前停止的会话统一归入 `focus.discarded`，不计入有效番茄。

---

#### focus.started（P1）

**顶层关联字段**：`taskId`、`sessionId`（本次专注的 Session id）；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ pomodoroIndex, plannedDuration, taskEstimateAtStart }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `pomodoroIndex` | `number` | 该 Task 下本次专注的发生序号（从 1 起递增），与 Session.pomodoroIndex 一致；discarded 历史 session 占用序号不回收（见 §3.3） |
| `plannedDuration` | `number` | 计划时长（秒），与 Session.plannedDuration 一致，取 `Settings.focusMinutes × 60` |
| `taskEstimateAtStart` | `number` | 本次专注开始时 Task.estimatedPomodoros 的快照；用于事后分析"第几个番茄时完成了任务、预估是否准确" |

**说明**：用户选定任务并启动计时，新 Session（type=`'focus'`，status=`'active'`）写入存储时触发。`pomodoroIndex` 在 Session 写入时确定，discarded 历史 session 占用的序号不回收。

**典型触发**：用户在计时页选定任务后点击开始，倒计时启动。

**不应触发**：休息计时开始（→ §7.6 `break.started`）；仅浏览计时页未点击开始；App 重新打开后检测到已有进行中的 focus Session（Session 已存在，不重复触发本事件）；UnresolvedInterval 归类产生 extraFocus（→ §7.11）。

---

#### focus.completed（P2）

**顶层关联字段**：`taskId`、`sessionId`；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ pomodoroIndex, plannedDuration, actualDuration }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `pomodoroIndex` | `number` | 该 Task 下本次专注的序号，与 Session.pomodoroIndex 一致 |
| `plannedDuration` | `number` | 计划时长（秒），与 Session.plannedDuration 一致 |
| `actualDuration` | `number` | 实际专注时长（秒），正常完成时约等于 plannedDuration；与 Session.actualDuration 一致 |

**说明**：专注倒计时归零、响铃，Session status 变更为 `'completed'`，`endedAt` 写入时触发。本事件代表一个有效专注单元完成，计入有效番茄统计（统计口径见 §8）。完成后系统进入休息引导流程，休息相关事件见 §7.6。

**典型触发**：25 分钟倒计时结束，响铃，Session 正常收尾。

**不应触发**：用户中途主动停止（→ `focus.discarded`）；休息计时完成（→ §7.6 `break.completed`）；App 关闭导致 Session 未正常收尾（→ 产生 UnresolvedInterval，见 §7.11）；用户手动勾选任务完成（→ §7.1 `task.completed`，两者无直接触发关系）。

---

#### focus.discarded（P2）

**顶层关联字段**：`taskId`、`sessionId`；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ pomodoroIndex, actualDuration, reason, triggeredByInterruptEventId }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `pomodoroIndex` | `number` | 与 Session.pomodoroIndex 一致；作废 session 仍占用此序号，不回收（见 §3.3） |
| `actualDuration` | `number` | 实际已经过时长（秒），与 Session.actualDuration 一致 |
| `reason` | `string \| null` | 作废归因字段；枚举值：`'userInitiated'`（用户在计时页主动点击作废） / `'userConfirmedAfterRecovery'`（用户在恢复处理流程中确认该 focus 番茄作废，见 §7.11）；取值约束：必须取自此两值之一，或为 null |
| `triggeredByInterruptEventId` | `string \| null` | （可选）本次 focus 作废**主要由哪一条 interrupt 事件触发**的因果关联；可空，默认 `null`；仅当用户在放弃确认流程中**明确确认**"本次放弃主要由某条 interrupt 触发"时，写入该 interrupt Event 的 id；用户未确认 / 跳过 / 不确定，或本次作废与打扰无明确因果关系时写 `null`；**不得**仅凭时间接近自动推断"最近一次 interrupt 导致作废"；取值约束：`null`，或同一 focus session（顶层 `sessionId` 相同）内已写入的 `interrupt.internal` / `interrupt.external` Event 的 UUID v7 id |

**说明**：用户主动作废当前正在进行的标准番茄，Session status 变更为 `'discarded'`，`endedAt` 写入时触发。作废的 focus Session 不计入有效番茄（见 §8），`pomodoroIndex` 占用不回收（见 §3.3）。App 意外关闭、崩溃、页面关闭、系统睡眠、计时状态丢失等异常中断，不在本节定性为 `focus.discarded`，应交由 §7.11 interval / UnresolvedInterval 恢复与归类流程统一处理。

**关于 `triggeredByInterruptEventId`（因果关联，不新增强制交互）**：本字段只记录"作废与某条打扰的因果关联"，是事件 payload 中的**可选关联字段，不在 Session 实体上新增字段**。它不改变作废流程，不在专注过程中追问用户，不打断工作流；UI 仅可在用户**已主动决定放弃 focus** 的确认流程中提供一个可选、可跳过的轻量确认入口（用户跳过即写 `null`）。所引用的 interrupt Event 必须是同一 focus session（`sessionId` 相同）内已写入的 `interrupt.internal` / `interrupt.external`（见 §7.8）。记录打扰与触发作废之间仍无强制因果约束（见 §7.8）——本字段只在用户主动指认时承载因果，系统不得自动关联。Phase 1 只要求数据结构可承载，不要求完整 UI 落地。

**典型触发**：用户在计时页主动点击"放弃此番茄"（reason=`'userInitiated'`）；用户在恢复处理流程中主动确认"这次番茄作废"（reason=`'userConfirmedAfterRecovery'`，见 §7.11 `interval.sessionResolved`）。

**不应触发**：正常完成（→ `focus.completed`）；App 意外关闭、崩溃、页面关闭、系统睡眠等本身不自动触发本事件（→ 产生 UnresolvedInterval，见 §7.11；只有用户在恢复流程中主动确认"作废"后，方可触发 reason=`'userConfirmedAfterRecovery'`）；用户只是记录打扰但之后继续完成本次专注（→ §7.8 interrupt，不触发本事件）；extraFocus 的状态变更（extraFocus 不通过 `focus.*` 事件触发，见 §7.11）。

---

### 7.6 Break Session（休息会话）

本节定义标准休息会话（Session.type ∈ {`'shortBreak'`, `'longBreak'`}）生命周期相关事件。

**Domain 级说明**：
- `break.*` 事件只描述 shortBreak 和 longBreak 两种标准休息的计时流程（开始 / 完成 / 跳过）。
- 休息建议项的展示与选择过程（restSuggestionShown / Shuffled / restSelected 等）见 §7.7（restItem 域）。
- extraRest Session 由用户对 UnresolvedInterval 执行归类操作产生，不通过 `break.*` 事件触发，相关事件见 §7.11（interval 域）。
- v3 的 `break.ended`（通用结束，含提前结束）在 v4 中不定义。v4 只区分完成（`break.completed`）与跳过（`break.skipped`）；用户提前结束休息归入 `break.skipped`（skipKind=`'explicitSkip'`）。
- v3 的 `extraRest.confirmed` 移至 §7.11（interval 域），不在本节定义。

---

#### break.started（P2）

**顶层关联字段**：`sessionId`（本次休息的 Session id）；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ breakType, plannedDuration, sourceFocusSessionId }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `breakType` | `string` | 休息类型，与 Session.type 一致；取值约束：`'shortBreak'` 或 `'longBreak'` |
| `plannedDuration` | `number` | 计划时长（秒），与 Session.plannedDuration 一致；shortBreak 取 `Settings.shortBreakMinutes × 60`，longBreak 取 `Settings.longBreakMinutes × 60` |
| `sourceFocusSessionId` | `string` | 触发本次休息的上一段 focus Session 的 id，与 Session.sourceFocusSessionId 一致；便于直接追溯"哪个番茄完成后触发了此次休息" |

**说明**：focus Session 正常完成后系统触发休息流程，新 Session（type=`'shortBreak'` 或 `'longBreak'`，status=`'active'`）写入存储时触发。longBreak 在每完成 `Settings.longBreakEvery` 个有效标准 focus 后触发（判断口径见 §8）。

**典型触发**：第一个番茄正常结束后，系统自动启动 5 分钟短休；完成第四个番茄后，系统自动启动 15 分钟长休。

**不应触发**：专注计时开始（→ §7.5 `focus.started`）；extraRest 归类（→ §7.11）；用户仅浏览休息页面但尚未实际开始计时；`sourceFocusSessionId` 所指的前置 Session 不是 type=`'focus'` 且 status=`'completed'` 的标准 focus——即 discarded focus、extraFocus、UnresolvedInterval 归类产生的 extraFocus 等均不触发标准 break.started；标准 shortBreak / longBreak 只来自标准 focus 的正常完成。

---

#### break.completed（P2）

**顶层关联字段**：`sessionId`；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ breakType, plannedDuration, actualDuration, actualRest }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `breakType` | `string` | 休息类型；取值约束：`'shortBreak'` 或 `'longBreak'` |
| `plannedDuration` | `number` | 计划时长（秒），与 Session.plannedDuration 一致 |
| `actualDuration` | `number` | 实际休息时长（秒），与 Session.actualDuration 一致；正常完成时约等于 plannedDuration |
| `actualRest` | `string \| null` | 用户最终实际选择 / 执行的休息活动 key，与 Session.actualRest 一致；不存展示文案；null 表示用户未选择任何休息建议项；休息建议项的展示、洗牌、候选列表与用户选择过程由 §7.7 restItem 域记录，不塞入本事件 payload |

**说明**：休息倒计时归零，Session status 变更为 `'completed'`，`endedAt` 写入时触发。本事件代表一次标准休息正常完成，可作为完整番茄循环统计的必要条件之一；完整循环的最终统计口径见 §8。若 shortBreak / longBreak 已开始计时后，因 App 关闭、崩溃、页面关闭、系统睡眠、计时器状态丢失或用户长时间未响应而进入 §7.11 恢复流程，且用户在恢复流程中确认该 break 实际已完成，本事件也可同步触发；此时应同时触发 `interval.sessionResolved`（resolvedAs=`'completed'`），两条事件共享 `correlationId`。active break 异常断裂且用户在恢复流程中确认 skipped 时，不触发本事件，也不触发 `break.skipped`，仅触发 `interval.sessionResolved`（resolvedAs=`'skipped'`），见 §7.11。

**典型触发**：5 分钟短休倒计时结束；15 分钟长休正常结束；active break 因 App 关闭等原因进入恢复流程，用户确认"该休息实际已完成"时（同时触发 `interval.sessionResolved`，共享 `correlationId`）。

**不应触发**：用户跳过或中途退出休息（→ `break.skipped`）；专注计时完成（→ §7.5 `focus.completed`）；extraRest 完成（extraRest status 固定为 `'completed'`，但不触发 `break.*` 事件，见 §7.11）；active break 异常断裂且用户在恢复流程中确认 skipped（→ `interval.sessionResolved`，resolvedAs=`'skipped'`，不触发本事件）。

---

#### break.skipped（P2）

**顶层关联字段**：`sessionId`；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ breakType, skipKind, plannedDuration }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `breakType` | `string` | 休息类型；取值约束：`'shortBreak'` 或 `'longBreak'` |
| `skipKind` | `string` | 跳过原因，与 Session.skipKind 一致；取值约束：必须为 `'explicitSkip'` / `'noResponse'` / `'appClosed'` / `'missed'` 之一（枚举含义见 §3.3）；注：`'appClosed'` 仅用于休息计时尚未真正开始、因 App 关闭 / 崩溃导致休息流程未进入的情形；若休息已经开始计时（status=`'active'`）后发生时间线断裂，不在本事件中写入，见说明 |
| `plannedDuration` | `number` | 原计划时长（秒），与 Session.plannedDuration 一致；跳过时 actualDuration 固定为 0，不放入 payload |

**说明**：休息未完成，Session status 变更为 `'skipped'`，`skipKind` 与 `endedAt` 写入，`actualDuration` 写入为 0 时触发。跳过的休息计入休息跳过率统计，不计入完整番茄循环（统计口径见 §8）。本事件主要覆盖"标准休息流程层面的跳过 / 未进入 / 错过"场景。若 shortBreak / longBreak 已经开始计时（status=`'active'`），但因 App 关闭、崩溃、页面关闭、系统睡眠、计时器状态丢失等原因导致 active break 没有正常收尾，不在本节直接定性为 `break.skipped`；应交由 §7.11 interval / UnresolvedInterval 恢复与归类流程统一处理。

**典型触发**：用户点击"跳过休息"按钮（skipKind=`'explicitSkip'`）；休息提示 / 弹窗出现但用户未响应，休息计时尚未真正开始（skipKind=`'noResponse'`）；其他未进入或错过标准休息流程的情形（skipKind=`'missed'`）。

**不应触发**：休息正常完成（→ `break.completed`）；专注计时中途作废（→ §7.5 `focus.discarded`）；用户记录打扰后继续专注（→ §7.8 interrupt；休息尚未开始，不触发本事件）；shortBreak / longBreak 已开始计时后因 App 关闭、崩溃、页面关闭、系统睡眠、计时器状态丢失等原因导致时间线断裂（→ §7.11 UnresolvedInterval 统一处理）。

---

### 7.7 Rest Item（休息建议项）

本节定义两类行为的事件：

- **A 类：单次休息中的建议项选择过程**（break session 期间）：系统展示候选项、用户洗牌、用户确认选择、用户中途更换选择。
- **B 类：Settings 级别的休息建议项增删改操作**（对 `Settings.restSuggestions` 元素的管理）。

**顶层关联字段约定**：A 类事件必须填写 `sessionId`（对应该次 break Session）和 `settingsId`；B 类事件只填写 `settingsId`，`sessionId` 存 null。

**Domain 级说明**：

- `restItem` 域的实体基础是 `Settings.restSuggestions` 数组元素（字段定义见 §3.7）。
- A 类事件只在标准 shortBreak / longBreak session 期间触发；extraRest 期间不触发（extraRest 由 §7.11 处理）。
- 内置项（`isBuiltIn=true`）不允许物理删除，只允许 `restItem.disabled`（见 §3.7 关键规则 5e）。
- 自定义项（`isBuiltIn=false`）若已被历史 Session 的 `suggestedRest` 或 `actualRest` 引用，同样只能 disabled，不能 deleted（见 §3.7 关键规则 5e）。
- `restItem.updated` 只允许修改 `label`、`icon`、`sortIndex`；`key` 和 `appliesTo` 写入后不可更改（见 §3.7 关键规则 5b）。
- 本节不规定每次展示几个候选项等 UI / Settings 策略；事件结构只保证能支撑"多个候选项 + 展示顺序 + 最终选择"的后续分析。

**Domain 级反例**（适用于本节所有事件）：

- Settings 页面仅打开查看休息项列表，不写入任何本节事件。
- extraRest 期间的任何选择操作，不触发本节 A 类事件（→ §7.11）。

---

#### restItem.shown（P3）

**顶层关联字段**：`sessionId`、`settingsId`。

**payload**：`{ breakType, shownKeys, eligibleCount }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `breakType` | `string` | 本次休息类型；取值约束：`'shortBreak'` 或 `'longBreak'` |
| `shownKeys` | `string[]` | 本次实际展示给用户的休息建议项 key 列表；数组顺序即 UI 展示顺序（如从左到右 / 从上到下）；只存 key，不存文案（文案可能变化，key 是稳定标识）；取值约束：（1）非空数组；（2）每个 key 必须存在于 Settings.restSuggestions；（3）每个 key 必须满足 `isEnabled=true` 且 `appliesTo` 包含当前 `breakType`（不允许展示已禁用项或类型不符的项）；（4）`shownKeys.length ≤ eligibleCount` |
| `eligibleCount` | `number` | 本次展示前，符合当前 break 类型（`isEnabled=true` 且 `appliesTo` 包含对应类型）的候选池总数；取值约束：整数，≥ 0；必须满足 `eligibleCount ≥ shownKeys.length` |

**说明**：标准 break Session 进行期间，系统向用户展示休息建议候选列表时触发。`shownKeys` 记录本次展示快照及顺序，供未来分析"展示位置对用户选择的影响"。用户洗牌后系统展示新列表时再次触发本事件，与对应 `restItem.shuffled` 共享 `correlationId`。

**典型触发**：短休倒计时开始，休息建议区首次出现；用户点击"换一组"后，新候选列表出现（此时与 `restItem.shuffled` 共享 `correlationId`）。

**不应触发**：Settings 页面查看休息建议列表；break Session 结束后；extraRest 期间（→ §7.11）。

---

#### restItem.shuffled（P3）

**顶层关联字段**：`sessionId`、`settingsId`。

**payload**：`{ breakType, shuffleCount }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `breakType` | `string` | 取值约束：`'shortBreak'` 或 `'longBreak'` |
| `shuffleCount` | `number` | 本次 break session 中用户已触发洗牌的累计次数（含本次）；取值约束：整数，≥ 1 |

**说明**：用户在 break Session 期间点击"换一个 / 换一组"触发洗牌时触发。本事件只记录用户发起了洗牌动作；系统展示新候选列表由随后触发的 `restItem.shown` 记录，两条事件共享 `correlationId`。

**典型触发**：用户在短休界面点击"再换一个"，当前候选列表刷新为新的一组。

**不应触发**：break Session 首次展示候选项（→ 只触发 `restItem.shown`，用户尚未主动发起洗牌）；Settings 页面操作休息项；break 已结束。

---

#### restItem.selected（P3）

**顶层关联字段**：`sessionId`、`settingsId`。

**payload**：`{ breakType, selectedKey, selectedIndex, sourceShownEventId }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `breakType` | `string` | 取值约束：`'shortBreak'` 或 `'longBreak'` |
| `selectedKey` | `string` | 用户最终确认的休息建议项 key；应同步写入对应 break Session 的 `actualRest` 及 `break.completed.actualRest` payload，三者保持一致；取值约束：非空字符串，必须存在于 Settings.restSuggestions |
| `selectedIndex` | `number` | `selectedKey` 在本次 `restItem.shown.shownKeys` 中的下标（0 起始）；若所选 key 不在最后一次展示的 `shownKeys` 中，存 -1；取值约束：整数，≥ -1 |
| `sourceShownEventId` | `string \| null` | 本次选择所基于的 `restItem.shown` 事件 id；实现阶段如无法稳定关联可写 null，字段须预留；取值约束：null 或合法的 Event UUID v7 |

**说明**：用户在 break Session 期间**首次**从候选列表中确认选定某个休息建议项时触发。每次 break session 中本事件只触发一次；后续改选触发 `restItem.selectionChanged`，不再触发本事件。`selectedKey` 应同步写入 Session.actualRest 和 `break.completed.actualRest`，三者数据口径保持一致。

**典型触发**：用户在短休界面首次点击"深呼吸"并确认选择；长休期间首次点击"散步"作为本次长休活动。

**不应触发**：用户查看候选项但未点击选择；已有选择后再次更换（→ `restItem.selectionChanged`）；break 已结束；Settings 页面操作（→ B 类事件）。

---

#### restItem.selectionChanged（P3）

**顶层关联字段**：`sessionId`、`settingsId`。

**payload**：`{ breakType, previousKey, newKey, newIndex, sourceShownEventId }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `breakType` | `string` | 取值约束：`'shortBreak'` 或 `'longBreak'` |
| `previousKey` | `string` | 用户更换前的休息项 key（上一次已确认的选择）；不允许为 null（本事件只在已有选择后更换时触发）；取值约束：非空字符串，必须存在于 Settings.restSuggestions |
| `newKey` | `string` | 用户本次更换后选择的 key；应同步更新 Session.actualRest；取值约束：非空字符串，必须存在于 Settings.restSuggestions |
| `newIndex` | `number` | `newKey` 在本次 `restItem.shown.shownKeys` 中的下标（0 起始）；若所选 key 不在最后一次展示的 `shownKeys` 中，存 -1；取值约束：整数，≥ -1 |
| `sourceShownEventId` | `string \| null` | 本次改选所基于的 `restItem.shown` 事件 id；实现阶段如无法稳定关联可写 null，字段须预留；取值约束：null 或合法的 Event UUID v7 |

**说明**：用户在 break Session 期间已经确认选择某个休息项后，又更换为另一个休息项时触发。每次更换均写一条本事件，`previousKey` 指向更换前的选择，`newKey` 指向更换后的选择。`newKey` 应同步更新 Session.actualRest；break 结束时 `break.completed.actualRest` 记录最终选择。

**典型触发**：用户短休时首次选了"远眺"（触发 `restItem.selected`），后改选"绕肩"（触发本事件，`previousKey='short_gaze_distance'`，`newKey='short_shoulder_rolls'`）；同一 break 内再改选"深呼吸"，再触发一条本事件。

**不应触发**：用户首次确认选择（→ `restItem.selected`）；用户只是查看候选项但没有选择；break 已结束；Settings 级别操作（→ B 类事件）。

---

#### restItem.created（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ key, label, appliesTo, sortIndex }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `string` | 新休息项的 key，由数据层按 `'<scope>_custom_' + UUID v7` 规则生成（见 §3.7 关键规则 5c）；取值约束：格式为 `'short_custom_<UUIDv7>'` 或 `'long_custom_<UUIDv7>'`，非空 |
| `label` | `string` | 用户输入的休息项名称；取值约束：非空字符串 |
| `appliesTo` | `array` | 由显式传入的 `targetBreakType` 决定（见 §3.7 关键规则 5d），不允许推断；取值约束：`['shortBreak']` 或 `['longBreak']` |
| `sortIndex` | `number` | 新项在对应类型分组内的初始排序索引；取值约束：整数，≥ 0 |

**说明**：用户在 Settings 中新增一条自定义休息建议项（`isBuiltIn=false`）时触发。`key` 由数据层统一生成，前端不得手写（见 §3.7 关键规则 5d）。

**典型触发**：用户在短休设置页点击"新增"，输入名称"原地跳绳"并确认。

**不应触发**：系统初始化写入内置休息项（内置项初始化不触发本事件）；编辑已有休息项（→ `restItem.updated`）；启用已禁用项（→ `restItem.enabled`）。

---

#### restItem.updated（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ key, changedFields }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `string` | 被修改的休息建议项 key；本字段本身不可更改；取值约束：必须存在于 Settings.restSuggestions |
| `changedFields` | `object` | 实际发生变更的字段及新值；只记录有变化的字段（`label` / `icon` / `sortIndex`），未变字段不写入；取值约束：对象非空，各字段新值须满足 §3.7 对应约束 |

**说明**：用户修改已有休息建议项的 `label`、`icon` 或 `sortIndex` 时触发。`key` 与 `appliesTo` 写入后不可更改，本事件不处理这两个字段的变更。内置项与自定义项均可触发本事件。

**典型触发**：用户将长休项"散步"改名为"不看屏幕的散步"；用户给休息项添加 emoji 图标。

**不应触发**：修改 `isEnabled`（→ `restItem.disabled` / `restItem.enabled`）；修改 `key` 或 `appliesTo`（不允许修改）；新增（→ `restItem.created`）；删除（→ `restItem.deleted`）；用户手动拖拽调整休息项顺序（→ `restItem.reordered`）。

---

#### restItem.disabled（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ key }`

**说明**：用户将某个休息建议项的 `isEnabled` 从 `true` 改为 `false` 时触发。禁用后该项不再出现在新的推荐 / 选择列表中，但历史 Session 引用的 `key` 仍可解释（见 §3.7 关键规则 5）。内置项不允许物理删除，禁用是唯一停用方式；满足历史引用条件的自定义项同样只能禁用（见 §3.7 关键规则 5e）。

**典型触发**：用户在设置中关闭某个不喜欢的内置休息项；用户禁用某条自定义项。

**不应触发**：启用（→ `restItem.enabled`）；满足无引用条件的自定义项物理删除（→ `restItem.deleted`）。

---

#### restItem.enabled（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ key }`

**说明**：用户将某个休息建议项的 `isEnabled` 从 `false` 改回 `true` 时触发。该项将重新出现在新的推荐 / 选择列表中。

**典型触发**：用户重新启用之前关闭的"伸懒腰"。

**不应触发**：禁用（→ `restItem.disabled`）；新增（→ `restItem.created`）。

---

#### restItem.deleted（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ key, label }`

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `string` | 被删除的休息建议项 key；取值约束：必须存在于 Settings.restSuggestions，且满足可删除条件 |
| `label` | `string` | 删除时的名称，供审计使用；取值约束：非空字符串 |

**说明**：用户物理移除一条自定义休息建议项（`isBuiltIn=false`）时触发。触发前数据层必须验证：该 key 从未出现在任何历史 Session 的 `suggestedRest` 或 `actualRest` 中（见 §3.7 关键规则 5e）。不满足此条件的写入应被拒绝；实现端应提示用户"该项已被使用，只能禁用"并触发 `restItem.disabled`，不触发本事件。内置项不允许触发本事件。

**典型触发**：用户删除一个刚刚新增、从未在任何 break session 中使用过的自定义短休项。

**不应触发**：内置项（→ 只允许 `restItem.disabled`）；已被历史 Session 引用的自定义项（→ `restItem.disabled`）；禁用而非删除（→ `restItem.disabled`）。

---

#### restItem.reordered（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ breakType, orderedKeys }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `breakType` | `string` | 否 | 无 | 被重排的休息类型分组；取值约束：`'shortBreak'` 或 `'longBreak'`；短休与长休的 `sortIndex` 互不影响，各自独立触发本事件 |
| `orderedKeys` | `string[]` | 否 | 无 | 调整后该分组内所有已启用休息项按新 `sortIndex` 顺序排列的 `key` 数组；取值约束：非空数组，每个 key 必须存在于 Settings.restSuggestions 且 `appliesTo` 包含本次 `breakType` |

**说明**：用户在设置页手动拖拽调整某一休息类型分组内的显示顺序时，相关项的 `sortIndex` 更新写入 Settings 时触发。一次拖拽操作只触发一个事件，不为每个 sortIndex 变化分别触发。实现端根据 `orderedKeys` 数组重新分配各项的 `sortIndex` 值（如以步长 1000 重新赋值），具体赋值策略由实现端决定。

**典型触发**：用户在设置页短休建议列表中拖拽调整"伸懒腰"和"深呼吸"的排列顺序，松手后 sortIndex 写入存储时触发（breakType=`'shortBreak'`）。

**不应触发**：系统按历史使用频次动态展示休息项目（`restSuggestionDisplayMode='usageFrequency'`）时不修改 `sortIndex`，不触发本事件；用户切换 `restSuggestionDisplayMode`（→ `settings.restSuggestionDisplayModeUpdated`，不触发本事件）；修改休息项的 `label` 或 `icon`（→ `restItem.updated`）；新增或删除休息项（→ `restItem.created` / `restItem.deleted`）；仅查看设置页未实际调整顺序。

---

### 7.8 Interrupt（专注中打扰）

本节定义专注会话（Session.type=`'focus'`）进行期间发生的打扰行为事件。

**Domain 级说明**：

- 打扰事件只在 focus Session status=`'active'` 期间触发。break session 期间、focus 结束后、focus 尚未开始时，均不触发本节事件。
- 打扰次数**不存在 Session 字段上**（见 §3.3 关键规则第 8 条）；打扰次数通过查询对应 `sessionId` 的 interrupt 事件数量派生。
- 记录打扰不代表本次番茄作废。用户记录打扰后可继续专注；若打扰导致用户决定放弃本次番茄，随后触发 `focus.discarded`（见 §7.5）。记录打扰事件与触发 `focus.discarded` 无强制因果约束——用户可能只记录打扰但继续完成番茄，也可能记录打扰后随即作废，由用户操作决定。若用户在放弃确认流程中明确指认"本次作废主要由某条 interrupt 触发"，该因果由 `focus.discarded.payload.triggeredByInterruptEventId`（引用同一 focus session 内的 interrupt Event id，见 §7.5）记录；这不改变"记录打扰 ≠ 自动作废"原则，系统**不得**仅凭时间接近自动关联。
**Domain 级反例**（适用于本节所有事件）：

- break session 期间发生任何打扰，不触发本节事件。
- focus 尚未启动（用户仅选定任务但未点击开始计时），不触发本节事件。
- 用户直接点击作废番茄但未记录打扰，不触发本节事件（仅触发 `focus.discarded`）。

---

#### interrupt.internal（P2）

**顶层关联字段**：`sessionId`（正在进行的 focus Session id）、`taskId`（关联任务）；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ offsetSeconds, note }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `offsetSeconds` | `number` | 否 | 无 | 打扰发生时距本次专注 `startedAt` 的已过秒数；用于分析打扰在番茄中的发生位置（如"集中在前 5 分钟"）；取值约束：整数，≥ 0 |
| `note` | `string \| null` | 是 | `null` | 用户对本次打扰的自由文字记录，如"突然想到要回邮件"、"情绪低落想刷手机"；取值约束：无特殊约束，可为 null |

**说明**：用户在专注期间主动记录一次内部打扰时触发，内部打扰指来自自身的分心、情绪波动、冲动等——用户自主判断本次打扰来源是"内部"。本事件记录打扰行为本身，不代表本次番茄作废。打扰次数通过查询与该 `sessionId` 关联的 interrupt 事件数量派生，不存在 Session 字段上（见 §3.3 关键规则第 8 条）。

**典型触发**：专注进行中用户走神想刷手机，在 App 中点击"记录打扰"并选择"内部"类型（可选填写备注）；用户情绪波动难以集中，主动记录一次内部打扰。

**不应触发**：break session 期间（→ 不触发，打扰事件只在 focus 进行中触发）；被外界他人或环境打断（→ `interrupt.external`）；用户直接作废番茄且未记录打扰（→ `focus.discarded`，不附带本事件）；focus 正常完成后追溯（→ 不触发）；focus 尚未开始（→ 不触发）。

---

#### interrupt.external（P2）

**顶层关联字段**：`sessionId`（正在进行的 focus Session id）、`taskId`（关联任务）；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ offsetSeconds, note }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `offsetSeconds` | `number` | 否 | 无 | 打扰发生时距本次专注 `startedAt` 的已过秒数；取值约束：整数，≥ 0 |
| `note` | `string \| null` | 是 | `null` | 用户对本次外部打扰的自由文字记录，如"电话来了"、"同事过来询问"；取值约束：无特殊约束，可为 null |

**说明**：用户在专注期间主动记录一次外部打扰时触发，外部打扰指来自外界环境的打断，如电话、他人打扰、环境噪音等。事件结构与 `interrupt.internal` 完全相同，区别仅在于打扰来源的主观分类（用户自主判断本次是"来自外部"），由事件类型本身区分，payload 无需额外字段。

**典型触发**：专注途中接到电话，电话结束后在 App 中记录"外部打扰"并可选填写备注；同事走过来询问问题被打断，事后在 App 中记录一次外部打扰。

**不应触发**：break session 期间（→ 不触发）；来自自身的分心或情绪波动（→ `interrupt.internal`）；用户直接作废番茄且未记录打扰（→ `focus.discarded`，不附带本事件）；focus 已完成后追溯（→ 不触发）；focus 尚未开始（→ 不触发）。

---

### 7.9 Energy（能量记录）

本节定义能量状态记录相关事件。

**Domain 级说明**：

- §7.9 只定义一个事件：`energy.recorded`。用 payload 中的 `source` 字段区分记录来源，枚举与 §3.5 EnergyRecord.source 保持一致。
- 当前产品流程不提供用户主动编辑或删除能量记录的入口，§7.9 不定义 `energy.updated` / `energy.deleted` 事件。EnergyRecord 作为可同步实体仍保留 `deletedAt` 软删除字段（见 §2.4），这是跨端同步、数据修复、tombstone 留存的基础设施；但当前产品层面不暴露删除 / 编辑入口，因此对应事件暂不定义。如未来做"我的历史 / 能量记录管理"页面并允许用户删除明显误填的记录，再补充 `energy.deleted`；如允许修改能量分值，再补充 `energy.updated`。
- `recoveryDelta` 不存在 EnergyRecord 字段上，也不出现在 `energy.recorded` payload 中；恢复量统计在展示时动态派生（详见 §3.5 及 §8.7）。

---

#### energy.recorded（P2）

**顶层关联字段**：`energyRecordId`（必填，指向本次新创建的 EnergyRecord）；`sessionId`（按 §3.5 字段一致性约束第 5 / 5a / 6 条规则填写；`source ∈ {'dayStart', 'beforeFocus', 'onReturn', 'manual'}` 时为 null）；`taskId`（如与某个 focus / extraFocus 任务上下文有关且可从上下文稳定确定，则填写，否则为 null）；`dayPlanId`（如写入时可从上下文稳定确定对应 DayPlan，则填写，否则为 null）。

**payload**：`{ source, energyLevel, mood, note }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `source` | `string`（枚举） | 否 | 无 | 本次记录的触发来源；与 §3.5 EnergyRecord.source 枚举完全一致；取值约束：必须取自 §3.5 source 枚举之一（`dayStart` / `beforeFocus` / `afterFocus` / `afterShortBreak` / `afterLongBreak` / `afterExtraFocus` / `afterExtraRest` / `onReturn` / `manual`） |
| `energyLevel` | `number` | 否 | 无 | 用户记录的当前能量状态；与 EnergyRecord.energyLevel 一致；取值约束：整数，1 ≤ energyLevel ≤ 10 |
| `mood` | `number \| null` | 是 | `null` | 用户记录的情绪状态；Phase 1 暂缓采集，写 null；schema 中预留字段，与 EnergyRecord.mood 一致；取值约束：null 或整数，1 ≤ mood ≤ 10 |
| `note` | `string \| null` | 是 | `null` | 用户对本次能量与状态的文字备注；创建时一次性写入，不定义独立的增删改事件；取值约束：无特殊约束，可为 null |

**说明**：用户提交一次能量状态记录时触发，同步写入 EnergyRecord 实体。`source` 区分记录来源，`sessionId` 随 source 类型按 §3.5 字段一致性约束填写：`source ∈ {'afterFocus', 'afterShortBreak', 'afterLongBreak', 'afterExtraFocus', 'afterExtraRest'}` 时 `sessionId` 必须非 null 并指向对应 Session；`source ∈ {'dayStart', 'beforeFocus', 'onReturn', 'manual'}` 时 `sessionId` 为 null。`source` 各值的触发场景如下表：

| source 值 | 触发场景 |
|---|---|
| `'dayStart'` | 用户当天第一次进入工作流时系统提示打卡；不依附 Session |
| `'beforeFocus'` | 当天首次开始 focus 前，或距上一条可用能量记录已超过一个长休时长后重新开始 focus 前（具体提示策略可在 UI / Settings 规则中细化）；`onReturn` 后立即开始 focus 时不重复触发本 source（onReturn 记录可作为前置状态） |
| `'afterFocus'` | focus 倒计时结束后用户提交 |
| `'afterShortBreak'` | shortBreak 结束后用户提交 |
| `'afterLongBreak'` | longBreak 结束后用户提交 |
| `'afterExtraFocus'` | extraFocus 归类完成后用户提交 |
| `'afterExtraRest'` | extraRest 归类完成后用户提交 |
| `'onReturn'` | App 重新打开、页面恢复、用户长时间无响应后回来时系统提示记录；`onReturn` 后立即开始 focus 时不再另行触发 `beforeFocus` |
| `'manual'` | 用户主动打开记录面板手动提交；不依附 Session |

**典型触发**：用户当天第一次打开工具，系统弹出能量打卡提示，用户填写后确认（source=`'dayStart'`）；当天第一个番茄开始前系统提示填写当前状态（source=`'beforeFocus'`）；番茄计时结束后弹出状态记录提示，用户填写 energyLevel=3（source=`'afterFocus'`）；用户中途离开后重新打开 App，系统提示记录当前状态（source=`'onReturn'`）；用户主动点击"记录当前状态"（source=`'manual'`）。

**不应触发**：系统在用户未操作时自动写入（能量记录必须由用户主动提交，见 §3.5 关键规则第 1 条）；session 结束提示弹出但用户直接跳过（→ 不触发，不产生 EnergyRecord）；`onReturn` 后立即开始 focus（→ 不额外触发 source=`'beforeFocus'`，onReturn 记录已可作为前置状态）；刚完成 shortBreak / longBreak 并已记录对应 `afterShortBreak` / `afterLongBreak`，用户马上开始下一个 focus（→ 不重复触发 `beforeFocus`，上一条休息后记录已足够作为前置状态）。

---

### 7.10 Triage（待分流事项）

本节定义"专注中快速捕获计划外事项 → 待分流 → 事后处理"的完整流程事件。

**Domain 级说明**：

- **不是优先级标记**。Triage 不表示"某任务比其他任务更紧急"；它表示"有一个计划外事项被捕获，尚待用户决定如何处置（今天做 / 以后做 / 放弃）"。待分流清单是纯派生视图：`status='active'` 且 `metadata.triageStatus='pending'`（见 §3.2 关键规则）；待分流事项不混入活动清单，须经 `triage.movedToToday` / `triage.movedToList` / `triage.dismissed` 处理后才流入对应视图。
- `triage.captured` 当前只在标准 focus Session status=`'active'` 期间，由计时页的计划外事项快速捕获入口触发。入口当前固定为计时页，payload 不需要 `captureSource` 字段；如未来开放多个捕获入口（全局快捷输入、今日列表等），再另行补充。
- **与 §7.8 Interrupt 的区别**：`interrupt.*` 记录"一次打扰发生了"（统计次数与发生时刻），不创建新实体；`triage.captured` 记录"一个计划外事项被捕获为 Task 并放入待分流清单"，会同时触发 Task 实体创建（与 `task.created` 共享 `correlationId`）。两者可同时发生，也可只发生其中一个，无强制绑定关系。

**Domain 级反例**（适用于本节所有事件）：

- 对非待分流的普通任务进行标题、备注、排序等字段编辑，不触发本节事件。
- 用户只是记录打扰但不捕获具体事项（→ §7.8 interrupt，不触发本节事件）。

---

#### triage.captured（P2）

**顶层关联字段**：`taskId`（新创建的待分流 Task）；`sessionId`（触发捕获时正在进行的 focus Session id）；若对应 `Session.dayPlanId` 非 null，则同步填写 `dayPlanId`。

**payload**：`{ title }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `title` | `string` | 否 | 无 | 用户快速输入的计划外事项标题；同步写入新建 Task.title；取值约束：非空字符串，最大长度 200 字符（与 §3.1 Task.title 约束一致） |

**说明**：用户在标准 focus Session active 期间，通过计时页快速捕获入口记录一个计划外事项时触发。系统同时创建一条新 Task（`metadata.triageStatus='pending'`，`status='active'`，`estimatedPomodoros` 取默认值 1），本事件与对应 `task.created`（source=`'triageCapture'`）共享 `correlationId`。捕获后用户继续专注，等当前番茄结束后再在待分流清单中集中处理。

**典型触发**：番茄计时进行中用户突然想到"要给某人回消息"，通过计时页快速捕获入口输入标题并确认；计时页计划外事项区快速记下"采购食材"。

**不应触发**：focus 未在 active 状态时（→ 不触发）；在活动清单 / 今日列表 / 其他页面新建普通任务（→ `task.created` source=`'manual'`，不触发本事件）；记录打扰但不捕获具体事项（→ §7.8 interrupt，不触发本事件）。

---

#### triage.movedToToday（P2）

**顶层关联字段**：`taskId`（被处理的待分流 Task）；`dayPlanId`（目标 DayPlan）。

**payload**：`{ addedAtIndex }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `addedAtIndex` | `number` | 否 | 无 | Task 加入当天 DayPlan.taskIds 后的位置下标（0 起始）；取值约束：整数，≥ 0 |

**说明**：用户在待分流清单中判断"这件事今天要做"，将该 Task 从待分流清单移入今日待办时触发。系统同时将 `metadata.triageStatus` 置为 null，并将 taskId 加入当天 `DayPlan.taskIds`。本事件与 `dayPlan.taskAdded`（source=`'button'`）共享 `correlationId`。

**典型触发**：番茄结束后用户打开待分流清单，判断"给某人回消息"今天要处理，点击"加入今日"。

**不应触发**：用户将普通活动清单任务加入今日（→ §7.4 `task.movedToToday` + `dayPlan.taskAdded`，不触发本事件）；待分流事项移入活动清单（→ `triage.movedToList`）；放弃待分流事项（→ `triage.dismissed`）。

---

#### triage.movedToList（P2）

**顶层关联字段**：`taskId`（被处理的待分流 Task）。

**payload**：`{}`

**说明**：用户在待分流清单中判断"这件事要做，但不急着今天做"，将该 Task 从待分流清单移入活动清单时触发。系统将 `metadata.triageStatus` 置为 null；taskId 不加入当天 `DayPlan.taskIds`，Task 自然出现在活动清单视图（见 §3.2 关键规则第 2 条）。

**典型触发**：番茄结束后用户打开待分流清单，判断"采购食材"本周内做即可，点击"移入清单"。

**不应触发**：待分流事项加入今日（→ `triage.movedToToday`）；普通今日任务移回清单（→ §7.3 `dayPlan.taskRemoved` + §7.4 `task.movedToList`，不触发本事件）；放弃待分流事项（→ `triage.dismissed`）。

---

#### triage.dismissed（P2）

**顶层关联字段**：`taskId`（被放弃的待分流 Task）。

**payload**：`{ dismissReason }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `dismissReason` | `string \| null` | 是 | `null` | 用户对放弃原因的可选自由文字说明，如"只是临时干扰"、"已通过口头沟通解决"；取值约束：无特殊约束，可为 null |

**说明**：用户在待分流清单中判断"这件事不需要保留"，点击"放弃 / 不保留 / 删除"时触发。系统固定执行软删除该 Task（`status='deleted'`，`deletedAt` 写入当前时间），同时触发 `task.deleted`，两条事件共享 `correlationId`。`metadata.triageStatus` 可同步清空为 null，或在软删除记录中保留原值作为历史状态；但读取视图因 `status='deleted'` / `deletedAt != null` 不再展示该 Task。不允许"只清除 `triageStatus` 但保留 Task 本体"作为本事件的结果——若用户想保留事项但以后再做，应使用 `triage.movedToList`；若今天做，应使用 `triage.movedToToday`。

**典型触发**：番茄结束后用户查看待分流清单，发现"给某人回消息"已通过口头解决，点击"放弃"关闭该事项。

**不应触发**：待分流事项加入今日（→ `triage.movedToToday`）；待分流事项移入活动清单（→ `triage.movedToList`）；普通任务软删除（→ `task.deleted`，不触发本事件）。

---

### 7.11 UnresolvedInterval（未归类时段恢复与归类）

本节定义 `interval.*` 域事件，用于记录 UnresolvedInterval 实体（§3.6）从检测、原 session 收尾到时间归类的完整处理流程。

**Domain 级说明**：

`interval.*` 事件处理的场景是：App 关闭 / 崩溃 / 浏览器休眠 / 系统睡眠 / 计时器状态丢失 / 产品流程等待用户回应超时，导致系统在一段时间内无法可靠判断用户状态，形成 UnresolvedInterval 实体（§3.6）。

本节将恢复处理分为**两层**：

**第一层——原 active session 收尾**：若断裂发生时存在 active 的标准 session（focus、shortBreak 或 longBreak），用户需在恢复处理 UI 中确认其最终状态：

- 原 focus → 确认 completed，或确认 discarded（discarded 时同步触发 `focus.discarded`，reason=`'userConfirmedAfterRecovery'`）；
- 原 break → 确认 completed（同步触发 `break.completed`），或确认 skipped（仅触发 `interval.sessionResolved`，不触发 `break.skipped`，以区分恢复收尾与标准跳过语义）。

**第二层——断裂后剩余未知时间归类**：断裂发生到用户返回之间，可能存在用户实际专注或休息的时间，需要用户主动归类：

- 归为 extraFocus → 创建 type=`'extraFocus'` 的 Session（`originIntervalId` 指向本 UnresolvedInterval），触发 `interval.classified`；
- 归为 extraRest → 创建 type=`'extraRest'` 的 Session（`originIntervalId` 指向本 UnresolvedInterval），触发 `interval.classified`；
- 选择忽略 → 不创建 Session，触发 `interval.ignored`；
- 支持拆分归类 → 同一 UnresolvedInterval 可由用户拆分为多段分别归类（如前 20 分钟归为 extraFocus，后 10 分钟归为 extraRest）。每段各触发一个 `interval.classified` 事件，各 Session 共享 `originIntervalId`，所有来自同一恢复操作的事件共享 `correlationId`。

**Phase 说明**：本节所有事件均为 P2。Phase 1 仅要求 UnresolvedInterval 数据模型与事件类型结构可承载，不要求自动检测逻辑落地，不要求接入恢复处理 UI 或完整事件流。

注：虽然 `interval.detected` 是系统自动写入事件（无需用户直接操作），但其背后需要 App 重启后扫描 active session、判断未正常闭合、创建 UnresolvedInterval 的完整恢复检测逻辑，属于恢复流程接入范畴，Phase 2 落地。

**额外专注后的标准休息衔接**：

用户在恢复流程中将部分时间归类为 extraFocus 后，若之前的标准 focus 已被确认为 completed，该标准 focus 对应的标准 shortBreak / longBreak 仍可由用户继续开始（即"补休息"）。此时 `break.started` 的 `sourceFocusSessionId` 仍指向该 completed 标准 focus，而非 extraFocus Session。该标准 focus + 标准 break 完成后仍可计入完整番茄循环（统计口径见 §8，补休息衔接以 §8.4.2 流程连续性判定为准）。

extraFocus 本身不触发标准 break。标准 break 只由 completed 标准 focus 触发（见 §7.6 `break.started` 约束）。

**Domain 级反例（通用）**：

以下情况不属于 `interval.*` 域的处理范畴，不触发 `interval.*` 事件：

- 标准 focus / break 正常开始、完成（→ `focus.*` / `break.*`）；
- 用户在计时页主动点击"放弃此番茄"（→ `focus.discarded`，reason=`'userInitiated'`，不经恢复流程）；
- 用户主动跳过休息（→ `break.skipped`）；
- 待分流事项处理（→ `triage.*`）；
- 用户未使用本工具计时器，事后声称某段时间在专注或休息——本产品只记录依照本工具番茄流程进行的实践，不支持事后手动补录 Session；此类声明不触发 `interval.*` 事件，不创建 UnresolvedInterval，不生成任何 focus / extraFocus / extraRest / shortBreak / longBreak Session；若用户需要调整累计番茄展示基数，应通过 `lifetimePomodoroBaseline` / statsBaseline 相关流程处理，不进入番茄工作流。

---

#### interval.detected（P2）

**顶层关联字段**：`unresolvedIntervalId`；若断裂时存在 active session，则同步填写 `sessionId`；若该 session 关联 task，则填写 `taskId`；若该 session 关联 dayPlan（`Session.dayPlanId` 非 null），则填写 `dayPlanId`。

**payload**：`{ source, detectedSessionType }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `source` | `string` | 否 | 无 | UnresolvedInterval 产生来源；与 `UnresolvedInterval.source` 字段一致；取值约束：必须取自 §3.6 source 枚举（`'appReopened'` / `'systemRecovered'` / `'timerStateLost'` / `'userNoResponse'`） |
| `detectedSessionType` | `string \| null` | 是 | `null` | 断裂时 active session 的类型；无 active session 时为 null；取值约束：`'focus'` / `'shortBreak'` / `'longBreak'` 或 null |

**说明**：App 重启 / 浏览器恢复 / 系统唤醒 / 产品流程超时时，系统扫描到存在未正常闭合的时间段，创建 UnresolvedInterval 实体并持久化时触发。本事件由系统自动写入，无需用户主动操作；写入时机为 UnresolvedInterval 实体首次写入存储时。

**典型触发**：App 重新打开，发现上次关闭时存在一个 status=`'active'` 的 focus Session 没有正常结束；系统创建 UnresolvedInterval 记录（source=`'appReopened'`）并写入存储时触发。

**不应触发**：App 正常关闭且用户已在关闭前完成所有 session；标准 session 正常完成或作废；App 重新打开但未发现未闭合 session（无需创建 UnresolvedInterval）；同一 UnresolvedInterval 上的后续归类操作（→ `interval.sessionResolved` / `interval.classified` / `interval.ignored`）。

---

#### interval.sessionResolved（P2）

**顶层关联字段**：`unresolvedIntervalId`、`sessionId`（被收尾的原 active session 的 id）；若该 session 关联 task，则填写 `taskId`；若该 session 关联 dayPlan，则填写 `dayPlanId`。

**payload**：`{ sessionType, resolvedAs }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `sessionType` | `string` | 否 | 无 | 被收尾 session 的类型；取值约束：`'focus'` / `'shortBreak'` / `'longBreak'` |
| `resolvedAs` | `string` | 否 | 无 | 用户在恢复流程中对原 session 的最终判定；取值约束：`'completed'` / `'discarded'` / `'skipped'` |

**resolvedAs 枚举语义**：

| 值 | 适用 sessionType | 含义 | 同时触发的其他事件 |
|---|---|---|---|
| `'completed'` | `'focus'` / `'shortBreak'` / `'longBreak'` | 用户确认原 session 已完成 | 同步触发 `focus.completed` 或 `break.completed`，共享 `correlationId` |
| `'discarded'` | `'focus'` 仅限 | 用户确认该 focus 番茄作废 | 同步触发 `focus.discarded`（reason=`'userConfirmedAfterRecovery'`），共享 `correlationId` |
| `'skipped'` | `'shortBreak'` / `'longBreak'` 仅限 | 用户确认该休息未实际进行，直接收尾跳过 | 仅触发本事件，**不触发 `break.skipped`** |

**说明**：用户在恢复处理 UI 中确认原 active session 的最终状态时触发。本事件是 interval 域 Layer 1 的核心事件，为"通过恢复流程收尾原 session"提供 interval 域层面的审计记录。当 resolvedAs=`'completed'` 或 `'discarded'` 时，对应的标准 session 关闭事件（`focus.completed` / `focus.discarded` / `break.completed`）同时触发，与本事件共享 `correlationId`，表示同一次恢复操作。

`resolvedAs='skipped'` 时不触发 `break.skipped`：`break.skipped` 的语义是"用户在休息流程开始前主动跳过或超时未响应"；本事件的语义是"已开始计时的 break 因异常中断、事后在恢复流程中被确认为未实际进行"——两者产生时序和操作语境均不同，不应混用。

**break skipped 时的 Session 字段一致性**：当 `sessionType ∈ {'shortBreak','longBreak'}` 且 `resolvedAs='skipped'` 时，原 break Session 本体同时更新为：`status='skipped'`、`endedAt=恢复处理确认时刻`、`actualDuration=0`、`skipKind='missed'`（使用现有枚举中语义最接近"错过后事后收尾"的值；见 §3.3 skipKind 枚举）。`skipKind` 写入是为满足 §3.3 Session 字段一致性约束，恢复流程的审计语义以本 `interval.sessionResolved` 事件为准，不由 `break.skipped` 表达。

同一次恢复操作中，若第一层（`interval.sessionResolved`）与第二层（`interval.classified` / `interval.ignored`）均触发，所有事件共享 `correlationId`。

**典型触发**：恢复处理 UI 显示"你上次关闭 App 时有一个番茄正在进行，请确认它的状态"，用户选择"这次番茄完成了"（resolvedAs=`'completed'`）或"这次番茄没用了，放弃"（resolvedAs=`'discarded'`）时触发。

**不应触发**：用户在计时页主动点击"放弃此番茄"（→ `focus.discarded`，reason=`'userInitiated'`，不经恢复流程）；用户在标准流程中主动跳过休息（→ `break.skipped`）；UnresolvedInterval 本身没有关联 active session（无原 session 需要收尾，直接进入 Layer 2 归类）。

---

#### interval.classified（P2）

**顶层关联字段**：`unresolvedIntervalId` 必填；`sessionId` 填写本次归类后新建的 extraFocus / extraRest Session id；当 `classificationType='extraFocus'` 时，`taskId` 必填，且必须与新建 extraFocus Session 的 `taskId` 一致（见 §3.3 字段一致性约束第 6 条）；当 `classificationType='extraRest'` 时，`taskId` 固定为 null（extraRest 不归属于某个 Task，见 §3.3 字段一致性约束第 8 条）；若可关联到对应 DayPlan，则填写 `dayPlanId`。

**payload**：`{ classificationType }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `classificationType` | `string` | 否 | 无 | 归类方向；取值约束：`'extraFocus'` / `'extraRest'` |

**说明**：用户在恢复处理 UI 中将一段未知时间归类为额外专注或额外休息，确认后触发。此时系统：（1）创建 type=`'extraFocus'` 或 `'extraRest'` 的 Session（`originIntervalId` 指向本 UnresolvedInterval）；（2）在所有分段归类完成后，将 UnresolvedInterval.status 更新为 `'classified'`，填写 `classifiedAt`。`classificationType='extraFocus'` 时，不允许生成无 `taskId` 的 extraFocus Session；若用户没有合适的既有 Task，须在归类流程中先选择或快捷创建一个 Task，再确认归类（快捷创建路径见下方**关联事件**）。

**拆分归类**：同一 UnresolvedInterval 可由用户拆分为多段分别归类（如前 20 分钟归为 extraFocus，后 10 分钟归为 extraRest）。每段归类各触发一个 `interval.classified` 事件，顶层 `sessionId` 各不相同（每段对应各自的 Session），顶层 `unresolvedIntervalId` 相同。所有来自同一恢复操作的事件（含 Layer 1 事件）共享 `correlationId`。所有产生的 Session 均通过 `originIntervalId` 指向同一 UnresolvedInterval（见 §3.6 关键规则）。

**关联事件**：若 extraFocus 归类时用户快捷新建 Task，则同时触发 `task.created`（source=`'unresolvedIntervalClassification'`），共享 `correlationId`，Event 顶层同步填写 `unresolvedIntervalId`（见 §7.1）。若 extraRest 归类时用户快捷新建休息项，则触发 §7.7 相关 restItem 事件，共享 `correlationId`。

**典型触发**：恢复处理 UI 显示"你在这段时间里做了什么？"，用户选择"继续专注了这个任务"并确认，extraFocus Session 写入存储时触发。

**不应触发**：忽略未归类时段（→ `interval.ignored`）；extraFocus Session 通过非 UnresolvedInterval 归类方式创建（extraFocus 仅由本流程产生，无其他入口）；拆分时每一段均独立触发本事件，不合并为单一事件。

---

#### interval.ignored（P2）

**顶层关联字段**：`unresolvedIntervalId`。

**payload**：`{ ignoreReason }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `ignoreReason` | `string \| null` | 是 | `null` | 用户对忽略原因的可选自由文字说明；与 `UnresolvedInterval.ignoreReason` 字段一致；取值约束：无特殊约束，可为 null |

**说明**：用户在恢复处理 UI 中选择"这段时间不计入统计 / 忽略"时触发。此时系统将 UnresolvedInterval.status 更新为 `'ignored'`，填写 `ignoredAt`，不创建任何 extraFocus / extraRest Session。UnresolvedInterval 实体本身保留作为完整审计记录，不软删除（见 §3.6 关键规则）。

本事件只描述时间段的处置方式（"这段时间不统计"）。原 active session 的收尾由 `interval.sessionResolved` 单独负责，两者若属同一次恢复操作，共享 `correlationId`。示例：用户确认 focus 作废（→ `focus.discarded` + `interval.sessionResolved`，resolvedAs=`'discarded'`），并同时选择忽略剩余时段（→ `interval.ignored`），三条事件共享 `correlationId`。

**典型触发**：恢复处理 UI 显示"你在这段时间里做了什么？"，用户选择"这段时间不用记录"并确认。

**不应触发**：归类为 extraFocus / extraRest（→ `interval.classified`）；原 session 的收尾（→ `interval.sessionResolved` 配合 `focus.discarded` 等）；已处于 `'ignored'` 或 `'classified'` 状态的 UnresolvedInterval 重复触发。

---

### 7.12 Settings（用户偏好设置）

本节定义 `settings.*` 域事件，用于记录 Settings 实体（§3.7）的初始化与用户修改操作。

**Domain 级说明**：

- `settings.*` 事件只描述 Settings 实体本身的生命周期（初始化、计时参数修改、每日模板管理、休息建议项展示模式切换）。
- `restSuggestions` 休息建议项的新增、重命名、禁用、启用、手动拖拽排序，可在设置页或计时页触发，但无论入口如何，事件均归 §7.7 `restItem.*`；§7.12 不重复定义相关事件。设置页可作为休息建议项的主要管理入口；计时页可作为快速新增入口。
- `restSuggestionDisplayMode` 字段变更（用户切换"固定顺序 / 使用频次"展示策略）记录为 §7.12 `settings.restSuggestionDisplayModeUpdated`，不归 §7.7；切换展示模式本身不修改 `restSuggestions.sortIndex`，不触发 `restItem.reordered`。
- `lifetimePomodoroBaseline` 的调整不触发 `settings.*` 事件，应触发 §7.13 `statsBaseline.*` 事件；该字段只影响累计番茄计数起点，不生成 Session，不伪造历史番茄记录，不进入 UnresolvedInterval / Session 工作流。
- `appDayStartOffsetMinutes`（产品日开始偏移，§3.7）的修改记录为 §7.12 `settings.appDayStartOffsetUpdated`，**不**归入 `settings.timerUpdated`（它是整个产品的全局日边界设置，不是计时时长参数）；Phase 1 固定默认 `0`、UI 不开放修改，P2+ 开放设置入口后修改才触发该事件。
- Phase 说明：`settings.initialized` 为 P1；其余 Settings 修改类事件均为 P2。Phase 1 只要求默认 Settings 初始化及 `settings.initialized`，不要求完整设置页管理事件全部接入。

---

#### settings.initialized（P1）

**顶层关联字段**：`settingsId`（本次初始化写入的 Settings 记录 id）。

**payload**：`{ focusMinutes, shortBreakMinutes, longBreakMinutes, longBreakEvery, restSuggestionsCount, dailyTaskTemplatesCount }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `focusMinutes` | `number` | 否 | `25` | 初始化时写入的 focus 默认时长（分钟）；与 §3.7 默认值一致 |
| `shortBreakMinutes` | `number` | 否 | `5` | 初始化时写入的短休默认时长（分钟） |
| `longBreakMinutes` | `number` | 否 | `15` | 初始化时写入的长休默认时长（分钟） |
| `longBreakEvery` | `number` | 否 | `4` | 初始化时写入的长休触发间隔（个有效标准 focus） |
| `restSuggestionsCount` | `number` | 否 | `28` | 初始化时写入的休息建议项总数（短休 15 + 长休 13）；完整内容以 Settings 本体为准，不放入 payload |
| `dailyTaskTemplatesCount` | `number` | 否 | `1` | 初始化时写入的每日模板总数（默认"计划准备"1 条）；完整内容以 Settings 本体为准，不放入 payload |

**说明**：首次启动 App 且数据库中不存在任何 Settings 记录时，系统创建一条默认 Settings 并写入存储，此时触发。本事件在产品生命周期内只触发一次；已存在 Settings 时重新打开 App 不触发。若 Settings 因数据异常（如 bug、意外清除）丢失后被重建，不应默默重写本事件——数据异常重建属于数据修复场景，应走 §7.14 `data.*` 或 §7.17 `error.*` 相关流程。

**典型触发**：用户第一次安装并打开产品，系统在数据库中未找到任何 Settings 记录，自动写入默认配置时触发。

**不应触发**：已存在 Settings 时打开 App；用户手动修改任何 Settings 字段（→ 对应 `settings.*` 修改事件）；数据迁移场景（→ §7.14 `data.*`）；因数据异常导致 Settings 丢失后的重建（→ §7.17 / §7.14）。

---

#### settings.timerUpdated（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ field, oldValue, newValue }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `field` | `string` | 否 | 无 | 被修改的计时参数字段名；取值约束：`'focusMinutes'` / `'shortBreakMinutes'` / `'longBreakMinutes'` 之一（`longBreakEvery` 当前固定为 4、UI 不开放修改，不通过本事件变更） |
| `oldValue` | `number` | 否 | 无 | 修改前的字段值 |
| `newValue` | `number` | 否 | 无 | 修改后的字段值；必须满足 §3.7 对该字段的取值约束（如 `longBreakMinutes` 只允许 15 / 20 / 30） |

**说明**：用户在设置页修改计时参数时，对应 Settings 字段更新写入存储时触发。每次只修改一个字段触发一个事件；如一次操作同时修改多个计时字段，则为每个字段分别触发一个独立事件，不合并。字段取值约束见 §3.7 字段一致性约束。历史 Session 的 plannedDuration 不受设置变更影响（Session 写入时锁定配置，见 §3.7 关键规则第 3 条）。

**典型触发**：用户在设置页将专注时长从 25 分钟改为 30 分钟（field=`'focusMinutes'`，oldValue=25，newValue=30）；将长休时长从 15 分钟改为 20 分钟（field=`'longBreakMinutes'`，oldValue=15，newValue=20）。`longBreakEvery` 固定为 4、不开放修改，不触发本事件。

**不应触发**：`restSuggestions` 配置变更（→ §7.7 `restItem.*`）；`lifetimePomodoroBaseline` 调整（→ §7.13 `statsBaseline.*`）；`appDayStartOffsetMinutes` 修改（→ 本节 `settings.appDayStartOffsetUpdated`）；`dailyTaskTemplates` 管理（→ 本节 `settings.dailyTaskTemplate*` 系列事件）；仅查看设置页但未写入变更；newValue 与 oldValue 相等（未实际修改不触发）。

---

#### settings.appDayStartOffsetUpdated（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ oldValue, newValue, changedBy }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `oldValue` | `number` | 否 | 无 | 修改前的产品日开始偏移（分钟）；取值约束：整数，0 ≤ oldValue ≤ 1439，与 §3.7 `appDayStartOffsetMinutes` 取值约束一致 |
| `newValue` | `number` | 否 | 无 | 修改后的产品日开始偏移（分钟）；取值约束：整数，0 ≤ newValue ≤ 1439，且必须与 `oldValue` 不同（相同不写入本事件）|
| `changedBy` | `string` | 否 | `'user'` | 变更来源；取值约束：`'user'` / `'migration'` / `'system'` 之一。`'user'` = 用户从设置入口修改；`'migration'` = 数据迁移过程写入或修正；`'system'` = 仅系统级修复使用，不用于普通自动判断 |

**说明**：用户（或迁移 / 系统级修复流程）修改 `Settings.appDayStartOffsetMinutes`，新值写入存储时触发。该字段是整个产品判断"今天 / 每日 / 当日"的全局日边界规则（见 §2.5、§3.7）；改后历史记录的产品日归属 `appDate` 按新偏移在查询时重新派生，`localDate` 事实自然日不受影响、不被重写。本事件**不通过** `settings.timerUpdated` 承载——`appDayStartOffsetMinutes` 不是计时器时长参数，与 focus / shortBreak / longBreak 时长无关。Phase 1 `appDayStartOffsetMinutes` 固定默认 `0`、UI 不开放修改，因此 P1 不产生本事件；P2+ 若开放设置入口，对该字段的每次修改都必须通过本事件记录。

**典型触发**：用户在设置页将"一天起始时刻"从 00:00 改为 04:00（oldValue=0，newValue=240，changedBy=`'user'`）；数据迁移流程对该偏移做修正（changedBy=`'migration'`）。

**不应触发**：Phase 1 默认初始化写入 `appDayStartOffsetMinutes=0`（→ 随 `settings.initialized` 的 Settings 本体写入，不单独触发本事件）；newValue 与 oldValue 相等（未实际修改不触发）；计时时长参数修改（→ `settings.timerUpdated`）；`lifetimePomodoroBaseline` 调整（→ §7.13 `statsBaseline.*`）；仅查看设置页但未写入变更。

---

#### settings.dailyTaskTemplateAdded（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ templateKey, title, estimatedPomodoros, autoAddToDayPlan, sortPosition, sortIndex }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `templateKey` | `string` | 否 | 无 | 新模板的稳定标识；格式为 `'custom_' + UUID v7`（见 §3.7）；写入后不随 title 改名变化 |
| `title` | `string` | 否 | 无 | 生成 Task 时使用的默认标题；取值约束：非空字符串 |
| `estimatedPomodoros` | `number` | 否 | 无 | 生成 Task 时的默认预估番茄数；取值约束：整数，1–7，不得超过 §3.1 Task.estimatedPomodoros 的上限；5–6 时 UI 可给出非阻断式软提醒；7 为最大允许值；`>7` 时不允许写入此模板（不允许通过 dailyTaskTemplates 绕过 Task 本体的 7 番茄上限） |
| `autoAddToDayPlan` | `boolean` | 否 | 无 | 是否在每日首次创建 DayPlan 时自动生成当天 Task |
| `sortPosition` | `string` | 否 | 无 | 生成 Task 在今日列表中的插入位置；取值约束：`'first'` 或 `'last'` |
| `sortIndex` | `number` | 否 | 无 | 该模板在设置列表中的排序索引；取值约束：整数，≥ 0 |

**说明**：用户在设置页新增一条自定义每日模板，模板元素写入 Settings.dailyTaskTemplates 数组时触发。内置模板（`isBuiltIn=true`，如"计划准备"）由首次初始化写入，不触发本事件。新增的自定义模板 `isBuiltIn=false`。

**典型触发**：用户在每日模板设置页点击"新增模板"，填入标题"日报"（estimatedPomodoros=1，autoAddToDayPlan=`true`，sortPosition=`'last'`）并保存，模板写入 Settings 时触发。

**不应触发**：内置模板写入（→ `settings.initialized`）；修改已有模板字段（→ `settings.dailyTaskTemplateUpdated`）；物理删除模板（→ `settings.dailyTaskTemplateRemoved`）；排序调整（→ `settings.dailyTaskTemplateReordered`）。

---

#### settings.dailyTaskTemplateUpdated（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ templateKey, field, oldValue, newValue }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `templateKey` | `string` | 否 | 无 | 被修改模板的稳定标识 |
| `field` | `string` | 否 | 无 | 被修改的字段名；取值约束：`'title'` / `'estimatedPomodoros'` / `'autoAddToDayPlan'` / `'sortPosition'` 之一（`templateKey` 与 `isBuiltIn` 不允许修改，不触发本事件） |
| `oldValue` | `string \| number \| boolean` | 否 | 无 | 修改前的字段值 |
| `newValue` | `string \| number \| boolean` | 否 | 无 | 修改后的字段值 |

**说明**：用户修改已有每日模板的字段时，对应字段写入 Settings.dailyTaskTemplates 元素时触发。每次只修改一个字段，触发一个事件。内置模板（`isBuiltIn=true`）允许修改 `title` / `estimatedPomodoros` / `autoAddToDayPlan` / `sortPosition`；自定义模板（`isBuiltIn=false`）以上字段均可修改。

**`autoAddToDayPlan` 与每日自动添加的关系**：§3.7 `dailyTaskTemplates` 元素没有独立的 `isEnabled` 字段。"关闭每日自动添加"（使其不再每日自动生成任务）等同于将 `autoAddToDayPlan` 由 `true` 改为 `false`，触发本事件（field=`'autoAddToDayPlan'`，newValue=`false`）。该模板本体仍然存在，可继续编辑、排序，或随时重新开启自动添加，与 restSuggestions 的 `isEnabled` 禁用不同。若需要彻底从列表物理移除自定义模板，应使用 `settings.dailyTaskTemplateRemoved`（内置模板不允许物理移除）。

**典型触发**：用户将内置"计划准备"模板的预估番茄数从 1 改为 2（field=`'estimatedPomodoros'`，oldValue=1，newValue=2）；用户关闭自定义"日报"模板的每日自动添加（field=`'autoAddToDayPlan'`，oldValue=`true`，newValue=`false`）。

**不应触发**：排序索引调整（→ `settings.dailyTaskTemplateReordered`）；新增模板（→ `settings.dailyTaskTemplateAdded`）；物理移除自定义模板（→ `settings.dailyTaskTemplateRemoved`）；修改 `templateKey` 或 `isBuiltIn`（不允许，不触发任何事件）。

---

#### settings.dailyTaskTemplateRemoved（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ templateKey, title, wasAutoAddEnabled }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `templateKey` | `string` | 否 | 无 | 被移除模板的稳定标识；用于事后审计 |
| `title` | `string` | 否 | 无 | 被移除时的模板标题；用于事后可读性审计 |
| `wasAutoAddEnabled` | `boolean` | 否 | 无 | 被移除时 `autoAddToDayPlan` 的状态；便于回溯模板最后配置 |

**说明**：用户物理删除一条自定义每日模板（`isBuiltIn=false`），模板元素从 Settings.dailyTaskTemplates 数组中移除时触发。内置模板（`isBuiltIn=true`）不允许物理删除，不触发本事件；若用户不希望内置模板每天自动添加，应将 `autoAddToDayPlan` 改为 `false`（→ `settings.dailyTaskTemplateUpdated`），模板本体仍会保留在列表中。

**典型触发**：用户在设置页删除自定义的"日报"每日模板，确认后模板从 Settings.dailyTaskTemplates 数组中移除时触发。

**不应触发**：内置模板（不允许物理删除）；仅关闭每日自动添加而不物理移除（→ `settings.dailyTaskTemplateUpdated`，field=`'autoAddToDayPlan'`，newValue=`false`）；排序调整（→ `settings.dailyTaskTemplateReordered`）。

---

#### settings.dailyTaskTemplateReordered（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ orderedTemplateKeys }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `orderedTemplateKeys` | `string[]` | 否 | 无 | 调整后所有模板按新 `sortIndex` 顺序排列的 `templateKey` 数组；取值约束：非空数组，长度须与 Settings.dailyTaskTemplates 当前元素数量一致，所有元素均为已存在的 `templateKey` |

**说明**：用户在设置页调整每日模板的显示顺序时，相关模板的 `sortIndex` 更新写入 Settings 时触发。一次排序操作只触发一个事件，不为每个 sortIndex 变化分别触发。实现端根据 `orderedTemplateKeys` 数组重新分配各模板的 `sortIndex` 值（如以步长 1000 重新赋值），具体赋值策略由实现端决定。

**典型触发**：用户在设置页拖拽调整两条每日模板的顺序，拖拽结束后 sortIndex 写入存储时触发。

**不应触发**：修改单条模板的非排序字段（→ `settings.dailyTaskTemplateUpdated`）；新增或删除模板（→ `settings.dailyTaskTemplateAdded` / `settings.dailyTaskTemplateRemoved`，这些操作的 sortIndex 副产物不额外触发本事件）；仅查看设置页但未实际调整排序。

---

#### settings.restSuggestionDisplayModeUpdated（P2）

**顶层关联字段**：`settingsId`。

**payload**：`{ field, oldValue, newValue, changedBy }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 |
|---|---|---|---|---|
| `field` | `string` | 否 | 无 | 固定值 `'restSuggestionDisplayMode'`；取值约束：必须为 `'restSuggestionDisplayMode'` |
| `oldValue` | `string` | 否 | 无 | 切换前的展示模式；取值约束：`'customOrder'` / `'usageFrequency'` 之一 |
| `newValue` | `string` | 否 | 无 | 切换后的展示模式；取值约束：`'customOrder'` / `'usageFrequency'` 之一，且必须与 `oldValue` 不同 |
| `changedBy` | `string` | 否 | `'user'` | 变更来源；当前只允许 `'user'`（用户在设置页手动切换）；取值约束：必须为 `'user'` |

**说明**：用户在设置页切换休息建议项展示排序策略时，`Settings.restSuggestionDisplayMode` 字段更新写入存储时触发。切换展示模式不修改任何 `restSuggestions` 元素的 `sortIndex`，不触发 `restItem.reordered`。`'usageFrequency'` 模式下的频次来源为历史 `Session.actualRest` 派生，实现端可使用可重建的派生缓存优化性能，但缓存不得作为事实源，事实源仍为历史 Session 记录。`'usageFrequency'` 模式的频次统计窗口（最近 30 天 / 90 天 / 全部历史）待 §8 统计口径或 UI 设计确定。

**典型触发**：用户在设置页将休息建议展示方式从"固定顺序"切换为"按历史使用频次"（oldValue=`'customOrder'`，newValue=`'usageFrequency'`）；或反向切换。

**不应触发**：用户手动拖拽调整休息项顺序（→ `restItem.reordered`，不触发本事件）；`restSuggestions` 元素的增删改（→ §7.7 `restItem.*`）；仅查看设置页但未实际切换展示模式；newValue 与 oldValue 相等（未实际修改不触发）。

---

### 7.13 StatsBaseline（累计番茄基数变更）

本节定义 `statsBaseline.*` 域事件，用于记录用户手动调整 `Settings.lifetimePomodoroBaseline`（累计完整番茄基数）的操作。

**Domain 级说明**：

- `statsBaseline.*` 只用于记录 `lifetimePomodoroBaseline` 的手动调整，不覆盖以下场景：重置全部统计 / 清零全部统计；某日统计修正；手动补录外部番茄；手动覆盖某日番茄数；直接修改 Session / Event 派生统计结果。
- 如未来需要"重置应用数据 / 数据清空 / 导入迁移 / 数据修复"等操作，应放到 §7.14 `data.*` 或 §7.17 `error.*` 等域单独设计，不纳入 `statsBaseline.*`。
- `lifetimePomodoroBaseline` 字段本身在 Phase 1 即可存在于 Settings 实体（§3.7）中，默认值为 `0`；但写入 `statsBaseline.updated` 事件的真实用户交互入口在 Phase 2 才要求接入，不要误读为"P2 才允许存在该字段"。
- `lifetimePomodoroBaseline` 的调整不触发 `settings.*` 事件（→ `statsBaseline.updated`）；其语义是"统计起点校正"，而非"偏好配置变更"。

**统计语义说明**：

`lifetimePomodoroBaseline` 只影响累计完整番茄数的展示基数。累计完整番茄数的计算方向为：`lifetimePomodoroBaseline + 本工具内全时间段完整番茄循环数`（完整口径见 §8.11）。调整该字段：

- 不生成 Session；
- 不生成 UnresolvedInterval；
- 不生成 extraFocus / extraRest；
- 不伪造成历史番茄记录；
- 不影响日统计；
- 不影响任务统计；
- 不影响完整番茄循环统计。

---

#### statsBaseline.updated（P2）

**顶层关联字段**：`settingsId`（被修改的 Settings 记录 id）。

**payload**：`{ oldValue, newValue }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `oldValue` | `number` | 否 | 无 | 修改前的累计番茄基数 | 整数，≥ 0，不允许小数或负数 |
| `newValue` | `number` | 否 | 无 | 修改后的累计番茄基数 | 整数，≥ 0，不允许小数或负数；必须与 `oldValue` 不等（两值相等时不触发本事件） |

**说明**：用户在设置页手动修改累计番茄基数（`lifetimePomodoroBaseline`）并确认写入时触发。本事件仅记录变更前后的值，不附加原因说明字段；`oldValue / newValue` 已足够支撑审计追溯。事件写入后，Settings 实体中的 `lifetimePomodoroBaseline` 字段同步更新为 `newValue`。

**典型触发**：用户从其他计时工具切换到本产品，在设置页将累计番茄基数从 `0` 改为 `300`，并确认保存时触发。或用户发现上次调整有误，将基数从 `305` 改为 `300` 时触发。

**不应触发**：`oldValue === newValue`（未发生实际变更，不触发）；本工具内完成标准 focus Session（累计番茄通过 Session 自动派生，不影响 `lifetimePomodoroBaseline`，→ `focus.completed`）；`lifetimePomodoroBaseline` 字段因 Settings 首次初始化而写入默认值 `0`（→ `settings.initialized`）；因数据迁移写入初始值（→ §7.14 `data.*`）；任何其他 Settings 字段的修改（→ `settings.timerUpdated` 或对应 `settings.dailyTaskTemplate*` 事件）。

---

### 7.14 Data / Migration / Demo（数据维护与演示）

本节定义 `data.*` 与 `demo.*` 两类事件，用于数据迁移审计、本地数据备份恢复、数据清空及开发调试演示。**本节所有事件均不进入用户番茄统计、不影响日统计、不影响任务统计、不影响完整番茄循环统计。**

**Domain 级说明**：

- `data.*` 事件分两类：
  - **迁移审计类**（`data.migrationCompleted` / `data.migrationFailed`）：DEV 级别，由系统在 schema 版本升级时自动写入，仅用于审计追溯，不是用户主动触发的操作。迁移失败的唯一权威事件为 `data.migrationFailed`，不允许新增 `error.migrationFailed`（见 §6.4 第 6 条）。
  - **数据管理类**（`data.exported` / `data.imported` / `data.cleared`）：用户主动触发的本地数据管理操作，属于产品功能（Phase 4），不进用户统计。
- `data.*` 数据管理类事件只覆盖 Web 本地数据（IndexedDB）的备份与恢复；多端同步后的云端备份、跨设备备份合并、云端恢复策略当前不在此定义（见 §14【18】）。
- `demo.*` 事件均为 DEV 级别，只能由开发者或产品调试入口显式触发，不是普通用户操作路径；新用户首次进入产品时默认空白，不自动加载演示数据（D4）。

---

#### data.migrationCompleted（DEV）

**顶层关联字段**：均为 null（本事件描述系统级批量操作，无特定实体关联）。

**payload**：`{ fromSchemaVersion, toSchemaVersion, durationMs }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `fromSchemaVersion` | `string` | 否 | 无 | 迁移开始前的 schema 版本号 | 非空字符串；不允许为空字符串 |
| `toSchemaVersion` | `string` | 否 | 无 | 迁移完成后的 schema 版本号 | 非空字符串；不允许为空字符串；必须与 `fromSchemaVersion` 不等 |
| `durationMs` | `number \| null` | 是 | `null` | 本次迁移耗时（毫秒）；用于性能审计追溯；采集失败时允许为 null | 整数，≥ 0；或 null |

**说明**：IndexedDB schema 版本升级时，迁移脚本执行完毕且完整性校验通过后触发。本事件由系统自动写入，不是用户操作触发。schema 版本变化通过 `fromSchemaVersion` / `toSchemaVersion` 字段表达，不另立 `data.schemaUpgraded` 事件——一次 schema 升级的结果统一通过 `data.migrationCompleted`（成功）或 `data.migrationFailed`（失败）唯一表达，避免歧义。

**典型触发**：应用发布新版本，用户打开 App 时 IndexedDB 检测到版本号变化，执行迁移脚本，脚本成功执行并通过完整性校验后触发。

**不应触发**：迁移脚本执行失败（→ `data.migrationFailed`）；用户手动修改任意设置或任务字段（→ 对应 `settings.*` / `task.*` 等事件）；首次安装无迁移需要时（首次安装无已有数据可迁移，不触发本事件）。

---

#### data.migrationFailed（DEV）

**顶层关联字段**：均为 null（本事件描述系统级操作，无特定实体关联）。

**payload**：`{ fromSchemaVersion, toSchemaVersion, errorCode, errorMessage }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `fromSchemaVersion` | `string` | 否 | 无 | 迁移开始前的 schema 版本号 | 非空字符串；不允许为空字符串 |
| `toSchemaVersion` | `string` | 否 | 无 | 目标 schema 版本号（迁移失败，未成功达到此版本）| 非空字符串；不允许为空字符串 |
| `errorCode` | `string \| null` | 是 | `null` | 机器可读错误代码，用于程序化错误分类 | 字符串或 null |
| `errorMessage` | `string \| null` | 是 | `null` | 人类可读错误描述，用于调试追溯 | 字符串或 null |

**说明**：IndexedDB schema 迁移脚本执行失败时触发。本事件是迁移失败的唯一权威事件；不允许使用 `error.migrationFailed` 替代（见 §6.4 第 6 条）。`error.*` 域只负责运行时异常（如数据写入失败、意外状态），不用于迁移流程。迁移失败后如何引导用户（如提示重试、清空重建）属于产品异常处理流程，不在本事件 payload 中表达；若需要记录后续处理结果，参见 §7.17 `error.*` 或 `data.cleared`。

**典型触发**：应用升级后，迁移脚本因数据结构不符合预期、IndexedDB 写入失败或脚本 bug 等原因抛出异常，迁移过程中断时触发。

**不应触发**：迁移成功完成（→ `data.migrationCompleted`）；运行时数据写入失败（→ §7.17 `error.dataWriteFailed`）；用户主动清空数据（→ `data.cleared`）。

---

#### data.exported（P4）

**顶层关联字段**：均为 null（本事件描述整体数据操作，无特定实体关联）。

**payload**：`{ format, schemaVersion, totalRecords }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `format` | `string` | 否 | 无 | 导出文件格式 | 枚举：`'json'`；当前只支持 JSON，未来若扩展其他格式同步更新枚举 |
| `schemaVersion` | `string` | 否 | 无 | 导出文件对应的数据 schema 版本号；用于未来导入时判断是否需要执行迁移 | 非空字符串；不允许为空字符串 |
| `totalRecords` | `number \| null` | 是 | `null` | 本次导出的记录总数（各实体合计）；用于完整性审计；采集失败时允许为 null | 整数，≥ 0；或 null |

**说明**：用户在产品设置中主动触发"导出本地数据备份"操作，导出文件生成并写入完成时触发。本事件是 Web 本地数据安全能力的审计记录，不是统计事件。Web 端数据存储于用户本地浏览器 IndexedDB，可能因清理浏览器数据、换浏览器或换设备等原因丢失；本地数据导出是应对此类场景的数据保护手段。当前只覆盖 Web 本地 IndexedDB 数据的导出；多端同步后的云端备份场景待后续另行设计（见 §14【18】）。

**典型触发**：用户担心切换浏览器或清理浏览器数据导致历史记录丢失，在设置页点击"导出数据备份"，系统将 IndexedDB 全量数据序列化为 JSON 文件并触发浏览器下载，下载文件写入完成时触发。

**不应触发**：用户查看设置页但未触发导出操作；schema 迁移自动完成（→ `data.migrationCompleted`）；用户清空数据（→ `data.cleared`）；演示数据加载或清除（→ `demo.loaded` / `demo.cleared`）。

---

#### data.imported（P4）

**顶层关联字段**：均为 null（本事件描述整体数据操作，无特定实体关联）。

**payload**：`{ format, sourceSchemaVersion, totalRecords }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `format` | `string` | 否 | 无 | 导入文件格式 | 枚举：`'json'`；与 `data.exported` 对应 |
| `sourceSchemaVersion` | `string` | 否 | 无 | 备份文件对应的 schema 版本号；系统据此判断导入后是否需要执行迁移 | 非空字符串；不允许为空字符串 |
| `totalRecords` | `number \| null` | 是 | `null` | 本次导入的记录总数；采集失败时允许为 null | 整数，≥ 0；或 null |

**说明**：用户主动选择一个本地备份文件并触发数据恢复，导入流程完成（数据写入 IndexedDB）时触发。若备份文件的 `sourceSchemaVersion` 低于当前版本，系统应在导入写入后执行迁移脚本；迁移结果另由 `data.migrationCompleted` / `data.migrationFailed` 记录，本事件只记录导入动作本身。演示数据与真实数据隔离处理，导入真实备份不影响演示数据状态。

**典型触发**：用户换浏览器或意外清除站点数据后，通过设置页"从备份恢复数据"入口选择之前导出的 JSON 备份文件，系统解析并将数据写入 IndexedDB 完成时触发。

**不应触发**：用户查看设置页但未选择文件；schema 迁移自动执行（→ `data.migrationCompleted` / `data.migrationFailed`）；用户导出数据（→ `data.exported`）；演示数据加载（→ `demo.loaded`）。

---

#### data.cleared（P4）

**顶层关联字段**：均为 null（本事件描述整体数据操作，无特定实体关联）。

**payload**：`{ scope }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `scope` | `string` | 否 | 无 | 本次清空的数据范围 | 固定为 `'allLocalData'`；表示清空全部 Web 本地用户数据；本字段不表示当前已支持分范围清空 |

**说明**：用户在产品设置中明确执行"清空全部本地数据 / 重置应用"操作，全量数据删除完成时触发。清空后产品恢复为空白初始状态（等同于新用户首次打开）。本事件是数据管理行为的审计记录，不是"重置统计"或"番茄计数清零"事件——若用户只想调整累计番茄起点，应使用 `statsBaseline.updated`（见 §7.13）。本事件的清空范围为全部用户真实数据；演示数据的清除使用 `demo.cleared`，不触发本事件。

**典型触发**：用户在设置页找到"清空数据 / 重置应用"，阅读确认提示并点击最终确认后，系统删除 IndexedDB 中所有用户数据，操作完成时触发。

**不应触发**：用户调整 `lifetimePomodoroBaseline`（→ `statsBaseline.updated`）；用户完成、删除或归档任务（→ `task.completed` / `task.deleted` / `task.archived`）；用户清空演示数据（→ `demo.cleared`）；schema 迁移（→ `data.migrationCompleted`）；用户导入备份（→ `data.imported`，覆盖写入不属于"清空"语义）。

---

#### demo.loaded（DEV）

**顶层关联字段**：均为 null（本事件描述批量写入操作，无特定实体关联）。

**payload**：`{ demoVersion, recordCount }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `demoVersion` | `string \| null` | 是 | `null` | 演示数据集的版本标识；用于追溯使用了哪个版本的演示数据 | 字符串或 null |
| `recordCount` | `number \| null` | 是 | `null` | 本次加载的演示记录总数；采集失败时允许为 null | 整数，≥ 0；或 null |

**说明**：开发者或产品通过调试入口显式触发演示数据加载，演示数据写入存储完成时触发。本事件是 Dev-only 调试审计事件，不进用户统计。演示数据与真实用户数据隔离处理，不应混入用户真实记录。新用户默认空白，产品不会在任何普通用户操作路径中自动加载演示数据（D4）。

**典型触发**：开发者在本地开发环境通过专用调试入口点击"加载演示数据"，系统将预设演示数据集写入存储时触发。产品演示或 UI 走查需要预填数据时，通过本机制加载。

**不应触发**：新用户首次进入产品（默认空白，不自动加载演示数据，D4）；Settings 首次初始化（→ `settings.initialized`）；DayPlan 创建（→ `dayPlan.created`）；普通用户开始使用产品的任何正常操作路径。

---

#### demo.cleared（DEV）

**顶层关联字段**：均为 null（本事件描述批量删除操作，无特定实体关联）。

**payload**：`{ recordCount }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `recordCount` | `number \| null` | 是 | `null` | 本次清除的演示记录总数；采集失败时允许为 null | 整数，≥ 0；或 null |

**说明**：开发者通过调试入口清除当前已加载的演示数据，恢复空白或调试前状态时触发。本事件只清除演示数据，不删除用户真实数据。若演示数据加载后用户产生了真实操作记录，清除演示数据不应波及真实记录；演示数据与真实数据的隔离由实现层保障，不在本事件 payload 中表达。

**典型触发**：开发者在调试入口点击"清除演示数据"，系统删除演示数据集写入的所有记录时触发。重复加载演示数据前，通常先调用本操作清除旧演示数据。

**不应触发**：用户清空全部本地数据（→ `data.cleared`）；演示数据从未被加载（无演示数据可清除，不应触发）；普通用户操作路径（如删除任务）（→ `task.deleted` 等对应事件）。

---

### 7.15 Notification / Prompt（系统通知与产品内弹窗）

本节定义 `notification.*` 与 `prompt.*` 两类事件，用于记录浏览器 / OS 级系统通知可见性及产品内需要用户回应的弹窗提示。**本节事件不计入专注时长、不计入休息时长、不进入番茄统计。**

**Domain 级说明（notification）**：

- `notification.*` 只记录浏览器 / OS 级系统通知的可见性（如番茄结束时向用户发送的浏览器推送通知）；不覆盖产品内视觉提示、铃声、全屏结束提示、按钮状态变化等 UI 表现——这些由 `focus.completed` / `break.completed` 等业务事件自然触发，不作为独立事件记录。
- 产品内要求用户回应的提示归 `prompt.*`，不归 `notification.*`。
- 不定义 `notification.dismissed`：浏览器 / OS 级通知的关闭行为在不同系统和浏览器中支持不稳定；用户关闭系统通知不代表完成或拒绝任何业务行为；后续真实行为由 `break.started`、`break.skipped`、`focus.started`、`energy.recorded` 等业务事件记录。如未来需要分析通知点击 / 关闭行为或权限状态，再另行扩展。

**Domain 级说明（prompt）**：

- `prompt.*` 只记录"产品内需要用户回应、但没有更具体 domain 承接的通用提示"；若提示已有专属 domain 事件（如休息建议选择归 §7.7 `restItem.*`、恢复流程归 §7.11 `interval.*`），不重复进入 `prompt.*`。
- 危险操作二次确认弹窗（如清空全部数据前的确认）暂不纳入 `prompt.*`，最终成功行为由对应业务事件（如 `data.cleared`）记录。
- 用户有效回应由对应业务 domain 事件表达（如 `energy.recorded`、`task.completed`、`task.split` + `task.archived`），不定义通用 `prompt.responded`。
- `prompt.dismissed` 记录"用户关闭、跳过、忽略或超时未回应，且未产生对应业务结果"的情形。

---

#### notification.shown（P3）

**顶层关联字段**：`sessionId`（触发通知的 Session id）；`notificationType='focusCompleted'` 时同时填写 `taskId`；无关联 Session 时填 null。

**payload**：`{ notificationType }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `notificationType` | `string` | 否 | 无 | 通知类型 | 枚举：`'focusCompleted'`（专注结束通知）/ `'breakCompleted'`（休息结束通知）；如需扩展其他通知类型，同步补入枚举并更新 §14 |

**说明**：系统向浏览器 / OS 层发送通知且通知被成功展示给用户时触发。本事件只记录通知已展示这一事实，不追踪通知后续生命周期（自动消失、被系统收起、用户手动关闭均不另记事件）。

**典型触发**：用户在其他标签页浏览时，番茄计时结束，系统发出"专注结束，该休息了"的浏览器推送通知，通知成功展示于屏幕通知区域时触发（notificationType=`'focusCompleted'`）。

**不应触发**：产品内视觉提示（计时页弹出结束动画、铃声播放、全屏结束提示等），这些是 UI 表现，不记录为事件；通知自动消失或被用户手动关闭（不单独记录关闭生命周期）；用户未授权浏览器通知权限（通知未实际展示时不触发）；用户在当前标签页且产品可见时番茄结束（此时产品内提示属 UI 表现，不触发本事件）。

---

#### prompt.shown（P3）

**顶层关联字段**：视 promptType 填写对应关联字段——`'taskCompletionCheck'` 填写 `taskId`、`sessionId`；`'energyRecording'` 填写 `sessionId`（session 后提示）或 null（`dayStart` / `onReturn` 类提示）；`'taskSplitSuggestion'` 填写 `taskId`。

**payload**：`{ promptType, promptContext }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `promptType` | `string` | 否 | 无 | 弹窗类型 | 枚举：`'taskCompletionCheck'`（番茄结束后"任务完成了吗？"任务完成确认提示，具体 UI 形态不限于弹窗）/ `'energyRecording'`（能量 / 状态记录提示弹窗）/ `'taskSplitSuggestion'`（任务超预估 / 重新评估 / 拆分引导提示）|
| `promptContext` | `string \| null` | 是 | `null` | 弹窗触发节点；仅 `promptType='energyRecording'` 时必填，其余 promptType 固定为 null | 当 `promptType='energyRecording'` 时必须取以下 8 个枚举值之一：`'beforeFocus'`（标准专注开始前）/ `'afterFocus'`（标准 focus 结束后）/ `'afterShortBreak'`（短休结束后）/ `'afterLongBreak'`（长休结束后）/ `'afterExtraFocus'`（extraFocus 归类后）/ `'afterExtraRest'`（extraRest 归类后）/ `'dayStart'`（当天首次打开 App / 开始今日计划时）/ `'onReturn'`（用户离开后回到 App 时）；其他 promptType 固定为 null，不允许填写枚举值 |

**说明**：产品内需要用户回应的弹窗被展示给用户时触发。各 promptType 对应的有效结果事件：
- `'taskCompletionCheck'`：用户确认完成 → `task.completed`；用户点"还没完成"/ 关闭 / 跳过 → `prompt.dismissed`；
- `'energyRecording'`：用户提交记录 → `energy.recorded`；用户跳过 / 关闭 / 超时未回应 → `prompt.dismissed`；
- `'taskSplitSuggestion'`：用户执行拆分 / 归档 → 对应 `task.*` 事件；用户暂不处理 / 关闭 / 跳过 → `prompt.dismissed`。

**典型触发**：
- promptType=`'taskCompletionCheck'`：**仅当系统主动展示一个显著的、需要用户回应的任务完成确认提示时触发**（如番茄计时结束后系统主动询问"这个任务完成了吗？"）。典型形式可以是弹窗、收尾页中的显著确认模块、toast / 卡片式确认提示等，具体 UI 形态不限于弹窗。
  - **不触发**的情形：若任务完成入口只是页面上长期存在的复选框、任务卡片上的完成按钮、计时页常驻轻量入口——即没有形成一次"系统主动询问 / 显著提示 / 需要回应"的产品内提示——则**不触发** `prompt.shown(taskCompletionCheck)`。
  - 用户点击这些常驻 / 轻量入口完成任务时，直接写入 `task.completed`，**不补写** `prompt.shown`。`prompt.shown` 记录的是"系统提示出现了"，`task.completed` 记录的是"用户确认任务完成了"，两者不混同。
- promptType=`'energyRecording'`：当天第一次开始 focus 前系统提示记录当前状态。
- promptType=`'taskSplitSuggestion'`（**强触发**——以下任一条件满足均应触发）：
  1. 用户创建任务时输入 `estimatedPomodoros > 7`，写入被拒绝，应触发拆分提示；
  2. 用户执行二次 / 三次预估时换算后总预估 `> 7`，写入被拒绝，应触发拆分提示；
  3. 任务进入第三轮预估（round=3），第三轮对应的有效标准 focus 完成后仍未完成任务，在对应 break 完成 / 跳过 / 经恢复流程收尾后触发；
  4. 该 Task 已完成 7 个有效标准 focus（`type='focus'` 且 `status='completed'`，不含 discarded / extraFocus / break），且任务仍未完成，在第 7 个有效 focus 对应的 break 完成 / 跳过 / 经恢复流程收尾后触发；此时该 Task 进入 `splitNeeded` 状态（见 §3.1），**在用户完成拆分 / 归档或经明确的重新处理流程解除前，不允许该 Task 直接开启第 8 个标准 focus**。用户关闭 / 跳过 / 暂不处理该提示（→ `prompt.dismissed`）**不解除该限制**，不等于允许继续第 8 个标准 focus（严格路线 A，见 §3.1 关键规则 10）。

  **5–6 软提醒区**（非阻断式）：用户创建任务或调整预估后，`estimatedPomodoros` 为 5 或 6 时，允许写入，不阻断用户；UI 可给出非阻断式软提醒（如"此任务已偏大，建议拆分"），**不必触发 `prompt.shown`**，不要求用户强制回应，不阻止继续操作。

  **边界说明**：`taskSplitSuggestion` 是产品内需要用户回应的提示，只记录"系统提示用户重新评估 / 拆分"这一行为，不表示拆分已发生；真正拆分 / 归档时，由 `task.split`、`task.archived`（outcome=`'split'`）、`task.created`（source=`'splitChild'`）承接；它不是 `notification.*`、`restItem.*` 或 `error.*`。

**不应触发**：休息建议选择界面（→ §7.7 `restItem.*`）；恢复流程弹窗（→ §7.11 `interval.*`）；危险操作二次确认弹窗（→ 最终结果由业务事件表达）；普通 UI 弹窗、铃声、全屏提示（属 UI 表现，不记录为事件）；用户已有效回应后再次展示同类弹窗（每次展示独立触发）。

---

#### prompt.dismissed（P3）

**顶层关联字段**：与对应 `prompt.shown` 保持一致（视 promptType 填写 `taskId`、`sessionId`）。

**payload**：`{ promptType, promptContext }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `promptType` | `string` | 否 | 无 | 被关闭 / 跳过的弹窗类型 | 与 `prompt.shown` 枚举一致：`'taskCompletionCheck'` / `'energyRecording'` / `'taskSplitSuggestion'` |
| `promptContext` | `string \| null` | 是 | `null` | 弹窗触发节点；与对应 `prompt.shown` 保持一致 | 当 `promptType='energyRecording'` 时必须取与 `prompt.shown` 相同的枚举值（见 `prompt.shown` 约束）；其他 promptType 固定为 null |

**说明**：用户关闭、跳过、忽略或超时未回应产品内弹窗，且未产生对应业务结果时触发。有效回应（如用户确认完成任务、提交能量记录、执行拆分）由对应业务事件表达，不触发本事件。

**典型触发**：番茄结束后"任务完成了吗？"任务完成确认提示出现（具体 UI 形态不限于弹窗），用户点击"还没完成"或直接关闭（promptType=`'taskCompletionCheck'`）；能量记录弹窗出现，用户点击"跳过"或超时未操作（promptType=`'energyRecording'`）；任务拆分提示出现，用户点击"稍后处理"或直接关闭（promptType=`'taskSplitSuggestion'`）。

**不应触发**：用户实际有效回应（提交能量记录 → `energy.recorded`；确认任务完成 → `task.completed`；执行拆分 → 对应 `task.*` 事件）；弹窗从未展示即消失（不产生任何 prompt 事件）。

**`taskCompletionCheck` 边界**：只有在已经触发过对应 `prompt.shown(taskCompletionCheck)`（即出现过一次系统主动展示、需要用户回应的显著任务完成确认提示）后，被用户关闭、跳过、点"还没完成"或超时未回应时，才触发 `prompt.dismissed(taskCompletionCheck)`。若任务完成入口只是常驻复选框 / 普通完成按钮 / 计时页轻量入口，由于从未触发 `prompt.shown`，也**不产生** `prompt.dismissed`。用户有效确认完成任务时，写 `task.completed`，不写 `prompt.dismissed`。

---

### 7.16 Session Note / Review（当前不定义事件）

本域当前不定义任何事件。不定义 `session.noteCreated` / `session.noteUpdated` / `session.noteDeleted` / `review.*` 等事件；不支持自由文本复盘、每轮备注、日总结。如未来重新设计，应作为新的后置功能另行进入 §11，而不是在当前数据模型中预留字段。

---

### 7.17 Error（运行时异常）

本节定义 `error.*` 域事件，用于记录本地数据写入失败及数据状态违反业务约束的运行时异常。

**Domain 级说明**：

- `error.*` 事件是本地数据可靠性审计记录，不进入用户番茄统计、不计入专注时长、不计入休息时长、不影响日统计、任务统计或完整番茄循环统计。
- Phase 1–4 不自动上传；error 事件写入本地 Event 日志；用户反馈问题时，可通过 §7.18 `diagnosticLog.exported`（诊断日志导出）或 §7.14 `data.exported`（全量数据导出）能力提供给实现方排查（导出与隐私边界见 §7.18、§9，待承接项见 §14【22】）。
- 不允许定义 `error.migrationFailed`（见 §6.4 第 6 条）；迁移失败的唯一权威事件为 §7.14 `data.migrationFailed`。
- 不定义平台专属错误事件（如 `error.indexedDbFailed`、`error.sqliteFailed`）；平台 / 存储引擎差异通过 payload `context.storageEngine` 字段表达，事件名保持平台无关。
- `context` 字段用于结构化排查元信息，**不得包含用户正文内容**（如 Task 标题、备注文本、EnergyRecord 自由文本、完整实体快照），避免 error 日志成为隐私泄漏源。`errorMessage` 同样不得拼接用户正文内容；如需描述错误，只写技术性错误说明，不写 Task 标题、备注文本、EnergyRecord 自由文本或完整对象内容。

---

#### error.dataWriteFailed（P1）

**顶层关联字段**：如明确关联某实体，填写对应字段（如 `sessionId`、`taskId`、`settingsId`）；无法确定具体实体或批量 / 系统级操作时填 null，通过 `context` 补充说明。

**payload**：`{ errorCode, errorMessage, context }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `errorCode` | `string` | 否 | 无 | 机器可读错误代码，用于程序分类和排查 | 非空字符串；格式由实现层定义，如 `'ERR_WRITE_FAILED'`；不允许为空字符串 |
| `errorMessage` | `string \| null` | 是 | `null` | 人类可读错误说明，用于调试；可为 null，避免强依赖浏览器 / 平台返回文本的稳定性 | 字符串或 null |
| `context` | `object` | 否 | `{}` | 结构化排查元信息；各字段均为可选，按实际可采集信息填写；**不得包含用户正文内容** | 对象（至少为空对象 `{}`，不允许 null）|

`context` 推荐字段（均可选）：

- `entityType`：被写入的实体类型，如 `'Session'`、`'Task'`、`'Event'`、`'Settings'`
- `entityId`：被写入实体的 id，已知时填写
- `operation`：失败的操作类型，如 `'create'`、`'update'`、`'softDelete'`、`'appendEvent'`
- `storageEngine`：出错的存储引擎，如 `'indexedDB'`、`'sqlite'`
- `objectStore`：出错的对象存储 / 表名，如 `'sessions'`、`'events'`、`'tasks'`
- `attemptedWriteType`：写入类型，如 `'insertRecord'`、`'updateField'`
- `schemaVersion`：出错时的 schema 版本号

**说明**：系统尝试将数据写入本地存储（IndexedDB / SQLite 等）时发生失败，即把该失败记录为本事件。本事件是"写入失败"这一事实的审计记录，不影响任何统计数据。若发生的是"连 Event 本身也无法写入"的严重存储故障，系统无法保证本事件一定成功落入 Event 日志；此时实现层应尽力 fallback 到 console、临时内存、UI 错误提示或后续诊断机制；具体方案属于实现层细节，v4 不展开。顶层关联字段与 `context` 不互斥：顶层字段用于快速关联实体，`context` 用于说明具体操作 / 存储引擎等排查信息。

**典型触发**：用户番茄结束后系统写 Session / Event 失败；用户修改 Settings 时保存失败；用户提交 EnergyRecord 时写入失败；任意实体 create / update / soft-delete / appendEvent 过程中本地存储写入失败。

**不应触发**：迁移脚本执行失败（→ `data.migrationFailed`）；数据处于意外状态但写入本身未失败（→ `error.unexpectedState`）；普通读取操作（读取失败当前不定义独立事件）。

---

#### error.unexpectedState（P1）

**顶层关联字段**：如明确关联某实体（如发现该 Session / Task 状态异常），填写对应字段（如 `sessionId`、`taskId`）；无法确定具体实体时填 null，通过 `context` 补充说明。

**payload**：`{ errorCode, errorMessage, context }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `errorCode` | `string` | 否 | 无 | 机器可读错误代码，用于程序分类和排查 | 非空字符串；格式由实现层定义，如 `'ERR_UNEXPECTED_STATE'`；不允许为空字符串 |
| `errorMessage` | `string \| null` | 是 | `null` | 人类可读的意外状态描述，用于调试；可为 null | 字符串或 null |
| `context` | `object` | 否 | `{}` | 结构化排查元信息；各字段均为可选；**不得包含用户正文内容** | 对象（至少为空对象 `{}`，不允许 null）|

`context` 推荐字段（均可选）：

- `entityType`：状态异常的实体类型，如 `'Session'`、`'Task'`、`'UnresolvedInterval'`
- `entityId`：状态异常实体的 id，已知时填写
- `invariant`：被违反的字段一致性约束描述，如 `'session.completedAt.required_when_completed'`、`'break.sourceFocusSession.invalid'`
- `detectedBy`：检测到异常的触发点，如 `'startupCheck'`、`'recoveryFlow'`、`'writeValidation'`、`'readValidation'`
- `sourceEventType`：触发检测的事件类型，如 `'focus.completed'`、`'interval.sessionResolved'`
- `sourceAction`：触发检测的操作，如 `'recovery'`、`'read'`、`'write'`

**说明**：系统在读取、写入或恢复流程中检测到数据违反 v4 字段一致性约束或业务不变量时触发。本事件记录"发现异常"这一事实；异常的后续处理（如引导用户进入恢复流程、标记数据待修复）属于产品与实现层决策，不在本事件 payload 中表达。

**典型触发**：`status='completed'` 的 Session 但 `endedAt=null`；`status='completed'` 的 Task 但 `completedAt=null`；break 的 `sourceFocusSessionId` 指向不存在或不合法的 focus；active Session / UnresolvedInterval / Event 之间状态无法对齐；任意实体字段组合违反 §3 一致性约束。

**不应触发**：数据写入操作失败（→ `error.dataWriteFailed`）；schema 迁移执行失败（→ `data.migrationFailed`）；用户主动操作产生的合法状态变化（如 `focus.discarded`）；系统对意外状态已有专门处理流程的情形（如 UnresolvedInterval 检测由 `interval.detected` 记录，见 §7.11）。

---

### 7.18 Diagnostic Log（诊断日志导出）

本节定义 `diagnosticLog.*` 域事件，记录用户主动导出诊断日志这一排障动作。诊断日志导出与 §7.14 `data.exported`（本地数据全量备份）目的不同、范围不同、隐私边界不同，故单列独立 domain，不复用 `data.*`。

**Domain 级说明**：

- `diagnosticLog.*` 事件是排障操作的审计记录，不进入用户番茄统计、不计入专注 / 休息时长、不影响日统计、任务统计或完整番茄循环统计。
- **Phase 1–4 不自动上传**：诊断日志必须由用户主动触发导出，并由用户自行决定是否发送给实现方排查；系统不在任何阶段自动收集或上传诊断日志。
- **与全量数据导出分离**：`data.exported`（§7.14）导出 Web 本地 IndexedDB 全量数据用于备份恢复；`diagnosticLog.exported` 只导出错误排障所需的最小必要子集。两者入口、范围、用途、隐私边界均不同，不得合并为同一导出。
- **导出内容边界**：默认导出最近 30 天的 `error.*` 事件及其必要的 Event 顶层元信息（如 `occurredAt`、`type`、顶层关联字段）。**不导出**完整 Task 列表、完整 Session 列表、完整 EnergyRecord 列表或完整 Event 日志；**不导出** Task `title`、`note`、`actualWorkNote` 等用户正文内容。
- **脱敏底线沿用 §7.17**：导出的 `error.*` 事件中 `context` / `errorMessage` 仍不得包含用户正文内容（见 §7.17 Domain 级说明）；本节不重复定义 `error.*` 字段细节。
- **Phase 1 仅预留结构、不做真实导出**：Phase 1 只在本数据规范中定义 `diagnosticLog.exported` 事件类型结构、payload schema 与上述导出内容 / 隐私边界，**不做真实导出入口、不生成导出文件、不触发下载**。真实导出入口、导出文件生成与下载流程从 **P2** 起接入，正式体验可在后续（P4）继续完善（见 §10.5、§11）。

---

#### diagnosticLog.exported（P2）

**顶层关联字段**：均为 null（本事件描述整体诊断日志导出操作，无特定实体关联）。

**payload**：`{ format, rangeDays, includedEventTypes, exportedEventCount }`

| 字段 | 类型 | 可空 | 默认值 | 含义说明 | 取值约束 |
|---|---|---|---|---|---|
| `format` | `string` | 否 | 无 | 导出文件格式 | 枚举：`'json'`；当前只支持 JSON，未来若扩展其他格式同步更新枚举 |
| `rangeDays` | `number` | 否 | `30` | 本次导出覆盖的时间范围（最近 N 天的 `error.*` 事件）| 整数，1–90；Phase 1 默认 30；未来如开放自定义时间范围也不得超过 90 天——诊断日志是 Beta 排障的最小必要导出，不默认支持无限期历史导出 |
| `includedEventTypes` | `string[]` | 否 | `['error.dataWriteFailed', 'error.unexpectedState']` | 本次导出包含的事件类型清单 | 非空数组；元素必须为合法 event type 字符串；Phase 1 默认仅允许 `error.*` 事件类型；不允许 null，不允许空数组——诊断日志默认只服务错误排查，不混入 `task.*` / `energy.*` / `session.*` / `prompt.*` 等用户行为事件，避免变成半个全量数据导出 |
| `exportedEventCount` | `number \| null` | 是 | `null` | 本次实际导出的事件数量（`includedEventTypes` 命中的全部事件合计）；用于完整性审计；采集失败时允许为 null | null 或整数，≥ 0 |

**说明**：用户在产品内（如设置页 / 反馈入口）主动触发"导出诊断日志"操作，系统收集 `includedEventTypes` 指定范围内、最近 `rangeDays` 天的 `error.*` 事件及必要 Event 顶层元信息，序列化为 JSON 文件并触发下载，下载文件写入完成时触发本事件。本事件是排障导出动作的审计记录，不是统计事件，也不表示错误本身的发生（错误发生见 §7.17 `error.*`）。导出内容的脱敏底线与 `error.*` 字段细节均以 §7.17 为权威，本节不重复。更具体的 UI 入口与导出文件结构见 §11 后置实现清单。

**典型触发**（据用途补写）：Beta 期用户遇到异常（如番茄结束后数据保存失败、界面状态异常）后向实现方反馈，在设置页 / 反馈入口点击"导出诊断日志"，系统将最近 30 天的 `error.*` 事件序列化为 JSON 文件并触发浏览器下载，下载完成时触发；用户随后自行决定是否将该文件发送给实现方。

**不应触发**（据用途补写）：用户导出本地数据全量备份（→ §7.14 `data.exported`）；`error.*` 事件本身写入本地日志时（写入失败见 §7.17 `error.dataWriteFailed`，意外状态见 `error.unexpectedState`）；系统自动收集 / 上传诊断（Phase 1–4 无自动上传，不存在此触发）；用户打开设置页但未触发导出操作；用户清空本地数据或导入备份（→ §7.14 `data.cleared` / `data.imported`）。

---

## 8. 统计口径

本章定义番茄钟产品所有统计指标的计算口径。§8 只规定"怎么算"（数据来源、筛选条件、公式、排除边界），不规定"怎么展示"（UI 布局、图表类型、颜色）。统计页整体真实化阶段见 §10；具体指标是否进入当期 UI 展示，由 §11 / 后续实现计划承接。§8 仅定义统计计算口径，不负责 UI 排期，也不逐指标标注 Phase。

---

### 8.1 统计基本原则与排除边界

#### 8.1.1 统计数据来源

§8 所有指标均从以下实体派生，不从 Task 字段直接读取番茄数、专注时长或打扰次数（见 §3.1 关键规则 1）：

| 实体 | 在统计中的主要用途 |
|---|---|
| `Session` | 有效番茄数、专注时长、休息时长、完整番茄循环数、休息跳过率 |
| `Event`（`interrupt.*`） | 应对打扰次数 |
| `EnergyRecord` | 能量趋势、休息恢复效果（recoveryDelta） |
| `DayPlan` | 预算使用率、今日排期余量 |
| `Settings.lifetimePomodoroBaseline` | 累计完整番茄展示基数（仅影响累计总数展示，不影响日统计、任务统计、完整循环统计） |

所有统计在查询或展示时动态派生，不预先存储在实体字段上。

#### 8.1.2 通用约定

**A. 日期归属基准**

用户可见的"今日 / 每日 / 当日"统计，以及日 / 周 / 月 / 年聚合，均按各实体的**产品日 `appDate`** 归属（`appDate` 由各实体的业务时间字段、`timezone` 与 `Settings.appDayStartOffsetMinutes` 派生，见 §2.5）：
- Session 统计 → 按 `startedAt` 派生的 `appDate`
- Event 统计 → 按 `occurredAt` 派生的 `appDate`
- EnergyRecord 统计 → 按 `occurredAt` 派生的 `appDate`

`localDate` 仍是各实体的事实自然日（见 §2.5），用于事实记录与溯源，但**不作为最终用户统计的业务日期**。当 `appDayStartOffsetMinutes = 0` 时 `appDate` 与 `localDate` 通常一致；当其 ≠ 0 时，凌晨时段可能归属前一个 `appDate`。这些实体当前不存储 `appDate` 字段，统计查询层按 §2.5 规则派生，不得直接以 `localDate` 作为用户统计的业务日期。具体的聚合口径（日 / 周 / 月 / 年）见 §8.2。

**B. 不预存统计结果**

任务有效番茄数、某日打扰总次数等均不写入 Task / DayPlan 字段，一律从 Session / Event 实时派生。唯一例外是 `task.completed` 事件 payload 中的 `validFocusCountAtCompletion` 快照字段（见 §7.1）：该字段锁定任务完成时刻的有效 focus 数，专用于预估准确率计算，不替代 Session 实时派生统计。

**C. 软删除数据不进统计**

`deletedAt ≠ null` 的可同步实体记录不参与用户统计计算；Event 作为 append-only 记录不适用软删除规则。

**D. `completionSource='manual'` 的任务完成**

手动完成的任务可进入"任务完成数"统计，但不计入有效番茄数、完整番茄循环数、预估准确率。详见 §8.5。

#### 8.1.3 不进用户统计的数据范围

以下数据不进入成果类主指标，或仅进入指定明细 / 诊断指标；具体纳入与排除以下方表格逐项为准。

**Session 类型与状态排除**

| 类型 / 状态 | 排除规则 |
|---|---|
| `focus.status='discarded'` | 不计入有效番茄数、完整番茄循环数、Task 预估准确率；其 `actualDuration` 计入总专注时长 / 累计专注时长（拆分为"作废专注时长"明细，见 §8.3.5），但不作为番茄成果 |
| `break.status='skipped'` | 不计入完整番茄循环；`actualDuration` 固定为 0，不计入任何休息时长统计 |
| `type='extraFocus'` | 不计入有效番茄数、完整番茄循环数、Task 有效番茄数；`actualDuration` 只进"额外专注时长"，与标准专注时长拆开计算，见 §8.3 |
| `type='extraRest'` | 不计入完整番茄循环；`actualDuration` 只进"额外休息时长"，与标准休息时长拆开计算，见 §8.6 |

**Event 域排除**

| Domain | 排除原因 |
|---|---|
| `data.*` | 数据迁移 / 备份 / 清空属系统管理行为，不进用户统计 |
| `demo.*` | 演示数据操作，不进用户统计 |
| `error.*` | 运行时错误诊断，不进用户统计 |
| `notification.*` | 通知展示记录，不进用户统计 |
| `prompt.*` | 产品内需要用户回应的提示 / 决策记录（UI 形态不限于弹窗），不进入面向用户的番茄、专注、休息、能量等统计主指标；如未来用于提示触发率、任务过大风险、产品诊断等分析，应在 §9 / §10 / §11 单独定义，不在 §8 主统计中默认纳入 |
| `statsBaseline.*` | 只影响累计完整番茄展示基数，不影响日统计 / 任务统计 / Session 派生统计 |
| `settings.*` | 设置变更记录，不进用户统计 |

**其他排除**

- `UnresolvedInterval.status='ignored'` 的时段：不生成 Session，不进任何专注 / 休息统计。
- Session Note / Review（§7.16 当前无事件定义）：不进统计。
- `task.*` / `dayPlan.*` / `triage.*` 等非计时域事件不直接参与有效番茄数、专注时长、休息时长、完整番茄循环等计时类统计。任务状态类统计应按具体指标选择事实源：当前任务状态、当前完成数等可从 Task 当前字段派生；涉及历史完成时点、完成时快照、预估准确 / 偏差的统计，应使用 `task.completed` 事件及其 payload（如 `validFocusCountAtCompletion`），不得简单按事件条数计数。

---

### 8.2 日期归属与日 / 周 / 月 / 年聚合

#### 8.2.1 各实体的 localDate 与 appDate 派生规则

各实体的 `localDate` 是事实自然日，在实体写入时派生，规则如下：

| 实体 | 基准时间字段 | localDate 派生方式 |
|---|---|---|
| Session | `startedAt` | 按 `timezone` 将 `startedAt` 转换为本地日期 |
| Event | `occurredAt` | 按 `timezone` 将 `occurredAt` 转换为本地日期 |
| EnergyRecord | `occurredAt` | 按 `timezone` 将 `occurredAt` 转换为本地日期 |
| UnresolvedInterval | `startedAt` | 按 `timezone` 将 `startedAt` 转换为本地日期 |

`timezone` 在记录写入时取设备当前 IANA 时区名，写入后不修改（见 §2.5）。`localDate` 格式为 `YYYY-MM-DD`，反映业务事件发生时用户的本地日历日期，不是 UTC 日期。

**统计日归属用产品日 `appDate`**：用户可见的"今日 / 每日 / 当日"统计与日 / 周 / 月 / 年聚合，按各实体的**产品日 `appDate`** 归属。`appDate` 在统计查询时按同一基准时间字段、`timezone` 与 `Settings.appDayStartOffsetMinutes` 派生（规则见 §2.5）：

```text
appDate = local date of (基准时间字段在 timezone 下的本地时间 − appDayStartOffsetMinutes 分钟)
```

- 当 `appDayStartOffsetMinutes = 0` 时，`appDate` 与 `localDate` 通常一致；
- 当其 ≠ 0 时，凌晨时段可能归属前一个 `appDate`（例：offset=240、本地 02:00 → `appDate` 归前一自然日）；
- 这些实体当前不存储 `appDate`，由查询层派生，不得直接以 `localDate` 作为用户统计的业务日期。

**本节及 §8 后续各小节适用**：§8 各统计中凡以 `localDate = 目标日期` / `… .localDate = 目标日期` 形式书写的日期筛选条件，以及凡表述为"按某实体 `localDate` 归属 / 以某实体 `localDate` 为准"的日归属，统一按该实体派生的**产品日 `appDate` 归属**解释；当 `appDayStartOffsetMinutes = 0` 时与 `localDate` 等价。各公式不再逐条重复此换算，本节为统一口径锚点。下文部分高频指标已直接改写为 `appDate` 表述，未改写处一律按本锚点解释。

#### 8.2.2 跨凌晨处理

Session 的开始时刻与结束时刻可能跨越自然日边界（如 23:50 开始、00:15 结束）。处理规则如下：

- **整条 Session 归属 `startedAt` 所在日**，不按 `endedAt` 归属，不拆分为两天。
- 示例：`startedAt = 2026-05-31 23:50`、`endedAt = 2026-06-01 00:15`，则 `localDate = 2026-05-31`，该 Session 完整计入 5 月 31 日统计。
- 本规则适用于 focus、shortBreak、longBreak、extraFocus、extraRest 全部 5 种 Session 类型。

EnergyRecord 同理：按 `occurredAt` 所在本地日期归属，不存在拆分问题（单点记录）。

#### 8.2.3 日 / 周 / 月 / 年聚合口径

以下聚合均以各实体派生的**产品日 `appDate`** 为基础（见 §8.2.1）；周 / 月 / 年由 `appDate` 归属推导。当 `appDayStartOffsetMinutes = 0` 时 `appDate` 与 `localDate` 一致。

**日统计**

筛选条件：`entity.appDate = 目标日期`（格式 `YYYY-MM-DD`）。

**周统计**

周统计以周一为第一天、周日为最后一天。筛选条件：`entity.appDate` 落在目标周周一至周日的 7 天范围内（含首尾两日）。

**月统计**

筛选条件：`entity.appDate` 的年月部分 = 目标年月（`YYYY-MM`），即筛选该年该月全部日期。

**年统计**

筛选条件：`entity.appDate` 的年份部分 = 目标年（`YYYY`），即筛选该年全部日期。

#### 8.2.4 自定义产品日（appDate）说明

用户"一天从几点开始"的需求（如"05:00 起算新的一天"）已确认支持，且不只是统计页偏好，而是整个产品判断"今天 / 每日 / 当日"的全局日边界规则（UI 入口挂账见 §11 #1）。其实现口径为 §2.5 的产品日 `appDate`：由各实体业务时间字段、`timezone` 与 `Settings.appDayStartOffsetMinutes` 派生，`localDate` 事实自然日含义不变、不受影响。

- Phase 1 `appDayStartOffsetMinutes` 固定默认 `0`，此时 `appDate` 与 `localDate` 一致，但**数据层与统计查询层从一开始即按 `appDate` 口径设计**（不把 `localDate` 当业务日期）；
- 当 `appDayStartOffsetMinutes ≠ 0`（后续开放 UI 后），凌晨时段可能归属前一个 `appDate`，日 / 周 / 月 / 年聚合随之按 `appDate` 重新解释历史记录；
- 各实体当前不新增 `appDate` 存储字段（DayPlan 例外，见 §3.2），统计查询层按 §2.5 / §8.2.1 派生。
- **重新解释只针对查询时派生 `appDate` 的实体**（Session / Event / EnergyRecord / UnresolvedInterval）：offset 修改后，这些实体的产品日归属在查询时按新偏移重新派生。**DayPlan 是例外**：`DayPlan.appDate` 是创建时落库的业务键，offset 修改后**不自动重写、不自动改名、不自动迁移**（见 §2.5 规则 6、§3.2 关键规则 10）。涉及 DayPlan 的预算使用率、今日任务列表、每日模板生成等，按 DayPlan 已存的 `appDate` 解释，不随 offset 修改自动重排历史 DayPlan。

（早期草稿中以 `statsDate` / `statsDayStartOffsetMinutes` 表达的"自定义统计日"方案已被统一为产品日 `appDate` / `appDayStartOffsetMinutes`，不再使用 `statsDate` 命名。）

---

### 8.3 有效番茄数与专注时长

#### 8.3.1 有效番茄数

**定义**：一轮标准 focus Session 正常响铃完成即为一个有效番茄。

**筛选条件**：

```
Session.type === 'focus'
&& Session.status === 'completed'
&& Session.deletedAt === null
```

**数据来源字段**：`Session.type`、`Session.status`、`Session.startedAt`（日归属按 §8.2 派生为产品日 `appDate`；`Session.localDate` 为底层事实日期）。

**排除规则**：以下均不计入有效番茄数：

- `focus.status='discarded'`：中途停止或主动作废的 focus；
- `type='extraFocus'`：由 UnresolvedInterval 归类产生的额外专注（见 §8.1.3）；
- break 的任何状态：break 是否完成 / 跳过不影响对应 focus 是否为有效番茄；
- `completionSource='manual'` 的任务完成：手动完成任务不产生额外有效番茄，有效番茄只从 Session 派生，与 Task 完成方式无关。

**聚合公式**：

```
日有效番茄数 = count(Session where type='focus' and status='completed'
                       and deletedAt === null and appDate = 目标日期)
```

周 / 月 / 年有效番茄数：将 `appDate` 筛选范围扩展至对应时段（见 §8.2.3）。

#### 8.3.2 标准专注时长

**定义**：所有已完成的标准 focus Session 的实际专注秒数之和。

**数据来源字段**：`Session.actualDuration`（单位：秒，表示该 Session 在收尾 / 归类时确认的实际持续时长；写入后固定，不随 Settings 后续变更追溯修改）。

**筛选条件**：

```
Session.type === 'focus'
&& Session.status === 'completed'
&& Session.deletedAt === null
```

**公式**：

```
标准专注时长（秒）= sum(Session.actualDuration
                        where type='focus' and status='completed'
                        and deletedAt === null)
```

#### 8.3.3 额外专注时长

**定义**：所有 extraFocus Session 的实际专注秒数之和。extraFocus 由用户对 UnresolvedInterval 归类产生，不属于标准番茄流程，不计入有效番茄数。

**筛选条件**：

```
Session.type === 'extraFocus'
&& Session.deletedAt === null
```

（extraFocus 的 status 恒为 `'completed'`，见 §3.3，无需额外筛选 status。）

**公式**：

```
额外专注时长（秒）= sum(Session.actualDuration
                        where type='extraFocus'
                        and deletedAt === null)
```

**重要约束**：额外专注时长必须与标准专注时长分开计算，不得合并后无差别对外呈现。

#### 8.3.4 总专注时长

**定义**：标准专注时长（§8.3.2）、额外专注时长与作废专注时长之和，反映用户在目标时段实际投入专注的全部时间（含已完成、额外归类与中途作废的真实专注时间）。

**公式**：

```
总专注时长 =
  标准专注时长     // 见 §8.3.2
  + 额外专注时长   // 见 §8.3.3
  + 作废专注时长   // 见 §8.3.5
```

总专注时长可作为合计值展示，但明细层必须能区分标准专注时长、额外专注时长、作废专注时长三部分来源，不得无差别合并。作废 focus 计入总专注时长，只表示这段时间用户确实在专注，不代表它是番茄成果——它仍不计入有效番茄数、完整番茄循环数等成果类指标（见 §8.3.5）。

#### 8.3.5 作废专注时长（诊断指标）

**定义**：所有 `focus.status='discarded'` Session 的实际专注秒数之和。作废 focus 是用户已真实投入的专注时间，因此**计入总专注时长**（见 §8.3.4），但必须在明细中与标准专注时长、额外专注时长拆开，不得无差别合并。

**公式**：

```
作废专注时长（秒）= sum(Session.actualDuration
                         where type='focus'
                         and status='discarded'
                         and deletedAt === null)
```

**约束**：作废 focus 算真实专注时间，不算番茄成果。以下成果类指标均不计入作废 focus：

- 有效番茄数；
- 完整番茄循环数；
- Task 有效番茄数；
- 预估准确率 / 预估偏差；
- 累计完整番茄数。

---

### 8.4 完整番茄循环与完整番茄组

本节定义三个层级递进的番茄结构指标：有效番茄数（§8.3.1，只看 focus completed）、**完整番茄循环数**（focus completed + 对应 break completed）、**完整番茄组数**（连续 `longBreakEvery` 轮完整循环且末轮为 longBreak completed）。三者口径不同，不得混用。

#### 8.4.1 完整番茄循环定义

**定义**：一轮完整番茄循环 = 一个标准 focus completed + 对应该 focus 的标准 break（shortBreak / longBreak）completed。它衡量"一次专注 + 对应休息"是否结构完整，区别于有效番茄数（后者只看 focus 是否 completed，不看休息）。

**判定条件**：

```
focus.type === 'focus'
&& focus.status === 'completed'
&& focus.deletedAt === null

存在一条 break 满足：
  break.type in ['shortBreak', 'longBreak']
  && break.status === 'completed'
  && break.sourceFocusSessionId === focus.id
  && break.deletedAt === null

且满足 §8.4.2 流程连续性规则
```

**与有效番茄数的关系**：

- 有效番茄数只看 focus completed（§8.3.1）；
- 完整番茄循环数额外要求其对应 break 也 completed；
- 因此完整番茄循环数 ≤ 有效番茄数。focus completed 但 break skipped / 缺失 → 有效番茄 +1、完整循环 +0。

**排除**：

- `focus.status='discarded'`：不计入（既非有效番茄，也非完整循环）；
- `extraFocus`：不计入完整循环；但若夹在 completed 标准 focus 与对应 completed break 之间，不打断该轮循环（见 §8.4.2 B 条）；
- `extraRest`：不能补足 / 替代标准 break，不能使某 focus 事后变为完整循环；
- **收工豁免不等于完整循环**：若 completed 标准 focus 后通过 `dayPlan.workEnded` 明确收工、未进入 completed break，该 focus 仍为有效番茄，但不构成完整番茄循环。收工豁免只影响 §8.6.4 休息统计分母，不改变本节完整循环判定（见 §8.6.4 收工豁免）。

**日期归属**：一轮完整循环按该轮**标准 focus 的产品日 `appDate`** 归属，与有效番茄数同一归属基准。当 focus 与其对应 break 跨日分属两天时，该完整循环仍计入 focus 所在日，不按 break 的归属日。以下为 `appDayStartOffsetMinutes = 0`（`appDate` 与 `localDate` 一致）时的跨凌晨示例：focus 23:50 completed 归 5/31、break 00:10 completed 归 6/01，则该完整循环计入 focus 所在日 5/31，不按 break 归属，以免同一轮的"有效番茄"与"完整循环"落在不同统计日。

**聚合公式**：

```
日完整番茄循环数 =
  count(标准 focus where
        type='focus'
        and status='completed'
        and deletedAt === null
        and 该 focus 满足完整番茄循环判定（含 §8.4.2）
        and focus.appDate = 目标日期)
```

周 / 月 / 年：将 `focus.appDate` 筛选范围扩展至对应时段（见 §8.2.3）。

#### 8.4.2 流程连续性规则

完整番茄循环要求对应 break 仍属于该 focus 的"连续收尾流程"，而非事后补休息。本规范不采用固定时间上限（如"focus 完成后 2 小时内开始休息"），改用流程连续性判断。当前 v4 中，部分中断场景有明确事件 / 字段锚点，可程序判定；部分场景暂无统一锚点，仅作产品语义边界说明。§8 不发明新的判定逻辑、不新增事件或流程状态字段。

**A. 可程序判定的中断条件**：

对于某个 completed 标准 focus，若不存在一条 `sourceFocusSessionId === focus.id` 且 `status='completed'` 的标准 break，则该 focus 不构成完整循环。若存在指向该 focus 的 break 但其状态为 `skipped` 或其他非 `completed` 状态，同样不构成完整循环。

此外，当新的标准 focus 已经开始、而上一轮 focus 仍没有对应 completed break 时，表示已进入下一轮专注，上一轮不能再被后续 break 倒算补足。

**B. 允许夹入、不打断本轮循环的情况**：

由 §7.11 UnresolvedInterval 归类产生的 `extraFocus`，夹在 completed 标准 focus 与对应 completed break 之间。流程为：标准 focus completed → extraFocus completed → 对应 break completed，仍算一轮完整循环。此时 `break.sourceFocusSessionId` 必须指向原 completed 标准 focus，而非 extraFocus（见 §8.4.1）。

**C. 流程关闭以 skipped 标准 break 为锚点（已确认）**：

当本轮标准 break 机会被产品流程明确关闭时，应写入一条对应的 skipped 标准 break Session（`type ∈ {'shortBreak','longBreak'}`、`status='skipped'`、`actualDuration=0`，`skipKind` 与 `sourceFocusSessionId` 按 §3.3 / §7.6 / §7.11 既有口径取值），作为该 focus 标准休息机会的关闭锚点。该 skipped break 即落入上述 A 条可程序判定的中断条件：对应 focus 仍计入有效番茄，但不再构成完整循环，后续 completed break 也不得倒算补足（见 D 条）。

> 流程关闭必须基于明确产品流程或恢复流程节点（用户点击跳过、产品要求回应休息收尾但用户长期无响应、App 关闭 / 崩溃后恢复流程确认不补本轮 break、用户开始新一轮标准 focus 而上一轮 break 机会已关闭等）。**不得**仅凭用户长时间无鼠标 / 键盘操作、窗口失焦、用户打开别的页面，或系统层面"无活动"等行为，自动推断"用户没有休息"或"流程关闭"。

**D. 不得倒算**：后续 break 不得倒回来把更早的 focus 补算为完整循环。用户已跳过该 break、对应 break 已写为 skipped、已开始新一轮标准 focus 等情形，均见上述 A 条与 C 条边界说明。

**E. 任务管理事件不作中断锚点**：`task.*` / `dayPlan.*` / `triage.*` 等任务管理事件不属于番茄计时流程，不得被当作"中断本轮 focus → break 收尾流程"的判定锚点。

#### 8.4.3 longBreak 触发节奏 vs 完整番茄组

`longBreak` 的触发节奏与"完整番茄组"统计是两个不同概念，不得混为一谈：

- **longBreak 触发节奏**：决定"第几个 focus 后该进入长休"，用于保护用户休息；
- **完整番茄组统计**：衡量结构完整的番茄实践，要求连续 4 轮完整循环且末轮为 longBreak completed（当前产品口径 `longBreakEvery` 固定为 4）。

**longBreak 触发节奏口径**：

- longBreak 触发主要跟随 completed 标准 focus 的累计节奏；
- 当前产品口径下 `longBreakEvery` 固定为 4，第 4 个 completed 标准 focus 后触发 longBreak；
- 中间某轮 shortBreak 被 skipped / 缺失，不阻止后续 longBreak 触发。

> `longBreak` 触发节奏不按单个 Task 的 `pomodoroIndex` 判断，而按当前标准番茄流程中 completed 标准 focus 的累计节奏判断；`pomodoroIndex` 仅用于 Task 内 focus 顺序追溯，不作为完整番茄组连续性或 `longBreak` 触发的唯一依据。

例如：用户在 A 任务做 2 个番茄、再在 B 任务做 2 个番茄，第 4 个 completed 标准 focus 后仍应触发 longBreak，而不应因为单个 Task 内尚未到第 4 个 focus 就不触发。

**但"触发了 longBreak" ≠ "该段可统计为完整番茄组"**。示例：

```text
第 1 个 focus completed + shortBreak completed   → 完整循环
第 2 个 focus completed + shortBreak completed   → 完整循环
第 3 个 focus completed，但 shortBreak skipped / 缺失 → 不是完整循环
第 4 个 focus completed                          → 应触发 longBreak
```

若第 4 个 focus 后 longBreak completed，则第 4 轮算一轮完整番茄循环；但由于第 3 轮缺少 completed break，这 4 轮不能统计为一组完整番茄组。

> `longBreak` 触发节奏用于保护用户休息，主要跟随 completed 标准 focus 的累计节奏；完整番茄组统计用于衡量结构完整的番茄实践，必须要求 4 轮完整番茄循环（`longBreakEvery` 固定为 4），且最后一轮为 completed longBreak。中间 shortBreak skipped / 缺失时，不影响后续 longBreak 触发，但会导致该段实践不能被统计为完整番茄组。

#### 8.4.4 完整番茄组定义

**定义**：当前产品口径下，完整番茄组由连续 4 轮完整番茄循环构成，且最后一轮的对应 break 为 longBreak completed（`longBreakEvery` 固定为 4、UI 不开放修改，仅作未来预留 / 历史兼容字段，不表示 Phase 1–4 用户可配置）。即：

```text
3 轮：focus completed + shortBreak completed
+
1 轮：focus completed + longBreak completed
```

即 4 轮均为完整番茄循环（§8.4.1），且第 4 轮确实完成长休。

**连续性按"完整循环序列"判断，不按 `pomodoroIndex` 严格连号**：

- 完整番茄组按完整番茄循环序列判断，而非要求 `pomodoroIndex` 完全连号；
- `focus.discarded` 不计入有效番茄、不计入完整循环、不计入 Task 有效番茄、不参与预估准确率，**但不打断完整番茄组累计**——一个作废 focus 只是一次失败 / 中止的标准番茄尝试，不应抹掉其前后已完成的完整循环；
- `extraFocus` 不计入完整循环；若夹在 completed 标准 focus 与对应 completed break 之间，也不打断该轮循环或完整番茄组累计（见 §8.4.2 B 条）；
- **真正影响完整番茄组统计资格的**，是某个 completed 标准 focus 没有形成完整循环（对应 break skipped / 缺失 / 不属于连续收尾流程）。

**口径（`longBreakEvery` 固定为 4）**：

> 当前产品口径下 `longBreakEvery` 固定为 4、UI 不开放修改，因此完整番茄组 = 连续 4 轮完整番茄循环，且最后一轮对应 break 为 completed longBreak。

`longBreakEvery` 作为未来预留字段，若将来开放为可配置项，再行确认一组番茄未完成期间变更设置的归属规则（届时回填本节）。

**时段聚合归属**：完整番茄组的成立条件不变（连续 `longBreakEvery` 轮完整循环，且最后一轮对应 break 为 longBreak completed）。当一组完整番茄组跨产品日 / 周 / 月 / 年边界时，该组在日 / 周 / 月 / 年统计中**统一归属到组内第 1 轮标准 focus 的 `appDate`**；周 / 月 / 年归属由该第 1 轮标准 focus 的 `appDate` 推导。**不**按末轮 focus 的 `appDate`、longBreak 的 `appDate`，也不按 longBreak 的 completed 时间归属。

理由：末轮之所以成为"第 `longBreakEvery` 轮"，正因为其前已存在第 1、2、3……轮，因此该组应归属于它被启动 / 建立的产品周期，而非最终收尾完成的产品周期。这与 §8.4.1 已确认的"单轮完整循环按本轮标准 focus 的 `appDate` 归属、不按 break 完成日归属"保持一致。

跨日示例（`appDayStartOffsetMinutes = 0`）：

- 5/31 22:30 第 1 轮完整循环
- 5/31 23:00 第 2 轮完整循环
- 5/31 23:30 第 3 轮完整循环
- 6/01 00:00 第 4 轮完整循环 + longBreak completed

这 4 轮构成一组完整番茄组。该组归属 **5/31**，而非 6/01，因为组首轮标准 focus 的 `appDate` 是 5/31。

本归属口径仅由查询 / 统计逻辑按已有 Session 链路派生，不新增 `groupAppDate` / `completedGroupAt` / `groupStartedAt` 等字段。

---

### 8.5 任务统计

本节定义 Task 维度的统计口径：有效番茄数、专注时长、预估准确 / 偏差、任务完成数与手动完成区分、跨天任务呈现。番茄数与时长一律从 Session 派生，不从 Task 字段直接读取（§3.1 关键规则 1、§8.1.1）。

#### 8.5.1 Task 有效番茄数

**定义**：某 Task 的有效番茄数 = 该 Task 下满足有效番茄条件（§8.3.1）的标准 focus Session 数。

**筛选条件**：

```
Session.taskId === task.id
&& Session.type === 'focus'
&& Session.status === 'completed'
&& Session.deletedAt === null
```

**排除**（均不计入 Task 有效番茄数）：`focus.discarded`、`extraFocus`、`shortBreak`、`longBreak`、`extraRest`。

**两个口径：今日新增 vs 历史累计**

```
今日新增有效番茄数（某 Task）=
  count(Session where taskId=task.id and type='focus' and status='completed'
        and deletedAt===null and appDate = 目标日期)

completedValidFocusCountForTask（历史累计有效番茄数）=
  count(Session where taskId=task.id and type='focus' and status='completed'
        and deletedAt===null)   // 全时间段，不限日期
```

- **日统计主口径为"今日新增"**：跨天继续同一 Task 时，日统计页展示该 Task 当天新增有效番茄数，而非历史累计（详见 §8.5.5）；
- 历史累计有效番茄数 `completedValidFocusCountForTask` 由该 Task 下 completed 标准 focus Session 派生，作明细辅助展示。

**与 `remainingPomodoros` 的分工**：

> `remainingPomodoros` 将在 §8.10 基于 `completedValidFocusCountForTask` 派生。

§8.5 不展开 DayPlan 预算 / 今日排期余量公式，避免任务统计与今日预算统计混在一起。

#### 8.5.2 Task 专注时长

**定义**：某 Task 的专注总时长含标准专注时长、额外专注时长、作废专注时长三部分，反映该任务上的真实投入时间，必须拆开，不得无差别合并。一句话口径：**时间按真实投入算，番茄成果按 completed 标准 focus 算。**

```
Task 标准专注时长 =
  sum(Session.actualDuration where taskId=task.id
      and type='focus' and status='completed' and deletedAt===null)

Task 额外专注时长 =
  sum(Session.actualDuration where taskId=task.id
      and type='extraFocus' and deletedAt===null)

Task 作废专注时长 =
  sum(Session.actualDuration where taskId=task.id
      and type='focus' and status='discarded' and deletedAt===null)

Task 专注总时长 = Task 标准专注时长 + Task 额外专注时长 + Task 作废专注时长
```

**约束**：

- Task 有效番茄数仍然只统计 `type='focus' && status='completed'` 的标准 focus（§8.5.1）；`focus.status='discarded'` 与 `extraFocus` 均不计入 Task 有效番茄数；
- `extraFocus` 计入 Task 专注总时长明细，但不计入 Task 有效番茄数、不计入完整循环、不参与预估准确率；其 `taskId` 继承归类时用户确认的 Task（§7.11）；
- `focus.status='discarded'` 的 `actualDuration` 计入 Task 专注总时长（与 §8.3.4 全局总专注时长含作废的口径一致），用于反映该任务上的真实投入时间，但不计入 Task 有效番茄成果；
- 展示或明细层必须拆分为标准专注时长 / 额外专注时长 / 作废专注时长三部分，不得无差别合并。

#### 8.5.3 预估准确 / 预估偏差

**适用范围**：仅针对已完成（completed）且通过番茄流程完成的 Task。手动完成任务默认不作样本（见 §8.5.4）。

**样本筛选条件**：

```ts
预估准确 / 偏差统计样本 =
  task.completed Event
  && completionSource === 'pomodoro'
  && validFocusCountAtCompletion != null
  && estimateRounds.length >= 1
```

- `completionSource === 'manual'` 的任务不进入"番茄完成任务预估准确率"样本（见 §8.5.4）；
- 缺少 `validFocusCountAtCompletion`（`null`）的历史数据 / 旧数据不进入该统计样本，避免用实时 Session 反推污染完成时快照口径；
- `estimateRounds.length === 0` 属于数据异常或旧数据缺失，不进入预估准确 / 偏差样本。

**完成时快照**：使用 `task.completed` 事件 payload 的 `validFocusCountAtCompletion`（§7.1）——任务完成那一刻该 Task 已累计的有效标准 focus 数。不使用实时派生总和，以免被后续数据修复 / 恢复 / 补关联反向改变。

**严格口径（只认初始预估）**：仅当 `estimateRounds.length === 1` 且 `validFocusCountAtCompletion === estimateRounds[0].pomodoros` 时，算"初始预估准确"。发生二次 / 三次预估（`estimateRounds.length > 1`）一律视为初始预估不准确——即使最终预估值恰好等于实际值，也不计为准确。

**三分法（按首次预估值 `estimateRounds[0].pomodoros` 判断方向）**：

```ts
validFocusCountAtCompletion === estimateRounds[0].pomodoros
→ 初始预估准确

validFocusCountAtCompletion < estimateRounds[0].pomodoros
→ 初始预估偏大

validFocusCountAtCompletion > estimateRounds[0].pomodoros
→ 初始预估偏小
```

**"超预估"不另设指标**：在已完成任务统计语境下，"超预估"等同于"初始预估偏小"（实际 > 首次预估），不单独设独立指标，避免重复。UI 层未来可把"初始预估偏大"与"初始预估偏小"合并展示为"预估偏差"，但数据层统计口径保留方向。

**进行中任务不定义"已超预估"指标**：

> 对进行中任务，不定义"已超预估"用户统计指标。当当前有效标准 focus 数达到当前 `Task.estimatedPomodoros` 而任务仍未完成时，应由任务完成检查、二次预估或拆分提示流程承接，不允许静默继续累积到"超预估"状态。**特别地，当某 Task 已用满 7 个有效标准 focus（产品硬上限）仍未完成时，按严格路线 A 进入 `splitNeeded`（见 §3.1 关键规则 10、§7.15），在拆分 / 归档 / 重新处理流程解除前不允许直接开启第 8 个标准 focus；用户关闭拆分提示不解除该限制。** 若历史数据、旧版本数据、恢复流程或 bug 导致出现 `completedValidFocusCountForTask > Task.estimatedPomodoros` 且任务仍 active，应视为数据一致性 / 流程异常边界，后续在错误诊断或恢复流程中处理，不进入 §8.5 用户统计主指标。

#### 8.5.4 任务完成数与"手动完成 vs 番茄完成"

**任务完成数**：某时段内完成的 Task 数。数据源为 `task.completed` 事件，按该 Event 派生的产品日 `appDate` 归属统计时段；`appDate` 由事件发生时间、`timezone` 与 `appDayStartOffsetMinutes` 派生（§8.2.1，`offset = 0` 时与 `Event.localDate` 一致）。`completedAt` 作为任务完成的业务时间，应与该事件时间语义保持一致，但**统计归属以 `task.completed` 事件的产品日为准**，不需另从 `completedAt` 临时派生日期。（§8.1.3：涉及历史完成时点的统计应使用 `task.completed` 事件，不按 Task 当前状态简单计数。）

```
今日完成任务数 =
  count(task.completed Event where Event.appDate = 目标日期)
```

**手动完成 vs 番茄完成的区分**：依据 `task.completed` payload 的 `completionSource`（§7.1，取值 `'pomodoro'` / `'manual'`；`null` 表示未完成，不进完成数）。

```
今日番茄完成任务数 = count(task.completed where appDate=目标日期 and completionSource === 'pomodoro')
今日手动完成任务数 = count(task.completed where appDate=目标日期 and completionSource === 'manual')
```

区分必须用 `=== 'pomodoro'` / `=== 'manual'` 精确匹配，**不得**用 `completionSource !== 'manual'`——因为 `completionSource = null` 的未完成任务也满足 `!== 'manual'`，会被误算入番茄完成数。

**手动完成与番茄统计的关系**（沿用本节手动完成口径）：

- `completionSource='manual'` 的任务**计入**任务完成数（含手动完成数）；
- 但**不计入**有效番茄数、完整番茄循环数、预估准确率（有效番茄只从 Session 派生，与 Task 完成方式无关，见 §8.3.1）；
- 默认不作"番茄完成任务预估准确率"的样本：

> 手动完成任务不作为"番茄完成任务预估准确率"的样本；若未来需要统计手动完成任务的预估偏差，应另设任务管理统计口径，不与番茄完成任务混算。

**提前完成的两种数据语义**（避免误读 `completionSource`）：

任务在达到预估前提前完成，按完成时是否处于"completed 标准 focus 后的收尾流程"分两种来源，统计归属不同：

- **A. completed 标准 focus 后提前完成 → `completionSource='pomodoro'`**。
  例：预估 3 个番茄，用户在第 2 个 completed 标准 focus 后，于任务完成确认入口 / 收尾流程中确认任务完成 → `Task.completionSource='pomodoro'`、`validFocusCountAtCompletion=2`。该任务进入"番茄完成任务"，并按 §8.5.3 三分法判为**初始预估偏大**（`2 < estimateRounds[0].pomodoros`）。`completionSource='pomodoro'` 不要求恰好达到 `estimatedPomodoros`，只表示任务是在 completed 标准 focus 后的收尾 / 确认流程中完成的。

- **B. focus 进行中作废后完成 → `focus.discarded` + `completionSource='manual'`**。
  例：预估 3 个番茄，用户在第 2 个 focus 进行到 5 分钟时确认任务已完成 → 拆为两个动作：`focus.discarded`（这轮标准 focus 未 completed）+ `task.completed(completionSource='manual')`。该作废 focus 的 5 分钟计入 Task 专注总时长（§8.5.2 作废专注时长），但**不**计入有效番茄；该任务**不进入**"番茄完成任务预估准确率"样本——因为它不是由 completed 标准 focus 后的收尾流程完成，而是用户直接确认任务已完成。

一句话区分：**是否经由 completed 标准 focus 的收尾流程完成，决定 `completionSource` 取 `'pomodoro'` 还是 `'manual'`，而非是否达到预估数。** 任务提前完成入口的具体 UI 形态由实现自由选择；其 `prompt.shown(taskCompletionCheck)` 触发口径已确认（见 §7.15、§8.5.4）。

#### 8.5.5 跨天任务的呈现

跨天继续同一 Task 时，日统计与历史累计分别呈现：

- **日统计主口径 = 该 Task 当天新增有效番茄数**（§8.5.1 今日新增口径）；
- 历史累计有效番茄数 `completedValidFocusCountForTask` 作辅助明细，不作为日统计主数字。

**示例**：某 Task 在 5 月 30 日完成 2 个有效标准 focus、5 月 31 日继续完成 3 个，则 5 月 31 日日统计页中该 Task 的"今日有效番茄数"为 **3**（当天新增），而非历史累计 5；任务详情 / 明细可辅助展示"今日新增 3 / 历史累计 5"。

**任务完成归属**：跨天任务按 `task.completed` Event 派生的产品日 `appDate` 计入"完成任务数"（§8.2.1，`offset = 0` 时与 `Event.localDate` 一致）；`completedAt` 仅作为任务完成业务时间，应与事件时间语义保持一致，但统计归属以该事件的产品日为准，不另从 `completedAt` 派生（与 §8.5.4 一致）。与有效番茄数按各 Session 当天归属互不冲突。

**预算占用**：跨天继续任务时，DayPlan 预算按 `remainingPomodoros` 占用、不按总预估重复占用，相关口径见 §8.10。

---

**§8.5 范围边界说明（任务生命周期统计本轮不展开）**

> 拆分归档与血缘的基础数据结构与事件已落地（§3.1、§7.1），不再挂账。拆分频率、拆分归档率、完成归档率等指标属于后续任务生命周期统计 / 运营统计，不是 §8 当前必须继续展开的基础统计口径，本节不展开。后续如需要运营分析，可在任务生命周期统计或可运营性数据章节中确认是否引入这些指标（见 §14【D6】）；当前不阻塞 §8 基础统计口径。

---

### 8.6 休息统计

本节定义休息相关基础统计：标准休息时长、额外休息时长、总休息时长、休息完成率与跳过率。休息时长与跳过率的**主指标合并** `shortBreak + longBreak`（统称"标准休息"），明细层可按 `break.type` 拆分短休 / 长休。休息恢复效果（`recoveryDelta`）的短休 / 长休分析见 §8.7，不在本节展开。

#### 8.6.1 标准休息时长

**主指标**：

```
标准休息时长 =
  sum(Session.actualDuration
      where type in ['shortBreak', 'longBreak']
      and status='completed'
      and deletedAt === null)
```

**明细（按 `break.type` 拆分）**：

```
短休时长 = sum(Session.actualDuration where type='shortBreak' and status='completed' and deletedAt===null)
长休时长 = sum(Session.actualDuration where type='longBreak'  and status='completed' and deletedAt===null)
```

**排除**：`break.status='skipped'` 的 `actualDuration` 固定为 0，不计入任何休息时长（§8.1.3）。

#### 8.6.2 额外休息时长

**定义**：所有 extraRest Session 的实际休息秒数之和。extraRest 由 §7.11 UnresolvedInterval 归类产生，不属标准休息流程，不计入完整番茄循环（§8.1.3）。

```
额外休息时长 = sum(Session.actualDuration where type='extraRest' and deletedAt === null)
```

（extraRest 的 status 恒为 `'completed'`，见 §3.3，无需额外筛选 status。）

#### 8.6.3 总休息时长

```
总休息时长 = 标准休息时长 + 额外休息时长
```

总休息时长可作合计值展示，但明细层必须拆分为标准休息时长（短 / 长）与额外休息时长，不得无差别合并。

#### 8.6.4 休息完成率与跳过率

**分母：应休息次数**。每完成一个标准 focus，理论上对应一次标准休息机会，故分母取"应触发 break 的 completed 标准 focus 数"（分母口径选项 b），但需扣除"收工豁免"的 focus（见下方"收工豁免"）：

```
应休息次数 =
  count(Session where type='focus' and status='completed' and deletedAt === null)
  − 收工豁免 focus 数
```

不采用 `completed break + skipped break` 作分母——否则会漏掉 break 缺失 / 未生成 / 未收尾的情况，导致统计偏好看。

**收工豁免（已确认）**：当某个 completed 标准 focus 后既没有 completed 标准 break、也没有 skipped 标准 break，但存在指向该 focus（或可由收工流程判定为该 focus 后收工）的有效 `dayPlan.workEnded` 收工锚点时，该 focus 的标准休息机会被豁免，不构成"应休息"样本：

```
收工豁免 focus 数 =
  count(标准 focus where
        type='focus' and status='completed' and deletedAt===null
        and 不存在 sourceFocusSessionId 指向该 focus 的 completed 或 skipped 标准 break
        and 存在有效 dayPlan.workEnded 锚点指向该 focus
            （payload.endedAfterFocusSessionId = focus.id，或经收工流程判定为该 focus 后收工）)
```

收工豁免的统计影响：

- 该 focus 仍计入有效番茄（§8.3.1）；
- 该 focus 不计入完整番茄循环（§8.4.1，因无 completed break）；
- 该 focus 不计入应休息次数分母；
- 不计入 completed 标准 break 分子；
- 不写成、也不计入任何 skipped 标准 break（含 `explicitSkip` / `noResponse` / `missed` / `appClosed`）；
- 不计入休息缺失 / 未收尾；
- 不计入主动跳过率、未响应率、错过率。

收工豁免**不是**跳过休息，也不是休息失败，而是"本次标准 break 机会被收工豁免、应休息机会不存在"。**不得**把收工豁免写成 `break.skipped`，也不得写 `skipKind`。收工豁免必须以明确的 `dayPlan.workEnded` 锚点为依据，**不得**仅凭页面关闭、窗口失焦、长时间无操作或"未开始下一轮 break / focus"自动推断（见 §7.3 `dayPlan.workEnded`，以及 §8.4.2 C 条禁止行为猜测口径）。

**分母为 0 的规则**：当 `应休息次数 = 0` 时，标准休息完成率、主动跳过率、未响应率、错过率、App 关闭未完成率等所有以应休息次数为分母的比例均为 `null` / 无数据，不显示为 0（0% 会被误解为"该休息但完全没休息"，但真实情况是没有应休息样本；沿用 §8 缺样本不补 0 原则）。

**标准休息完成率**：

```
标准休息完成率 = completed 标准 break 数 / 应休息次数

completed 标准 break 数 =
  count(Session where type in ['shortBreak','longBreak'] and status='completed' and deletedAt===null)
```

**主动跳过率（主指标，只统计 `skipKind='explicitSkip'`）**：

```
标准休息主动跳过率 =
  count(Session where type in ['shortBreak','longBreak']
        and status='skipped' and skipKind='explicitSkip' and deletedAt===null)
  / 应休息次数
```

**skipKind 拆分（明细 / 后续项，不并入主动跳过率）**：`break.skipped` 的 skipKind 有**四类**（§3.3 / §7.6）：`explicitSkip`（用户主动跳过休息）/ `noResponse`（休息提示出现后用户未回应）/ `missed`（错过 / 未进入休息）/ `appClosed`（页面关闭、App 退出或崩溃导致休息流程未完成）。四类都应被识别；只有 `explicitSkip` 进入"主动跳过率"主指标，`noResponse` / `missed` / `appClosed` 单独拆出、**不并入主动跳过率**，避免把"未回应""错过流程""App 关闭"误说成"主动跳过"：

```
未响应率 =
  count(Session where type in ['shortBreak','longBreak']
        and status='skipped' and skipKind='noResponse' and deletedAt===null)
  / 应休息次数

错过率 =
  count(Session where type in ['shortBreak','longBreak']
        and status='skipped' and skipKind='missed' and deletedAt===null)
  / 应休息次数

App 关闭未完成率 =
  count(Session where type in ['shortBreak','longBreak']
        and status='skipped' and skipKind='appClosed' and deletedAt===null)
  / 应休息次数
```

**短休 / 长休主动跳过率明细**：拆分时分母应使用对应类型的"应触发次数"，而非一律用所有 completed focus 数：

```
短休主动跳过率 = count(shortBreak skipped, skipKind='explicitSkip') / 应触发 shortBreak 的次数
长休主动跳过率 = count(longBreak  skipped, skipKind='explicitSkip') / 应触发 longBreak 的次数
```

当前产品口径下，长休触发节点固定为每第 4 个 completed 标准 focus（`longBreakEvery` 固定为 4，不作为用户可配置项；用户当前可设置专注时长、短休时长、长休时长，不支持把"每几个番茄进入长休"从 4 改为其他值）。短休 / 长休应触发次数按当前标准番茄流程中的 completed 标准 focus 序列计算：第 4、8、12… 个 completed 标准 focus 应触发 longBreak，其余 completed 标准 focus 应触发 shortBreak。

```
应触发 longBreak 的次数 =
  当前标准番茄流程 completed 标准 focus 序列中第 4、8、12… 个 focus 的数量

应触发 shortBreak 的次数 =
  应休息次数 - 应触发 longBreak 的次数
```

该累计节奏不按单个 Task 的 `pomodoroIndex` 判断，而按当前标准番茄流程中的 completed focus 累计节奏判断（§8.4.3）。例如 A 任务做 2 个 completed focus、B 任务做 2 个 completed focus，第 4 个 completed 标准 focus 后仍应触发 longBreak。

**休息缺失 / 未收尾不隐形吞掉**：当 `应休息次数 > (completed 标准 break 数 + 全部 skipped 标准 break 数)` 时——其中"全部 skipped 标准 break 数"含 `explicitSkip` / `noResponse` / `missed` / `appClosed` 四类，所有 skipped break（包括 `appClosed`）都应先从缺失里扣除，不得把 `appClosed` 误算为"没有休息记录"——差额为休息缺失 / 未生成 / 未收尾（active break 断裂等情形交 §7.11 处理）。该差额应作为"休息缺失 / 未收尾"原因明细或后续统计项呈现，不得隐形并入完成率分子或任一跳过率，以免统计偏好看。此处 `应休息次数` 已按上文扣除收工豁免 focus，因此收工豁免不会被误算为休息缺失 / 未收尾。

> 收工豁免规则已确认并落地：每个 completed 标准 focus 默认对应一次标准休息机会，但经 `dayPlan.workEnded` 明确收工的 focus 从分母中豁免（见上方"收工豁免"）。本规则只处理"明确收工"场景；focus → break 连续流程是否关闭、skipped 后不可倒算等判定见 §8.4.2。

---

### 8.7 休息恢复效果

本节定义休息恢复效果指标 `recoveryDelta` 的计算口径。`recoveryDelta` 衡量一次休息前后能量是否恢复，是统计 / 展示时动态派生的值，不写入 EnergyRecord 本体（§3.5）。

#### 8.7.1 recoveryDelta 定义与关联链路

**基础含义**：

```
recoveryDelta = 休息后 energyLevel − 休息前 energyLevel
```

正值表示休息后能量回升，负值表示休息后能量更低，0 表示无变化。`energyLevel` 取值为整数 1–10（§3.5）。

**短休 recoveryDelta**（对一条 `status='completed'` 的 shortBreak Session）：

```
短休 recoveryDelta =
  EnergyRecord(source='afterShortBreak', sessionId = shortBreak.id).energyLevel
  −
  EnergyRecord(source='afterFocus', sessionId = shortBreak.sourceFocusSessionId 指向的 focus.id).energyLevel
```

**长休 recoveryDelta**（对一条 `status='completed'` 的 longBreak Session）：

```
长休 recoveryDelta =
  EnergyRecord(source='afterLongBreak', sessionId = longBreak.id).energyLevel
  −
  EnergyRecord(source='afterFocus', sessionId = longBreak.sourceFocusSessionId 指向的 focus.id).energyLevel
```

**关联规则（必须依链路，不靠时序）**：

```
break Session
→ break.sourceFocusSessionId → 对应 completed focus
→ afterFocus EnergyRecord（sessionId = 该 focus.id）              // 休息前基准
→ afterShortBreak / afterLongBreak EnergyRecord（sessionId = 该 break.id）  // 休息后
```

不得用"时间上最近的一条 EnergyRecord"粗暴推断前后关系。

**基准范围限定**：`beforeFocus`、`onReturn`、`dayStart`、`manual` 等 Session 外或非配对的 EnergyRecord 不作为默认 recoveryDelta 基准；它们可用于能量曲线等其他自我觉察统计（§8.8），但不参与某次标准休息的恢复效果计算。

**软删除过滤**：参与 `recoveryDelta` 计算的 break Session、`sourceFocusSessionId` 指向的 focus Session，以及休息前 / 休息后的 EnergyRecord，均必须满足 `deletedAt === null`。已软删除的 Session 或 EnergyRecord 不参与 recoveryDelta 计算：

```
break.deletedAt === null
focus.deletedAt === null
beforeEnergyRecord.deletedAt === null   // afterFocus
afterEnergyRecord.deletedAt === null    // afterShortBreak / afterLongBreak
```

**时段归属**：每条 recoveryDelta 样本按其 break Session 派生的产品日 `appDate` 归属（§8.2.1；`appDayStartOffsetMinutes = 0` 时与 `localDate` 一致），用于日 / 周 / 月 / 年聚合。

#### 8.7.2 样本有效性与缺失处理

**缺记录不计算、不补 0**：休息前 `afterFocus` 与休息后 `afterShortBreak` / `afterLongBreak` 任一缺失时，该次休息不计算 recoveryDelta：

| 休息前 afterFocus | 休息后 afterShortBreak / afterLongBreak | 是否计算 recoveryDelta |
|---|---|---|
| 有 | 有 | 计算 |
| 缺 | 有 | 不计算 |
| 有 | 缺 | 不计算 |
| 缺 | 缺 | 不计算 |

"不计算"不代表该次休息无效，也不代表 recoveryDelta = 0；只表示样本不足、无法可靠判断恢复效果。补 0 会误导性拉低平均值。

**四个统计量（必须区分）**：对某个休息活动（或某类休息整体）——

- **使用次数**：该休息项目被实际选择 / 该类休息被实际进入的总次数；
- **有效恢复样本数**：其中可计算 recoveryDelta 的次数（前后 EnergyRecord 齐全）；
- **样本不足次数**：使用了但缺前 / 后 EnergyRecord、无法计算 recoveryDelta 的次数；
- **平均恢复效果**：仅基于有效恢复样本计算。

**平均恢复效果公式（分母只用有效样本）**：

```
平均恢复效果 = sum(可计算的 recoveryDelta) / 有效恢复样本数
```

不得写成 `sum(可计算的 recoveryDelta) / 使用次数`——样本不足不能按 0 处理，否则会误导性拉低平均值。

示例：某休息项目使用 5 次，其中 4 次前后记录齐全、1 次缺失 → 使用次数 = 5、有效恢复样本数 = 4、样本不足次数 = 1、平均恢复效果 = 4 次 recoveryDelta 之和 / 4（不是 / 5）。

#### 8.7.3 休息活动恢复效果排行

**分组维度**：按 break Session 的 `actualRest`（用户实际选择的休息活动 key；字段属 Session / break.completed 相关语义，key 来源见 Settings.restSuggestions / §3.7、§7.7）分组，分别在短休内部、长休内部排行；不做短休 vs 长休跨类型对比（两者场景、时长、目的不同，直接比较无可比性、易误导）。

单活动的四个统计量沿用 §8.7.2 的区分（使用次数不等于可计算 recoveryDelta 的次数）：

```
单活动使用次数 =
  count(completed break
        where actualRest = 该活动 key
        and type = 对应的 shortBreak / longBreak
        and deletedAt === null)

单活动有效恢复样本数 =
  上述使用次数中，前后 EnergyRecord 齐全、可计算 recoveryDelta 的次数

单活动样本不足次数 =
  单活动使用次数 - 单活动有效恢复样本数

单活动平均恢复效果 =
  sum(有效样本的 recoveryDelta) / 单活动有效恢复样本数
```

短休活动按 `type='shortBreak'`、长休活动按 `type='longBreak'` 分别套用上式；短休排行与长休排行各自独立成榜，不混入同一榜单。

**单活动缺样本规则**：当单活动有效恢复样本数为 0 时，单活动平均恢复效果为 `null` / 无数据；可展示该活动的使用次数与样本不足次数，但不展示平均恢复效果为 0（沿用 §8.7.2 缺样本不补 0 原则）。

**`actualRest = null` 的 break（用户进入休息但未选活动）**：无活动 key 可归属，**不进入任何单个休息活动排行**；但其 recoveryDelta 若可计算，仍计入"该类休息整体平均恢复效果"作为不区分活动的总体基准（口径选项 b）。即：

- 单活动排行：仅 `actualRest` 非 null 的 completed break 进入对应活动的使用次数 / 有效恢复样本 / 平均恢复效果；
- 整体平均（短休整体 / 长休整体）：该类全部 completed break 中可计算 recoveryDelta 的样本均计入，含 `actualRest = null` 的 break。

---

### 8.8 能量趋势

本节定义能量趋势统计口径，数据源为 EnergyRecord（§3.5）。所有聚合按 EnergyRecord 派生的**产品日 `appDate`** 归属（见 §8.2.1、§8.2.4）；Phase 1 `appDayStartOffsetMinutes = 0` 时与 `localDate` 一致，offset ≠ 0 时凌晨记录可能归前一产品日（UI 入口挂账见 §11 #1）。休息恢复效果（`recoveryDelta`）见 §8.7，本节只看能量水平随时间的变化。

#### 8.8.1 日视图能量曲线

**用途**：回答"用户今天的能量如何随时间变化"。

**坐标**：

```
x = EnergyRecord.occurredAt 对应的本地时刻（HH:mm）
y = EnergyRecord.energyLevel（整数 1–10）
```

**数据范围**：当天（`EnergyRecord.appDate = 目标日期`、`deletedAt === null`）的**全部** EnergyRecord，不限 source，按 `occurredAt` 时间顺序排列。各 source（`dayStart` / `beforeFocus` / `afterFocus` / `afterShortBreak` / `afterLongBreak` / `afterExtraFocus` / `afterExtraRest` / `onReturn` / `manual`）均纳入当天能量时间线。

**不采用相对时刻**：日视图 x 轴用绝对时刻 HH:mm，不用"专注第几分钟"。

**同一 / 相近时刻多条记录**：同一时刻或相近时刻存在多条 EnergyRecord 时，统计口径保留全部记录；具体点位重叠、标签显示、视觉避让或视觉抽样由 UI 层处理，§8 不规定图表展示细节。某些场景下 `afterFocus`、`afterShortBreak`、`manual` 等记录可能时间很接近，不应在数据口径层面丢弃。

#### 8.8.2 周 / 月 / 年能量趋势

**用途**：观察长期能量趋势。每一天聚合为一个点，趋势是逐日 `dailyAverageEnergy` 序列，不是把整段时间的 EnergyRecord 混合成单一均值。

**每日平均能量与样本数**：

```
dailyAverageEnergy(某日) =
  average(EnergyRecord.energyLevel where appDate = 该日 and deletedAt === null)

energySampleCount(某日) =
  count(EnergyRecord where appDate = 该日 and deletedAt === null)
```

**无记录不补 0**：

```
若该日无 EnergyRecord：
  energySampleCount = 0
  dailyAverageEnergy = null   // 显示为空缺 / 无数据，不补 0
```

补 0 会误导用户以为当天能量极低，而实际只是没有记录。

**保留样本数**：每个日点应保留 `energySampleCount`，便于区分"稳定平均"与"单次记录值"——如某天只有 1 条记录，可展示该点，但应理解为单次记录值，不是稳定平均。

周 / 月 / 年聚合范围按 §8.2.3 扩展 `appDate` 筛选区间；每个日点仍按单日 `dailyAverageEnergy` 计算。

**区间总览平均能量（暂不定义主口径）**：若未来新增周 / 月 / 年"区间总览平均能量"，应单独定义是按原始 EnergyRecord 加权平均，还是按每日 `dailyAverageEnergy` 等权平均；两者含义不同（例如某天记录 10 条、另一日仅 1 条时，两种算法结果不同）。本节暂只定义逐日趋势点，不定义区间总览均值主口径。

#### 8.8.3 不作主口径 / 暂不启用项

- **`dayStart` 不代表整天能量**：`source='dayStart'` 只代表当天开始时的能量状态，不能代表整天整体水平；不得用 `dayStart.energyLevel` 替代 `dailyAverageEnergy` 作周 / 月 / 年主趋势指标。未来如需，可单独设计"起始能量趋势"指标，不在本轮主口径。
- **中位能量暂不作主口径**：本轮周 / 月 / 年趋势用每日平均能量，不用每日中位数作主指标；中位数留作未来高级统计或后续优化项。
- **mood 暂不启用**：`EnergyRecord.mood` 保持 schema 预留（§3.5），Phase 1 写 null；统计页不展示 mood 曲线，不定义 mood 趋势。未来如需情绪趋势，再单独扩展 mood 采集与展示口径。

---

### 8.9 应对打扰统计

本节定义应对打扰统计口径。统一使用"应对打扰"表述（指用户在标准 focus 过程中记录 / 应对的打扰次数），数据来源为 Event，不使用旧原型的 Task 字段。

#### 8.9.1 数据来源与术语

**数据来源**：`interrupt.internal` / `interrupt.external` 两类事件（§7.8）。每条事件顶层带 `sessionId`（正在进行的 focus Session）、`taskId`、可选 `dayPlanId`，payload 含 `offsetSeconds`（距该 focus `startedAt` 的已过秒数，≥ 0）。打扰次数从事件派生，不存在 Session 字段上（§3.3 关键规则 8）。

不得继续使用旧原型字段：

```
task.interrupts.internal
task.interrupts.external
```

**触发边界**（§7.8）：interrupt 只在标准 focus active 期间触发；break / extraFocus 期间不触发 interrupt。因此应对打扰统计天然只覆盖标准 focus 内的打扰。

**术语**：统计页统一用"应对打扰总数 / 内部应对打扰数 / 外部应对打扰数"，不写"今日专注打扰总数"。

#### 8.9.2 应对打扰总数与内 / 外拆分

按 `interrupt` 事件派生的产品日 `appDate` 归属统计时段（§8.1.2、§8.2.1；`appDayStartOffsetMinutes = 0` 时与 `Event.localDate` 一致；Event 为 append-only，不适用软删除过滤）：

```
内部应对打扰数 = count(interrupt.internal where Event.appDate = 目标日期)
外部应对打扰数 = count(interrupt.external where Event.appDate = 目标日期)
应对打扰总数   = 内部应对打扰数 + 外部应对打扰数
```

本指标按 interrupt 事件本身计数，覆盖标准 focus active 期间发生的 interrupt；其对应 focus 可为 `completed` 或 `discarded`。若需衡量有效番茄内的打扰强度，使用 §8.9.3 的"平均每个有效番茄的应对打扰次数"。

**关联 Session 软删除边界**：interrupt Event 本身为 append-only、不做软删除过滤；但用户统计中的 interrupt 应关联到存在且未软删除的标准 focus Session。若其关联 Session 缺失或已软删除（`Session.deletedAt !== null`），该 interrupt 仅保留审计 / 诊断，不进入用户统计主指标（应对打扰总数、内 / 外拆分、平均每有效番茄等）。

日视图必须能在口径层面区分内部 / 外部；展示形式（数字 / 标签 / 明细 / 图形 / 是否两根柱子）由 UI 决定，§8 不强制。周 / 月 / 年：将 `appDate` 筛选范围扩展至对应时段（§8.2.3）。

#### 8.9.3 平均每个有效番茄的应对打扰次数（主趋势指标）

**用途**：衡量用户平均每完成一轮有效番茄，中间需应对多少次打扰。

**分子分母必须匹配**：以 completed 标准 focus 为单位，分母为该批 focus 数，分子为这些 focus 上发生的 interrupt 数：

```
完成标准 focus 集合（目标日期）=
  Session where type='focus' and status='completed' and deletedAt===null and appDate=目标日期

平均每个有效番茄的应对打扰次数 =
  count(interrupt.* where sessionId ∈ 完成标准 focus 集合)
  / count(完成标准 focus 集合)
```

分子只统计 `sessionId` 指向 completed 标准 focus 的 interrupt（内部 + 外部）。

**分母为 0 的规则**：当完成标准 focus 集合为空时，本指标为 `null` / 无数据，不显示为 0。0 表示"有有效番茄且没有打扰"；`null` 表示"没有有效番茄，无法计算平均值"。这与 §8 "缺样本不补 0"的原则一致。

**discarded focus 内的 interrupt**：可进入"应对打扰总数"（§8.9.2，按事件计数）、任务级番茄历史明细（§8.9.4）、作废番茄相关诊断指标；但**不进入本指标分子**——其对应 focus 不是有效番茄，本指标分子分母都只限 completed 标准 focus。

**可拆内 / 外**（同一分母，分子分别取内 / 外）：

```
平均每个有效番茄的内部应对打扰次数 =
  count(interrupt.internal where sessionId ∈ 完成标准 focus 集合) / count(完成标准 focus 集合)

平均每个有效番茄的外部应对打扰次数 =
  count(interrupt.external where sessionId ∈ 完成标准 focus 集合) / count(完成标准 focus 集合)
```

可用于周 / 月趋势，观察用户应对内部 / 外部打扰的能力是否改善。

#### 8.9.4 任务级番茄历史明细

**用途**：展示某 Task 下每一轮标准 focus 的完成 / 作废状态，以及该 focus 内的 `interrupt.internal` / `interrupt.external`。

**按真实顺序生成**：明细应按 Task 下标准 focus Session 的真实发生顺序生成；对每个标准 focus Session：

```
按 interrupt.offsetSeconds 排序渲染该 session 内的 interrupt 事件
→ 最后渲染该 focus 的 completed / discarded 结果状态
```

不得只用 completed 总数、作废总数、interrupt 总数倒推（会丢失"完成、作废、再完成"的真实顺序）。

**只占标准 focus 槽位**：记录轴 / 历史明细的槽位对应标准 focus Session。以下不作为有效番茄槽位：extraFocus、shortBreak、longBreak、extraRest。extraFocus 可作额外专注明细展示，但不进入标准番茄位序。

**UI 符号不固定**：§8 只定义数据来源与统计语义；记录轴的具体符号、颜色、形状（含内 / 外打扰标记、预估位形状、completed / discarded 符号等）属 UI 层，见 §11 后置实现清单，不写入 §8 正文。

#### 8.9.5 周 / 月 / 年趋势与不作主指标项

**周 / 月 / 年趋势**（汇总，不展示复杂每任务记录轴）：

- 每日应对打扰总数趋势；
- 每日平均每个有效番茄的应对打扰次数趋势；
- 可选：每日内部 / 外部打扰趋势。

**不作主指标 / 不必保留**：

- "平均每个任务的应对打扰次数"不作主指标（不同任务大小不同，按任务平均会失真；任务维度打扰由 §8.9.4 历史明细表达）；
- 笨重的"每任务打扰分布卡片"不必保留——已有任务级番茄历史明细即可；
- 作废与打扰的因果（`focus.discarded.payload.triggeredByInterruptEventId`，见 §7.5）属明细 / 诊断口径：仅在用户主动指认时存在、不普遍存在，**不作主指标**，也不得据时间接近反推；若未来要分析"打扰导致作废率"，应在运营 / 诊断口径单独定义，不在 §8 主统计默认纳入。

---

### 8.10 DayPlan 预算相关

本节定义两个与 DayPlan 预算相关、但用途不同的派生指标：DayPlan 预算使用率（统计页复盘）与今日排期余量（今日待办 / DayPlan 规划页）。两者都基于 `DayPlan.budgetPomodoros`，但不得混称为"今日剩余预算"。聚合按**产品日 `appDate`** 归属，见 §8.2.1 与 §8.2.3；"今日"指当前 `appDate`，DayPlan 业务键即 `appDate`（§3.2）；自定义产品日见 §8.2.4 / §11 #1。

#### 8.10.1 两个概念的区分

| 指标 | 用途 | 回答的问题 |
|---|---|---|
| DayPlan 预算使用率 | 统计页复盘 | 今天计划做多少番茄，实际完成了多少有效番茄？ |
| 今日排期余量 | 今日待办 / DayPlan 规划页（"余 N"） | 按当前预算与今日任务剩余量，今天理论上还剩多少可安排番茄？ |

统计页主指标是预算使用率；"余 N"（今日排期余量）是今日待办页指标，不作统计页主指标。二者含义不同，不混称。

#### 8.10.2 DayPlan 预算使用率（统计页主指标）

**定义**：当天已完成有效标准 focus 数占当天 DayPlan 预算的比例。

```
今日已完成有效标准 focus 数 =
  count(Session where type='focus' and status='completed'
        and deletedAt===null and appDate=目标日期)

budgetUsageRate（DayPlan 预算使用率）=
  今日已完成有效标准 focus 数 / DayPlan.budgetPomodoros
```

- 分子为当天**全部** completed 标准 focus，不限于 `DayPlan.taskIds` 内的任务（衡量当天整体执行量 vs 预算）；
- **不按任务细分**：统计页展示总体预算使用率，不把预算拆到每个任务；任务层面复盘（今日完成 / 未完成哪些任务、各任务今日新增 / 历史累计有效番茄、预估准确 / 偏差）见 §8.5；
- **无数据 / 分母为 0 的规则**（沿用 §8 除零规则，§8.9.3）：
  - 当目标日期不存在未软删除的 DayPlan，或目标日期 DayPlan 已软删除（`DayPlan.deletedAt !== null`）时，预算使用率为 `null` / 无数据，不显示为 0；
  - 当存在有效 DayPlan 但 `DayPlan.budgetPomodoros = 0` 时，同样为 `null` / 无数据；
  - 区分：没有预算 / 没有 DayPlan → `null` / 无数据；有预算但完成 0 个有效 focus → 0%（`0` 只表示"有预算且实际完成有效标准 focus 为 0"）。

示例：budgetPomodoros = 8、今日已完成有效标准 focus = 5 → 预算使用率 = 5 / 8 = 62.5%。

#### 8.10.3 remainingPomodoros 与今日排期余量

**remainingPomodoros（单任务剩余番茄数）**：

```
remainingPomodoros（某 Task）=
  max(0, Task.estimatedPomodoros − completedValidFocusCountForTask)
```

`completedValidFocusCountForTask` 为该 Task 历史累计有效番茄数（§8.5.1：该 Task 下 completed 标准 focus Session 数，全时间段）。`Task.estimatedPomodoros` 是任务整体总预估，不是今日预估、不是剩余预估；跨天继续任务时按 `remainingPomodoros` 占用预算，不按总预估重复占用。

**今日排期余量（todayPlanningCapacityRemaining，今日待办 / DayPlan 页指标）**：

```
todayPlanningCapacityRemaining =
  DayPlan.budgetPomodoros
  − 今日已完成有效标准 focus 数
  − Σ(DayPlan.taskIds 中未完成任务的 remainingPomodoros)
```

- "未完成任务"的精确条件：

  ```
  Task.id ∈ DayPlan.taskIds
  && Task.deletedAt === null
  && Task.status not in ['completed', 'archived', 'deleted']
  ```

  `splitNeeded` 仍视为未完成、仍需处理的任务状态，在进入归档终态前继续按 `remainingPomodoros` 占用今日排期余量。若用户后续完成拆分归档，原 Task 进入 `archived`，则原 Task 不再占用今日排期；拆分产生的新 Task 是否进入今日待办、如何占用预算，按 `DayPlan.taskIds` 与各自 `remainingPomodoros` 重新计算。
- **可为负**：今日任务剩余量超过预算时为负 / 超载状态；Phase 1 只提示超载，不强制禁止继续添加任务；
- **不等于"今天还能实际完成几个番茄"**：它是计划排期指标，不预测用户剩余体力 / 时间 / 执行能力，只回答"按当前预算与今日任务剩余量，计划容量还剩多少"；
- 属今日待办 / DayPlan 规划页指标，**不作统计页主指标**（统计页主指标见 §8.10.2）。

示例：budgetPomodoros = 8、今日已完成有效标准 focus = 3、未完成任务 remainingPomodoros 之和 = 7 → 今日排期余量 = 8 − 3 − 7 = −2（超出预算 2 个番茄）。

---

### 8.11 长期累计统计

本节定义两个长期累计指标：累计完整番茄数、累计专注时长。两者语义不同、不可互相替代——前者衡量完成了多少轮"结构完整的专注 + 休息"，后者衡量实际投入了多少专注时间。均为全时间段累计，不限日 / 周 / 月 / 年视图。

#### 8.11.1 累计完整番茄数

**定义**：用户从外部带入的基数，加上本工具内全时间段的完整番茄循环数。

```
累计完整番茄数 =
  lifetimePomodoroBaseline
  + 本工具内全时间段完整番茄循环数

本工具内全时间段完整番茄循环数 =
  count(满足 §8.4 完整番茄循环定义的循环，全时间段，不限日期)
```

- 完整番茄循环沿用 §8.4.1 / §8.4.2 口径（标准 focus completed + 对应 completed break + 流程连续性规则）；`extraFocus` 不计入、`extraRest` 不补足、`focus completed` 但对应 break skipped / 缺失不计入；
- 该指标表达"结构完整的番茄实践次数"（完成了多少轮"专注 + 对应休息"），不是"启动并完成了多少段 focus"，因此区别于累计有效番茄 / 累计有效 focus；
- 本工具内完整番茄循环只统计未软删除 Session 构成的完整循环；已软删除 Session（`deletedAt !== null`）不参与累计；
- 全时间段累计，不限日 / 周 / 月 / 年视图；累计值是单一总数，非逐日序列，不做日期归属切分。

#### 8.11.2 累计专注时长

**定义**：全时间段 completed 标准 focus、extraFocus 与 discarded 标准 focus 的实际专注秒数之和。口径与 §8.3 全局总专注时长、§8.5 Task 专注总时长一致：时间按真实投入算，番茄成果按 completed 标准 focus 算。

```
累计专注时长 =
  sum(全时段 Session.actualDuration
      where type='focus'
      and status='completed'
      and deletedAt===null)
  +
  sum(全时段 Session.actualDuration
      where type='extraFocus'
      and deletedAt===null)
  +
  sum(全时段 Session.actualDuration
      where type='focus'
      and status='discarded'
      and deletedAt===null)
```

- 新增此指标的原因：用户不同阶段可能用不同计时设置（如 25+5、45+10），单纯比较番茄个数会受单轮专注时长设置影响；累计专注时长更稳定地反映实际投入时间；
- `extraFocus` 虽不计入完整番茄循环（§8.4），但它是真实额外专注时间，计入累计专注时长；
- `focus.status='discarded'` **计入**累计专注时长，因为它是真实发生过的专注投入；但**不计入**累计完整番茄数、不计入有效番茄、不计入完整番茄循环、不参与 Task 预估准确率 / 预估偏差（作废 focus 单独的诊断口径见 §8.3.5 作废专注时长）；
- 与累计完整番茄数不可互相替代：前者衡量结构完整的"专注 + 休息"轮数，后者衡量实际专注时间。

#### 8.11.3 lifetimePomodoroBaseline 边界与卡片展示

**baseline 语义与边界**（§3.7 / §7.13，见本节 §8.11）：`Settings.lifetimePomodoroBaseline` 语义为"用户从外部工具或历史记录中手动带入的累计完整番茄基数"（非"累计有效 focus 基数"）。该字段：

- 只作累计完整番茄数的展示基数；
- 不生成 Session、不伪造历史记录；
- 不影响日统计、任务统计、完整番茄循环统计、预估准确率；
- 仅出现在 §8.11.1 累计完整番茄数中。

**卡片展示**（见 §11 后置实现清单）：统计页顶部累计番茄卡片主展示只需展示合计值（如"累计完整番茄：320"），不要求主卡片拆分"历史基数 + 本工具内"。分项来源（历史基数 / 本工具内完整番茄）可作 tooltip / 展开说明，具体 UI 展示方式属 UI 挂账（见 §11），不写入本节统计口径。

---

### 8.12 明确不进用户统计的数据

本节收尾归纳哪些数据不进入面向用户的统计主指标，区分三类边界：完全不进任何统计、进诊断 / 明细但不进用户主指标、运营 / 演示 / 诊断边界。详细排除规则以 §8.1.3 为权威来源，本节不重复罗列。

#### 8.12.1 完全不进任何用户统计的数据

以下数据不进入任何面向用户的统计指标（权威清单见 §8.1.3）：

- **Event 管理 / 诊断域**：`data.*`、`demo.*`、`error.*`、`notification.*`、`prompt.*`、`statsBaseline.*`、`settings.*`——属系统管理、演示、错误诊断、通知、产品内需要用户回应的提示 / 决策记录（UI 形态不限于弹窗）、设置变更记录，不进番茄 / 专注 / 休息 / 能量等用户统计主指标；
- **软删除记录**：`deletedAt !== null` 的可同步实体记录不参与用户统计计算（Event 为 append-only，不适用软删除规则）；
- **UnresolvedInterval `status='ignored'`**：不生成 Session，不进任何专注 / 休息统计；
- **Session Note / Review**（§7.16 当前无事件定义）：每轮备注、日总结等不进统计，统计页不展示。

#### 8.12.2 进诊断 / 明细但不进用户主指标的数据

以下数据在 §8 中已定义口径，但定位为诊断 / 明细 / 边界，不作为面向用户的统计主指标：

- **作废专注时长**（§8.3.5）：`focus.status='discarded'` 的 `actualDuration` 计入总专注时长 / Task 专注总时长 / 累计专注时长（拆为"作废专注时长"明细）；不计入有效番茄数、完整番茄循环数、Task 有效番茄数、预估准确率、累计完整番茄数；
- **休息未响应率 / 错过率**（§8.6.4）：`break.skipped` 中 `skipKind='noResponse'` / `'missed'` 拆出，不并入主"主动跳过率"；
- **休息缺失 / 未收尾**（§8.6.4）：应休息次数与已完成 / 已跳过 break 的差额，作原因明细 / 后续统计项，不隐形并入完成率或跳过率；
- **discarded focus 内的 interrupt**（§8.9.2 / §8.9.3）：可进应对打扰总数、任务级历史明细、作废诊断，但不进"平均每个有效番茄的应对打扰次数"分子。

这些指标可用于诊断与复盘，但展示时应与用户主指标区分，不得混入主指标计算。

#### 8.12.3 运营 / 演示 / 错误诊断边界

- **演示数据**：`demo.*` 操作及演示数据不进用户统计；演示数据策略与 Phase 定位见 §9 / §10；
- **错误诊断**：`error.*` 事件只进本地诊断，不进用户统计；诊断日志导出机制见 §7.18 `diagnosticLog.exported`，可运营性与隐私边界见 §9，UI 入口与文件结构待 §11 展开（待承接项见 §14【22】）；
- **运营边界**：`prompt.*` 若未来用于提示触发率、任务过大风险等产品诊断分析，应在 §9 / §10 / §11 单独定义，不在 §8 主统计默认纳入（§8.1.3）。

---

## 9. 可运营性数据要求

本章规定数据层在**运营与隐私层面的边界口径**：数据存放在哪、对外出口有哪些、哪些数据可被用户看见、哪些只用于诊断与运营分析。本章是导航与边界性质，**不重述** §2 / §3 / §7 / §8 已定义的字段、事件、统计规则，也**不定义具体运营指标公式**（那些属 §8 或后续运营分析口径）；涉及具体规则处一律交叉引用对应章节。

### 9.1 数据存放与本地边界

- Phase 1–4，所有用户数据存储于用户本地（Web 端为浏览器 IndexedDB），**不离开本地、不上传服务器、无远程账号**；常规使用不存在服务端数据副本。
- 多端同步与云端能力 Phase 5+ 才引入（冲突解决预留见 §2.6；云端备份 / 跨设备恢复见 §14【18】）；在此之前不预设任何多设备场景。
- 跨端契约字段（UUID v7 主键、`createdAt/updatedAt/schemaVersion/deletedAt/deviceId/syncedAt` 同步预留字段、`timezone` 等）虽 Phase 1 即落库，但仅为未来同步预留，不代表当前已有同步行为（见 §2）。

### 9.2 数据可见性与记录不可追溯编辑原则

- 本产品鼓励在工作流中**低摩擦记录真实发生的数据**，不做事后整理 / 美化。番茄流程、休息、打扰、能量等记录由流程自然产生；Event 是 append-only 不可变历史（见 §3.4），不软删、不物删。
- 用户可在统计页与必要明细视图查看自己的历史数据，但产品**不提供常规的历史记录编辑 / 删除入口**；数据纠错以"追加新事实"或既有的实体软删除机制为准（见 §2.4），不通过改写历史实现。此处的实体软删除**仅指 §2.4 定义的可软删除实体对象**（如 Task、DayPlan 等）；Event 仍遵循 §3.4 append-only 原则，是不可变历史，**不通过编辑、软删除或物理删除纠错**。
- 不设独立"我的历史"功能页作为可编辑历史档案。如未来确需对个别误填记录（如能量分值）提供修正能力，按 §7.9 所述另立对应事件再行设计，本规范当前不预设历史编辑功能。

### 9.3 隐私与脱敏边界

- Phase 1–4 数据不离开本地，常规使用无对外传输；数据的对外出口只有用户**主动导出**（见 §9.4），导出后由用户自行掌控与决定是否发送。
- `error.*` 诊断数据脱敏底线见 §7.17：`context` / `errorMessage` 不得包含用户正文内容（Task 标题、备注、能量自由文本、完整实体快照等）。本章不重复 `error.*` 字段细节。
- 诊断日志导出（§7.18 `diagnosticLog.exported`）默认仅含 `error.*` 事件与必要 Event 顶层元信息，不含用户正文；更细的脱敏过滤范围、导出文件结构属实现细节，见 §11（待承接项见 §14【22】）。

### 9.4 数据导出与可携带性

- 用户对自身数据有两类**互不合并**的主动导出能力：
  - **全量数据备份** → §7.14 `data.exported`：Web 本地 IndexedDB 全量数据（JSON），用于换浏览器 / 防清除导致丢失。
  - **诊断日志导出** → §7.18 `diagnosticLog.exported`：按 §7.18 定义的时间范围导出 `error.*` 事件及必要 Event 顶层元信息（JSON），用于 Beta 排障。
- 二者目的、范围、隐私边界不同，**不合并为同一入口**；导出格式、payload、范围细节以 §7.14 / §7.18 为权威，本章不重述。
- 多端 / 云端备份与跨设备恢复 Phase 5+ 再设计（见 §14【18】）；当前所有导出均限单设备本地。

### 9.5 演示数据与运营 / 诊断分析边界

- **演示数据**（`demo.*`，§7.14）：Dev-only，与真实用户数据隔离；新用户默认空白、不自动加载；`demo.*` 不进任何用户统计。Phase 定位见 §10。
- **错误诊断**（`error.*`，§7.17）：只进本地诊断，不进用户统计；迁移失败的唯一权威事件为 `data.migrationFailed`，不新增 `error.migrationFailed`（见 §6.4）。
- **产品级运营 / 诊断分析**（如 `prompt.*` 提示触发率、任务过大风险、拆分 / 归档频率等）：不在 §8 用户统计主指标默认纳入（见 §8.1.3、§8.12.3、§14【D6】）；如未来需要，另在运营分析口径中单独定义，不混入面向用户的统计主指标。
- 本章只划运营 / 隐私**边界**，不写具体运营指标公式。

---

## 10. Phase 分级实施计划

本章只划分 Phase 1–5+ 各阶段的**范围方向**，不重述 §7 各事件的 Phase 标注（标注含义见 §7 开头的 Phase 标注表），也不写逐功能实现规则。重构总方针：**只换数据地基**——Phase 1 不做视觉重设计、不重构页面布局、不新增完整 P2/P3 功能流程，也不要求接完所有业务逻辑。

> **"不改交互"的准确边界**：上述方针**不**意味着"任何最小入口都不能加"。Phase 1 允许为了让 v4 数据闭环成立、且现有核心功能不退化，补充**最小必要**的数据入口、初始化逻辑或小型确认 / 错误提示（典型如"当前 appDate DayPlan 最小初始化闭环"，见 §10.2）。任何新增交互必须沿用现有原型视觉风格，不得引入新的设计体系，不得借数据层重构重做交互或扩大为完整功能重做。一句话：禁止大改视觉、禁止重做交互，但允许为数据闭环补最小必要入口。

### 10.1 分级总则（跨 Phase 原则）

- **结构 P1 预留、行为 P2 接入**：Phase 1 必须建立完整数据模型（objectStore / 表结构 / 字段 / 事件类型结构）；自动检测逻辑、UI 入口、真实事件写入等"行为"可后置到 Phase 2 及以后。Phase 1 **不得**以"该功能整节标 P2"为由跳过结构预留（典型如 UnresolvedInterval、`statsBaseline`，逐条说明见 §11）。
- **P1 数据地基范围固定，不因事件清单变大而扩**：§7 事件清单的丰富程度只意味着"数据模型要能承载这些事件"，**不**意味着 Phase 1 要把所有事件的行为逻辑都接上。P1 只建模 / 预留，不要求接完所有业务逻辑。
- **Dev-only 事件与用户统计隔离**：DEV 级事件（迁移审计 `data.migrationCompleted` / `data.migrationFailed`、演示数据 `demo.*`）在任何 Phase 都不进用户统计（见 §7.14、§8.1.3）；演示数据与真实用户数据始终隔离。

### 10.2 Phase 1 · 数据地基（范围）

- **只建模 / 预留**：建立完整数据模型与跨端契约字段（UUID v7 主键、同步预留字段、`timezone` 等，见 §2 / §3），事件类型结构可承载 §7 全部事件；不要求接完所有业务逻辑、自动检测或 UI 入口。
- **当前 appDate DayPlan 最小初始化闭环（P1 必做）**：除建全数据结构外，Phase 1 还必须包含一条"今日待办最小闭环"，用于在已取消 `bucket`（见 §3.1 关键规则 3、§3.2 关键规则 1）的前提下承接今日待办与默认每日模板任务。具体要求：
  - 必须建齐 DayPlan 全字段结构（§3.2）；
  - 用户首次进入应用 / 首次读取当前产品日今日待办时：① 若无 Settings 则先创建默认 Settings；② 若当前 `appDate` 无有效 DayPlan，则创建当天 DayPlan；③ 按 `Settings.dailyTaskTemplates` 中 `autoAddToDayPlan=true` 的模板自动生成当天专属 Task 并加入 `DayPlan.taskIds`（内置 `planningPreparation` 生成「计划准备」1 个番茄、置于首位，`metadata.templateKey='planningPreparation'`、`metadata.source='systemDailyTemplate'`、`estimateRounds[0]` 写 `index=1`/`pomodoros=1`/创建时刻）；
  - 同一次初始化写入的 `settings.initialized`（若确创建了 Settings）、`dayPlan.created`、`task.created(source='systemDailyTemplate')`、`dayPlan.taskAdded(source='systemDailyTemplate')` 必须共享同一 `correlationId`（见 §7.3、§3.4 关键规则 5/8）。
  - **此闭环是数据地基的最小必要部分，不等同于提前实现完整 P2 DayPlan 管理能力**：Phase 1 仍不做完整计划页、预算 / 扣除项编辑 UI、DayPlan 历史复盘、收工流程、今日任务复杂重排交互、DayPlan 统计页真实化与任何视觉重设计——这些属 P2 或后续阶段。DayPlan 完整管理能力的事件 Phase 边界见 §7.3 `dayPlan.created` / `dayPlan.taskAdded` 的"Phase 边界"说明。
- **`appDate` / 用户自定义一天起始时刻**（UI 入口挂账见 §11 #1）：数据层与统计口径**承认这是后续需要处理的需求**。Phase 1 即预留 Settings 字段 `appDayStartOffsetMinutes`（固定默认 `0`，UI 暂不开放修改），且"今天 / 每日 / DayPlan / 今日任务列表 / 预算估算 / 按日统计归属"等内部逻辑一律走 `appDate` 派生，不把 `localDate` 当业务日期（见 §2.5、§3.7、§8.2）。**UI 设置入口后置，具体落地 Phase 待 §11 / 后续产品排期确定，本章不写死。**
- **演示数据**（【D4】）：新用户默认空白、不自动加载；`demo.*` 仅供 Dev 调试入口显式触发（见 §7.14）。

### 10.3 Phase 2 · 接真实数据（范围）

- 在 Phase 1 数据地基之上，把现有功能接入真实数据；行为层（自动检测逻辑、UI 入口、真实事件写入）按"结构 P1 预留、行为 P2 接入"原则落地。
- 本章不列逐功能实现规则；各事件的 Phase 归属见 §7 标注。

### 10.4 Phase 3 · 统计页真实化（范围）

- 统计页从原型 / 占位数据切换为基于真实 Event 与实体的统计；统计公式、口径与排除边界以 §8 为权威，本章不重述。

### 10.5 Phase 4 · 上线前完善（范围）

- 上线前完善面向真实用户的数据管理能力，如本地全量数据备份 / 恢复 / 清空（§7.14 `data.*` 管理类，标 P4）。
- 诊断日志导出（§7.18 `diagnosticLog.exported`）的 Phase 边界：**P1 只在数据规范中预留事件类型结构、payload schema 与隐私边界**，不做真实导出入口、不生成文件、不触发下载；**P2 起**接入真实导出入口、导出文件生成与下载流程；**P4** 完善正式用户可见入口、导出文件结构说明、文案、错误处理与反馈流程（UI 入口见 §11）。Phase 1–4 均不自动上传诊断日志（见 §7.18）。

### 10.6 Phase 5+ · 多端同步与云端能力预留（范围方向）

- Phase 5+ 才考虑多端同步、云端备份、跨设备恢复。
- 相关能力包括：多端数据同步、冲突解决、云端备份 / 恢复等。
- 交叉引用：冲突解决预留字段见 §2.6；云端备份 / 跨设备恢复挂账见 §14【18】。
- 当前**不展开**账号体系、云端架构、同步算法、冲突合并策略、设备间数据迁移细节——本节仅为路线图级别方向说明，不是已确认设计。

---

## 11. 后置实现清单

本章是后置实现清单的**索引**，用于挂账"数据已落地 / 口径已定，但 UI 入口或实现行为尚未接入"的事项。本章只挂账，**不展开**字段、payload、统计公式或实现规则，也**不是第二套 Phase 计划**；每条的数据真值以"数据真值"列引用的章节为准，本章不重复定义。"建议 Phase"为建议性排期参考、非承诺；标"待定"者其具体落地阶段待后续产品排期确定。

| #   | 挂账项                                                | 数据真值                 | 建议 Phase           | 待实现（一句话）                                                                              | 状态                        |
| --- | -------------------------------------------------- | -------------------- | ------------------ | ------------------------------------------------------------------------------------- | ------------------------- |
| 1   | `appDate` / `appDayStartOffsetMinutes` 用户设置入口      | §3.7 / §2.5 / §10.2  | 待定（后续排期，不写死）       | 提供"自定义一天起始时刻"设置 UI                                                                    | 数据已落地，UI 未建               |
| 2   | 改 offset 后历史统计重新派生与提示                              | §8.2 / §2.5          | 待定（随 #1 ）          | offset 变更后，查询时派生 `appDate` 的实体（Session / Event / EnergyRecord / UnresolvedInterval）历史按 `appDate` 重新派生，并视情提示用户；`DayPlan.appDate` 为已落库业务键，不在此自动重派生范围 | 口径已定，行为 / 提示未定            |
| 12  | 历史 DayPlan 重新归属 / 批量迁移 / 改名（如未来需要）                | §2.5 / §3.2          | 待定（专门迁移设计，不在 Phase 1 承诺） | offset 修改后历史 `DayPlan.appDate` 默认不自动重写；如未来确需"历史 DayPlan 重新归属 / 批量迁移 / 改名"，须另开专门数据迁移设计（迁移触发条件、改名规则、与 §7.3 dayPlan.* 事件的关系等） | 默认不迁移，专门迁移设计待立项 |
| 3   | 诊断日志导出入口、文件生成与正式 UI                                | §7.18 / §9.3 / §9.4  | 结构 P1 / 行为 P2 / 正式体验 P4 | 事件结构 / payload / 隐私边界可在数据规范中定义；真实导出入口、导出文件生成、下载流程从 P2 起接入；正式体验（正式入口、文件结构说明、文案、错误处理与反馈流程）可后续完善 | 结构 P1 预留，行为 P2 接入，正式体验待 P4 |
| 4   | UnresolvedInterval 结构预留 / 行为接入                     | §3.6 / §7.11         | 结构 P1 / 行为 P2+     | P1 必须建表与字段结构；P2+ 接自动检测、恢复归类 UI 与真实行为写入                                                | 结构须 P1 预留，行为后置            |
| 5   | `statsBaseline` / `lifetimePomodoroBaseline` UI 承接 | §3.7 / §7.13 / §8.11 | 字段 P1 / 事件与 UI P2+ | `lifetimePomodoroBaseline` 字段 P1 即存在；`statsBaseline.updated` 事件与累计基数调整 UI 作为 P2+ 后续承接 | 字段已落地，事件定义已立，真实触发 / UI 待接 |
| 6   | 一次拖拽产生多事件的实现 / QA checklist                        | §7.3 / §7.4          | P2（随排序 / 层级行为）     | 实现时确认一次拖拽按语义写多事件，并通过 `correlationId` 关联                                               | 高误读风险，实现期校验               |
| 7   | 收工豁免（`dayPlan.workEnded`）UI 入口                     | §7.3 / §8.6.4        | P2+                | 提供"结束今日番茄流程"的用户入口，不由系统自动推断                                                            | 数据 / 口径已落地，UI 未建          |
| 8   | 历史轴打扰符号 UI                                         | §8.9.4               | P3（统计页）            | 历史轴打扰符号的具体呈现（符号不固定）；不回填 §8 口径章                                                        | 数据已落地，UI 挂账               |
| 9   | 累计番茄卡片 UI                                          | §8.11                | P3（统计页）            | 累计番茄 / 专注时长卡片的展示形态                                                                    | 数据已落地，UI 挂账               |
| 10  | 统计指标进入当期 UI 展示的排期                                  | §8                   | P3+ / 后续           | 各统计指标是否 / 何时进入当期 UI 展示，本条仅挂账，具体由后续实现计划承接                                              | §8 只定口径，UI 排期在此承接         |
| 11  | `appDate` 落库性能优化评估                                  | §2.5 / §8.2          | 待定（数据量增长后评估）       | 当前 Event / Session / EnergyRecord / UnresolvedInterval 的产品日归属按"事实时间 + timezone + `appDayStartOffsetMinutes`"查询时派生、不落 `appDate` 字段；未来若数据量显著增长、查询性能成瓶颈，再评估是否增加预计算字段或索引策略 | 后置性能优化，不阻塞 Phase 1（原 §14【37】迁入）|

---

## 14. 待用户复核清单

> 本章记录文档撰写过程中已与用户逐条讨论并确认、但涉及尚未撰写章节、需在对应章节写完后跟进落实的事项，以及撰写过程中发现的待定事项。每条标注待展开位置。已确认事项此前将会删除，而后选择保留，故本章编号不连续。


**【D6】任务生命周期统计指标口径（未来运营分析阶段确认）**

拆分归档与血缘的基础数据面已落地：Task 已包含 `lineageId`、`splitFromTaskId`、`splitIndex`、`outcome` 等字段，§7.1 已定义 `task.split`、`task.archived(outcome='split')`、`task.created(source='splitChild')` 等事件。

待未来运营分析阶段确认：是否展示 / 统计拆分频率、拆分归档率、完成归档率等任务生命周期指标；若需要，应另行定义分子、分母、时间归属与展示口径。

本条不阻塞 Phase 1，也不阻塞 §8 基础统计口径。

---

**【18】多端同步后的云端备份 / 跨设备备份合并 / 云端恢复策略（Phase 5+，本轮不展开）**

本条属于 **Phase 5+** 范围，当前 Web 本地版本不处理，**不阻塞 Phase 1**，也不进入 §11 后置实现清单或 `ui-behavior-backlog.md`。

§7.14 `data.exported` / `data.imported` 当前语义限定为 Web 本地单设备（IndexedDB）的备份与恢复，不预设多设备场景。以下问题留待 Phase 5+ 同步方案或后置数据恢复方案中统一确认，本轮不展开、不预先锁定云存储选型（iCloud / 自建服务 / 第三方云）：

- 多端同步后是否还需要额外的本地备份能力；
- 云端数据与本地备份冲突时如何合并；
- 多个设备各自导出备份后如何交叉恢复；
- 导入备份时是否覆盖云端数据或触发冲突解决流程。
