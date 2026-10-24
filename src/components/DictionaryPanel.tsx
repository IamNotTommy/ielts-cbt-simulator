import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

export interface DictionaryPanelProps {
  open: boolean;
  query: string;
  requestId: number;
  onClose: () => void;
}

interface DictionaryDefinition {
  definition?: string;
  example?: string;
}

interface DictionaryMeaning {
  partOfSpeech?: string;
  definitions?: DictionaryDefinition[];
}

interface DictionaryEntry {
  word?: string;
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: DictionaryMeaning[];
}

type LoadState = 'idle' | 'empty' | 'loading' | 'success' | 'not-found' | 'error';

function phoneticTexts(entry: DictionaryEntry): string[] {
  const texts = [entry.phonetic, ...(entry.phonetics?.map(item => item.text) ?? [])]
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    .map(text => text.trim());
  return [...new Set(texts)];
}

export default function DictionaryPanel({ open, query, requestId, onClose }: DictionaryPanelProps) {
  const [input, setInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);

  const search = useCallback(async (rawQuery: string) => {
    const word = rawQuery.trim();
    abortRef.current?.abort();
    abortRef.current = null;
    const version = ++requestVersion.current;

    setInput(word);
    setActiveQuery(word);
    setEntries([]);
    setErrorMessage('');

    if (!word) {
      setLoadState('empty');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoadState('loading');

    try {
      const response = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        { signal: controller.signal },
      );
      if (version !== requestVersion.current) return;

      if (response.status === 404) {
        setLoadState('not-found');
        return;
      }
      if (!response.ok) {
        setErrorMessage(`词典服务返回错误（HTTP ${response.status}），请稍后重试。`);
        setLoadState('error');
        return;
      }

      const data: unknown = await response.json();
      if (version !== requestVersion.current) return;
      if (!Array.isArray(data)) {
        setErrorMessage('词典服务返回了无法识别的数据，请稍后重试。');
        setLoadState('error');
        return;
      }
      if (data.length === 0) {
        setLoadState('not-found');
        return;
      }

      setEntries(data as DictionaryEntry[]);
      setLoadState('success');
    } catch {
      if (controller.signal.aborted || version !== requestVersion.current) return;
      setErrorMessage('网络查询失败，请检查网络连接或稍后重试。');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    if (requestId <= 0) return;
    void search(query);
  }, [query, requestId, search]);

  useEffect(() => () => {
    requestVersion.current += 1;
    abortRef.current?.abort();
  }, []);

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(input);
  };

  const cambridgeWord = encodeURIComponent(activeQuery);

  return (
    <aside className="iv-dict" id="iv-dictionary" aria-label="词典">
      <div className="iv-dict-head">
        <b className="iv-dict-title">词典</b>
        <button type="button" className="iv-dict-close" aria-label="关闭词典" onClick={onClose}>✕</button>
      </div>

      <form className="iv-dict-search" onSubmit={submit}>
        <input
          className="iv-dict-input"
          type="search"
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="输入英文单词"
          aria-label="输入要查询的英文单词"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="iv-dict-submit">查询</button>
      </form>

      {activeQuery && (
        <div className="iv-dict-links">
          <a
            className="iv-dict-link"
            href={`https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${cambridgeWord}`}
            target="_blank"
            rel="noreferrer"
          >
            Cambridge 英中
          </a>
          <a
            className="iv-dict-link"
            href={`https://dictionary.cambridge.org/dictionary/english/${cambridgeWord}`}
            target="_blank"
            rel="noreferrer"
          >
            Cambridge 英英
          </a>
        </div>
      )}

      <div className="iv-dict-body">
        {loadState === 'idle' && (
          <div className="iv-dict-message">输入英文单词，或在原文中划词后点击“查词”。</div>
        )}
        {loadState === 'empty' && (
          <div className="iv-dict-message">请输入要查询的英文单词。</div>
        )}
        {loadState === 'loading' && (
          <div className="iv-dict-message" role="status">正在查询“{activeQuery}”…</div>
        )}
        {loadState === 'not-found' && (
          <div className="iv-dict-message" role="status">未找到“{activeQuery}”的词条，可尝试 Cambridge 词典。</div>
        )}
        {loadState === 'error' && (
          <div className="iv-dict-message iv-dict-error" role="alert">{errorMessage}</div>
        )}

        {loadState === 'success' && (
          <div className="iv-dict-results">
            {entries.map((entry, entryIndex) => {
              const phonetics = phoneticTexts(entry);
              return (
                <article className="iv-dict-entry" key={`${entry.word ?? activeQuery}-${entryIndex}`}>
                  <div className="iv-dict-entry-head">
                    <h2 className="iv-dict-word">{entry.word || activeQuery}</h2>
                    {phonetics.length > 0 && (
                      <div className="iv-dict-phonetics" aria-label="音标">
                        {phonetics.map(text => <span className="iv-dict-phonetic" key={text}>{text}</span>)}
                      </div>
                    )}
                  </div>

                  {entry.meanings?.map((meaning, meaningIndex) => (
                    <section className="iv-dict-meaning" key={`${meaning.partOfSpeech ?? 'meaning'}-${meaningIndex}`}>
                      <h3 className="iv-dict-pos">{meaning.partOfSpeech || '释义'}</h3>
                      <ol className="iv-dict-definitions">
                        {(meaning.definitions ?? [])
                          .filter(definition => definition.definition?.trim())
                          .map((definition, definitionIndex) => (
                            <li className="iv-dict-definition" key={definitionIndex}>
                              <p className="iv-dict-definition-text" lang="en">{definition.definition}</p>
                              {definition.example?.trim() && (
                                <p className="iv-dict-example" lang="en">例句：{definition.example}</p>
                              )}
                            </li>
                          ))}
                      </ol>
                    </section>
                  ))}
                </article>
              );
            })}
            <small className="iv-dict-source">释义来源：Free Dictionary API</small>
          </div>
        )}
      </div>
    </aside>
  );
}
