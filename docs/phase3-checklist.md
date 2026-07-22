# Phase 3 自用增强版验收清单

本清单服从 `docs/data-layer-spec-v4.md`，只验收 `docs/phase3-plan.md` 定义的真实统计与完整任务管理范围。`[x]` 只能由直接测试、完整验证、浏览器证据、精确 commit 与独立 Reviewer 共同支持；计划阶段保持 `[ ]`。

## A. 基线、纪律与隔离

- [x] A1 Phase 2 Ready 与 tips `29aea35` / `16b7022` 已作为基线，Phase 2 文档未被改写。
- [x] A2 每个单元开工记录 v4、checklist、精确文件、测试、浏览器、不做范围和工作区隔离。
- [x] A3 每个单元一个最终原子实现 commit，另有 review-log-only bookkeeping commit；均无 push。
- [x] A4 每个实现 commit 由独立只读 Reviewer 审精确 hash，findings 修复至 PASS；bookkeeping commit 也被独立核对。
- [x] A5 所有数据 command 子块先有直接测试，并有 post-write fault-injection/rollback 证明。
- [x] A6 每个单元运行范围相称 direct/full Vitest、typecheck、build、`git diff --check`；lint 缺失如实记录。
- [x] A7 每个单元完成当前生产入口浏览器冒烟、reload、retained DB 与 clean Console；必要时补 fresh origin。
- [x] A8 53 个用户历史文档删除始终未被恢复、覆盖、暂存或提交。
- [x] A9 未修改 v4、AGENTS.md、CLAUDE.md 或 Phase 2 已审查记录。

## B. 任务层级、排序、备注与历史

- [x] B1 顶层和子任务均为 Task；创建子任务写 `task.created(source=manual)` + `subtask.added`，共享 correlationId。
- [x] B2 parentId 只指向有效顶层 Task；已有子任务的 Task 不可再成为子任务；层级最多两层。
- [x] B3 子任务同母重排只在 sibling 域更新 sortIndex，写 `subtask.reordered`。
- [x] B4 顶层活动排序只比较 parentId=null；各 parentId 子域不跨域比较 sortIndex。
- [x] B5 今日顶层顺序只来自 DayPlan.taskIds；子任务顺序不读写 DayPlan.taskIds。
- [x] B6 顶层任务成为子任务写 `task.reparented`；若在当前 DayPlan，先以同事务关联事件移出今日。
- [x] B7 子任务升级顶层写 `subtask.unparented` 并分配新的顶层活动 sortIndex。
- [x] B8 不实现跨母任务移动；无 `subtask.reparented` 真实触发。
- [x] B9 子任务可编辑标题/预估、完成、取消完成、软删除、归档，沿用对应 task.* 语义。
- [x] B10 子任务完成不自动完成母任务；子任务删除/归档不级联其他任务。
- [x] B11 active/splitNeeded Task 的 note 可完整编辑，写 `task.updated(field=note)`。
- [x] B12 completed/archived Task 的 actualWorkNote 可完整编辑，写 `task.updated(field=actualWorkNote)`。
- [x] B13 当前视图排除 archived/deleted；归档历史只显示 archived，deleted 不混入。
- [x] B14 active 子任务的母任务不在当前视图时，子任务仍通过待整理查询可见。
- [x] B15 history 排序稳定，显示 outcome、归档时间、完成来源、notes 与 lineage 必要信息。
- [x] B16 上述命令/Event mirror/状态矩阵/跨域排序均有直接测试与 rollback 测试。

## C. archived 恢复

- [x] C1 只开放 restoredFrom=archived，不实现 deleted 恢复或最近删除 UI。
- [x] C2 completed archive 恢复为 completed，保留 completedAt/completionSource，清空 outcome/archivedAt。
- [x] C3 split archive 恢复为 active，完成字段为 null，清空 outcome/archivedAt。
- [x] C4 恢复追加 `task.restored(restoredFrom=archived)`；旧 Event 不修改、不删除。
- [x] C5 恢复实体/Event 同事务，Event 失败时 Task 完整回滚。
- [x] C6 恢复 completed 后若需重新执行，必须另行显式取消完成并追加 `task.uncompleted`。
- [x] C7 UI 可从历史恢复，reload 后状态和历史事件一致。

## D. task split

