# Toy 项目施工约定与数据层红线

本文件是本项目的常驻工作约定与数据不变量。它统管「项目定位、文档权威层级、工作纪律、Git 提交」，并在末尾收录逐条强制的「数据层实现红线」。

数据真值、字段、事件、payload、统计口径与 Phase 语义，始终以 `docs/data-layer-spec-v4.md` 为最高权威。本文件若与 v4 冲突，以 v4 为准。

> **现状（2026-07）**：数据层三个阶段（Phase 1 数据地基 / Phase 2 核心自用 / Phase 3 真实统计与完整任务管理）均已封板并通过独立 review，随后完成过一轮 UI 打磨并已合入 `main`。当前没有进行中的主线施工。下面第五节的「数据层实现红线」在任何碰数据的改动里长期有效，与阶段无关。文中出现的 “Phase 1 / P2 …” 指的是 v4 规范里的功能阶段语义（数据契约的一部分），不是施工进度。

---

## 一、项目定位

- 本项目是一个**番茄钟 + 自我觉察工具**：在计时专注之外，记录精力 / 情绪 / 中断，帮助用户观察自己的状态。
- 数据层已从旧原型的临时结构，重建为可长期演进、可同步、可审计的事实层。
- 后续可能扩展到 **iOS / macOS**（统一用 SQLite），因此数据结构与事件契约始终按「跨端可同步」口径设计，不能退回成只服务当前 Web UI 的临时结构。
- 用户为非工程技术背景，与 Claude 协作推进。汇报要说人话，不要把 schema 术语直接摊给用户。

---

## 二、文档权威层级

下层文档不得覆盖上层文档。冲突时一律以更高层为准。

1. **最高 —— `docs/data-layer-spec-v4.md`**
   唯一权威数据规范。字段 / 事件 / payload / 约束 / 统计口径 / Phase 语义，全部以它为准。其他任何文档与它冲突，一律以 v4 为准。

2. **阶段计划 / 验收记录 —— `docs/phase{1,2,3}-plan.md`、`docs/phase{1,2,3}-checklist.md`、`docs/*-review-log.md`**
   历史施工计划与验收留痕。服从 v4，不得改写 v4 的数据语义；作为已完成阶段的事实记录保留，不要回头篡改。

3. **旧原型对照 —— `docs/prototype-behavior-inventory.md`**
   **只**用于识别旧 UI 行为与旧写入路径。不得新增规范、不得覆盖 v4、其中的旧字段 / 旧状态**不得**作为新数据真值。

4. **旁挂 —— `docs/ui-behavior-backlog.md`**
   UI 行为待办，**不作为数据依据**。与 v4 冲突时一律以 v4 正文为准。

---

## 三、工作纪律

1. **开工前确认工作区**：先看 Git 工作区状态。若已有未提交修改，先向用户说明，**不要直接覆盖**，等用户决定如何处理。
2. **一次一个可验收单元**：不一轮跨多件事，不顺手做相邻重构、不顺手清理无关代码。
3. **收敛范围**：只改本轮目标相关文件。
4. **自测如实报告**：完成后必须运行项目已有的测试 / typecheck / build（`npm run test:run`、`npm run typecheck`、`npm run build`）。若项目没有对应命令，明确说明「未运行，原因是项目未提供命令」，**不得假装已通过**。
5. **交付输出**：改动文件、完成内容、自测结果、遗留风险、建议的 commit message。

---

## 四、Git 提交规则

1. **每完成一个小的可验收单元就自己 commit 一次，不必先征求确认**——单元切小、提交勤，方便用户日后按步 `git revert` 精准回滚。
2. commit 必须是**原子提交**，只包含该单元相关修改；不得把多件事、或格式化 / 重命名 / 大范围清理与业务实现混进同一个 commit——除非它们是本轮目标的必要组成。
3. commit 前先运行项目已有的测试 / typecheck / build（或说明无法运行的原因）；不得假装已通过。
4. commit 后如实报告 commit hash、`git diff --stat` 与 commit message，让用户能看到刚存了什么、随时回滚。
5. **在任何情况下都不得自动 push。** push 一律等用户明确授权。
6. commit message 写清楚「为什么」，用常规前缀（`fix` / `feat` / `docs` / `test` / `chore` 等）。

