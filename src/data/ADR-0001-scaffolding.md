# ADR-0001 · 数据层工程脚手架与技术选型（Phase 1 / S0）

- 状态：已采纳（2026-06-05）
- 范围：phase1-plan.md **S0**；落实 v4 **§2.1**（dataStore 抽象、组件不得直接读写底层存储）、**§2.2**（UUID v7）。
- 决策记录依据：S0 / D1 要求实现方将选型记录为 ADR / implementation note（不作为阻塞项）。

## 背景

仓库原为纯浏览器原型（`index.html` + `@babel/standalone` + 6 个全局作用域 `.jsx`），无任何工具链，无法 `import`、无法跑单元测试。Phase 1 后续 S1–S14 的验收全部依赖类型定义、模块 import 与正反单测，故 S0 须先立起可独立测试的数据层工程基础。

## 决策

1. **工具链 = TypeScript + Vite + Vitest**，遵守"稳定最小"：只引入数据层必需依赖。
   - `dependencies`：`uuid@^11`（提供 `v7`）。
   - `devDependencies`：`typescript`、`vite`、`vitest`、`@types/node`。
   - 暂不引入 ESLint / Prettier / CI / 状态管理 / UI 构建工具（挂账后续）。
2. **原型零改动**：现有 `index.html` 与 6 个 `.jsx` 保持原样；**刻意不建接管 `index.html` 的 `vite.config`**，仅以 `vitest.config.ts`（node 环境）驱动数据层测试。原型与新数据层的集成留到 S13。
3. **数据层落点 = `src/data/`**，对外只经 `src/data/index.ts`（barrel）暴露，内部文件不被上层直接深引。

## ID 生成（§2.2，红线 1）

- 选 `uuid` 包的 `v7`：标准实现、生态稳定、自带 TS 类型，满足"前 48 位时间戳、天然时间序"。
- 备选 `uuidv7` 专用包（强调单调性）暂不选用：`uuid` 覆盖面更广、维护更稳；S2 若对单调性有更强要求再评估。
- S0 仅冒烟验证版本位 = 7；单一来源强制（全库 grep 唯一）与连续生成单调递增的硬验收留 S2。

## 存储访问方向（§2.1）

- S0 仅定义最小 `StorageAdapter` 接口（`get/getAll/put`），确立"组件不得直接读写底层存储"的边界类型。
- 接口**刻意不暴露通用物理删除原语**（v4 §2.4、红线 12：可同步实体禁止物理删除、Event 不可删除），避免给 S1/S9 留误用入口；业务删除一律走软删 API（S9），本轮不提前建。
- **S0 不做**：IndexedDB 实现、objectStore 结构、事务（transaction）机制、`dataStore` CRUD —— 全部留 S1。
- S1 方向（待定稿，非本 ADR 锁定）：优先原生 IndexedDB 封装在 `StorageAdapter` 之后；如易用性需要再评估引入 `idb`（Jake Archibald 的轻量 Promise 封装）；单元测试用内存适配器或 `fake-indexeddb`。

## 不在 S0 做

实体 schema（S5）、校验器（S6）、EventType 枚举（S7）、原子写入（S8）、软删（S9）、派生视图（S10）、初始化闭环（S11）、错误事件（S12）、核心行为接入（S13）、旧数据处理（S14）；不迁移原型、不改 UI/视觉/交互；不把旧 `data.jsx` 当新数据真值。
