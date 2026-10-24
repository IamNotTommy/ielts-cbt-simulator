interface Props {
  secondsLeft: number;
  untimed?: boolean;           // 练习模式听力：不限时
  onSettings: () => void;
  onHelp: () => void;
  onHide: () => void;
  onFinish: () => void;
  onHome: () => void;
  flagged?: boolean;
  onToggleFlag?: () => void;
  hideModeTabs?: boolean;
  mode: 'reading' | 'writing' | 'listening';
  onMode: (m: 'reading' | 'writing') => void;
  /** 演示题才显示考生编号与「演示内容」徽标；真实题包不再出现 */
  demo?: boolean;
  /** 交卷按钮文案（Full length 阶段切换时不同） */
  finishLabel?: string;
}

export default function TopBar({
  secondsLeft, untimed, onSettings, onHelp, onHide, onFinish, onHome, hideModeTabs,
  mode, onMode, flagged, onToggleFlag, demo, finishLabel,
}: Props) {
  const mm = Math.floor(Math.max(0, secondsLeft) / 60);
  const ss = Math.max(0, secondsLeft) % 60;
  const cls = secondsLeft <= 300 ? 'timer critical' : secondsLeft <= 600 ? 'timer danger' : 'timer';
  const final = !untimed && secondsLeft <= 60; // 最后一分钟顶部整条变红
  return (
    <div className={'topbar' + (final ? ' final' : '')}>
      <div className="mode-tabs">
        <button onClick={onHome} title="返回题库（当前作答会自动保存）">‹ 题库</button>
        {!hideModeTabs && (
          <>
            <button className={mode === 'reading' ? 'on' : ''} onClick={() => onMode('reading')}>Reading</button>
            <button className={mode === 'writing' ? 'on' : ''} onClick={() => onMode('writing')}>Writing</button>
          </>
        )}
      </div>
      {demo && <span className="demo-badge">演示内容</span>}
      {untimed ? (
        <span className="timer" title="练习模式 — 不限时">不限时</span>
      ) : (
        <span className={cls} aria-live={secondsLeft <= 60 ? 'polite' : 'off'}>{mm}:{String(ss).padStart(2, '0')} left</span>
      )}
      <div className="actions">
        {onToggleFlag && mode !== 'writing' && (
          <>
            <button
              onClick={onToggleFlag}
              className={flagged ? 'flagged' : ''}
              aria-pressed={!!flagged}
              aria-label={flagged ? '取消当前题的标记' : '标记当前题，稍后回来检查'}
              title="标记当前题，稍后回来检查"
            >⚑ {flagged ? '已标记' : '标记'}</button>
            <span className="sep">|</span>
          </>
        )}
        <button className="tb-finish" onClick={onFinish} title="交卷前会先显示未答与标记摘要">
          {finishLabel ?? '交卷'}
        </button>
        <span className="sep">|</span>
        <button onClick={onSettings} title="字号、配色与亮度">设置</button>
        <span className="sep">|</span>
        <button onClick={onHelp} title="快捷键与操作说明">帮助</button>
        <span className="sep">|</span>
        <button onClick={onHide} title="隐藏屏幕（计时继续）">隐藏</button>
      </div>
    </div>
  );
}
