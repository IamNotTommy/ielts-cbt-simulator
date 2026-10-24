/** 统一搜索：题库 / 练习记录 / 词汇与批注。键盘可选、点击外部关闭、焦点返回搜索框。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredTest } from '../lib/store';
import type { PracticeRecord } from '../lib/history';
import type { VocabularyItem } from '../lib/vocabulary';
import { MAX_QUERY, countSearch, searchAll, type SearchOutput, type SearchResult } from '../lib/search';

interface Props {
  tests: StoredTest[];
  records: PracticeRecord[];
  vocabulary: VocabularyItem[];
  onPickTest: (testId: string) => void;
  onPickRecord: (recordId: string) => void;
  onPickVocabulary: (key: string) => void;
}

type GroupKey = 'tests' | 'history' | 'vocabulary';

const GROUP_LABEL: Record<GroupKey, string> = {
  tests: '题库',
  history: '练习记录',
  vocabulary: '词汇与批注',
};

const PLACEHOLDER = '搜索题包、练习记录、单词或批注…';

export default function GlobalSearch(p: Props) {
  const [raw, setRaw] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [expandGroup, setExpandGroup] = useState<GroupKey | null>(null);
  const [sel, setSel] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(raw.slice(0, MAX_QUERY)), 250);
    return () => window.clearTimeout(t);
  }, [raw]);

  useEffect(() => { setShowAll(false); setExpandGroup(null); setSel(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const results: SearchOutput = useMemo(() => (query.trim()
    ? searchAll({ query, tests: p.tests, records: p.records, vocabulary: p.vocabulary })
    : { tests: [], history: [], vocabulary: [] }), [query, p.tests, p.records, p.vocabulary]);

  const groups = useMemo(() => ([
    { key: 'tests' as const, items: results.tests },
    { key: 'history' as const, items: results.history },
    { key: 'vocabulary' as const, items: results.vocabulary },
  ]), [results]);

  const visibleGroups = groups
    .filter(g => !expandGroup || g.key === expandGroup)
    .map(g => ({
      ...g,
      shown: showAll || expandGroup === g.key ? g.items : g.items.slice(0, 5),
      hidden: Math.max(0, g.items.length - 5),
    }));
  const flat = visibleGroups.flatMap(g => g.shown);

  const total = countSearch(results);

  const pick = (r: SearchResult) => {
    setOpen(false);
    setShowAll(false);
    if (r.kind === 'test') p.onPickTest(r.testId);
    else if (r.kind === 'history') p.onPickRecord(r.recordId);
    else p.onPickVocabulary(r.vocabularyKey);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setRaw('');
      setQuery('');
      inputRef.current?.focus();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const r = flat[sel];
      if (r) pick(r);
    }
  };

  let flatIdx = -1;
  const showPanel = open && raw.trim().length > 0;

  return (
    <div className="gs-wrap" ref={wrapRef}>
      <input
        ref={inputRef}
        className="gs-input"
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="gs-panel"
        aria-autocomplete="list"
        aria-label="统一搜索"
        placeholder={PLACEHOLDER}
        maxLength={MAX_QUERY}
        value={raw}
        onFocus={() => setOpen(true)}
        onChange={e => { setRaw(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {raw && (
        <button
          className="gs-clear"
          aria-label="清空搜索"
          onClick={() => { setRaw(''); setQuery(''); setOpen(false); inputRef.current?.focus(); }}
        >✕</button>
      )}

      {showPanel && (
        <div className="gs-panel" id="gs-panel" role="listbox" aria-label="搜索结果">
          {total === 0 ? (
            <div className="gs-empty">
              没有找到「{raw.trim()}」。试试书名、Test 编号、日期、单词或批注里的词。
            </div>
          ) : (
            <>
              {visibleGroups.filter(g => g.shown.length > 0).map(g => (
                <div className="gs-group" key={g.key}>
                  <div className="gs-group-head">{GROUP_LABEL[g.key]}（{g.items.length}）</div>
                  {g.shown.map(r => {
                    flatIdx++;
                    const idx = flatIdx;
                    return (
                      <button
                        key={`${r.kind}-${r.id}`}
                        className={`gs-item${idx === sel ? ' on' : ''}`}
                        role="option"
                        aria-selected={idx === sel}
                        onMouseEnter={() => setSel(idx)}
                        onClick={() => pick(r)}
                      >
                        <b>{r.title}</b>
                        <small>{r.subtitle}</small>
                      </button>
                    );
                  })}
                  {!showAll && expandGroup !== g.key && g.hidden > 0 && (
                    <button
                      className="gs-more"
                      onClick={() => { setExpandGroup(g.key); setShowAll(true); setSel(0); }}
                    >
                      查看全部结果（{g.items.length}）→
                    </button>
                  )}
                </div>
              ))}
              <div className="gs-foot">
                <span>
                  {expandGroup ? `仅看「${GROUP_LABEL[expandGroup]}」` : '↑↓ 选择 · Enter 打开 · Esc 关闭'}
                </span>
                {(showAll || expandGroup) && (
                  <button
                    className="gs-more"
                    onClick={() => { setShowAll(false); setExpandGroup(null); setSel(0); }}
                  >
                    {expandGroup ? '显示全部结果组' : '收起'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
