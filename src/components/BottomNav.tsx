import { useEffect, useRef } from 'react';

export interface NavPart {
  label: string;       // "Part 1"
  questions: number[]; // 题号数组
}

interface Props {
  parts: NavPart[];
  current: number | null;
  answered: Record<number, boolean>;
  reviewed: Record<number, boolean>;
  reviewMode: boolean;
  onToggleReviewMode: () => void;
  onJump: (no: number) => void;
  onPrev: () => void;
  onNext: () => void;
  disablePrev: boolean;
  disableNext: boolean;
}

export default function BottomNav(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 当前题自动滚入可见区（规格 2.4）。
  // 只用 scrollLeft 滚题号条自身：scrollIntoView 会连带滚动最近的祖先滚动容器，
  // 在某些布局下会把内容区/页面一起滚走（曾出现"点开始后自己跳到中间"）。
  useEffect(() => {
    const box = scrollRef.current;
    if (p.current == null || !box) return;
    const el = box.querySelector(`[data-q="${p.current}"]`) as HTMLElement | null;
    if (!el) return;
    const target = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [p.current]);

  return (
    <div className="bottomnav">
      <label className="review-toggle">
        <input type="checkbox" checked={p.reviewMode} onChange={p.onToggleReviewMode} />
        ⚑ Review
      </label>
      <div className="nav-scroll" ref={scrollRef}>
        {p.parts.map(part => {
          const done = part.questions.filter(q => p.answered[q]).length;
          return (
            <span key={part.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="part-label">{part.label}:</span>
              {part.questions.map(no => {
                const cls = [
                  'qbox',
                  p.answered[no] ? 'answered' : '',
                  p.current === no ? 'current' : '',
                  p.reviewed[no] ? 'review' : '',
                ].join(' ');
                return (
                  <button key={no} data-q={no} className={cls} onClick={() => p.onJump(no)}>
                    {no}
                  </button>
                );
              })}
              <span className="part-count">{done} of {part.questions.length}</span>
            </span>
          );
        })}
      </div>
      <button className="nav-arrow" onClick={p.onPrev} disabled={p.disablePrev} aria-label="Previous">←</button>
      <button className="nav-arrow" onClick={p.onNext} disabled={p.disableNext} aria-label="Next">→</button>
    </div>
  );
}
