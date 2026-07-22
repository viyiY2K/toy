# Phase 3 自用增强版实施计划

本文定义 Phase 3 自用增强版的施工顺序与范围，只包含真实统计页和可长期个人使用的完整任务管理。它服从 `docs/data-layer-spec-v4.md`，不改写字段、事件、payload、状态机或统计口径。`docs/phase3-checklist.md` 是验收清单；`docs/phase3-review-log.md` 记录每个施工单元的实现与独立审查结果。

## 0. 基线、权威与用户决策

- 角色：`Implementer`。
- 分支：`data-layer-refactor`。
- 规划基线 HEAD：`16b702216fb272c5a86bc16ab7a502fb5336eb3b`；Phase 2 实现 tip 为 `29aea35c80ca77b31c83e520acf04dbdb11f35f4`。
- Phase 2 已 Ready；规划时复验：Vitest 41 files / 316 tests passed，TypeScript passed，Vite build 73 modules passed；仓库没有 lint script。
- 受保护工作区：53 个位于 `docs/Draft/` 与 `docs/ai-context/` 的用户既有未暂存删除不属于 Phase 3。不得恢复、覆盖、暂存、提交或吸收。
- 不 push。

权威顺序：

1. `docs/data-layer-spec-v4.md`；
2. 本计划；
3. `docs/phase3-checklist.md`；
4. `AGENTS.md` 与根 `CLAUDE.md`；
5. Phase 2 文档只作已完成现状与回归依据，不修改其记录；
6. prototype inventory、UI backlog 和根目录旧原型文件只作历史参考，不进入生产依赖。

用户于 2026-07-21 集中确认以下 Phase 3 产品语义：

- archived 恢复归档前语义状态：`outcome='completed'` 恢复为 `completed` 并保留 `completedAt/completionSource`；`outcome='split'` 恢复为 `active` 且完成字段保持 null；两者均清空 `outcome/archivedAt` 并追加 `task.restored(restoredFrom='archived')`。若要重新执行已完成任务，用户再显式执行 `task.uncompleted`。
- 子任务顺序复用 `Task.sortIndex`，但严格按排序域解释：顶层活动任务为 `parentId=null` 域，每个母任务的直接子任务各自形成独立 sibling 域；命令和查询不跨域比较或重排，且绝不使用 `DayPlan.taskIds` 表达子任务顺序。
- 最小批量集合为：批量加入今日、批量移回活动清单、批量归档已完成。命令先对整批做只读预检；预检不通过时零写入。预检通过后每个 Task 使用自己的实体+Event 原子事务依次提交，不发明跨 Task all-or-nothing；运行时中途失败保留已成功项，并返回逐项结果供 UI 明确报告与重试。批量手动完成和批量软删除不在本轮。

## 1. 只读审计结论

### 1.1 已有真实统计事实

- Session 已真实记录标准 focus、discarded focus、short/long break、恢复归类的 extraFocus/extraRest，时长事实为 `actualDuration`。
- Event 已真实记录 `task.completed` 快照、interrupt、focus/break、`dayPlan.workEnded` 与恢复流程，且 append-only。
- EnergyRecord 已有标准工作流的 dayStart/beforeFocus/afterFocus/afterShortBreak/afterLongBreak 写入口；`recoveryDelta` 未落库，符合 v4。
- DayPlan、Settings 与 `lifetimePomodoroBaseline` 字段已落库；当前 offset 为 0，但时间帮助函数已经按事实时间、记录 timezone 与 offset 派生 `appDate`。
- 当前局部查询仅覆盖当前日 completed focus、每 Task 历史有效 focus、remaining/capacity、当前 active Session 的 interrupt 与能量提示；没有可供统计页使用的历史范围聚合。
- 生产 UI 没有统计组件，导航入口禁用。根目录 `stats.jsx` 依赖旧 `bucket/log/interrupts` 真值，被生产入口守卫明确隔离，禁止复用。

### 1.2 已有任务管理能力

