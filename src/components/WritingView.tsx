import { useRef, useState } from 'react';
import type { WritingTask } from '../types';
import { loadUiSettings, saveUiSettings } from '../lib/uiSettings';

export function countWords(t: string): number {
  return t.trim().split(/\s+/).filter(Boolean).length;
}

interface Props {
  task: WritingTask;
  text: string;
  onChange: (t: string) => void;
}

/** 写作主界面：左题目右作答框，实时字数（规格第 4 章）。
 *  按 2026 机考真实行为：写作区同样禁复制、禁粘贴，不留开关。 */
export default function WritingView({ task, text, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  /* 分栏比例拖拽（与阅读共用同一记忆值） */
  const [split, setSplit] = useState(() => loadUiSettings().split);
  const persistSplit = (n: number) => {
    const clamped = Math.min(75, Math.max(25, Math.round(n)));
    const cur = loadUiSettings();
    saveUiSettings({ ...cur, split: clamped });
    return clamped;
  };
  const dragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const content = rootRef.current;
    if (!content) return;
    const move = (ev: MouseEvent) => {
      const r = content.getBoundingClientRect();
      setSplit(Math.min(75, Math.max(25, ((ev.clientX - r.left) / r.width) * 100)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setSplit(s => { persistSplit(s); return s; });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const onDividerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setSplit(s => persistSplit(s - 5)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setSplit(s => persistSplit(s + 5)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSplit(persistSplit(50)); }
  };

  return (
    <div
      className="content"
      ref={rootRef}
      style={{ ['--split' as any]: `${split}%` }}
    >
      <div className="pane passage">
        <div className="part-card">
          <h2 className="part-name">{task.part}</h2>
          <p className="part-sub">{task.timing}</p>
        </div>
        <div className="task-prompt">
          {task.promptLines.map((l, i) => (
            <p key={i} className={l.style}>{l.text}</p>
          ))}
        </div>
        {task.hasChart && (
          <div className="chart-box">
            {task.figureImage ? (
              <img src={task.figureImage} alt="Task 1 source figure" style={{ maxWidth: '100%', height: 'auto' }} />
            ) : task.figureData?.columns?.length ? (
              <>
                <div className="chart-title">
                  {task.figureType === 'table' ? 'Table（题目所附数据表）' : `Figure: ${task.figureType ?? 'chart'}`}
                </div>
                <table className="fig-table">
                  <thead>
                    <tr>{task.figureData.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(task.figureData.rows ?? []).map((r, i) => (
                      <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <div className="chart-title">
                  {task.figureType ? `Figure (${task.figureType})` : 'Average weekly housework hours, 2005 vs 2025'}
                </div>
                <div className="chart-placeholder">
                  {task.figureType ? '本题包未附图形数据，请参照原卷图表作答' : '图表占位（演示内容，非真题）'}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div
        className="divider"
        onMouseDown={dragStart}
        onDoubleClick={() => setSplit(persistSplit(50))}
        onKeyDown={onDividerKey}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动或按左右方向键调整题目与写作区宽度，回车重置为 50%"
        aria-valuenow={Math.round(split)}
        aria-valuemin={25}
        aria-valuemax={75}
        tabIndex={0}
        title="拖动或按 ←/→ 调整宽度（回车重置 50%）"
      />

      <div className="pane questions write-pane">
        <textarea
          spellCheck={false}  /* 真机无拼写检查 */
          value={text}
          onChange={e => onChange(e.target.value)}
          placeholder="Write your answer here…"
        />
        <div className={'wordcount' + (countWords(text) >= task.minWords ? ' reached' : '')}>
          当前词数 <b>{countWords(text)}</b> / 建议最低 {task.minWords}
        </div>
      </div>
    </div>
  );
}
