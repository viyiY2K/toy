import { Icon } from './Icon';

const React = window.React;

// 真·空态的统一呈现：一个克制的线性小图标 + 一句主句 + 一句指向下一步的引导。
// 只用于用户每天会正面撞见的空态（清单、今日、计时今日、归档），不是给每个微型图表空位用的。
export function EmptyState({ icon, title, hint }) {
  return (
    <div className="empty-state" role="status">
      {icon && (
        <span className="empty-state-icon" aria-hidden="true">
          <Icon name={icon} size={20} stroke={1.4}/>
        </span>
      )}
      <p className="empty-state-title">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
    </div>
  );
}
