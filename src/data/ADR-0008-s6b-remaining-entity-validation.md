# ADR-0008 · S6b 其余可同步实体写入校验

## 状态

Accepted（S6b）

## 范围与依据

- v4 §2.5、§3.3、§3.5、§3.6、§3.7。
- phase1-plan S6 的 Session / EnergyRecord / UnresolvedInterval / Settings 子单元。
- phase1-checklist A、D–G。

## 决策

1. 四个实体复用 S6a 的严格 runtime shape、公共字段和结构化错误原语；所有跨
   记录约束通过同一事务可见的 `ValidationContext` 查询，缺少必要能力时拒绝。
2. Session 按五种 type 和四种 status 验证完整字段矩阵。标准 Session 新建时的
   `plannedDuration` 取有效 Settings 快照值，并按创建时 offset 绑定对应产品日的
   有效 DayPlan；更新时保留原创建事实，不用后来 Settings 反向改写。
3. Session `actualDuration` 仅校验自身的 null/0/正整数规则，绝不与
   `endedAt - startedAt` 比较。该字段仍是实际时长唯一事实源。
4. EnergyRecord 的 after-* source 必须引用对应 type 的 Session；独立 source 固定
   `sessionId=null`。UnresolvedInterval 严格验证时间顺序和状态时间矩阵。
5. Settings 验证单例、计时范围、固定 `longBreakEvery=4`、两类内嵌数组完整
   shape/唯一 key/custom UUID v7 前缀、offset 范围。内置休息项/模板不可移除；
   已被历史 Session 引用的自定义休息项不可物理移除。

## 明确不做

- 不校验 Event type/payload，不落库、不开事务、不实现命令或 UI。
- 不派生统计，不实现 P2+ 恢复/设置界面行为。
- 不修改规范、计划、checklist 或历史资料。
