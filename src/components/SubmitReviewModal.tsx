/** 交卷前检查：未答 / Flag / 写作词数摘要，可点题号返回定位；时间归零不经过这里。 */
import { useEffect, useRef, useState } from 'react';

export type SubmitSkill = 'reading' | 'listening' | 'writing';

export interface ObjectiveSummary {
  kind: 'objective';
  answered: number;
  total: number;
  unanswered: number[];
  flagged: number[];
}

export interface WritingSummary {
  kind: 'writing';
  tasks: {
    task: 1 | 2;
    words: number;
    minWords: number;
    hasText: boolean;
  }[];
  flagged: number[];
}

interface Props {
  skill: SubmitSkill;
  testName: string;
  scopeLabel: string;
  elapsedSec: number;
  fullTransition: boolean;
  summary: ObjectiveSummary | WritingSummary;
  actionLabel?: string;
  onJump: (questionNo: number) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const CHIP_LIMIT = 12;

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function Chips({ nos, tone, onJump }: { nos: number[]; tone: 'warn' | 'flag'; onJump: (n: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!nos.length) return <span className="sr-ok">无</span>;
  const shown = expanded ? nos : nos.slice(0, CHIP_LIMIT);
  return (
    <span className={`sr-chips ${tone}`}>
      {shown.map(n => (
        <button key={n} className="sr-chip" onClick={() => onJump(n)} title={`跳到第 ${n} 题`}>{n}</button>
      ))}
      {!expanded && nos.length > CHIP_LIMIT && (
        <button className="sr-expand" onClick={() => setExpanded(true)}>展开全部（{nos.length}）</button>
      )}
      {expanded && nos.length > CHIP_LIMIT && (
        <button className="sr-expand" onClick={() => setExpanded(false)}>收起</button>
      )}
    </span>
  );
}

export default function SubmitReviewModal(p: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        p.onClose();
      }
      if (e.key === 'Tab') {
        // 简易焦点圈定：只在弹窗内循环
        const root = document.getElementById('submit-review-dialog');
        if (!root) return;
        const items = [...root.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
          .filter(el => !el.hasAttribute('disabled'));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prevFocus.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = p.summary;
  const flagged = s.flagged;
  const unanswered = s.kind === 'objective' ? s.unanswered : [];
  const hasIssue = unanswered.length > 0;
  const confirmLabel = p.actionLabel ?? (p.fullTransition ? '结束本阶段' : '确认交卷');

  return (
    <div className="overlay sr-overlay" onClick={p.onClose}>
      <div
        id="submit-review-dialog"
        className="modal sr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sr-title"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="sr-title">确认交卷？</h2>
        <p className="sr-sub">{p.testName} · {p.scopeLabel} · 用时 {fmt(p.elapsedSec)}</p>

        {s.kind === 'objective' ? (
          <>
            <div className="sr-summary">
              <div className="sr-stat">
                <b>{s.answered}</b><span>/ {s.total} 已答</span>
              </div>
              <div className={`sr-stat${unanswered.length ? ' warn' : ''}`}>
                <b>{unanswered.length}</b><span>未答</span>
              </div>
              <div className={`sr-stat${flagged.length ? ' flag' : ''}`}>
                <b>{flagged.length}</b><span>已标记</span>
              </div>
            </div>
            <div className="sr-line">
              <span className="sr-line-label">未答题号</span>
              <Chips nos={unanswered} tone="warn" onJump={p.onJump} />
            </div>
            <div className="sr-line">
              <span className="sr-line-label">待检查（Flag）</span>
              <Chips nos={flagged} tone="flag" onJump={p.onJump} />
            </div>
            {hasIssue && (
              <p className="sr-hint">还有题没作答。点击题号可以回到那道题继续作答。</p>
            )}
          </>
        ) : (
          <div className="sr-writing">
            {s.tasks.map(t => (
              <div className="sr-task" key={t.task}>
                <b>Task {t.task}</b>
                <span className={!t.hasText ? 'warn-text' : t.words < t.minWords ? 'hint-text' : 'ok-text'}>
                  {!t.hasText
                    ? '未作答'
                    : t.words < t.minWords
                      ? `${t.words} 词（未达到建议 ${t.minWords} 词）`
                      : `${t.words} 词（建议最低 ${t.minWords} 词）`}
                </span>
              </div>
            ))}
            <div className="sr-line">
              <span className="sr-line-label">已标记</span>
              <Chips nos={flagged} tone="flag" onJump={() => setNote('写作没有题号跳转，可在底部导航切换 Task。')} />
            </div>
            {note && <p className="sr-hint">{note}</p>}
            <p className="sr-hint">词数不足只提醒，不会阻止交卷。</p>
          </div>
        )}

        <div className="sr-ops">
          <button className="sr-back" onClick={p.onClose}>返回答题</button>
          <button className="sr-confirm" ref={confirmRef} onClick={p.onConfirm}>{confirmLabel}</button>
        </div>
        <p className="sr-esc">按 Esc 与「返回答题」效果相同</p>
      </div>
    </div>
  );
}
