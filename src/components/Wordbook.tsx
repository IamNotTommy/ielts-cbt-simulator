/** 精读词汇句子册：全屏弹层，翻卡复习 / 整体罗列（可按类型过滤）两种浏览方式；
 *  卡片可翻面看释义与例句，词条详情可跳回原文（进入该篇精读并定位闪烁）。 */
import { useEffect, useMemo, useState } from 'react';
import type { StoredTest } from '../lib/store';
import { syncWordbookFromServer, type WordbookEntry } from '../lib/intensive';
import FlashcardDeck from './FlashcardDeck';

export interface WordbookDetailData {
  kind: 'word' | 'sentence';
  text: string;
  note?: string;
  phonetic?: string;
  gloss?: string;
  sentence?: string;
  context?: string;
}

interface WordbookDetailProps {
  entry: WordbookDetailData;
  source: string;
  onClose: () => void;
  onJump: (() => void) | null;
}

/** 首页「最近」与词汇册共用同一套词条详情，避免两处样式与交互分叉。 */
export function WordbookDetail({ entry, source, onClose, onJump }: WordbookDetailProps) {
  return (
    <div className="iv-wb-detail-bg" onClick={onClose}>
      <div
        className={`iv-wb-detail ${entry.kind}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.text} 词条详情`}
        onClick={e => e.stopPropagation()}
      >
        <div className="iv-wb-detail-head">
          <span className={`iv-chip ${entry.kind}`}>{entry.kind === 'word' ? '单词' : '句子'}</span>
          <b className="iv-wb-detail-text">{entry.text}</b>
          <button className="iv-x" aria-label="关闭词条详情" onClick={onClose}>✕</button>
        </div>
        {(entry.phonetic || entry.gloss) && (
          <p className="iv-wb-lex">{[entry.phonetic, entry.gloss].filter(Boolean).join(' · ')}</p>
        )}
        {entry.note && <div className="iv-wb-note">{entry.note}</div>}
        {entry.sentence && <p className="iv-wb-sent">{entry.sentence}</p>}
        {entry.context && <p className="iv-wb-ctx">{entry.context}</p>}
        <div className="iv-wb-src">出处：{source}</div>
        <div className="iv-wb-detail-ops">
          <button
            className="iv-btn"
            disabled={!onJump}
            title={onJump ? '' : '题包已被删除，重新导入后可跳转'}
            onClick={onJump ?? undefined}
          >
            跳转到原文
          </button>
          <button className="iv-btn plain" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  tests: StoredTest[];   // 题库（含 demo），用于「跳转到原文」；找不到说明题包已删
  initialMode?: 'card' | 'list';
  onClose: () => void;
  onJump: (t: StoredTest, passageIdx: number, noteId: string) => void;
}

export default function Wordbook({ tests, initialMode = 'card', onClose, onJump }: Props) {
  const [entries, setEntries] = useState<WordbookEntry[] | null>(null);
  const [mode, setMode] = useState<'card' | 'list'>(initialMode);
  const [filter, setFilter] = useState<'all' | 'word' | 'sentence'>('all');
  const [detail, setDetail] = useState<WordbookEntry | null>(null);

  useEffect(() => { void syncWordbookFromServer().then(setEntries); }, []);

  const list = useMemo(
    () => (entries ?? [])
      .filter(e => filter === 'all' || e.kind === filter)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [entries, filter],
  );

  const detailTest = detail ? tests.find(t => t.id === detail.testId) : null;
  const detailOk = !!(detail && detailTest && detailTest.passages[detail.passageIdx]);

  return (
    <div className="iv-wb">
      <header className="iv-top">
        <button className="iv-back" onClick={onClose}>← 返回</button>
        <div className="iv-title">
          <b>精读词汇句子册</b>
          <span>{list.length} 条{filter !== 'all' ? `（已过滤）` : ''}</span>
        </div>
        <div className="iv-wb-tabs">
          <button className={mode === 'card' ? 'on' : ''} onClick={() => setMode('card')}>翻卡复习</button>
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>整体罗列</button>
        </div>
        <div className="iv-wb-filter">
          {(['all', 'word', 'sentence'] as const).map(f => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? '全部' : f === 'word' ? '单词' : '句子'}
            </button>
          ))}
        </div>
      </header>

      {entries === null ? (
        <div className="iv-wb-empty">载入中…</div>
      ) : list.length === 0 ? (
        <div className="iv-wb-empty">
          这里还是空的。做完一套阅读后在成绩单点「精读」，划过划重点的单词和句子会自动收进这本册子。
        </div>
      ) : mode === 'card' ? (
        <FlashcardDeck
          entries={list.map(e => ({ ...e, source: `${e.testName} · Passage ${e.passageIdx + 1}` }))}
          className="fc-full"
          onDetail={setDetail}
        />
      ) : (
        <div className="iv-wb-list">
          {list.map(e => (
            <button className="iv-wb-row" key={e.id} onClick={() => setDetail(e)}>
              <span className={`iv-chip ${e.kind}`}>{e.kind === 'word' ? '单词' : '句子'}</span>
              <span className="iv-wb-row-text">{e.text}</span>
              <small>{e.testName} · P{e.passageIdx + 1}{e.hits > 1 ? ` · 出现 ${e.hits} 次` : ''}</small>
            </button>
          ))}
        </div>
      )}

      {detail && (
        <WordbookDetail
          entry={detail}
          source={`${detail.testName} · Passage ${detail.passageIdx + 1}`}
          onClose={() => setDetail(null)}
          onJump={detailOk ? () => onJump(detailTest!, detail.passageIdx, detail.noteId) : null}
        />
      )}
    </div>
  );
}
