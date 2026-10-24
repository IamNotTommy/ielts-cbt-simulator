import { useEffect, useMemo, useState } from 'react';
import type { ReviewRating } from '../lib/vocabulary';
import { ratingLabel } from '../lib/vocabulary';

export interface FlashcardEntry {
  id: string;
  kind: 'word' | 'sentence';
  text: string;
  note?: string;
  phonetic?: string;
  gloss?: string;
  sentence?: string;
  context?: string;
  source?: string;
}

interface Props<T extends FlashcardEntry> {
  entries: T[];
  limit?: number;
  className?: string;
  emptyText?: string;
  onMore?: () => void;
  onDetail?: (entry: T) => void;
  /** 复习模式：显示三档评分，隐藏普通上一张/下一张（父组件控制队列） */
  onRate?: (entry: T, rating: ReviewRating) => void;
  reviewMode?: boolean;
  /** 覆盖右上角计数短标签（例如“本次 3/18”） */
  label?: string;
  onSpaceFlip?: boolean;
}

export default function FlashcardDeck<T extends FlashcardEntry>({
  entries,
  limit,
  className = '',
  emptyText = '还没有可以复习的卡片。',
  onMore,
  onDetail,
  onRate,
  reviewMode,
  label,
  onSpaceFlip = true,
}: Props<T>) {
  const list = useMemo(() => entries.slice(0, limit ?? entries.length), [entries, limit]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const safeIdx = list.length ? Math.min(idx, list.length - 1) : 0;
  const cur = list[safeIdx] ?? null;

  useEffect(() => { setFlipped(false); }, [cur?.id]);

  const go = (next: number) => {
    setIdx(next);
    setFlipped(false);
  };

  /* 键盘：空格翻面（卡片本身是 button，天然支持），左右切卡（仅普通模式） */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (onRate && e.key === ' ') {
      e.preventDefault();
      setFlipped(v => !v);
      return;
    }
    if (!onRate && e.key === 'ArrowLeft') { e.preventDefault(); go(Math.max(0, safeIdx - 1)); }
    if (!onRate && e.key === 'ArrowRight') { e.preventDefault(); go(Math.min(list.length - 1, safeIdx + 1)); }
  };

  return (
    <div className={`fc-deck ${className}${reviewMode ? ' fc-review' : ''}`} onKeyDown={onSpaceFlip ? onKeyDown : undefined}>
      <div className="fc-toolbar">
        <span className="fc-count">
          {label ?? (cur ? `${safeIdx + 1} / ${list.length}` : '0 / 0')}
          {!label && limit != null && entries.length > list.length ? ` · 共 ${entries.length} 个` : ''}
        </span>
        {onMore && <button type="button" className="fc-more" onClick={onMore}>更多</button>}
      </div>

      {cur ? (
        <>
          <div className="fc-stage">
            {!onRate && (
              <button
                type="button"
                className="fc-nav"
                disabled={safeIdx <= 0}
                onClick={() => go(safeIdx - 1)}
                aria-label="上一张卡片"
              >
                ←
              </button>
            )}
            <button
              type="button"
              className={`fc-card ${cur.kind}${flipped ? ' flipped' : ''}`}
              onClick={() => setFlipped(v => !v)}
              aria-pressed={flipped}
              aria-label={`${cur.text}，${flipped ? '显示正面' : '翻面查看释义'}`}
            >
              <span className="fc-card-inner">
                <span className="fc-face fc-front" aria-hidden={flipped}>
                  <span className={`iv-chip ${cur.kind}`}>{cur.kind === 'word' ? '单词' : '句子'}</span>
                  <span className="fc-word">{cur.text}</span>
                  {cur.source && <span className="fc-source">{cur.source}</span>}
                  <span className="fc-hint">点击或按空格翻面</span>
                </span>
                <span className="fc-face fc-back" aria-hidden={!flipped}>
                  <b className="fc-back-word">{cur.text}</b>
                  {(cur.phonetic || cur.gloss) && (
                    <span className="fc-lex">{[cur.phonetic, cur.gloss].filter(Boolean).join(' · ')}</span>
                  )}
                  {cur.note && <span className="fc-note">{cur.note}</span>}
                  {(cur.sentence || cur.context) && (
                    <span className="fc-sentence">{cur.sentence || cur.context}</span>
                  )}
                  {!cur.phonetic && !cur.gloss && !cur.note && !cur.sentence && !cur.context && (
                    <span className="fc-empty-back">还没有释义或批注，可在词条详情里跳回原文查看。</span>
                  )}
                  <span className="fc-hint">点击回到正面</span>
                </span>
              </span>
            </button>
            {!onRate && (
              <button
                type="button"
                className="fc-nav"
                disabled={safeIdx >= list.length - 1}
                onClick={() => go(safeIdx + 1)}
                aria-label="下一张卡片"
              >
                →
              </button>
            )}
          </div>

          {onRate && flipped && (
            <div className="fc-rates" role="group" aria-label="反馈：这张卡片记得怎么样">
              {(['again', 'hard', 'good'] as ReviewRating[]).map(r => (
                <button
                  key={r}
                  type="button"
                  className={`fc-rate ${r}`}
                  onClick={() => { setFlipped(false); onRate(cur, r); }}
                >
                  {ratingLabel(r)}
                </button>
              ))}
            </div>
          )}
          {onRate && !flipped && (
            <p className="fc-rate-hint">翻面后才显示评分按钮</p>
          )}

          {onDetail && (
            <div className="fc-detail-row">
              <button type="button" className="fc-detail" onClick={() => onDetail(cur)}>查看词条详情</button>
            </div>
          )}
        </>
      ) : (
        <div className="fc-empty">{emptyText}</div>
      )}
    </div>
  );
}
