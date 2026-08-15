# 合并番茄钟 v4.3 数据层交接

> 状态：数据层已按 v4.3.2 收口并完成本地原子提交；UI 尚未按新语义重接。
> 原会话：`f903d7b7-8d60-4891-8da5-91bf1c43d94f`
> 原实现分支：`claude/pomodoro-spec-data-layer-f89a02`
> 实现锚点：`f2a2c9c`；v4.3.2 收口提交：本分支 `feat(data): 收口 v4.3.2 合并番茄数据层最终整合`（旧 docs-only 交接 `1ce98fe` 只作历史索引，不再表示“整合尚未落地”）

## 1. 任务目标

这轮不是简单修补 v0.1.4，而是把合并番茄钟从旧 v4.1 口径完整升级到 v4.3：

- 数据层强制保证活动 Session 锁定，不能只靠 UI 隐藏按钮；
- 增加成员执行分段 `Session.taskSegments`；
- 把番茄和完整 Session 时长归到 MergeGroup，把成员各自时间归到 Task；
- 补齐 MergeGroup 的标题、成功完成终态、事件、同步结构和统计；
- 明确正常完成与中途解散不是同一种结果；
- 保持事件追加式、实体与事件同事务写入、`actualDuration` 为唯一时长事实源；
- 本批次不重做 UI。

## 2. 用户最终确认的产品语义

### 2.1 状态机与锁定

- 产品没有暂停 / 恢复。标准 focus 只有 `active`、`completed`、`discarded`；中途终止一律作废，5 分钟不参与状态判断。
- 独立 focus 进行中，当前 Task 被锁定：不能删除、软删除、从计划页改预估，不能绕过正式流程改变本轮执行对象。
- 合并 focus 是“当前成员 + 未来队列”：
  - 当前成员是本轮顺序里第一个尚未完成的成员，不一定是字面 `taskIds[0]`；
  - 当前成员不能移出、换位、被未来成员插队，也不能通过整体解散绕过锁定；
  - 未来成员可新增、移出，并可在未来队列内部排序；
  - 当前成员可通过合并番茄专用完成流程被勾选完成，随后下一位立即接任。
- focus 作废或正常终结后解除锁定；正常终结后的预估调整仍应走正式收尾 / 重新预估流程。

### 2.2 成员不足时的最终口径

最终权威口径是“两层约束”，不要采用旧重试分支里的单成员续轮说法：

1. 新建 MergeGroup 时，至少 2 个成员。
2. 开启任何一轮合并 focus 前，至少 2 个**未完成成员**。
3. 一轮合法开跑后，如果用户移出未来成员，活动 Session 和终结快照允许缩到 1；当前轮不被打断。
4. 因此存储 validator 仍允许 `mergeGroupId != null && taskIds.length >= 1`，但开轮命令必须强制未完成成员 `>= 2`。
5. 本轮结束后，如果用户未确认整组完成且组只剩 1 个成员，再按成员不足解散，使该 Task 回到独立状态。

会话的某次重试曾回答“只剩 1 个未完成成员仍可续轮”，但最终实际提交 `36606d2`、当前 v4.3.2 和根目录红线 29 均采用上述两层约束。后续不要恢复被推翻的旧结论。

### 2.3 taskSegments

- 合并 Session 必须保存每个参与成员的分段：`{ taskId, startedAt, endedAt, actualDuration }`。
- 第一位从 Session 开始；当前成员被勾完成时，它的分段结束，下一位从同一时刻开始。
- 中途加入成员的加入时间不是它的开始时间；只有真正轮到它才开始，没轮到就是显式 0 分段。
- completed 和 discarded 都写分段；作废分段计入真实作废专注时长，但不计有效番茄或成果指标。
- 分段时长不能直接拿时间戳相减。应以墙钟比例切分 `Session.actualDuration`，并保证所有分段之和精确等于它。
- 取整余数进入最后一个正数分段；瞬间作废时保留显式 0 分段。
- 旧数据没有分段事实时保持 `taskSegments: []`，统计按 0 贡献处理，不能伪造平均分摊。

### 2.4 番茄和统计归属

核心口径：**番茄归合并组，时间归成员。**

