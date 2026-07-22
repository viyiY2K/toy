# ADR-0012 · Tombstone 与默认读取过滤（Phase 1 / S9）

- 范围：`phase1-plan.md` **S9**；落实 v4 **§2.4** 与 **§3.1 关键规则 5**。
- 默认读取：`dataStore` 和原子事务的 `get/getAll` 对六个可同步实体只返回
  `deletedAt === null` 的有效记录；Event 没有 `deletedAt`，普通读取不受过滤。
- 显式读取：恢复/审计路径通过仅接受 `SyncableStoreName` 的
  `getIncludingDeleted/getAllIncludingDeleted` 查看 tombstone；Event 在类型层没有该入口。
- 软删写入：只在 S8 原子事务中提供按 store 映射到实体类型的 `softDelete`，写入
  `deletedAt` 并同步推进 `updatedAt`。Task 另写 `status='deleted'`、可选
  `deletedReason`，并清空与 deleted 状态冲突的完成/归档当前状态字段。
- 安全边界：不存在物理 delete/clear/remove；Event 在类型层和运行时均拒绝软删；
  重复软删拒绝而不改写已有 tombstone。
- 不在本单元：S10 派生视图、S12 写入校验/错误事件、恢复 UI、Event 修正流程。
