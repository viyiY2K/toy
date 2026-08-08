# ADR-0034 · S1：设备身份 + 同步写入模式解锁

## 背景

多端同步（Phase 5）第一个可验收单元。目标：在不依赖任何外部账号、不改动 UI、对现有行为零回归的前提下，为后续阶段（S2+ 接 Supabase）打好本地地基。

## 决策

### 1. `validateSyncableBase` 新增可选 `mode: 'local' | 'sync' = 'local'`

`src/data/validation/primitives.ts`。默认值 `'local'`，行为与此前完全一致（`deviceId`/`syncedAt` 必须严格为 `null`，对应既有测试 `primitives.test.ts` 里 `sync.deviceId.reserved` / `sync.syncedAt.reserved` 两个 case）。`mode: 'sync'` 时改为要求二者是合法非空值（UUID v7 / 带偏移 ISO 时间）——用于同步引擎把远端数据落地本地、或本地上传成功后回写 `syncedAt` 这类写入。

六个实体校验文件（`task.ts`/`dayPlan.ts`/`session.ts`/`energyRecord.ts`/`unresolvedInterval.ts`/`settings.ts`）的 `collectXxxValidationIssues` 与 `validateXxx` 各自新增同名可选 `mode` 参数，原样透传，不改其余任何校验逻辑。

`src/data/writes/executeAtomicWrite.ts` 的 `ExecuteAtomicWriteOptions` 新增可选 `writeMode?: 'local' | 'sync'`（默认 `'local'`），贯穿 `validateEntity` 传给对应实体的 `validateXxx`。**不新增第二条写入通道**——同步写入依旧走同一个 `executeAtomicWrite` → `internalDataStore.runAtomic`，只是多一个显式开关，满足"同步写入本地时不得绕开原子写链路"的红线。

### 2. `src/data/sync/deviceIdentity.ts`：设备身份存 localStorage，不进 IndexedDB

`deviceId` 是"这台设备本身"的本地环境标识，不是任何可同步实体的字段值，因此不适合存进 IndexedDB（那里存的是跨端共享的实体记录）。`getOrCreateDeviceId()` 接受可选注入的 storage 契约，默认用 `localStorage`，便于测试用内存实现替代。ID 生成复用 `newId()`，不直接 `import` `uuid` 包，满足 `single-id-source.test.ts` 的 AST 扫描。

本阶段**不改** `src/data/index.ts`、不改任何 UI 文件——同步能力尚未对外暴露。

## 已知但本阶段刻意不解决的问题（留给 S4）

实现过程中发现一个真实存在、会在 S4 落地时浮现的生命周期缺口，记录在此，避免遗忘：

现有的更新类命令（如 `taskCommands.ts` 里的多处 `{ ...task, title: xxx, updatedAt: now }`）一律通过**展开既有实体对象**再覆盖业务字段的方式构造新值，`deviceId`/`syncedAt` 会原样带过、不会被业务命令主动清空。

按 S4 设计，一条记录首次同步成功后，`deviceId`/`syncedAt` 会被写成非空值（`writeMode: 'sync'`）。**此后**如果用户在本地正常编辑这条记录（走默认 `writeMode: 'local'` 的既有命令路径），展开出的新值仍然带着那对非空的 `deviceId`/`syncedAt`——但当前 `'local'` 模式的校验要求二者必须严格为 `null`，会导致这次编辑被拒绝。也就是说：**一条记录只要同步过一次，之后任何一次本地编辑都会在当前设计下校验失败**。

这不是 S1 引入的新问题（S1 完全没有产出任何非 null 的 `deviceId`/`syncedAt`），但会在 S4 让 `writeMode: 'sync'` 真正写出非空值的那一刻变成可复现的真实故障。S1 不在本单元里解决它，因为修复方式（很可能是把 `'local'` 模式的校验从"必须为 null"放宽成"要么都为 null、要么都是此前写入的合法值"）需要同时改动这两个已被独立 review 过的测试用例（`primitives.test.ts` 里 `sync.deviceId.reserved`/`sync.syncedAt.reserved` 两个 case 的期望结果），属于对既有校验语义的实质性变更，超出"设备身份 + 开关新增"这一个最小单元的范围，应该作为 S4 的显式设计输入，而不是顺手在 S1 里改掉。
