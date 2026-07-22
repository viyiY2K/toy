# Phase 1 Claude Code 施工总控文件

本文件是 Phase 1 施工流程与操作约束；它统管「项目定位、文档权威层级、每轮施工流程、Git 提交、Codex review 交接、禁止事项」，并在末尾收录逐条强制的「数据层实现红线」。

数据真值、字段、事件、payload、统计口径与 Phase 语义，始终以 `docs/data-layer-spec-v4.md` 为最高权威。本文件若与 v4 冲突，以 v4 为准。

---

## 一、项目定位与 Phase 1 总目标

### 项目定位
- 本项目是一个**番茄钟 + 自我觉察工具**：在计时专注之外，记录精力 / 情绪 / 中断，帮助用户观察自己的状态。
- 当前阶段是 **Web 版 Phase 1 数据地基重构**：把数据层从旧原型的临时结构，重建为可长期演进、可同步、可审计的事实层。
- 后续可能扩展到 **iOS / macOS**，因此数据结构与事件契约必须从一开始就按「跨端可同步」口径设计，不能写成只服务当前 Web UI 的临时结构。

### Phase 1 目标（要做的）
- 建立数据模型与实体定义。
- 建立 schema（表结构、字段、软删 / tombstone 等约束）。
- 建立**全量 EventType 枚举**与各事件 **payload 类型**。
- 建立基础写入校验（ID 规范、Event.type 合法性、原子写入等）。
- 建立 **IndexedDB / dataStore 抽象层**。
- 接入**必要的最小现有核心行为**（让既有核心流程能走通新数据层，而非重做行为）。

### Phase 1 不是（不要做的）
- 不是视觉重设计。
- 不是完整 UI 重构。
- 不是把完整统计页真实化。
- 不是提前实现 P2 / P3 / P4 行为。
- 不是多端同步落地。
- 不是诊断 / 导出的完整功能。

---

## 二、文档权威层级

下层文档不得覆盖上层文档。冲突时一律以更高层为准。

1. **最高 —— `docs/data-layer-spec-v4.md`**
   唯一权威数据规范。字段 / 事件 / payload / 约束 / 统计口径 / Phase 语义，全部以它为准。其他任何文档与它冲突，一律以 v4 为准。

2. **第二 —— `docs/phase1-plan.md`**
   施工计划。决定 Phase 1 按什么顺序实现（S 步划分）。它服从 v4，不得改写 v4 的数据语义。

3. **第三 —— `docs/phase1-checklist.md`**
   验收清单。用于检查 Phase 1 是否「建齐结构、写对真值」。它是验收口径，不是规范来源。

4. **第四 —— `docs/prototype-behavior-inventory.md`**
   旧原型行为对照参考。**只**用于识别旧 UI 行为与旧写入路径。
   - 不得新增规范。
   - 不得覆盖 v4。
   - 不得成为第二份实施计划。
   - 其中的旧字段 / 旧状态**不得**作为新数据真值。

5. **旁挂 —— `docs/ui-behavior-backlog.md`**
   UI 行为待办。**不作为数据依据**。与 v4 冲突时一律以 v4 正文为准；标「不阻塞 Phase 1」不等于可跳过 v4 正文要求的 P1 字段 / 结构预留。

---

## 三、每轮施工流程

每次只处理**一个明确施工单元**，不要一轮跨多个步骤。

1. **单元粒度**
   - 优先以 `docs/phase1-plan.md` 的**一个 S 步**为单位。
   - 若该 S 步过大，可拆成**一个可独立验收的子块**，但仍须一次只做一块。

2. **开工前：确认工作区**
   - 先确认当前 Git 工作区状态。
   - 若已有未提交修改，先向用户说明，**不要直接覆盖**，等用户决定如何处理。

3. **开工前:先只读分析**
   - 先进入 plan mode / 只读分析，**不直接改文件**。
   - 计划中必须写清楚：
     - 本轮目标；
     - 对应 `docs/phase1-plan.md` 的步骤；
     - 对应 `docs/phase1-checklist.md` 的验收范围；
     - 需要参考的 `docs/data-layer-spec-v4.md` 章节；
     - 预计修改的文件清单。

4. **用户确认计划后再执行。**