---

## 五、数据层实现红线（碰数据的改动逐条强制，违反即在 review 中打回）

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
10. Event.type 必须取自 §7 已定义枚举，写入未定义 type 必须被拒绝。完整 EventType 枚举 + payload 类型表覆盖 §7 全部事件；真实触发逻辑按各事件标注的 Phase 接入（§3.4 一致性约束 4、§10.2）。

### 结构预留、行为后置（最易被偷懒跳过）
11. "某功能整节标 P2/P3"绝不等于可以不建它的表/字段/事件结构。以下结构必须建齐，行为可后置：UnresolvedInterval 表与全部字段、Settings.lifetimePomodoroBaseline、EnergyRecord.mood、Settings.restSuggestionDisplayMode、deviceId/syncedAt 预留字段、statsBaseline 相关字段、全量 EventType 枚举与各 Phase 事件 payload 类型（§10.1、§11 第 4/5 项）。

### 可同步实体 vs Event
12. 可同步实体（Task/DayPlan/Session/EnergyRecord/UnresolvedInterval/Settings）禁止物理删除，删除一律写 deletedAt 软删并保留 tombstone；默认读取过滤 deletedAt != null。Event 不在此列（§2.4）。
13. Session 五种 type 共用同一字段集，不适用字段存 null，不是省略字段。用 TS discriminated union 时别把不适用字段省掉，否则跨端契约不一致（§3.3）。
14. dayPlanId 只是辅助/分析字段，按日统计不得依赖它（会漏掉无 DayPlan 的迁移数据、extra session 等）（§3.3、§3.4 规则）。

### 易错的语义细节
15. completionSource='manual' 完成任务时，validFocusCountAtCompletion 仍要写当时累计有效标准 focus 数（可为 0，也可 >0），不得直接写 0（§7.x task.completed）。
16. extraFocus 计入专注时长，但不计入有效番茄数 / 完整循环 / Task 有效番茄数；discarded focus 不计成果但 actualDuration 仍进总专注时长（§8.1）。
17. 已开始计时的 break 因崩溃/关闭断裂，走 UnresolvedInterval 恢复流程，不得直接写成 break.skipped（§7.6）。
18. longBreakEvery 当前固定为 4，restSuggestionDisplayMode 字段虽在 schema 但其统计窗口未定——字段存在不等于开放 UI 或写入对应事件（§3.7、§7.12）。
19. `appDayStartOffsetMinutes` 固定为 0，不开放 UI 修改，不真实触发设置更新事件。v4 §7.12 已定义 `settings.appDayStartOffsetUpdated`（P2），仅建其 EventType 与 payload schema、不真实触发；不得临时新增 v4 未定义的粗糙事件（§3.7 规则 10、§7.12）。

### 补充红线（来自规范交叉项）
20. restSuggestions 的短休/长休适用范围以 appliesTo 字段为准，不得靠 key 的 short_ / long_ 前缀推断；新增项由统一创建函数生成 key，不手拼前缀（§3.7、§7.7）。
21. ui-behavior-backlog.md 不是数据真值，数据真值一律以 data-layer-spec-v4.md 正文为准；backlog 标"不阻塞"不等于可跳过正文要求的字段/结构预留。
22. DayPlan 超载（今日预估总和 > budgetPomodoros）是派生状态，不写入字段、不发事件；数据层只是"不拒绝写入"，查询/UI 层按需派生超载提示（§3.2、§8.10）。
23. actualDuration 是 Session 实际时长唯一事实源，统计不得用 endedAt − startedAt 重算（§3.3，本批修订 5）。
