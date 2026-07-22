import { v7 as uuidv7 } from 'uuid';

/**
 * 单一 ID 生成入口（红线 1、v4 §2.2）。
 *
 * 全数据层一律通过本函数产出实体 / Event / 扣除项等 id；禁止自增整数、nanoid、UUID v4。
 * UUID v7 前 48 位为毫秒级时间戳，天然按时间排序，便于 IndexedDB / SQLite 按 key 范围查询。
 *
 * S2 已固化：本函数是全数据层唯一 ID 生成入口——
 * - 单一来源由 single-id-source.test.ts 守卫（src/data 内只有本文件可引入 uuid）；
 * - 连续生成单调递增（时间序）由 uuid 的 v7 保证，并在 id.test.ts 硬验收。
 */
export function newId(): string {
  return uuidv7();
}
