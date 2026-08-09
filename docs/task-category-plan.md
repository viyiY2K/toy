# 任务分类 · 实施交底文档

本文档不是数据规范，是给**下一个负责写代码的对话 / agent** 看的交底材料，目的是让实现方不需要用户重新讲一遍需求，就能直接开始写代码。数据层的字段、事件、约束以 `docs/data-layer-spec-v4.2.md` 为唯一权威（`docs/data-layer-spec-v4.md` / `docs/data-layer-spec-v4.1.md` 均为历史存档，已不再有效），本文档只做**索引 + 代码落点建议 + UI 意图说明**，两者冲突时以 v4.2 正文为准。

---

## 1. 这是什么功能

给任务打一个粗粒度的大类标签——**工作 / 学习 / 副业 / 生活**，用于统计页展示"这段时间我在各类事情上分别投入了多少专注时长"。

核心设计是"自动打标为主、手动纠偏为辅"：

- 用户每天设一个"今日主线分类"（默认按简化工作日规则预填：周一至周五=工作，周六日=副业），代表"今天大部分任务应该属于哪一类"。
- 某个任务**第一次开始专注**时，如果这个时刻落在用户配置的"上午 / 下午"两段自动打标时间窗口内，系统就自动把这个任务标成当天的主线分类。
- 命中窗口之外的任务、以及用户不认可自动结果的任务，用户随时可以手动改，**手动一旦发生，自动规则永远不再覆盖这个任务**。
- 没被打过标的任务保留"未分类"，不强制用户分类。

这不是项目管理意义上的"项目/清单"（没有改名、层级、颜色等扩展属性），就是一个受控枚举字段 + 一条统计聚合口径。

---

## 2. 权威数据契约索引（v4.2）

实现时逐条对照，不得与下列章节冲突：

| 内容 | 章节 |
|---|---|
| Task 新增 `category` / `categorySource` 字段、枚举值说明、字段一致性约束 | `data-layer-spec-v4.2.md` §3.1 完整字段定义、关键规则 13、字段一致性约束 10 |
| DayPlan 新增 `mainCategory` / `mainCategorySource`（今日主线分类）、默认预填规则 | §3.2 完整字段定义、关键规则 11、字段一致性约束 5 |
| Settings 新增 `taskCategoryWindows`（上午/下午自动打标时间窗口）、默认值 | §3.7 完整字段定义、taskCategoryWindows 对象结构、关键规则 11/12、字段一致性约束 12 |
| `task.categoryChanged` 事件完整定义（自动判定算法 + 手动路径） | §7.1 |
| `dayPlan.created` payload 扩展（新增 `mainCategory`/`mainCategorySource`）、`dayPlan.mainCategoryChanged` 事件 | §7.3 |
| `settings.initialized` payload 扩展（新增 `taskCategoryWindows`）、`settings.taskCategoryWindowsChanged` 事件 | §7.12 |
| 按分类统计投入时长口径（不含有效番茄数维度、合并番茄钟场景的重复计入说明、读当前值不做快照） | §8.5.6 |

---

## 3. 核心产品规则（给实现者的心智模型速览）

以下是从对话中确认、且已写入 v4.2 的关键行为，实现时必须遵守；细节以 v4.2 对应章节为准：

1. **枚举固定四类 + 未分类**：`'work'` / `'study'` / `'side'` / `'life'` / `null`（未分类）。不做成可自由增删的自定义分类系统——这是刻意的粗粒度设计，避免变成需要维护的项目管理系统。
2. **自动判定只评估一次**：某 Task 生命周期中**首次** `focus.started` 时评估；此后无论后续再开多少轮专注，都不会重新判定。
3. **手动优先级高于自动**：评估那一刻若 `categorySource` 已经是 `'manual'`（用户在开始专注前已经手动设置过），直接跳过自动判定，不覆盖。
4. **判定算法**：取触发评估的那次 focus Session 的 `startedAt`，换算成当天本地时间的分钟数，检查是否落在 `Settings.taskCategoryWindows.morning` 或 `.afternoon` 任一窗口内；命中则 `category` = 该 Session 所属 `appDate` 对应的 `DayPlan.mainCategory`，`categorySource='auto'`；不命中则不写入，保持未分类。
5. **今日主线分类（`DayPlan.mainCategory`）**：DayPlan 创建时按创建当天是否周一至周五预填（**不判断法定节假日与调休**——这是刻意简化，避免维护年度节假日日历的额外工作量）；用户可当天随时手动覆盖，覆盖后事后不追溯改变已经打过标的任务。
6. **时间窗口是全局设置**：固定上午/下午两段（回避午休），不按天单独配置，用户可在设置页调整起止时间，默认 09:00–12:00 / 14:00–19:00。
7. **统计只算时长，不算番茄数**：按分类统计的是"专注投入时长"（标准 + 额外 + 作废三段，沿用 §8.5.2 口径），**不**衍生出"按分类的有效番茄数"这种指标——有效番茄数只反映专注节奏，与分类无关。
8. **统计按当前分类值聚合，不做时点快照**：如果用户事后改了某任务的分类，这个任务名下所有历史专注时长，在统计里都会跟着变成新分类——`task.categoryChanged` 事件留痕"何时因何改变"供审计，但不影响聚合结果本身。这是用户已经明确确认过的口径，不要自作主张改成快照。

