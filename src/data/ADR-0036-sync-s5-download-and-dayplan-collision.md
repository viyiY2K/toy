# ADR-0036 · S5：下载（远端 → 本地）+ DayPlan 首次同步冲突处理

## 决策

`src/data/sync/downloadChanges.ts` 处理五个实体（tasks/day_plans/sessions/energy_records/
unresolved_intervals，不含 settings——见下方说明），按本地游标（`localStorage` 里各表各自的
`lastPulledAt`）增量拉取 `updated_at > cursor` 的远端行，逐条应用：本地不存在则直接写入，
已存在则按 `updatedAt` 取较新一份，否则跳过（本地更新，留给下一轮上传推送）。

**每条远端行各自一次独立的 `executeAtomicWrite`**，不是整批一个大事务：校验失败（比如极端
情况下 DayPlan 引用的 Task 还没下载到本地）只影响这一条，不拖累同批其它行。已知限制：
游标按"这一批已抓取到的行"整体推进，不区分单行是否应用成功——一条持续失败的行不会被无限
重试，除非它在远端又有新的 `updatedAt`。本模块把 tasks 排在 dayPlans 之前下载，同一轮内
DayPlan 引用的 Task 通常已经先落地，这个限制预期极少触发，未来如果真的需要更强的重试保证，
需要另外的"失败清单"机制，本次不做。

**Settings 明确排除在本模块之外**：不适用整表 last-write-wins，需要字段级合并，留给 S6。

## DayPlan 首次同步的 appDate 冲突

两台从未同步过的设备各自为同一天创建了 DayPlan（不同 id、相同 appDate）时，本地
`validateDayPlan` 本身就会拒绝"同一 appDate 出现第二条有效记录"（`dayPlan.appDate.unique`），
所以不处理这个场景的话，下载会直接报错。按用户已确认的产品决策——首次同步冲突"自动合并，
不打断用户"——处理方式：

- 谁的 `updatedAt` 更新，谁留下；另一条本地软删除（不物理删除，保留 tombstone）。
- 判定与操作放在 `resolveDayPlanAppDateCollisionIfAny()` 里，**独立于**随后写入远端行的那次
  `'sync'` 模式原子写，单独用一次 **`'local'` 模式**原子写完成软删。原因：本地这条"输家"
  DayPlan 从未同步过，`deviceId`/`syncedAt` 是 `null`/`null`；软删它只是清理本地遗留数据，
  不代表"这条记录本身被同步了"，理应保持 `null`/`null` 配对（ADR-0035 的配对规则）。如果图
  省事把这次软删塞进后面 `'sync'` 模式的事务里，`writeMode:'sync'` 会强制要求 tombstone 的
  `deviceId`/`syncedAt` 非空，而 `buildSoftDeleteTombstone` 只是从既有记录原样带过这两个
  字段——直接踩坑校验失败（本单元开发过程中实际踩到过，见下方"验证记录"）。
- 已知限制：这个判断读一次本地状态（不在事务内），随后才做写入，中间存在一个理论上的极小
  竞态窗口（比如正好这一刻用户又在改本地 DayPlan）。这是冷启动冲突场景里可接受的已知限制，
  不引入额外加锁机制。
- 另一个已知限制：如果本地版本"赢了"（保留本地、跳过远端行），远端那条"输家" DayPlan 不会
  被这台设备清理，会在 Supabase 里持续存在，未来第三台设备下载时可能重新看到它。这是本次
  范围内刻意不解决的问题（需要"客户端主动删除/合并远端行"的能力，目前架构未设计这一层），
  记录在此备查。

## 验证记录（供 review 参考）

开发过程中第一版实现把软删和写入放进同一个 `'sync'` 模式事务，测试报错：
`deviceId` → `id.uuidV7`、`syncedAt` → `time.isoWithOffset`（即"必须非空"校验失败在一条
`deviceId`/`syncedAt` 仍是 `null`/`null` 的 tombstone 上）。这正是上面"为什么要拆成两次
独立写入"的直接证据，保留在此避免以后被误改回"合并成一次事务更简洁"。