- 一条正常完成的合并 focus：全局有效番茄 `+1`、MergeGroup 有效番茄 `+1`、每个成员 Task 有效番茄 `+0`。
- MergeGroup 的专注时长取整条 Session 的 `actualDuration`。
- 成员 Task 只取自己的 `taskSegments.actualDuration`。
- 分类统计和 Goal 统计也只拿成员对应分段，跨分类 / Goal 加总应能与全局真实专注时长对账。
- break 不计入成员投入时间。
- discarded 合并 focus 只贡献真实作废专注时长，不贡献任何有效番茄。
- 合并成员必须排除出 Task 预估准确率样本；不能仅凭 `completionSource='pomodoro'` 判断它拥有有效番茄。

统计展示上，MergeGroup（如“杂事番茄”）是整体条目；展开详情后才看各成员各自的实际耗时和时间段。成员分属不同 Goal 是合法且常见的。

### 2.5 成员完成

合并番茄中当前成员被勾选完成时：

```text
completionSource = 'pomodoro'
validFocusCountAtCompletion = 0
```

这里的 `pomodoro` 表示“在番茄流程中完成”，不表示该 Task 独占过一个完整番茄。`task.completed` 必须明确关联当前 `sessionId` 和 `mergeGroupId`。该任务计入“番茄完成任务数”，但不进入 Task 番茄数预估准确率样本。

### 2.6 MergeGroup 的生命周期

- MergeGroup 是独立实体，不伪造成 Task，但预估轮次和预估准确率复用独立 Task 的算法。
- 必须有 `title`，创建时默认可为“杂事番茄”；支持 `mergeGroup.renamed`。
- `completed` 是用户确认完成的成功终态；`dissolved` 只表示取消 / 拆散 / 成员不足解散，两者互斥。
- 用户确认完成时允许仍有未完成成员，数据层不替用户推断“必须全做完才算组完成”。
- 完成后不能再增删成员、排序、追加预估或开新 focus；允许重命名，且重命名只改历史显示名。
- 完成事务必须原子完成：
  1. `MergeGroup.status='completed'`；
  2. 写 `completedAt`；
  3. 清空所有成员的 `Task.mergeGroupId`；
  4. 写 `mergeGroup.completed` Event。
- 清空归属不改 Task 自身状态：已完成者继续完成，未完成者继续 active，均不自动归档、删除或取消完成。
- `Task.mergeGroupId` 只表示“当前所属”，历史由终态 `MergeGroup.taskIds`、`Session.mergeGroupId`、`taskSegments` 和 Event 关联保留。
- `mergeGroup.completed` 顶层必须带触发确认的 completed 合并 focus `sessionId`；payload 为：

```text
completedAt
validFocusCountAtCompletion
finalTaskIds
incompleteTaskIds
```

### 2.7 强阻断

- 第三轮预估用满、或合并组已经完成 7 个标准 focus 后仍未结束，进入 `limitReached`。
- `limitReached` 禁止继续追加预估，禁止开启下一轮；关闭提示不解除阻断。
- 解除只能走正式的成员处理或解散流程，不能在活动 Session 中绕过当前成员锁定。

## 3. `f2a2c9c` 已经完成的实现

从 v0.1.4 基线 `c7e0d75` 到 `f2a2c9c` 共 8 个实现 / 规范提交：

| Commit | 内容 |
|---|---|
| `ac074bb` | 引入 v4.3 规范；Goal 只随规范进入，不写 Goal 代码 |
| `81cf2dc` | v4.3.1：锁定、成功终态、分段和统计语义 |
| `fe6e7df` | schema、validator、Event、迁移、Supabase、remote mapper、分段写入、锁定基础设施 |
| `9c8cabe` | 生命周期命令、当前成员锁定、未来队列编辑、完成 / 改名 / 结算命令 |
| `05660d6` | “番茄归组、时间归成员”统计与预估准确率共用算法 |
| `0433d99` | 锁定、终态与重命名测试 |
| `36606d2` | 开轮 `>=2`、存储 `>=1` 的最终两层规则 |
| `f2a2c9c` | 放行活动 Session 中完成当前成员，修正手动完成快照口径 |

已存在的关键函数 / 文件：

- `src/data/commands/mergeGroupCommands.ts`
  - `createMergeGroup`
  - `addTaskToMergeGroup`
  - `removeTaskFromMergeGroup`
  - `reorderMergeGroupMember`
  - `adjustMergeGroupEstimate`
  - `settleMergeGroupRound`
  - `completeMergeGroup`
  - `renameMergeGroup`
  - `dissolveMergeGroup`
- `src/data/commands/timerCommands.ts`
  - `startMergeGroupFocus`
  - `completeFocus`
  - `discardFocus`
  - `completeTaskFromPomodoro`
