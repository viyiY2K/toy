# ADR-0007 · S6a Task / DayPlan 写入校验

## 状态

Accepted（S6a）

## 范围与依据

- `docs/data-layer-spec-v4.md` §2.2–§2.5、§3.1、§3.2。
- `docs/phase1-plan.md` S6 的 Task / DayPlan 可独立验收子单元。
- `docs/phase1-checklist.md` A–C。

S6a 只建立公共验证原语、事务内只读 `ValidationContext`，以及 Task / DayPlan
写入校验器。Session、EnergyRecord、UnresolvedInterval、Settings 属 S6b；Event
type / payload 属 S7。

## 决策

1. 校验器接受 `unknown`，先验证完整且无额外字段的运行时 shape，再验证类型、
   范围、枚举和跨字段一致性；失败统一抛出含结构化 `issues` 的
   `EntityValidationError`。
2. `ValidationContext` 是只读、事务感知的查询边界。Task 两层限制、DayPlan 的
   Task 引用和有效 `appDate` 唯一性通过它检查；S8 的事务适配器必须让查询看到
   同一事务内尚未提交的变更。存在关联字段却缺少对应查询能力时，校验器会以
   `validation.context.required` 拒绝，不能静默跳过跨记录约束。对 DayPlan 更新还
   会读取同 id 旧记录，禁止改写创建时 `timezone`、`localDate` 与 `appDate`。
3. 新 Task 写入要求 `estimateRounds` 含连续的 1–3 轮，首轮从 index 1 开始。
   这是 v4 §3.1 关键规则 11 的正式数据写入口径；legacy 兼容不进入普通写路径。
   当前 `estimatedPomodoros` 必须等于最新轮总预估；原始任务的 lineage 等于自身
   id，拆分任务继承来源 lineage。
4. DayPlan `freeMin` 只在所有扣除项以原始小数分钟求和后对最终结果取整，并将
   负数钳制为 0。`conservativePomodoros` / `optimisticPomodoros` 仅验证非负整数；
   v4 §3.2 明确不要求数据层复算二者公式。
5. 校验 `localDate` 与创建业务时间、记录自身 IANA timezone 一致。历史
   `DayPlan.appDate` 不按当前 offset 回算，因为 v4 §2.5 明确它是创建时业务键且
   offset 变更后不可重写。

## 明确不做

- 不比较任何 Session 的 `actualDuration` 与时间戳差值。
- 不落库、不开事务、不写 Event，不实现 P2+ 行为或 UI。
- 不修改规范、计划、checklist 或历史资料。
