# Goal（中长期主线目标）交接

> 状态：产品语义和 v4.3 规范已完成，代码与 UI 尚未实现。
> 原会话：`d907ea96-8721-4793-bd2b-be4f3b15d206`
> 原规范分支：`claude/mainline-task-discussion-692f08`
> 最终规范提交：`3c9db61`

## 1. 任务背景

最初讨论沿用了 `Task.parentId` 的“母任务 / 子任务”概念，但用户随后明确纠正：真正需要的是“独立任务向上关联一个中长期目标”，不是继续维护一套模糊的任务层级。

最终决定引入独立实体 `Goal`，产品文案可以叫“主线任务”或“中长期主线目标”，代码和数据字段统一使用 `Goal` / `goalId`，避免与 `DayPlan.mainCategory` 的“今日主线分类”混淆。

## 2. 已确认的产品语义

### 2.1 Goal 与 Task 的关系

- Goal 是跨周 / 跨月的中长期目标，如“阅读《人类简史》”。
- Task 是单天可执行、可进入今日待办、可直接开始番茄的具体行动。
- Goal 不是 Task 的一种，也不是可计时单元：
  - 不进入 DayPlan；
  - 不直接开始番茄；
  - 没有预估番茄数；
  - 不受单 Task 最多 7 个番茄的约束。
- 一个 Goal 可关联多个 Task；一个 Task 最多关联一个 Goal。
- Task 可在活动清单、今日待办、完成或归档后关联 / 改绑 / 解除 Goal。
- 统计始终按 Task 当前 `goalId` 聚合。事后改绑会让历史投入数字随之移动，这是用户明确接受的预期行为。
- Task 不能同时属于多个 Goal；如果出现需求，视为 Goal 划分不清，应重新拆目标，不扩展多关联。
- Goal 之间也没有层级，不引入 `parentGoalId`。

### 2.2 废除旧子任务机制

用户明确同意彻底废弃旧的：

- `Task.parentId`
- `subtask.*` 事件域
- `task.reparented`
- 相关两层任务 UI 和命令

当时产品尚未正式投入使用，没有历史数据需要迁移，因此规范决定直接删除，不保留兼容字段或双轨写入。

注意：`docs/mainline-task-notes.md` 仍写着“保留 parentId，主线任务复用母子关系”，这是更早的草案，已经被后续讨论明确推翻，不能作为实现依据。

### 2.3 Goal 与合并番茄钟

- `goalId` 是长期语义归属，`mergeGroupId` 是一次执行层面的临时归并，两者互不影响，可以同时非 null。
- 同一个 MergeGroup 内的成员可以分别属于不同 Goal，也可以有的无 Goal。
- 合并组不能被当作共同 Goal；不能从“同组”推断“同一主线”。
- Goal 投入时长使用成员 Task 的 `taskSegments.actualDuration`，不能拿整条合并 Session 的 25 分钟重复记给多个 Goal。
- 合并成员不获得有效番茄，因此 Goal 的番茄数可能为 0，但分段投入时长大于 0；Goal 展示应以时间为主指标、番茄数为辅助。

### 2.4 Goal 与任务分类

- Goal 自己可以带 `category`：工作 / 学习 / 副业 / 生活 / 未分类。
- `Goal.category` 与名下 Task 的 `Task.category` 独立，不校验、不联动、不追溯覆盖。
- Goal 分类只有手动路径，不使用 Task 的自动打标窗口，因此 Goal 没有 `categorySource`。

### 2.5 状态、完成、归档和删除

- Goal 有 `active`、`completed`、`archived`、`deleted` 状态。
- Goal 完成由用户显式确认：
  - 名下 Task 全部完成不会自动完成 Goal；
  - Goal 完成也不会自动完成 / 归档尚未完成的 Task。
- Goal 完成后可归档；归档中保留两种 outcome：
  - `completed`：目标达成；
  - `abandoned`：目标未达成但决定停止推进。
- 用户最终确认保留 `outcome='abandoned'`，它与完成归档、软删除是三种不同语义。
- Goal 当前不增加期限 / 截止日期字段。未来有明确展示或统计需求时再设计字段、事件和口径。
- 删除 Goal 必须软删除，且不清空名下 Task 的 `goalId`：
  - 历史归属保留；
  - 删除可恢复；
  - 已删除 Goal 的任务统计进入独立“已删除目标”分组；
  - 因影响所有历史任务，删除操作必须弹窗二次确认。

### 2.6 计划页布局与展示意图

用户给出的计划页结构是 2×2 四个模块：

| 第一行 | 第二行 |
|---|---|
| 主线任务 / Goal | 计划外紧急 |
| 活动清单 | 今日待办 |