---

## 4. 当前代码库对照与落点建议

代码库里有一套已经在用的分阶段实现约定：`src/data/ADR-000X-*.md` 是按 `S5a`（schema shape）→ `S6`（字段一致性校验）→ `S7`（event contract）→ `S8`（commands，落库 + 发事件）→ `S10+`（query views）→ `S13+`（UI）的顺序推进的决策记录。建议这次也按同样的顺序拆阶段、每阶段一个 ADR，方便和历史记录对照。

**重要背景**：v4.1 的合并番茄钟（MergeGroup、`Session.taskIds` 数组）**目前还没有写进代码**——现在代码里 `Session.taskId` 仍是单数（`src/data/schema/session.ts:38`），`Task.mergeGroupId` 也不存在。v4.2 文档里 §8.5.6 的统计公式是按 v4.1 已经定稿的 `taskIds` 数组写的（为了和 §8.5.2 保持同一套公式风格），但**这次实现时目前只有单数 `taskId`**，公式里的 `taskIds.includes(task.id)` 在当前代码库退化为 `Session.taskId === task.id` 即可，等以后合并番茄钟真正落地时再一起升级，不需要这次顺便实现合并番茄钟。

具体落点：

| 阶段 | 内容 | 参考现有代码 |
|---|---|---|
| schema | `Task` 新增 `category` / `categorySource` | [src/data/schema/task.ts](../src/data/schema/task.ts) —参考 `TaskCompletionSource` 类型定义方式（约第 22 行） |
| schema | `DayPlan` 新增 `mainCategory` / `mainCategorySource` | [src/data/schema/dayPlan.ts](../src/data/schema/dayPlan.ts) —参考 `BudgetMode` 字段方式（约第 22、59 行） |
| schema | `Settings` 新增 `taskCategoryWindows` | [src/data/schema/settings.ts](../src/data/schema/settings.ts) —参考 `appDayStartOffsetMinutes` 字段方式（约第 67 行） |
| 校验（S6 对应物） | 新字段的字段一致性约束 | [src/data/validation/task.ts](../src/data/validation/task.ts) / [dayPlan.ts](../src/data/validation/dayPlan.ts) / [settings.ts](../src/data/validation/settings.ts) |
| event contract | `EventType` 联合类型新增三个事件、payload 类型映射 | [src/data/events/contract.ts](../src/data/events/contract.ts) —domain 列表约第 23 行、payload 类型表约第 148/259 行 |
| event 校验 | 新事件 payload schema、顶层关联字段要求 | [src/data/validation/event.ts](../src/data/validation/event.ts) —参考 `'dayPlan.created'` / `'settings.initialized'` 的写法（约第 238、293、331、345 行） |
| commands | 自动判定挂在"任务首次开始专注"这个动作上 | [src/data/commands/timerCommands.ts:80](../src/data/commands/timerCommands.ts:80) `startFocus`——需要判断"这是不是该 Task 的第一次 focus.started"，命中窗口则同事务追加 `task.categoryChanged` |
| commands | 手动设置/修改/清空分类 | [src/data/commands/taskCommands.ts](../src/data/commands/taskCommands.ts) 新增一个 command，参考 `completeTaskManually`（约第 821 行）等既有 command 的事务 + 事件写入模式 |
| commands | DayPlan 创建时预填 `mainCategory` | [src/data/initialization/currentAppDate.ts:114](../src/data/initialization/currentAppDate.ts:114)（`dayPlan.created` 当前在这里发出，P1 最小初始化路径）——需要在这里按星期几算出预填值 |
| commands | 手动覆盖今日主线分类 | 新增 command，参考 [src/data/commands/dayPlanCommands.ts](../src/data/commands/dayPlanCommands.ts) 里 `acceptDayPlanBudget`（约第 301 行）之类"字段变更 + 专属事件"的写法 |
| commands | Settings 初始化写入 `taskCategoryWindows` 默认值 | [src/data/initialization/currentAppDate.ts:69](../src/data/initialization/currentAppDate.ts:69)（`settings.initialized` 在这里发出） |
| commands | 修改自动打标时间窗口 | [src/data/commands/settingsCommands.ts:25](../src/data/commands/settingsCommands.ts:25) `updateTimerSetting`是最接近的参考范式 |
| 统计聚合 | §8.5.6 按分类统计投入时长 | [src/ui/statsViewModel.js](../src/ui/statsViewModel.js) 是现有统计聚合逻辑所在；[src/ui/StatsView.jsx:293](../src/ui/StatsView.jsx:293)（"任务结果" Section 附近）是现有任务维度统计的展示位置，可参考其数据流 |
| UI（打标/改标入口） | 任务详情 / 今日待办 / 活动清单里给出分类选择器 | [src/ui/TaskDetailModal.jsx](../src/ui/TaskDetailModal.jsx)、[src/ui/taskViewModel.js](../src/ui/taskViewModel.js) |
| UI（今日主线分类入口） | 今日计划页或设置页里的当天主线分类选择 | 需要实现方判断放在哪个已有页面，未在对话中定论 |
| UI（时间窗口设置） | 设置页新增上午/下午窗口配置 | [src/ui/SettingsView.jsx](../src/ui/SettingsView.jsx) |