5. **执行时收敛范围**
   - 只改本轮目标相关文件。
   - 不顺手做相邻重构、不顺手清理无关代码。

6. **完成后:自测**
   - 必须运行项目**已有的**测试 / typecheck / lint。
   - 若项目暂时没有对应命令,必须明确说明「未运行,原因是项目未提供命令」,**不得假装已通过**。

7. **完成后:交付输出**
   必须输出：
   - 改动文件；
   - 完成内容；
   - 对应 checklist 项；
   - 自测结果；
   - 遗留风险；
   - 建议的 commit message。

---

## 四、Git 提交规则

1. 每完成**一个可验收施工单元**，且测试 / typecheck / lint 已运行（或已说明无法运行的原因）后，提交一次 Git commit。
2. commit 必须是**原子提交**，只包含本轮目标相关修改。
3. **不得**把多个 S 步混进一个 commit。
4. **不得**把格式化、重命名、大范围清理与业务实现混进同一个 commit——除非它们是本轮目标的必要组成。
5. **不得**在用户未确认前自动 commit；也**不得**在用户未确认前自动 push。
6. 每次 commit 前必须展示 `git diff --stat`、简要 diff 摘要与建议 commit message，供用户过目；用户确认后才可执行 `git commit`，且仍禁止自动 push。
7. commit message 格式示例：
   - `phase1(S2): add UUID v7 id generator`
   - `phase1(S3): add timezone and appDate helpers`
   - `phase1(S5): define Task and DayPlan schemas`
   - `test(phase1-S3): cover appDate derivation cases`

---

## 五、Codex review 交接规则

1. 每个 commit 完成后，要能给 Codex 提供一份 **review 摘要**。
2. 摘要必须包含：
   - 本轮目标；
   - commit hash；
   - 修改文件；
   - 对应 `docs/data-layer-spec-v4.md` 章节；
   - 对应 `docs/phase1-checklist.md` 的行 / 段；
   - 测试命令与结果；
   - 需要重点审查的问题（已知风险、边界、未决项）。
3. Codex review **优先按单个 commit 或小范围 commit range 审**，不等整个 Phase 1 做完再审。

---

## 六、禁止事项（红线）

- **不得**把 `docs/prototype-behavior-inventory.md` 或 `docs/ui-behavior-backlog.md` 当成数据真值。
- **不得**为了让旧 UI 方便而改变 v4 数据结构。
- **不得**继续写旧数据结构或旧字段作为真值。
- **不得**新旧双轨写入。
- **不得**提前实现未纳入 Phase 1 的完整 P2 / P3 / P4 行为。
- **不得**借数据层重构做视觉重设计或页面布局重构。
- **不得**自动 push。
- **不得**在未读相关 v4 / plan / checklist 的情况下直接改代码。

---

## 七、数据层实现红线（Phase 1 重构期间逐条强制，违反即在 review 中打回）

### ID 与时间
1. 所有实体 ID 必须 UUID v7，统一从单一 ID 生成入口产出。禁止自增整数、nanoid、UUID v4（§2.2）。
2. 不得用 UUID v7 的时间序替代业务时间排序。Event 统计一律以 occurredAt 为准；occurredAt 可早于 createdAt（离线补录场景），createdAt 仅用于审计/同步（§3.4 规则 6）。

### appDate / localDate（最高频踩坑点）
3. localDate 是事实自然日，永远不得当业务日期使用。所有"今天/每日/当日/今日列表/预算/按日统计"一律走 appDate 派生（§2.5、§8.2）。
4. Phase 1 appDayStartOffsetMinutes 固定为 0，此时 appDate ≈ localDate——但代码必须从一开始就按 appDate 口径写，不许图省事直接用 localDate。否则 P2 一开放自定义日界线，所有今日逻辑全错。
5. appDate 派生的事实源是「业务时间字段 + 记录写入时存储的 timezone + Settings.appDayStartOffsetMinutes」。禁止在查询时拿"当前设备时区"重算历史记录（用户旅行/改时区后归属会漂）（§2.5 规则 1/4）。
6. Session/Event/EnergyRecord/UnresolvedInterval 当前不存 appDate 字段，查询层派生。DayPlan 例外，存 appDate 业务键（§8.2.1、§2.5 规则 5）。

