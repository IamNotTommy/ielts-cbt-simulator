/** 词汇中心：今日复习（SRS）/ 自由翻卡 / 全部词句。
 *  同词合并精读与精听来源；句子只浏览，不进入间隔复习。 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StoredTest } from '../lib/store';
import { syncWordbookFromServer } from '../lib/intensive';
import { syncLWordsFromServer } from '../lib/listenLab';
import type { ReviewRating, VocabularyItem } from '../lib/vocabulary';
import {
  applyRating, buildReviewQueue, buildVocabularyItems, dueLabel, progressMap, queueCounts, ratingLabel,
} from '../lib/vocabulary';
import type { LearningData } from '../lib/learningStore';
import { loadLearningData, updateLearningData } from '../lib/learningStore';
import FlashcardDeck from './FlashcardDeck';

interface Props {
  tests: StoredTest[];
  initialTab?: 'today' | 'free' | 'all';
  initialEntryKey?: string;
  onClose: () => void;
  onJumpReading: (t: StoredTest, passageIdx: number, noteId: string) => void;
  onJumpListening: (t: StoredTest, sectionIdx: number) => void;
  onChanged?: () => void;
}

type Tab = 'today' | 'free' | 'all';
type Filter = 'all' | 'word' | 'sentence' | 'reading' | 'listening';

const sourceText = (it: VocabularyItem) => [
  it.reading ? `精读：${it.reading.testName} · Passage ${it.reading.passageIdx + 1}` : '',
  it.listening ? `精听：${it.listening.testName} · Section ${it.listening.section}` : '',
].filter(Boolean).join('；');

const DAY = 86400000;

export default function VocabularyCenter(p: Props) {
  const [items, setItems] = useState<VocabularyItem[] | null>(null);
  const [data, setData] = useState<LearningData>(loadLearningData);
  const [tab, setTab] = useState<Tab>(p.initialTab ?? 'today');
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<VocabularyItem | null>(null);
  const [missingEntry, setMissingEntry] = useState(false);
  const [session, setSession] = useState<{
    queue: VocabularyItem[];
    idx: number;
    seen: Record<string, number>;
    done: { again: number; hard: number; good: number };
  } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [wb, lw] = await Promise.all([syncWordbookFromServer(), syncLWordsFromServer()]);
      if (!alive) return;
      const built = buildVocabularyItems(wb, lw);
      setItems(built);
      if (p.initialEntryKey) {
        const hit = built.find(x => x.key === p.initialEntryKey);
        if (hit) setDetail(hit);
        else setMissingEntry(true);
      }
    })();
    return () => { alive = false; };
  }, [p.initialEntryKey]);

  const persist = useCallback((mutator: (d: LearningData) => void) => {
    const next = updateLearningData(mutator);
    setData(next);
    p.onChanged?.();
  }, [p]);

  const pmap = useMemo(() => progressMap(data.vocabularyProgress), [data.vocabularyProgress]);
  const counts = useMemo(() => (items ? queueCounts(items, pmap, now) : null), [items, pmap, now]);

  const startReview = () => {
    if (!items) return;
    const t = Date.now();
    setNow(t);
    const queue = buildReviewQueue(items, pmap, t);
    setSession({ queue, idx: 0, seen: {}, done: { again: 0, hard: 0, good: 0 } });
  };

  const rate = (item: VocabularyItem, rating: ReviewRating) => {
    if (!session) return;
    const t = Date.now();
    const prev = pmap.get(item.key);
    const next = applyRating(item, prev, rating, t);
    persist(d => {
      const i = d.vocabularyProgress.findIndex(x => x.key === item.key);
      if (i >= 0) d.vocabularyProgress[i] = next;
      else d.vocabularyProgress.push(next);
    });
    const seen = session.seen[item.key] ?? 0;
    // 同一张卡本次会话最多出现 3 次：第 3 次评分后不再重新排队
    const canRequeue = rating === 'again' && seen < 2;
    const rest = [...session.queue.slice(0, session.idx), ...session.queue.slice(session.idx + 1)];
    if (canRequeue) rest.splice(Math.min(rest.length, session.idx + 2), 0, item);
    setSession({
      queue: rest,
      idx: session.idx,
      seen: { ...session.seen, [item.key]: seen + 1 },
      done: { ...session.done, [rating]: session.done[rating] + 1 },
    });
    setNow(t);
  };

  const freeItems = useMemo(() => {
    if (!items) return [];
    const kind = filter === 'word' || filter === 'sentence' ? filter : null;
    return items
      .filter(it => !kind || it.kind === kind)
      .map(it => ({
        id: it.key,
        kind: it.kind,
        text: it.text,
        note: it.note,
        phonetic: it.phonetic,
        gloss: it.gloss,
        sentence: it.sentence,
        context: it.context,
        source: sourceText(it),
      }));
  }, [items, filter]);

  const allItems = useMemo(() => {
    if (!items) return [];
    return items.filter(it => {
      if (filter === 'all') return true;
      if (filter === 'word' || filter === 'sentence') return it.kind === filter;
      if (filter === 'reading') return !!it.reading;
      return !!it.listening;
    });
  }, [items, filter]);

  const findTest = (testId: string) => p.tests.find(t => t.id === testId);
  const jumpReading = (it: VocabularyItem) => {
    if (!it.reading) return;
    const t = findTest(it.reading.testId);
    if (t) p.onJumpReading(t, it.reading.passageIdx, it.reading.noteId);
  };
  const jumpListening = (it: VocabularyItem) => {
    if (!it.listening) return;
    const t = findTest(it.listening.testId);
    const si = t?.listening?.sections.findIndex(s => s.section_number === it.listening!.section) ?? -1;
    if (t && si >= 0) p.onJumpListening(t, si);
  };

  const toggleSuspend = (it: VocabularyItem) => {
    persist(d => {
      const i = d.vocabularyProgress.findIndex(x => x.key === it.key);
      if (i >= 0) {
        d.vocabularyProgress[i] = { ...d.vocabularyProgress[i], suspended: !d.vocabularyProgress[i].suspended };
      } else {
        d.vocabularyProgress.push({
          key: it.key, text: it.text, reps: 0, intervalDays: 0, dueAt: Date.now(),
          lapses: 0, suspended: true,
        });
      }
    });
  };

  const wrapClass = 'vc-wrap';

  return (
    <div className={wrapClass}>
      <header className="iv-top">
        <button className="iv-back" onClick={p.onClose}>← 返回</button>
        <div className="iv-title">
          <b>词汇复习</b>
          <span>{items ? `${items.filter(i => i.kind === 'word').length} 个单词 · ${items.filter(i => i.kind === 'sentence').length} 个句子` : '载入中…'}</span>
        </div>
        <div className="iv-wb-tabs" role="tablist" aria-label="词汇中心页签">
          <button role="tab" aria-selected={tab === 'today'} className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>今日复习</button>
          <button role="tab" aria-selected={tab === 'free'} className={tab === 'free' ? 'on' : ''} onClick={() => { setTab('free'); setSession(null); }}>自由翻卡</button>
          <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => { setTab('all'); setSession(null); }}>全部词句</button>
        </div>
      </header>

      {missingEntry && (
        <p className="vc-missing" role="status">该词条已移除（可能来自已删除的精读/精听记录）。</p>
      )}

      {items === null ? (
        <div className="iv-wb-empty">载入词汇…</div>
      ) : tab === 'today' ? (
        session ? (
          session.queue.length === 0 || session.idx >= session.queue.length ? (
            <div className="vc-done">
              <h3>本轮完成</h3>
              <div className="vc-done-stats">
                <div><b>{session.done.again}</b><span>不认识</span></div>
                <div><b>{session.done.hard}</b><span>模糊</span></div>
                <div><b>{session.done.good}</b><span>认识</span></div>
              </div>
              <p>
                {(() => {
                  const t = Date.now();
                  const within1 = data.vocabularyProgress.filter(x => !x.suspended && x.dueAt > t && x.dueAt <= t + DAY).length;
                  const within2 = data.vocabularyProgress.filter(x => !x.suspended && x.dueAt > t + DAY && x.dueAt <= t + 2 * DAY).length;
                  return `明天到期 ${within1} 个，两天内再到期 ${within2} 个。`;
                })()}
              </p>
              <button className="as-primary" onClick={() => { setSession(null); setNow(Date.now()); }}>回到今日复习</button>
            </div>
          ) : (() => {
            const cur = session.queue[session.idx];
            return (
              <div className="vc-session">
                <div className="vc-session-head">
                  <span>本次 {session.idx + 1}/{session.queue.length}</span>
                  <span>不认识 {session.done.again} · 模糊 {session.done.hard} · 认识 {session.done.good}</span>
                  <button className="link-btn" onClick={() => setSession(null)}>结束本轮</button>
                </div>
                <FlashcardDeck
                  entries={[{
                    id: cur.key,
                    kind: cur.kind,
                    text: cur.text,
                    note: cur.note,
                    phonetic: cur.phonetic,
                    gloss: cur.gloss,
                    sentence: cur.sentence,
                    context: cur.context,
                    source: sourceText(cur),
                  }]}
                  className="fc-full"
                  reviewMode
                  label={`本次 ${session.idx + 1} / ${session.queue.length}`}
                  onRate={(_e, r) => rate(cur, r)}
                />
              </div>
            );
          })()
        ) : (
          <div className="vc-today">
            <div className="vc-stats">
              <div><b>{counts?.due ?? 0}</b><span>今日到期</span></div>
              <div><b>{Math.min(counts?.fresh ?? 0, 10)}</b><span>新词（最多 10）</span></div>
              <div><b>{data.vocabularyProgress.filter(x => x.suspended).length}</b><span>已暂停</span></div>
            </div>
            {(counts?.queueLength ?? 0) === 0 ? (
              <div className="iv-wb-empty">
                今天没有到期的单词。可以去「全部词句」查看下次到期时间，或先做一套题积累词汇。
              </div>
            ) : (
              <>
                <button className="as-primary" onClick={startReview}>
                  开始复习（{counts?.queueLength} 张）
                </button>
                {(counts?.overflow ?? 0) > 0 && (
                  <p className="vc-hint">今日还有 {counts!.overflow} 个，完成本轮后可继续。</p>
                )}
                <p className="vc-hint">间隔：3 → 7 → 14 → 30 → 60 → 120 → 180 天；「不认识」会在本轮稍后重现，最多 3 次。</p>
              </>
            )}
          </div>
        )
      ) : tab === 'free' ? (
        <div className="vc-free">
          <div className="iv-wb-filter" role="group" aria-label="翻卡筛选">
            {(['all', 'word', 'sentence'] as const).map(f => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? '全部' : f === 'word' ? '单词' : '句子'}
              </button>
            ))}
          </div>
          <FlashcardDeck
            entries={freeItems}
            className="fc-full"
            onDetail={e => setDetail(items.find(i => i.key === e.id) ?? null)}
            emptyText="还没有词条。精读划词或精听加入生词后，这里就会出现。"
          />
          <p className="affil-note">自由翻卡只浏览，不会改变复习进度和到期时间。</p>
        </div>
      ) : (
        <div className="vc-all">
          <div className="iv-wb-filter" role="group" aria-label="词条筛选">
            {(['all', 'word', 'sentence', 'reading', 'listening'] as const).map(f => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? '全部' : f === 'word' ? '单词' : f === 'sentence' ? '句子' : f === 'reading' ? '精读来源' : '精听来源'}
              </button>
            ))}
          </div>
          {allItems.length === 0 ? (
            <div className="iv-wb-empty">没有符合条件的词条。</div>
          ) : (
            <div className="iv-wb-list">
              {allItems.map(it => {
                const pr = pmap.get(it.key);
                return (
                  <div className="vc-row" key={it.key}>
                    <button className="vc-row-main" onClick={() => setDetail(it)}>
                      <span className={`iv-chip ${it.kind}`}>{it.kind === 'word' ? '单词' : '句子'}</span>
                      <span className="iv-wb-row-text">{it.text}</span>
                      <small>{sourceText(it) || '来源未知'}</small>
                    </button>
                    <div className="vc-row-side">
                      {it.kind === 'word' && (
                        <>
                          <span className="vc-due">{dueLabel(pr, now)}</span>
                          {pr?.lastRating && <span className="vc-last">上次：{ratingLabel(pr.lastRating)}</span>}
                          <button className="link-btn" onClick={() => toggleSuspend(it)}>
                            {pr?.suspended ? '恢复复习' : '暂停复习'}
                          </button>
                        </>
                      )}
                      {it.reading && (
                        <button className="link-btn" onClick={() => jumpReading(it)}>精读原文</button>
                      )}
                      {it.listening && (
                        <button className="link-btn" onClick={() => jumpListening(it)}>精听篇目</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {detail && (
        <div className="iv-wb-detail-bg" onClick={() => setDetail(null)}>
          <div
            className={`iv-wb-detail ${detail.kind}`}
            role="dialog"
            aria-modal="true"
            aria-label={`${detail.text} 词条详情`}
            onClick={e => e.stopPropagation()}
          >
            <div className="iv-wb-detail-head">
              <span className={`iv-chip ${detail.kind}`}>{detail.kind === 'word' ? '单词' : '句子'}</span>
              <b className="iv-wb-detail-text">{detail.text}</b>
              <button className="iv-x" aria-label="关闭词条详情" onClick={() => setDetail(null)}>✕</button>
            </div>
            {(detail.phonetic || detail.gloss) && (
              <p className="iv-wb-lex">{[detail.phonetic, detail.gloss].filter(Boolean).join(' · ')}</p>
            )}
            {detail.note && <div className="iv-wb-note">{detail.note}</div>}
            {detail.sentence && <p className="iv-wb-sent">{detail.sentence}</p>}
            {detail.context && <p className="iv-wb-ctx">{detail.context}</p>}
            <div className="iv-wb-src">出处：{sourceText(detail) || '未知'}</div>
            {detail.kind === 'word' && (
              <div className="iv-wb-src">
                {(() => {
                  const pr = pmap.get(detail.key);
                  return pr
                    ? `${dueLabel(pr, now)} · 复习 ${pr.reps} 次 · 遗忘 ${pr.lapses} 次${pr.suspended ? ' · 已暂停' : ''}`
                    : '新词，还没有复习记录';
                })()}
              </div>
            )}
            <div className="iv-wb-detail-ops">
              {detail.reading && (
                <button className="iv-btn" onClick={() => { jumpReading(detail); setDetail(null); }}>跳回精读原文</button>
              )}
              {detail.listening && (
                <button className="iv-btn" onClick={() => { jumpListening(detail); setDetail(null); }}>跳回精听篇目</button>
              )}
              <button className="iv-btn plain" onClick={() => setDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <p className="affil-note">
        同词来自精读与精听时只生成一个复习单位，两个来源都可以跳转。
      </p>
    </div>
  );
}