- [x] D1 split 只允许 active/splitNeeded 且未删除 Task。
- [x] D2 原 Task 变 archived/outcome=split/archivedAt 非 null，完成字段符合 v4。
- [x] D3 写 `task.split` 与 `task.archived(outcome=split)`。
- [x] D4 创建且只创建一个 `task.created(source=splitChild)` 新 Task。
- [x] D5 新 Task 的 lineageId 继承原 Task，splitFromTaskId 指向原 Task，splitIndex 为同 lineage 最大值+1。
- [x] D6 新 Task 继承 parentId；即使原 Task 是子任务，也只写 split 规定的三条 `task.*` Event，不追加 `subtask.added`。
- [x] D7 原 Task 若在当前 DayPlan 则移出并写 `dayPlan.taskRemoved(taskArchived)`；新 Task 默认不自动加入今日。
- [x] D8 所有实体与 Event 同事务且共享 correlationId；任一步失败全部回滚。
- [x] D9 UI 可确认新标题/预估并完成 split；历史可追踪原/新 Task。

## E. Triage

- [x] E1 只在 active 标准 focus 中显示快速捕获入口。
- [x] E2 捕获创建 active Task，预估 1，metadata.triageStatus=pending。
- [x] E3 捕获写 `task.created(source=triageCapture)` + `triage.captured`，共享 correlationId，捕获后 focus 继续。
- [x] E4 待分流纯查询只含 active/pending Task，不混入普通活动清单。
- [x] E5 移今日清空 pending、加入当前 DayPlan，写 `triage.movedToToday` + `dayPlan.taskAdded(button)`。
- [x] E6 移活动清单只清空 pending，写 `triage.movedToList`，不改 DayPlan。
- [x] E7 dismiss 固定 Task 软删除/status=deleted/deletedReason=triageDismissed。
- [x] E8 dismiss 写 `triage.dismissed` + `task.deleted`，共享 correlationId；不物理删除。
- [x] E9 三种处理均有 Event mirror、非法状态、重复提交与 rollback 测试。
- [x] E10 UI 三出口、reload 持久化与 clean Console 通过。

## F. 最小批量操作

- [x] F1 仅实现批量加入今日、移回活动清单、归档已完成。
- [x] F2 每类操作先对整批做只读预检；ID 重复、缺失或任一不合格时零写入。
- [x] F3 预检通过后按稳定输入顺序逐 Task 调用独立原子事务，不发明整批 all-or-nothing。
- [x] F4 运行时中途失败保留此前成功项，并返回 succeeded/failed/notAttempted 明细。
- [x] F5 每个成功 Task 的实体/Event/correlation 与对应单 Task 命令一致。
- [x] F6 批量加入今日按选择顺序追加；批量移回活动清单分配稳定顶层顺序；归档仅接受 completed。
- [x] F7 UI 选择模式只对合法集合启用动作，明确显示执行结果并支持失败项重试。
- [x] F8 不实现批量手动完成、批量软删除或跨 Task 单事务。

## G. 统计日期与基础边界

- [x] G1 统计范围支持 day/week/month；周一至周日；月按日历月。
- [x] G2 Session 用 startedAt，Event/EnergyRecord 用 occurredAt，结合记录 timezone 与 Settings offset 派生 appDate。
- [x] G3 不直接以 localDate、createdAt、endedAt 或 dayPlanId 作为统计日归属。
- [x] G4 跨日 Session 整条归 startedAt 派生 appDate；跨周/月边界有直接测试。
- [x] G5 deletedAt!=null 的可同步实体不作为对应指标样本；Event 保持 append-only。
- [x] G6 ignored interval 不产生 Session、不会进入用户统计。
- [x] G7 所有统计动态派生；无预存结果或事实缓存。
- [x] G8 retained DB 不需要 schema/DB version 变化，初始化不重复模板 Task。

## H. Focus、循环与累计

- [x] H1 有效番茄只数未删除 completed 标准 focus。
- [x] H2 discarded focus 不进有效番茄/完整循环/Task 有效番茄/预估样本。
- [x] H3 标准 focus、extraFocus、discarded focus 时长分别使用 actualDuration；总专注为三者之和。
- [x] H4 extraFocus 不进有效番茄或完整循环。
- [x] H5 完整循环要求 completed focus + 关联 completed 标准 break + 连续性；按 source focus appDate 归属。
- [x] H6 skipped/缺失 break、extraRest、workEnded 豁免均不能构成完整循环。
- [x] H7 后续 break 不得倒算补足已跳过/关闭或已进入下一 focus 的旧机会。
- [x] H8 累计完整番茄 = baseline + 工具内全时段完整循环；baseline 不影响其他统计。
- [x] H9 累计专注时长包含 completed/extra/discarded 的 actualDuration。
- [x] H10 不以 endedAt-startedAt 重算任何 Session 时长。

## I. 休息统计

