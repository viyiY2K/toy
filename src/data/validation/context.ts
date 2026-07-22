import type {
  DayPlan,
  EnergyRecord,
  Event,
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
}
