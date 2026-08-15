# 任务分类与批量分类交接

> 状态：旧基线分支上已完整实现并测试；未合入 main；当前 v4.3 规范仍残留被推翻的“手动清空分类”口径，必须先协调规范再移植。
> 原会话：`6ba8cfa6-cf98-4e7d-bc0d-a29fdb6491b0`
> 原实现分支：`claude/task-category-plan-3a4e6a`
> 最终提交：`b39c0dd`

## 1. 功能目标

给 Task 一个粗粒度类别，用来统计时间投入：

```text
work   工作
study  学习
side   副业
life   生活
null   尚未分类的状态
```

这是固定枚举，不是可增删改名的项目 / 标签系统。功能由三部分组成：首次专注时自动打标、用户手动批量纠偏、统计页按当前分类聚合投入时长。

## 2. 用户最终确认的规则

### 2.1 自动打标

- 每个 Task 生命周期中，只在**第一次 `focus.started`** 时评估一次。
- 用该 Session 的 `startedAt`、timezone 和 appDate 口径计算本地分钟数。
- 命中 `Settings.taskCategoryWindows.morning` 或 `.afternoon` 时，写入当天 `DayPlan.mainCategory`，来源为 `categorySource='auto'`。
- 未命中窗口时不写，保持 `category=null` / `categorySource=null`。
- 若首次专注前已经手动分类，自动规则跳过，不能覆盖用户选择。
- 默认窗口：09:00–12:00、14:00–19:00；为全局设置，不按天单独配置。
- DayPlan 默认主线分类采用简化星期规则：周一至周五默认工作，周六日默认副业；不接法定节假日 / 调休服务。
- 用户可手动改当天 `mainCategory`，但不追溯改写此前已分类的 Task。

### 2.2 手动分类的最终口径

用户明确拍板改为**批量操作**：

- 先选择一个或多个 Task，再统一选工作 / 学习 / 副业 / 生活之一。
- 不提供“清空分类”，不允许用户主动选“未分类”。
- `category=null` 只表示尚未分类、自动未命中或历史记录未分类，不是第五个选项。
- 已有分类可以批量改到另一类。
- 每个实际变更的 Task 写所选 category，并写 `categorySource='manual'`。
- 手动分类后自动打标永远不得覆盖。
- 删除所有“手动清空后是否会再次自动打标”的实现、测试和讨论。
- 批量命令沿用既有批量规范：整批先 preflight；每个 Task 独立事务、独立 `correlationId`；中途失败停止并报告未执行项。
- 已完成 / 已归档 Task 也允许事后分类，因为其历史投入需要进入正确分类桶。
- 选中的 Task 若已经属于目标分类，视为无实际变化：不写库、不发 Event，但不应让整批预检失败。

### 2.3 统计

- 只统计专注投入时长，不定义“按分类有效番茄数”。
- 按 Task 的**当前 category** 聚合，不做分类时点快照。
- 事后改分类后，该 Task 的历史专注时间整体移到新分类，这是用户明确接受的行为。
- 专注时长包含标准、额外和作废三部分，明细口径沿用 Task 专注总时长。
- 合并番茄必须按成员 `taskSegments.actualDuration` 进入各自分类桶，不能把整条 Session 重复记给每个类别。

### 2.4 UI 落点

- 清单页头部有“分类”入口，进入批量选择模式。
- 活动清单、今日待办、已完成、归档历史中的 Task 均可选择。
- 批量工具栏提供“归入”与四个分类；未选分类时执行按钮禁用。
- 设置页把“今日主线分类”和上午 / 下午自动打标窗口放在同一张任务分类卡片里。
- 统计页新增按分类投入时长。

原实现还保留了 Task 详情弹窗里的单任务四选一入口。Claude 当时判断它是“选择一个任务时的快捷路径”，写入规则与批量相同；**用户没有明确回答是否保留**。这不是已确认语义，继续实现前应决定：保留单任务快捷入口，还是只留批量入口。

## 3. 旧分支已经完成的内容

原分支先实现任务分类，再按用户最终决定改成批量分类。主要提交：

| Commit | 内容 |
|---|---|
| `335c3f4` | 合入当时的合并番茄分支并接同步层 |
| `d43bd18` | Task / DayPlan / Settings 分类字段和一致性校验 |
| `73c0254` | 三个新 Event 进入契约与运行时校验 |
| `6f4feda` | 首次专注自动打标与手动命令 |
| `fec2ab2` | 按分类统计投入时长 |
| `792d87f` | 分类、今日主线、窗口设置、统计 UI |
| `3eba35c` | Supabase 增量迁移脚本 |
| `135ff5c` | 改为批量分类，取消清空 |
| `b39c0dd` | 规范和交底文档同步最终批量口径 |

