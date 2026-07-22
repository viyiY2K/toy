/**
 * Settings 内置默认种子（S5d，v4 §3.7 内置默认清单）。
 *
 * 单一来源：短休 15 项 + 长休 13 项 = 28 项 restSuggestions，以及 1 项 planningPreparation 每日模板。
 * `makeSettings`（./settings）默认即写入这两套种子的**深拷贝**（§3.7 关键规则 2）；S11 初始化只消费、不重定义。
 *
 * 数据严格照 §3.7 清单：内置项 isBuiltIn=true / isEnabled=true / icon=null；
 * 短休 appliesTo=['shortBreak']、sortIndex 1000→15000 步长 1000；长休 appliesTo=['longBreak']、sortIndex 1000→13000；
 * 两组 sortIndex 互不干扰（§3.7 / 红线 20：展示范围以 appliesTo 为准，不靠 key 前缀推断）。
 *
 * 公共导出为**深冻结的只读视图**（数组 / 元素 / appliesTo 全部 frozen + readonly 类型），
 * 外部无法原地改写 canonical 常量，避免污染 `makeSettings` 的默认内置清单。
 */

import type {
  ReadonlyDailyTaskTemplate,
  ReadonlyRestSuggestion,
  RestSuggestion,
} from './settings';

/** 递归冻结对象/数组（含嵌套数组），使公共导出不可被外部原地修改。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

/** 内置短休建议（15 项，§3.7）。 */
const BUILTIN_SHORT_BREAK_SUGGESTIONS: RestSuggestion[] = [
  { key: 'short_scalp_massage', label: '梳头皮', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 1000, icon: null },
  { key: 'short_shoulder_rolls', label: '绕肩', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 2000, icon: null },
  { key: 'short_march_in_place', label: '原地踏步', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 3000, icon: null },
  { key: 'short_self_hug', label: '拥抱', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 4000, icon: null },
  { key: 'short_temple_massage', label: '揉太阳穴', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 5000, icon: null },
  { key: 'short_butterfly_tapping', label: '蝴蝶拍', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 6000, icon: null },
  { key: 'short_stretch_up', label: '伸懒腰', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 7000, icon: null },
  { key: 'short_deep_breathing', label: '深呼吸', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 8000, icon: null },
  { key: 'short_toe_dance', label: '脚趾舞', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 9000, icon: null },
  { key: 'short_full_body_stretch', label: '站姿全身伸展', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 10000, icon: null },
  { key: 'short_drink_water', label: '喝水', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 11000, icon: null },
  { key: 'short_gaze_distance', label: '远眺', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 12000, icon: null },
  { key: 'short_neck_shoulder_stretch', label: '拉伸肩颈', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 13000, icon: null },
  { key: 'short_touch_leaf', label: '抚摸叶子', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 14000, icon: null },
  { key: 'short_feeling_note', label: '写下此刻的感受', appliesTo: ['shortBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 15000, icon: null },
];

/** 内置长休建议（13 项，§3.7）。 */
const BUILTIN_LONG_BREAK_SUGGESTIONS: RestSuggestion[] = [
  { key: 'long_listen_music', label: '听音乐', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 1000, icon: null },
  { key: 'long_screen_free_walk', label: '不看屏幕的散步', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 2000, icon: null },
  { key: 'long_enjoy_view', label: '看风景', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 3000, icon: null },
  { key: 'long_mindful_breathing', label: '正念呼吸', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 4000, icon: null },
  { key: 'long_jigsaw_puzzle', label: '拼拼图', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 5000, icon: null },
  { key: 'long_hold_plush_toy', label: '把玩毛绒玩具', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 6000, icon: null },
  { key: 'long_eat_fruit_slowly', label: '慢慢吃点水果', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 7000, icon: null },
  { key: 'long_gentle_yoga', label: '做舒缓瑜伽', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 8000, icon: null },
  { key: 'long_simple_stretch', label: '简单拉伸', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 9000, icon: null },
  { key: 'long_wall_stand', label: '靠墙站立', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 10000, icon: null },
  { key: 'long_balcony_daydream', label: '在阳台发呆', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 11000, icon: null },
  { key: 'long_tidy_desk', label: '收拾桌面', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 12000, icon: null },
  { key: 'long_sip_water', label: '小口慢慢喝水', appliesTo: ['longBreak'], isBuiltIn: true, isEnabled: true, sortIndex: 13000, icon: null },
];

/** 内置 restSuggestions 默认清单（短休 15 + 长休 13 = 28 项，§3.7）。深冻结只读视图。 */
export const BUILTIN_REST_SUGGESTIONS: readonly ReadonlyRestSuggestion[] = deepFreeze([
  ...BUILTIN_SHORT_BREAK_SUGGESTIONS,
  ...BUILTIN_LONG_BREAK_SUGGESTIONS,
]);

/** 内置 dailyTaskTemplates 默认清单（1 项 planningPreparation，§3.7）。深冻结只读视图。 */
export const BUILTIN_DAILY_TASK_TEMPLATES: readonly ReadonlyDailyTaskTemplate[] = deepFreeze([
  {
    templateKey: 'planningPreparation',
    title: '计划准备',
    estimatedPomodoros: 1,
    autoAddToDayPlan: true,
    sortPosition: 'first',
    sortIndex: 0,
    isBuiltIn: true,
  },
]);