- “计划外紧急”可以是常驻模块，不必临时出现。
- Goal 清单主要用于在安排今日任务时提醒用户中长期目标，而不是直接计时。
- active Goal 卡片应有简单进度条，并同时显示“已完成 N / 共 M”，不能只给百分比。
- 新增 Task 会改变分母，进度可能从 75% 回退到 50%；用户明确接受，这才反映真实推进情况。
- active Goal 旁可有小图标 / 展开入口，查看已经完成的关联 Task。
- Goal 完成并归档后，在归档视图可直接查看它名下所有已完成 Task。
- 计时页不展示 Goal / 子母关系；计时页只展示独立 Task 或 MergeGroup 执行关系。
- Goal 清单还应展示“最近推进时间”，帮助发现长期未触碰的目标。

### 2.7 统计口径

- 关联任务数：当前 `goalId` 指向 Goal、且未软删除的 Task 数。
- 完成任务数：已完成或完成后归档的关联 Task 数。
- 进度：完成任务数 / 关联任务数；无任务时为 0。
- 有效番茄数：名下 Task 的有效番茄数之和；合并番茄不拆给成员，因此不进入 Goal 番茄数。
- 投入时长（主指标）：名下 Task 的专注总时长；合并场景只取分段。
- 最近推进时间：名下所有 Task 关联 focus 中最晚的 `startedAt`，包含 discarded、extraFocus 和参与合并的 Session。
- 当前归属口径意味着补绑 / 改绑历史 Task 会立即改变历史统计，属于预期行为。

## 3. 已完成的规范工作

`claude/mainline-task-discussion-692f08` 共完成 15 个规范提交，最终为 `3c9db61`。主要成果：

- v4.2 复制为独立 `docs/data-layer-spec-v4.3.md`；
- Task 删除 `parentId`，新增 `goalId`；
- 新增 Goal 实体和字段一致性约束；
- 删除 `subtask` domain 和 `task.reparented`；
- 新增 `task.goalLinked` / `task.goalUnlinked`；
- 新增 9 个 `goal.*` 事件；
- 新增 Goal 统计 §8.13；
- 记录计划页布局、进度、删除恢复、Goal category、abandoned 和无期限等决定；
- 与合并番茄的分段统计口径对齐；
- V43-1～V43-6 全部结案。

当前分支的 `docs/data-layer-spec-v4.3.md` 已经包含这些 Goal 规范，并已随 v4.3.2 数据层收口提交。不要再从 `3c9db61` 整文件覆盖当前版本。

## 4. 尚未实现

规范明确写着：Goal 目前只有定义，没有真实代码和 UI。后续至少需要独立施工计划覆盖：

### 4.1 数据结构与迁移

- Goal schema / factory / validator；
- stores、schemaVersion、IndexedDB migration；
- Task 从 `parentId` 改为 `goalId`，并删除旧层级字段；
- EventType / payload / association / entity consistency；
- Supabase Goal 表、索引、RLS、上传下载映射；
- 旧 parentId / subtask 云端结构的处理。

### 4.2 命令

- Goal 创建、编辑、分类、排序、完成、取消完成、归档、删除、恢复；
- Task 关联 / 改绑 / 解除 Goal；
- 批量把 Task 关联到 Goal；
- 删除 Goal 的二次确认属于 UI，但数据层必须保持软删除与指针保留语义。

### 4.3 查询与统计

- Goal 主线清单；
- 任务数、完成数、进度条；
- 投入番茄、投入时长、最近推进时间；
- 已删除目标分组；
- 归档 Goal 下的历史 Task 展开；
- 当前 `goalId` 改绑后的统计实时迁移。

### 4.4 UI

- 计划页四模块布局；
- Goal 卡片、分类、进度和最近推进；
- active Goal 的已完成任务展开入口；
- Goal 归档详情；
- Task 单个 / 批量关联 Goal；
- 删除二次确认和恢复入口。

## 5. 实现边界与风险

- Goal 是一个大功能，不能在合并番茄或分类任务中顺手实现。
- 删除旧 `parentId` 会触及已存在 UI、命令、查询、事件、同步和测试，必须按可验收小步拆分。
- 历史会话中“当时没有数据，可以直接删”的授权说明了产品数据背景，但后续执行任何清库 / 远端结构删除前仍需重新确认，不能把旧授权无限期当作当前授权。
- 当前 v4.3.2 数据层已完成本地收口提交；Goal 实现应基于该基线另开分支，不要从旧 Goal 讨论分支整包合并。
- 不要把 Goal 重新做成 Task、DayPlan 项或可直接计时对象。

## 6. 验收重点

- [ ] Task 最多关联一个 Goal，允许完成 / 归档后改绑
- [ ] `parentId` / `subtask.*` / `task.reparented` 全链路删除，无双轨写入
- [ ] Goal 不进 DayPlan、不产生 Session、不直接计时、无番茄预估
- [ ] Goal 完成与 Task 完成双向不自动联动
- [ ] Goal 删除软删、保留 Task.goalId、可恢复，并有二次确认
- [ ] abandoned 与 completed / deleted 区分
- [ ] Goal 无期限字段
- [ ] 进度可回退，同时显示 N / M
- [ ] 历史 Task 改绑后统计跟随当前 goalId 变化
- [ ] 合并成员按 taskSegments 给 Goal 计时，不重复整条 Session
- [ ] 同组成员可属于不同 Goal