关键代码位置：

- `src/data/commands/batchTaskCommands.ts` → `batchSetTaskCategory`
- `src/data/commands/taskCommands.ts` → `setTaskCategory`
- `src/data/commands/timerCommands.ts` → 首次 focus 自动判定
- `src/data/commands/dayPlanCommands.ts`
- `src/data/commands/settingsCommands.ts`
- `src/data/stats/categoryStats.ts`
- `src/data/commands/taskCategoryCommands.test.ts`
- `src/data/stats/categoryStats.test.ts`
- `src/ui/ActivitiesView.jsx`
- `src/ui/TaskDetailModal.jsx`
- `src/ui/SettingsView.jsx`
- `src/ui/StatsView.jsx`
- `supabase/migration-task-category.sql`

最终验证记录：

- `npm run typecheck` 通过；
- `npm run test:run`：528 tests / 64 files 通过；
- `npm run build` 成功；
- 浏览器清库后实测批量两个任务归入工作、各自产生不同 correlationId；单任务改为生活；无清空入口。

## 4. 为什么不能直接合并 `b39c0dd`

该分支建立在旧 v4.2 和旧合并番茄实现上，之后 main 与 v4.3.2 已发生大幅变化：

- 分支包含自己的一套旧 MergeGroup、Session、timerCommands、validator、迁移和同步修改；
- 当前 v4.3 已废除 `parentId` 并引入 Goal；
- 当前合并番茄统计已改为 `taskSegments` 分段；
- 当前 schemaVersion、EventType、Supabase 表结构均已继续演进；
- 原分支与 main 有多个 merge base，`timerCommands.ts` 等文件已知会冲突。

因此，旧分支应当作为“已验证参考实现”，不要整分支 merge。推荐在 v4.3.2 稳定基线上重新移植分类功能，逐块对照旧提交或手工重实现。

## 5. 当前规范冲突

当前工作树的 `docs/data-layer-spec-v4.3.md` 仍写着：

- `task.categoryChanged.newCategory` 可为 null；
- 手动路径允许设置 / 修改 / 清空；
- 用户可以主动重新清空为未分类。

这些文本已被用户后续的批量分类决定推翻，但 `b39c0dd` 只修了旧分支的 v4.2，没有进入当前 v4.3。

后续正确顺序：

1. 先对当前 v4.3 做一个纯规范原子提交，把 `newCategory` 收紧为非空四类、删除手动清空、补批量交互与事务口径；
2. 再移植 schema / validator / Event / command；
3. 再移植统计、UI 和同步；
4. 不修改历史归档 v4.1 / v4.2 来伪装一致。

## 6. 数据与同步注意事项

- 原实现新增 Supabase 分类字段和 `task_category_windows`，并提供增量 SQL。
- 原 SQL 同时处理过旧 `sessions.task_id` → `task_ids`，但当前项目早已继续升级到 `taskSegments` 和 v4.3.2；不能原样执行旧脚本，应从当前真实线上 schema 生成新的幂等增量迁移。
- 当时用户说工具尚未投入使用，本地 / 云端理论上都没有要保留的数据，并暂停真实多端同步测试。
- 原浏览器旧数据缺少新字段，会被 validator 拒绝；Claude 当时清库后才完成 UI 实测。
- 这些是当时背景，不代表现在可以自动清库或执行云端 SQL。任何破坏性数据操作和远端 DDL 都要重新确认。

## 7. 待完成与验收

### 仍需用户决定

- [ ] 是否保留 Task 详情弹窗里的单任务分类快捷入口；批量入口本身已经确定。
- [ ] 当前 Supabase 到底执行过哪一版 schema，需真实检查后决定迁移脚本。

### 实现验收

- [ ] 当前 v4.3 已删除手动清空和 `newCategory=null`
- [ ] 首次 focus 命中 / 不命中窗口行为正确
- [ ] 手动分类优先于自动分类
- [ ] 批量 preflight、逐项事务、逐项 correlationId
- [ ] 已完成 / 已归档 Task 可补分类
- [ ] 同类重复项 no-op，不发 Event
- [ ] `null` 不出现在用户可选项
- [ ] 改分类后历史统计按当前值迁移
- [ ] 合并 Session 只按 taskSegments 分到分类桶
- [ ] 设置页主线分类与时间窗口可修改
- [ ] 本地 migration、Supabase mapper 和真实多端同步通过
- [ ] 全量 test、typecheck、build 通过
