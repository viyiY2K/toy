import type {
  DayPlan,
  EnergyRecord,
  Event,
  MergeGroup,
  Session,
  Settings,
  Task,
  UnresolvedInterval,
} from '../schema';

/**
 * S6 validators 的只读查询边界。
 *
 * 纯字段校验不依赖存储；需要检查层级、引用或有效记录唯一性时，由后续 S8
 * 事务适配器提供本接口。所有查询都必须包含当前事务内尚未提交的变更。
 */
export interface ValidationContext {
  getTask?(id: string): Promise<Task | undefined>;
  hasTaskChildren?(id: string): Promise<boolean>;
  getDayPlan?(id: string): Promise<DayPlan | undefined>;
  getActiveDayPlanByAppDate?(appDate: string): Promise<DayPlan | undefined>;
  getSession?(id: string): Promise<Session | undefined>;
  getEnergyRecord?(id: string): Promise<EnergyRecord | undefined>;
  getEvent?(id: string): Promise<Event | undefined>;
  getUnresolvedInterval?(id: string): Promise<UnresolvedInterval | undefined>;
  getSettings?(id: string): Promise<Settings | undefined>;
  getActiveSettings?(): Promise<Settings | undefined>;
  isRestSuggestionReferenced?(key: string): Promise<boolean>;
  getMergeGroup?(id: string): Promise<MergeGroup | undefined>;
  /** 是否仍有 Task 的当前归属指针指向指定合并组（含软删除记录）。 */
  hasTasksInMergeGroup?(mergeGroupId: string): Promise<boolean>;
  /**
   * 该合并组当前那条 `status='active'` 的 focus Session（没有则 undefined）。
   * §3.8 一致性约束 1 的瞬时例外要用它：进行中允许把未来成员移空到只剩当前成员，
   * `taskIds` 长度可以暂时降到 1（关键规则 15）。
   */
  getActiveFocusSessionByMergeGroupId?(mergeGroupId: string): Promise<Session | undefined>;
}