- [x] I1 shortBreak、longBreak、extraRest 时长分别统计 actualDuration；skipped 时长为 0。
- [x] I2 completed/skipped 标准 break 计数与时长按 break Session 自身 appDate；完整循环才按 source focus appDate。
- [x] I3 completed、explicitSkip、noResponse、missed、appClosed、missing 分开计数。
- [x] I4 应休息分母从目标范围内 completed focus 集合计算并按 focus 自身 appDate；workEnded 有效锚点从该分母豁免，不伪装 skipped，不计 missing。
- [x] I5 完成率、主动跳过率分母为应休息次数；分母 0 时为 null，不补 0。
- [x] I6 missing=应休息−completed−全部 skipped，且不隐形并入其他分子。
- [x] I7 short/long 明细和第四个 completed focus 的 longBreak 节奏有直接测试。

## J. Energy、recovery 与 interrupt

- [x] J1 日能量保留全部未删除记录，按 occurredAt 排序并显示本地 HH:mm。
- [x] J2 周/月趋势逐日计算 average + sampleCount；无样本日 average=null。
- [x] J3 recoveryDelta 只按 break→sourceFocus→afterFocus/afterBreak 链路计算，不靠最近时间推断。
- [x] J4 break、focus、前后 EnergyRecord 任一删除或缺失时不产生样本、不补 0。
- [x] J5 recoveryDelta 不写回 EnergyRecord；短休/长休分别汇总有效样本、缺失样本和平均值。
- [x] J6 interrupt 总数、internal/external 只数关联存在且未删除标准 focus 的 Event。
- [x] J7 discarded focus interrupt 可进总数但不进平均每有效番茄分子。
- [x] J8 分母无有效番茄时平均值为 null。
- [x] J9 提供每日趋势和按 Event 发生本地时刻的四小时分布，内外可区分。

## K. Task 与 DayPlan 统计

- [x] K1 Task 有效番茄只数未删除 completed 标准 focus；extra/discarded/break 排除。
- [x] K2 日 Task 主数字为当日新增，历史累计作明细。
- [x] K3 任务完成数来自 `task.completed` Event，并拆 manual/pomodoro。
- [x] K4 manual completion 计任务完成数，但不伪造有效番茄、循环或预估样本。
- [x] K5 预估样本仅 completionSource=pomodoro、快照存在、estimateRounds 非空、Task 未删除。
- [x] K6 预估准确严格要求仅一轮且快照等于初始预估；偏大/偏小按初始值判断。
- [x] K7 缺快照、manual、deleted Task、空 estimateRounds 均排除并有直接测试。
- [x] K8 budgetUsageRate 分子为目标 appDate 全部有效标准 focus；DayPlan 缺失/删除或预算 0 时 null。

## L. 统计 UI

- [x] L1 当前“统计”导航启用并进入生产 StatsView；旧根 `stats.jsx` 保持隔离。
- [x] L2 日/周/月切换和日期导航使用 appDate 范围。
- [x] L3 展示累计完整番茄、累计专注时长、有效番茄、完整循环。
- [x] L4 清晰拆分 standard/extra/discarded focus 与 short/long/extra rest。
- [x] L5 展示休息 completed/skipped 四类/missing/workEnded exemption 与合法比例。
- [x] L6 展示 internal/external interrupt、趋势/分布和平均每有效番茄。
- [x] L7 展示能量趋势和可用 recoveryDelta；缺样本明确为空态。
- [x] L8 展示任务完成、Task 有效番茄和预估准确/偏大/偏小样本。
- [x] L9 使用轻量 CSS/SVG，无新增图表或外部依赖，无视觉/导航结构重设计。
- [x] L10 空数据、少量数据、跨边界数据与 retained IndexedDB 均正常；reload 一致且 Console 无红错。

## M. 最终自用 Ready

- [x] M1 真实 UI 完成父子创建、排序/层级变化、split、triage、notes、完成/归档/history/restore、三项 batch。
- [x] M2 真实 UI 产生 focus/break/energy/interrupt 后，日/周/月统计与实体/Event 一致。
- [x] M3 full Vitest、typecheck、production build、diff-check 全通过；lint 状态如实记录。
- [x] M4 每个实现与 bookkeeping commit 均独立 Reviewer PASS，无未关闭 finding。
- [x] M5 `docs/phase3-review-log.md` 完整记录 commit、验证、浏览器证据、findings 与残余风险。
- [x] M6 53 个用户删除未触碰、没有 push、没有范围外 P3/P4/P5+ 功能。
- [x] M7 进入长期个人使用与 bug/流畅度收集，不自动扩大范围。
