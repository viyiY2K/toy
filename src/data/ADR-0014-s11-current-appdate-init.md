# ADR-0014 · 当前产品日最小初始化闭环（Phase 1 / S11）

- 范围：`phase1-plan.md` **S11**；落实 v4 **§10.2**、**§3.7 关键规则 2/6**、
  §7.1/§7.3/§7.12 的 P1 初始化触发。
- 组合入口：`ensureCurrentAppDateInitialized({ now, timezone })` 在一个 S12
  `executeAtomicWrite` 中依次确保 Settings、按 Settings offset 派生的当前 appDate DayPlan，
  以及 DayPlan 首次创建时的 auto-add 每日模板 Task。
- 默认事实：首库 Settings 复用 S5 工厂的 25/5/15/4、28 条内置休息项和 1 条
  planningPreparation 模板；DayPlan 固化这四个计时字段的 settingsSnapshot；模板 Task
  写首轮 estimateRound、metadata.templateKey/source，并按 first/last 放入 taskIds。
- 事件：确实创建时才写 `settings.initialized` / `dayPlan.created` / `task.created` /
  `dayPlan.taskAdded`；同一次组合调用全部使用 S8 事务生成的同一个 correlationId。
- 幂等：IndexedDB 全 store 写事务串行化并发初始化；已有 Settings/当前 DayPlan 时不重写；
  模板步骤另以当前 taskIds 和既有 task.created Event 防止同日重入或用户移除后重建。
- 异常边界：若没有有效 Settings 但存在 tombstone，不把数据修复/重建冒充首次初始化，
  本步骤拒绝继续；Phase 1 不自动修复旧坏数据。
- 边界：不创建完整计划页、预算/扣除项编辑、历史复盘、收工、统计或 UI；不滚入昨日任务。
