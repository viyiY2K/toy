# ADR-0003 · 单一 UUID v7 ID 生成入口（Phase 1 / S2）

- 状态：已采纳（2026-06-05）
- 范围：phase1-plan.md **S2**；落实 v4 **§2.2**（UUID v7，禁自增/nanoid/v4）、红线 1。

## 背景

S0 已建 `src/data/id.ts` 的 `newId()`（委托 `uuid` 的 `v7`），但只做了 v7 格式冒烟。S2 收口两件被推迟的事：①全数据层**单一 ID 来源**的强制；②连续生成**单调递增**的硬验收。

## 决策

1. **唯一入口**：`newId()`（`src/data/id.ts`）是全数据层唯一调用 `uuid` 的地方；其余代码一律 `import { newId }`。实体 / Event / 扣除项 id / 未来自定义 key 的 UUID 段都经它产出。
2. **依赖 uuid v7 内建单调，不自写包装**：实测 `uuid@11` 的 `v7` 连续 5000 次生成 4999 严格递增、0 相等、0 回退（同毫秒内由内部序列保证单调）。故不引入 `uuidv7` 专用包、不自写单调计数器。`id.test.ts` 以「连续 1000 个字典序单调且无重复」硬验收。
3. **自动化单一来源守卫**：`single-id-source.test.ts` 随 `npm test` 运行，递归扫描 `src/data` 非测试 `.ts`，断言：仅 `id.ts` 引入 `uuid`；全目录无 `nanoid` / `crypto.randomUUID` / `uuidv4`；`id.ts` 只用 `v7` 不用 `v4`。任何人将来在别处引入第二套生成器，测试立即红。
4. **守卫范围 = `src/data`**：按红线"全数据层"口径限定。旧 `.jsx` 原型里的 `Math.random()` / `Date.now()` / 字面量 id 属旧结构、非新数据层，不在 S2 范围，留待 S13 接入 / S14 不迁移时处理。

## 不在 S2 做

- 自定义 key（restSuggestions / dailyTemplates）的**载体**属 S5（Settings），本轮不建；仅约定其 UUID 段创建时复用 `newId()`，届时守卫自动拦截任何第二来源。
- 不做 S3（时区/appDate）、S4（schemaVersion）、S5（实体 schema）；不接 UI；不把 ID 时间序当业务排序用（红线 2，本轮只验证生成单调）。
