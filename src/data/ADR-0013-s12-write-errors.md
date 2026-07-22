# ADR-0013 · 写前校验与脱敏错误事件（Phase 1 / S12）

- 范围：`phase1-plan.md` **S12**；落实 v4 **§7.17**、**§9.3** 与 checklist
  `error.dataWriteFailed` / `error.unexpectedState`。
- 业务写入口：`executeAtomicWrite` 在 S8 原子事务内提供强类型
  `put/softDelete/appendEvent`；六类实体分别调用 S6 validator，Event 调用 S7 validator，
  校验上下文能读取当前事务内待提交记录与保留的 tombstone。
- 公共边界：`src/data/index.ts` 的 `dataStore` 是运行时和类型层均只读的独立 facade；
  raw `put/appendEvent/runAtomic/softDelete` 只存在于未从公共 barrel 导出的内部 store，
  上层无法绕过 `executeAtomicWrite`。
- 失败分类：字段/不变量校验失败不执行目标写入、整批回滚，并在独立事务尽力追加
  `error.unexpectedState`（`detectedBy='writeValidation'`）；IndexedDB 请求失败整批回滚，
  独立追加 `error.dataWriteFailed`。普通业务回调错误不冒充存储失败。
- 脱敏：error `context` 只复制封闭白名单中的机器字段；`errorMessage` 固定为 null；
  不复制 Error 文本、Task 标题、备注、EnergyRecord 文本、payload 或实体快照。
- 防递归：错误 Event 的构造、校验或独立写事务再次失败时，不调用错误写入口；仅把相同的
  已脱敏诊断写入最多 50 条的内存环形记录并 `console.error`。
- P1 边界：只启用 create/update/soft-delete/appendEvent 的 `writeValidation`；不实现
  startupCheck、readValidation、全库扫描、旧坏数据修复、错误恢复 UI 或诊断导出。