---

## 5. UI / 交互意图（草案级别，允许按现有视觉风格调整）

**重要前提（沿用既有约定）**：本节不是像素级规范。实现时只要求延续产品现有的视觉风格和交互语言，具体样式细节实现方可自行判断，完成后拿给用户验收。

- **分类选择器**：四个固定选项 + 未分类，不需要设计成可扩展的标签系统（没有新增/改名/删除自定义分类的需求）。
- **自动打标不需要额外的用户可见反馈**：命中窗口时静默写入即可，不需要 `prompt.shown` 或类似的弹窗打断——这是背景自动化行为，用户主要通过任务上的分类标记本身、以及统计页的结果感知它，不需要一个"系统刚刚帮你打了标"的通知。
- **手动修改入口**：具体放在任务详情弹窗、今日待办行内、还是活动清单行内，未在对话中定论，实现方可自行判断，只要能覆盖"用户想改哪个任务的分类都能改到"。
- **今日主线分类的展示与修改入口**：未定论，可以放在今日计划页顶部，也可以放进设置页，实现方判断。
- **统计页新增维度**：在现有统计页（`StatsView.jsx`）里新增一块"按分类投入时长"的展示，具体图表形式（横向条形图、饼图、简单的比例列表）不限，参考现有 `Distribution` 组件（约第 122 行）之类的既有图表组件风格。

---

## 6. 明确不在本次范围内

- **法定节假日 / 调休精确判断**：`DayPlan.mainCategory` 默认预填只按"周一至周五"简化工作日规则，不接入节假日日历。这是用户已经明确确认过的简化，不要顺带实现节假日日历。
- **自定义分类 / 可扩展标签系统**：不要把四类枚举做成用户可自由增删改名的标签系统，这是刻意的粗粒度设计。
- **合并番茄钟（MergeGroup）的实现**：v4.1 的合并番茄钟数据规范已经定稿但代码尚未实现（见第 4 节说明），这次实现任务分类不需要顺带做合并番茄钟，也不需要把 `Session.taskId` 升级成 `taskIds` 数组——按当前单数 `taskId` 实现即可。
- **时间窗口按天单独配置**：`taskCategoryWindows` 是全局设置，不要做成"今日临时改一下窗口"的按天配置。
- **统计快照口径**：§8.5.6 明确是"按当前分类值聚合，不做时点快照"，不要自作主张加一层快照逻辑。
- **全局关闭自动打标的开关**：对话中没有出现这个需求，不要顺带加一个"是否启用自动打标"的总开关。

---

## 7. 验收方式

数据层实现完成后，按根目录 `CLAUDE.md` 的工作纪律跑 test/typecheck/build；UI 部分需要在浏览器里实际跑一遍第 3 节列的几个场景（任务首次开始专注命中窗口自动打标、命中窗口外不打标、手动修改后自动规则不再覆盖、今日主线分类默认预填与手动覆盖、时间窗口设置修改、统计页分类时长展示），由用户亲自验收，不能只凭自动化测试通过就判定完成。
