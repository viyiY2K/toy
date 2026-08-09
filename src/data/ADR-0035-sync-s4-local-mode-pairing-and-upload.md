# ADR-0035 · S4：修复本地编辑与已同步记录的生命周期冲突 + 上传逻辑

## 背景

ADR-0034（S1）落地时发现并记录了一个尚未解决的问题：一条记录首次同步成功后
（`deviceId`/`syncedAt` 被 `writeMode: 'sync'` 写成非空值），此后任何一次**本地正常编辑**
（走既有 `taskCommands.ts` 等命令的默认 `writeMode: 'local'`）都会因为 `'local'` 模式仍然
"硬性要求 `deviceId`/`syncedAt` 必须为 `null`"而校验失败——因为既有更新命令一律靠展开
既有实体对象（`{ ...task, title: xxx, updatedAt: now }`）构造新值，这两个字段会原样带过，
不会被业务命令主动清空。

S1 当时判断这个问题只有在 S4 让 `'sync'` 模式真正写出非空值之后才会变成可复现的真实故障，
所以刻意没有在 S1 里解决。现在到了 S4（真正实现上传、真正会调用 `writeMode: 'sync'` 写回
`syncedAt`），必须先修好这个问题，否则同步功能一上线，用户只要同步过一次就没法再正常编辑
任何数据了。

## 决策：把 `'local'` 模式的校验从"必须为 null"改成"配对一致性"

`src/data/validation/primitives.ts` 的 `validateSyncableBase()`，`mode='local'`（默认）分支：

- **旧行为**：`deviceId`/`syncedAt` 必须都严格为 `null`。
- **新行为**：`deviceId`/`syncedAt` 要么都是 `null`（从未同步过，Phase 1 原有口径不变），
  要么都是合法非空值（`deviceId` 是合法 UUID v7、`syncedAt` 是合法带偏移 ISO 时间）——
  这条分支覆盖"编辑一条此前已经同步过的既有记录"的场景，此时这两个字段的值是上一次
  `'sync'` 写入落下的，本地编辑只是原样带过，不应该被拒绝。
  一边为 `null`、另一边非 `null` 的不一致状态，仍然拒绝（新增 `sync.deviceId.pairing` /
  `sync.syncedAt.pairing` 两个错误码）。

`mode='sync'` 分支不变：仍然要求两者必须是合法非空值。

### 这个改动没有覆盖到的边界

字段级校验只能看到"这次写入的新值"，看不到"写入前的旧值"，所以无法在校验层面强制
"只有 `'sync'` 模式的写入才能把 `deviceId`/`syncedAt` 从 `null` 变成非空"——如果未来某个
本地命令不小心自己伪造了一对合法的 `deviceId`/`syncedAt`，字段级校验拦不住。这一层保护
现在完全靠代码纪律（本地命令只展开既有值、不新造这两个字段）+ code review，不是运行时
强制不变量。记录在此，避免以为这里有比实际更强的保护。

### 受影响的既有测试

`src/data/validation/primitives.test.ts` 里原来两个 case（`deviceId`/`syncedAt` 单独设为
非 null 时必须报 `sync.deviceId.reserved`/`sync.syncedAt.reserved`）随旧行为一起废弃，
替换成一组更完整的"配对规则"用例（覆盖：单边设置被拒绝、两边皆空通过、两边皆合法非空
通过——这一条就是本次要修的生命周期缺口的回归测试、语法非法值仍被拒绝、`'sync'` 模式
本身的正反例）。`src/data/schema/common.test.ts` 测的是工厂函数默认值，不受此次校验语义
调整影响，未改动。

## 上传逻辑（`src/data/sync/uploadChanges.ts`）

见代码内注释；核心设计点摘要：

- 六个可同步 store 各自用 `dataStore.getAllIncludingDeleted()` 取全量本地记录（含软删
  tombstone，tombstone 也需要上传，让远端同步"这条记录已被删除"这个事实），筛出
  `syncedAt === null || updatedAt > syncedAt` 的记录作为待上传集合。
- 每个实体的本地 camelCase 字段 → 远端 snake_case 列名，各自有一个显式的 `toRemoteRow`
  映射函数（不做通用反射式驼峰转下划线，字段集合、类型转换需要显式可读，避免"某个字段
  改名后映射悄悄错位"这类问题难以发现）。
- `syncedAt` 本身**不出现在上传 payload 里**——它是纯本地簿记字段（S2 设计已不建对应的
  远端列），上传前从 payload 剔除。
- `supabase.from(table).upsert(rows, { onConflict: 'id' })`；upsert 成功后，对这批 id 通过
  `executeAtomicWrite({ writeMode: 'sync' }, ...)` 把本地 `syncedAt` 回写为本次同步时刻、
  `deviceId` 回写为本机设备 id；upsert 失败的记录不做任何本地回写（下一轮同步会因为
  `syncedAt` 仍然落后于 `updatedAt` 而重新尝试）。
- Event 上传路径不同：Event 没有 `updatedAt`/`deletedAt`，用本地游标
  （`localStorage` 存 `lastUploadedEventId`，UUID v7 字符串本身按时间字典序，可以直接当
  游标比较）筛出待上传的新 Event，`upsert(rows, { onConflict: 'id', ignoreDuplicates: true })`
  ——对应 v4 §2.6"Event 相同 id 视为同一条记录，保留任意一份即可"。