- `src/data/commands/mergeSegments.ts`
- `src/data/commands/mergeMemberLock.ts`
- `src/data/stats/awarenessStats.ts`
- `src/data/queries/currentTaskViews.ts`

`f2a2c9c` 当时实际验证：519 tests / 65 files、typecheck 通过、build 成功；项目无 lint 脚本。这个结果只证明该提交，不证明当前未提交整合工作树。

## 4. v4.3.2 整合结果

当前分支为 `codex/v43-2-reconcile`，数据层实现基线是 `f2a2c9c`；恢复目录 docs-only commit 为 `ed6f090`。2026-08-15 Implementer 已 review 当时 19 个未提交文件，修掉完成快照漏计 `type='focus'`，并完成本地原子提交。已落地内容：

- `completeMergeGroup` 新增必填 `sessionId`；
- 允许组内仍有未完成成员时确认完成；
- 完成时保存 `finalTaskIds` / `incompleteTaskIds`；
- 完成 / 解散前清空全部成员当前归属，再写终态；
- validator 增加“终态组不得再被 Task 指向”和“终态只允许改名”；
- Event 契约与关联校验同步扩展；
- completed 终结快照允许只剩 1 个成员；
- 规范头已经写为 v4.3.2，并标记 V43-1～V43-6 全部结案；
- 对应命令、事件、schema、validator 和统计测试已增加或修改。

收口验证：

- `npm run test:run`：65 files / 531 tests passed；
- `npm run typecheck`：passed；
- `npm run build`：144 modules，成功；
- build 仅有既存的单包体积大于 500 kB 警告，不是构建失败。

未跟踪文件 `docs/ui-handoff-empty-states-and-beyond.md` 仍留在工作树，本提交未包含、未修改。

## 5. 尚未完成

### 5.1 数据层工作树已收口

- 已检查当时 19 个修改文件，并与 v4.3.2 对齐；
- 已核对 `completeMergeGroup`、dissolve、跨实体 validator 的写入顺序：先清空成员指针，再写终态，失败整事务回滚；
- 已重新运行全量 `npm run test:run`、`npm run typecheck` 与 `npm run build`；
- 已创建只包含本轮整合的原子本地 commit，未 push；
- 旧 `1ce98fe` 只保留为历史交接索引，不再表示“整合尚未落地”。

独立 Reviewer 对 `c7e0d75`..`8d6ca03` 曾给出 `BLOCKED`（锁定、Session 快照、恢复分段、当前查询）。随后已在本分支用 `fix(data): 关闭 v4.3.2 合并番茄独立 review 缺陷` 逐条修完；数据层阻塞项不再挡 UI 重接。

### 5.2 UI 仍是下一批

下列能力当前只有数据层 / 测试，没有完整 UI：

- 进行中逐个勾选当前成员完成；
- 按新语义展示和推进当前成员 / 未来队列；
- 确认整组完成；
- 合并组重命名；
- completed / dissolved 历史展示；
- 展开合并组查看成员分段；
- 统计页的 MergeGroup 维度与 Task / Goal 分段明细。

旧 v0.1.4 UI 可复用拖拽与卡片交互骨架，但不能沿用旧统计和旧收尾语义。

### 5.3 同步与数据升级

- schemaVersion 已从 2 升到 3，旧合并 Session 无分段时保留空数组；
- Supabase 需要 `task_segments`、MergeGroup `title` / `completed_at`、`completed` 状态等结构；
- 当前无法确认用户是否已经执行过最新 SQL；真实云端验收此前被用户暂停；
- 执行线上 SQL 属于外部状态变更，后续必须再次明确确认，不能仅凭旧会话自动执行。

## 6. 验收清单

- [x] 独立 active focus 锁定删除与预估修改（数据层）
- [x] 合并当前成员不能移出 / 换位 / 被插队 / 被整体解散绕过（数据层）
- [x] 未来成员可增删和内部排序（数据层）
- [x] 当前成员完成后正确推进下一位（数据层）
- [x] completed / discarded 都写完整分段，分段和精确等于 `actualDuration`
- [x] 开轮要求至少 2 个未完成成员；已开跑记录可缩到 1
- [x] 一条 completed 合并 Session：全局 +1、组 +1、成员 +0
- [x] discarded 只计实际作废时长
- [x] 合并成员不进 Task 预估准确率
- [x] 完成允许仍有未完成成员，并原子清空全部 `Task.mergeGroupId`
- [x] completed Event 带 sessionId 和两份成员快照
- [x] completed / dissolved 后只允许重命名
- [ ] UI 不再展示或写入旧口径