- 已完成：顶层任务创建、标题/预估编辑、今日与活动清单移动、两种顶层排序、手动/番茄完成、取消完成、完成归档、活动任务软删除。
- 可复用：完整 Task schema、两层 validator、全量 Task/Subtask/Triage/Event 契约、原子事务、软删除、当前 DayPlan 初始化与现有 UI 卡片/按钮/拖拽语言。
- 缺 command/query：子任务创建与 sibling 排序、顶层变子任务、子任务升级、notes、split、triage、archive history、archived restore、批量三项与层级化当前视图。
- 缺 UI：层级编辑、任务详情 notes、split、focus 快速捕获、待分流清单、归档历史/恢复、批量选择与结果反馈。
- 不新增独立子任务排序字段；不实现跨母任务移动 `subtask.reparented`，因为目标仅授权“如实现”时使用该语义，本轮最小完整体验不需要它。

### 1.3 保留数据与 schema 判断

本轮不新增实体字段、object store 或 IndexedDB 索引，因此保持 `CURRENT_SCHEMA_VERSION=1`、`DB_VERSION=1`，不做伪升级或迁移。所有新能力读取既有 stores；retained DB 验收重点是旧 Task/Session/Event/EnergyRecord 可直接被新查询/UI 使用，当前日初始化仍幂等且不重复创建模板任务。

## 2. 固定施工与审查纪律

每个 S-step 或列出的独立子单元都执行：开工记录 → 数据子块先写直接测试 → 实现 → direct tests → full Vitest/typecheck/lint/build/diff-check → 真实生产入口浏览器冒烟（新增流程、reload、retained DB、clean Console，必要时 fresh origin）→ 自审 → 一个最终原子实现 commit → 独立只读 Reviewer 审精确 hash → 修复并 amend/复审至 `PASS` → review-log-only bookkeeping commit → 独立 Reviewer 核对 bookkeeping commit。bookkeeping commit 不递归记录自身。绝不 push。

每个单元开工记录必须列明 v4、checklist、精确文件、直接测试、浏览器冒烟、明确不做和 53 个删除隔离。数据命令必须含 fault-injection/rollback 测试，证明相关实体与所有 Event 不会部分提交。

## 3. S-step 施工顺序

### S0 · Phase 3 计划、清单与 review-log 基线

- 依据：v4 §2–§3、§7、§8、§10.4、§11；Phase 2 closeout。
- 交付：本计划、`phase3-checklist.md`、`phase3-review-log.md`。
- 验证：交叉引用、基线测试/typecheck/build、当前生产入口初始化/reload/clean Console、`git diff --check`、独立审查。
- 不做：任何生产源码、v4 或 Phase 2 记录修改。

### S1a · 任务层级、通用备注与 archived 恢复数据语义

- 依据：v4 §2.4、§3.1–§3.2、§3.4、§7.1–§7.4；已确认恢复/排序语义。
- 内容：层级化 current/history query；创建子任务；同母任务 sibling 重排；顶层任务成为子任务；子任务升级顶层；活动 `note` 与 completed/archived `actualWorkNote` 编辑；archived history；按已确认矩阵恢复 archived Task。
- 规则：顶层转子任务若仍在当前 DayPlan，先用既有 `dayPlan.taskRemoved(userRemoved)` + `task.movedToList` 关闭今日成员关系，再写 `task.reparented`，同一事务/correlation；升级顶层时分配新的顶层活动 `sortIndex`。active child 若母任务不在当前活动视图，仍在“待整理子任务”查询中可见，避免静默丢失。
- 预计文件：`taskCommands.ts`/测试、`currentTaskViews.ts`/测试、Event validator/测试、数据 barrel、一个 ADR。
- 浏览器冒烟：当前入口既有任务流程/reload/clean Console；新 UI 验收留 S2a。
- 不做：split、triage、batch、任务 UI、deleted 恢复、跨母任务移动。

### S1b · task split 与 triage 原子数据流程