### Event append-only
7. 禁止给 Event 加 updatedAt / deletedAt / deviceId / syncedAt，即使为了"统一 base fields"也不行（§2.3、§3.4 规则 7）。
8. 撤销一条 Event 只能追加修正性 Event（如 task.uncompleted 修正 task.completed），不得修改或删除原 Event（§3.4 规则 2）。
9. 实体变更 + 对应 Event 写入必须同事务原子提交，失败整体回滚（§3.4，本次新增的关键规则第 8 条）。
10. Event.type 必须取自 §7 已定义枚举，写入未定义 type 必须被拒绝。Phase 1 即建完整 EventType 枚举 + payload 类型表，覆盖 §7 全部事件；真实触发逻辑可只接 P1 + 已有业务最小集（§3.4 一致性约束 4、§10.2）。

### 结构 P1 预留、行为 P2 接入（最易被偷懒跳过）
11. "某功能整节标 P2"绝不等于 Phase 1 可以不建它的表/字段/事件结构。以下结构 Phase 1 必须建齐，行为可后置：UnresolvedInterval 表与全部字段、Settings.lifetimePomodoroBaseline、EnergyRecord.mood、Settings.restSuggestionDisplayMode、deviceId/syncedAt 预留字段、statsBaseline 相关字段、全量 EventType 枚举与各 Phase 事件 payload 类型（§10.1、§11 第 4/5 项）。

### 可同步实体 vs Event
12. 可同步实体（Task/DayPlan/Session/EnergyRecord/UnresolvedInterval/Settings）禁止物理删除，删除一律写 deletedAt 软删并保留 tombstone；默认读取过滤 deletedAt != null。Event 不在此列（§2.4）。
13. Session 五种 type 共用同一字段集，不适用字段存 null，不是省略字段。用 TS discriminated union 时别把不适用字段省掉，否则跨端契约不一致（§3.3）。
14. dayPlanId 只是辅助/分析字段，按日统计不得依赖它（会漏掉无 DayPlan 的迁移数据、extra session 等）（§3.3、§3.4 规则）。

### 易错的语义细节
15. completionSource='manual' 完成任务时，validFocusCountAtCompletion 仍要写当时累计有效标准 focus 数（可为 0，也可 >0），不得直接写 0（§7.x task.completed）。
16. extraFocus 计入专注时长，但不计入有效番茄数 / 完整循环 / Task 有效番茄数；discarded focus 不计成果但 actualDuration 仍进总专注时长（§8.1）。
17. 已开始计时的 break 因崩溃/关闭断裂，走 UnresolvedInterval 恢复流程，不得直接写成 break.skipped（§7.6）。
18. longBreakEvery 当前固定为 4，restSuggestionDisplayMode 字段虽在 schema 但其统计窗口未定——字段存在不等于 Phase 1 开放 UI 或写入对应事件（§3.7、§7.12）。
19. `appDayStartOffsetMinutes` Phase 1 固定为 0，不开放 UI 修改，不真实触发设置更新事件。v4 §7.12 已定义 `settings.appDayStartOffsetUpdated`（P2），Phase 1 仅建其 EventType 与 payload schema、不真实触发；不得临时新增 v4 未定义的粗糙事件（§3.7 规则 10、§7.12）。

### 补充红线(来自规范交叉项)
20. restSuggestions 的短休/长休适用范围以 appliesTo 字段为准,不得靠 key 的 short_ / long_ 前缀推断;新增项由统一创建函数生成 key,不手拼前缀(§3.7、§7.7)。
21. ui-behavior-backlog.md 不是数据真值,数据真值一律以 data-layer-spec-v4.md 正文为准;backlog 标"不阻塞 Phase 1"不等于可跳过正文要求的 P1 字段/结构预留。
22. DayPlan 超载(今日预估总和 > budgetPomodoros)是派生状态,不写入字段、不发事件;数据层只是"不拒绝写入",查询/UI 层按需派生超载提示(§3.2、§8.10)。
23. actualDuration 是 Session 实际时长唯一事实源,统计不得用 endedAt − startedAt 重算(§3.3,本批修订 5)。
