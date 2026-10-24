interface CtxState {
  x: number;
  y: number;
  hasSelection: boolean;
  onHighlight: boolean; // 点在已高亮文字上
}

interface Props {
  state: CtxState;
  onPickColor: (cls: 'hl-y') => void;
  onNotes: () => void;
  onClear: () => void;
  onClearAll: () => void;
  onClose: () => void;
}

/** 批注工具条：**黄色高亮**（只保留黄色，按用户要求去掉绿/粉）+ 取消高亮 + 添加笔记 + 清空 */
export default function ContextMenu({ state, onPickColor, onNotes, onClear, onClearAll, onClose }: Props) {
  const act = (label: string, icon: string, enabled: boolean, fn: () => void) => (
    <span
      className={'annotate-act' + (enabled ? '' : ' disabled')}
      onClick={() => { if (enabled) { fn(); onClose(); } }}
    >
      <span>{icon}</span>
      {label}
    </span>
  );

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 969 }} onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
      <div
        className="ctx-menu"
        style={{
          left: Math.max(8, Math.min(state.x, window.innerWidth - 470)),
          top: Math.max(8, Math.min(state.y, window.innerHeight - 70)),
          width: 'auto',
        }}
        onMouseDown={e => e.preventDefault()} // 保住文本选区
      >
        <div className="annotate-bar">
          <span className="annotate-act" onClick={() => { onPickColor('hl-y'); onClose(); }}>
            <span style={{ display: 'inline-block', width: 13, height: 13, borderRadius: 3, background: '#ffe066', border: '1px solid #e6c200', verticalAlign: '-2px' }} />
            Highlight
          </span>
          <span className="annotate-sep" />
          {act('Add note', '📝', state.hasSelection, onNotes)}
          {act('Remove highlight', '✕', state.onHighlight, onClear)}
          {act('Clear all', '⊘', true, onClearAll)}
        </div>
      </div>
    </>
  );
}