- 依据：v4 §3.1–§3.4、§7.1–§7.5、§7.10。
- 内容：单新任务 split；active focus 快速捕获；待分流移今日/活动清单/dismiss；相关查询。
- split：只允许 active/splitNeeded；新 Task 继承 parentId 与 lineageId，`splitIndex` 取同 lineage 已有最大值 + 1，source=`splitChild`；原 Task 归档 outcome=`split`；当前 DayPlan 如含原 Task 则移除，新 Task 默认不自动加入今日；所有实体/Event 共享一个 correlationId。即使原 Task 是子任务，也只写 v4 要求的 `task.split`、`task.archived(outcome='split')`、`task.created(source='splitChild')` 三条事件，不追加只适用于普通手工新建子任务的 `subtask.added`。
- triage：捕获固定预估 1、`metadata.triageStatus='pending'`；dismiss 固定软删除 `deletedReason='triageDismissed'`，`triage.dismissed` 与 `task.deleted` 共享 correlationId。
- 预计文件：任务/awareness commands 与测试、current task/timer query 与测试、barrel、一个 ADR。
- 不做：跨母任务移动、多 split child、通知/prompt、UI。

### S1c · 三项安全批量命令

- 依据：既有单 Task 命令语义、v4 §3.2/§3.4/§7.1/§7.3–§7.4；用户确认的事务语义。
- 内容：批量加入今日、批量移回活动清单、批量归档 completed；稳定输入顺序；整批预检零写入；逐 Task 独立原子提交；结构化 `succeeded/failed/notAttempted` 结果。
- 预计文件：独立 batch command 模块与测试、barrel、一个 ADR。
- 不做：跨 Task all-or-nothing、批量完成、批量删除、UI。

### S2a · 层级任务、备注与归档历史 UI

- 依据：S1a；v4 §3.1、§7.1–§7.4。
- 内容：在现有清单页增加最小层级行与任务详情面板；父/子创建、编辑、完成、取消完成、删除、归档、sibling 排序、缩进/升级；active note；completed/archived actualWorkNote；归档历史浏览和 archived restore。
- UI 规则：今日仍只按 `DayPlan.taskIds` 排顶层成员；活动顶层只按顶层 sortIndex；子任务仅在自己的 sibling 域排序；archived/deleted 不进入当前列表，history 只显示 archived，不显示 deleted。
- 浏览器冒烟：完整层级/notes/history/restore/reload/retained DB；拖拽若受控浏览器不可靠，先穷尽 view-model/command 测试后给出最小普通浏览器步骤。
- 不做：视觉重设计、split/triage/batch UI。

### S2b · split、focus capture、triage 与批量 UI

- 依据：S1b–S1c；v4 §7.1、§7.10。
- 内容：任务 split 确认区；计时页快速捕获；待分流清单及三种处置；清单选择模式与三项批量动作；逐项失败报告与重试提示。
- 浏览器冒烟：split 血缘/归档；active focus 捕获后继续计时；triage 三出口；三项 batch、reload 与 Event/correlation 检查。
- 不做：批量完成/删除、跨母任务移动、其他 P3/P4 行为。

### S3a · Session/休息核心统计纯聚合层

- 依据：v4 §2.5、§3.3–§3.4、§8.1–§8.4、§8.6、§8.11。
- 内容：纯日期范围与日桶；今日/周/月；有效标准番茄、完整循环；标准/extra/discarded focus 时长；short/long/extraRest；标准休息 completed/四类 skipped/missing/workEnded exemption；累计完整番茄与累计专注时长。
- 归属：所有 Session 时长与 completed/skipped 标准 break 计数都按该 Session 自身 `startedAt` 派生的 appDate；完整循环按 source focus 的 appDate；应休息分母及 workEnded 豁免从目标范围内 completed focus 集合计算，因此按 focus 自身 appDate。不得为了让跨日一轮不拆散而把 break 重新归到 source focus 日；所有时长只读 actualDuration。
- 预计文件：新增 stats date-range/aggregation 模块及直接测试、barrel、一个 ADR。
- 直接边界：deleted Session、discarded、extraFocus/extraRest、skipped、missing、workEnded、ignored interval、跨 appDate/周/月、baseline。
- 不做：UI、缓存、预存统计、DayPlan 迁移。

### S3b · Task/Energy/Interrupt 统计纯聚合层

- 依据：v4 §8.5、§8.7–§8.10。
- 内容：任务完成数及 manual/pomodoro 拆分；Task 当期新增/历史有效番茄；完成时快照预估准确/偏大/偏小与排除；能量日时间线和周/月逐日平均/样本数；链路派生 recoveryDelta；interrupt 内外数量、每日趋势、平均每有效番茄与本地时刻四小时分布；DayPlan 预算使用率。
- 规则：Task 统计只显示未软删除 Task；global Session 成果仍由未删除 Session 事实决定；interrupt 必须关联存在且未删除标准 focus；recoveryDelta 缺样本为 null，不补 0、不写回。
- 预计文件：扩展 stats aggregation/query 与测试、一个 ADR。
- 不做：UI、mood、运营生命周期指标、缓存。

### S4 · 真实统计页与 retained-data 验收

- 依据：S3；v4 §8、§10.4、§11 #8–#10。
- 内容：启用统计导航；新增生产 StatsView；日/周/月选择与日期导航；累计卡片、核心时间/循环/休息/任务卡片、轻量 CSS/SVG 趋势、interrupt 分布、能量/recovery、任务明细；真实空态/少量数据态。
- 预计文件：新增 StatsView/view-model/测试，修改 App 与局部 `styles.css`；不接根目录旧 `stats.jsx`。
- 浏览器冒烟：fresh origin 空态；retained DB；产生真实 focus/break/energy/interrupt 后核对日/周/月；跨边界 fixture；reload；Console 无红错。
- 不做：图表依赖、视觉重设计、year 视图、统计缓存。

### S5 · 跨域自用回归与 Phase 3 closeout

- 依据：本计划、完整 checklist、Phase 2 回归基线。
- 内容：公共生产命令集成回归；可重复 Phase 3 浏览器 smoke 文档与 bug/流畅度记录；全清单对账；最终全范围独立 Reviewer。
- 验证：完整父子/层级/split/triage/notes/history/restore/batch + 真实 focus/break/energy/interrupt + 日周月统计一致性 + reload/retained DB/clean Console；full test/typecheck/build/diff-check；lint 状态如实记录。
- 不做：用 closeout 顺手补其他 P3/P4/P5+ 功能。

## 4. 依赖顺序

```text
S0
 └─ S1a → S1b → S1c
      └─ S2a → S2b
           └─ S3a → S3b
                └─ S4
                     └─ S5
```

先锁定完整任务语义，再建立统计聚合，避免 split/triage/restore 影响 Task 统计后返工。任何单元未获实现 commit 与 bookkeeping commit 双重独立 Reviewer `PASS`，不得进入下一单元。

## 5. 范围红线与完成定义

- 实体与 Event 同一原子事务；Event append-only；同步实体只软删除；不物理删除历史 Event。
- 用户可见日/周/月都按 appDate；不以 localDate 或 dayPlanId 代替。
- Session 时长只读 actualDuration；不从 endedAt-startedAt 重算。
- 不建立新旧双轨；根目录旧原型不进入生产依赖。
- 不实现通知、prompt 分析、rest-item 行为分析、timer/offset/休息建议设置、自由 Session note、日总结、备份/导入/清空、账号/云端/同步、deleted 恢复或其他未授权 P4+。
- 不新增重型依赖；任何外部依赖需用户另行确认。
- 只有 checklist 必做项全勾选、所有实现/bookkeeping commit 均 Reviewer PASS、全套自动验证和真实生产浏览器流程通过、53 个删除未触碰且无 push，才能声明 Phase 3 complete 并进入长期个人使用与 bug/流畅度观察。
