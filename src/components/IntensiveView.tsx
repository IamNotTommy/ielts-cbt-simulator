/** 精读界面：批注边栏 | 文章+题目 | 批注边栏。
 *  划词（单词=蓝 / 句子=琥珀）→ 高亮 + 靠近锚点一侧的批注框，批注数据走 intensive.ts
 *  （localStorage 缓存 + 启动器文件夹镜像）。从首页精读记录进入时批注默认折叠。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { StoredTest } from '../lib/store';
import { tk } from '../lib/store';
import { gradeReading } from '../lib/scoring';
import {
  expandSentence,
  expandWord,
  ivKey,
  loadIntensive,
  saveIntensive,
  sentenceAround,
  type IntensiveFile,
  type IntensiveKind,
  type IntensiveNote,
} from '../lib/intensive';
import DictionaryPanel from './DictionaryPanel';

interface Props {
  test: StoredTest;
  passageIdx: number;
  fromRecords: boolean;    // true = 从首页精读记录进入：批注默认折叠成小色点
  focusNoteId?: string;    // 词汇册「跳转到原文」：展开该批注、滚动定位并闪烁
  onClose: () => void;
}

/** 选区落在某个 .iv-ptext 内时的锚点信息（工具条位置 + 段内偏移） */
interface Sel {
  para: number;
  start: number;
  end: number;
  x: number;   // 相对 iv-body 的坐标（选区右下角）
  y: number;
  absX: number; // 视口坐标，用于判断左右边栏
}

const KIND_LABEL: Record<IntensiveKind, string> = { word: '单词', sentence: '句子' };

/** textarea 随内容自适应高度（批注框大小随文字内容自适应） */
function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

export default function IntensiveView({ test, passageIdx, fromRecords, focusNoteId, onClose }: Props) {
  const passage = test.passages[passageIdx];
  const [file, setFile] = useState<IntensiveFile | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [toolbar, setToolbar] = useState<Sel | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);   // 新建批注自动聚焦输入
  const [flashId, setFlashId] = useState<string | null>(null);
  const [showNoteList, setShowNoteList] = useState(false);
  const [showDictionary, setShowDictionary] = useState(false);
  const [dictQuery, setDictQuery] = useState('');
  const [dictRequestId, setDictRequestId] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const [tops, setTops] = useState<Record<string, number>>({});

  const bodyRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sideLRef = useRef<HTMLElement>(null);
  const sideRRef = useRef<HTMLElement>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const saveTimer = useRef(0);

  /* ---- 载入精读文件（服务器优先），记录入口进入时全部折叠 ---- */
  useEffect(() => {
    let alive = true;
    loadIntensive(ivKey(test.id, passageIdx)).then(f => {
      if (!alive) return;
      const cur: IntensiveFile = f ?? {
        testId: test.id,
        testName: test.name,
        passageIdx,
        passageTitle: passage?.title ?? '',
        updatedAt: Date.now(),
        notes: [],
      };
      // 题包可能重新导入过：名称/标题以当前题包为准
      cur.testName = test.name;
      cur.passageTitle = passage?.title ?? '';
      setFile(cur);
      if (fromRecords) {
        const c: Record<string, boolean> = {};
        cur.notes.forEach(n => { c[n.id] = true; });
        setCollapsed(c);
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.id, passageIdx]);

  /** 改批注（本地 state 立即生效；500ms 防抖后落盘 + 镜像 + 联动词汇册） */
  const commit = (notes: IntensiveNote[]) => {
    setFile(f => {
      if (!f) return f;
      const next = { ...f, notes, updatedAt: Date.now() };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveIntensive(next), 500);
      return next;
    });
  };

  /** 平滑定位到主滚动区上 1/3；文首/文末空间不足时由滚动边界自然钳到头/底 */
  const jumpToNote = (id: string) => {
    const main = mainRef.current;
    const el = main?.querySelector<HTMLElement>(`[data-nid="${id}"]`);
    if (!main || !el) return;
    const mainRect = main.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const desired = main.scrollTop + elRect.top - mainRect.top - main.clientHeight / 3;
    const max = Math.max(0, main.scrollHeight - main.clientHeight);
    const top = Math.min(max, Math.max(0, desired));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    main.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
  };

  /* ---- 词汇册「跳转到原文」：展开目标批注 → 滚动到锚点 → 闪烁 ---- */
  useEffect(() => {
    if (!file || !focusNoteId) return;
    setCollapsed(c => ({ ...c, [focusNoteId]: false }));
    setFlashId(focusNoteId);
    const t1 = window.setTimeout(() => jumpToNote(focusNoteId), 80);
    const t2 = window.setTimeout(() => setFlashId(null), 2200);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!file]);

  /* ---- 滚动/缩放 → 重算批注框位置与连线（rAF 合帧） ---- */
  useEffect(() => {
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLayoutTick(t => t + 1));
    };
    const main = mainRef.current;
    main?.addEventListener('scroll', bump, { passive: true });
    window.addEventListener('resize', bump);
    return () => {
      cancelAnimationFrame(raf);
      main?.removeEventListener('scroll', bump);
      window.removeEventListener('resize', bump);
    };
  }, [!!file]);

  /* ---- 批注框纵向位置（跟随锚点，边栏内堆叠避让） ---- */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const main = mainRef.current;
    if (!body || !main || !file) return;
    const newTops: Record<string, number> = {};
    for (const side of ['left', 'right'] as const) {
      const sideEl = side === 'left' ? sideLRef.current : sideRRef.current;
      if (!sideEl) continue;
      const sideRect = sideEl.getBoundingClientRect();
      const items = file.notes
        .filter(n => n.side === side)
        .map(n => {
          const r = main.querySelector(`[data-nid="${n.id}"]`)?.getBoundingClientRect();
          const h = collapsed[n.id] ? 14 : (cardEls.current.get(n.id)?.offsetHeight ?? 96);
          return { n, r, h, desired: r ? r.top - sideRect.top : 0 };
        })
        .filter((x): x is { n: IntensiveNote; r: DOMRect; h: number; desired: number } => !!x.r)
        .sort((a, b) => a.desired - b.desired);
      let cursor = 0;
      for (const it of items) {
        const clamped = Math.min(Math.max(it.desired, 0), Math.max(0, sideRect.height - it.h));
        const top = Math.max(clamped, cursor);   // 空间不够就往下紧凑堆叠
        newTops[it.n.id] = top;
        cursor = top + it.h + 10;
      }
    }
    setTops(newTops);
  }, [file, collapsed, layoutTick]);

  /* ---- 划词：先把选区两端吸附到完整单词，再显示浮动工具条 ---- */
  const readSelection = (): Sel | null => {
    const main = mainRef.current;
    const body = bodyRef.current;
    const sel = window.getSelection();
    if (!main || !body || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    for (const el of Array.from(main.querySelectorAll<HTMLElement>('.iv-ptext'))) {
      if (!range.intersectsNode(el)) continue;
      const text = el.textContent ?? '';
      const len = text.length;
      let start = 0;
      let end = len;
      if (el.contains(range.startContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.startContainer, range.startOffset);
        start = pre.toString().length;
      }
      if (el.contains(range.endContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.endContainer, range.endOffset);
        end = pre.toString().length;
      }
      start = Math.max(0, Math.min(start, len));
      end = Math.max(0, Math.min(end, len));
      if (end <= start) continue;

      // expandWord 只扩展选区两端，中间可跨多个单词；高亮造成的多个文本节点也能按原文偏移还原。
      const whole = expandWord(text, start, end);
      if (whole.end <= whole.start) continue;
      const selected = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let startSet = false;
      let endSet = false;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const nodeLen = node.textContent?.length ?? 0;
        if (!startSet && whole.start <= offset + nodeLen) {
          selected.setStart(node, Math.max(0, whole.start - offset));
          startSet = true;
        }
        if (startSet && whole.end <= offset + nodeLen) {
          selected.setEnd(node, Math.max(0, whole.end - offset));
          endSet = true;
          break;
        }
        offset += nodeLen;
      }
      if (!startSet || !endSet) continue;
      sel.removeAllRanges();
      sel.addRange(selected);

      const r = selected.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      return {
        para: Number(el.dataset.para ?? 0),
        start: whole.start,
        end: whole.end,
        x: Math.min(r.right - b.left, b.width - 130),
        y: r.bottom - b.top + 8,
        absX: (r.left + r.right) / 2,
      };
    }
    return null;
  };

  const onArticleMouseUp = () => {
    setToolbar(readSelection());
  };

  /** 选「单词」/「句子」→ 边界收敛 → 建批注（锚点在中线左 → 左边栏，右 → 右边栏） */
  const createNote = (kind: IntensiveKind) => {
    const s = toolbar;
    const main = mainRef.current;
    if (!s || !file || !main || !passage) return;
    const text = passage.paragraphs[s.para]?.text ?? '';
    const range = kind === 'word' ? expandWord(text, s.start, s.end) : expandSentence(text, s.start, s.end);
    if (range.end <= range.start) { setToolbar(null); return; }
    const mr = main.getBoundingClientRect();
    const note: IntensiveNote = {
      id: `in${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind,
      para: s.para,
      start: range.start,
      end: range.end,
      text: text.slice(range.start, range.end),
      ...sentenceAround(text, range.start, range.end),
      note: '',
      side: s.absX < mr.left + mr.width / 2 ? 'left' : 'right',
      createdAt: Date.now(),
    };
    commit([...file.notes, note]);
    setEditingId(note.id);
    setToolbar(null);
    window.getSelection()?.removeAllRanges();
  };

  const lookupWord = () => {
    const s = toolbar;
    if (!s || !passage) return;
    const text = passage.paragraphs[s.para]?.text ?? '';
    const range = expandWord(text, s.start, s.end);
    const word = range.end > range.start ? text.slice(range.start, range.end).trim() : '';
    if (word) {
      setDictQuery(word);
      setDictRequestId(id => id + 1);
      setShowNoteList(false);
      setShowDictionary(true);
    }
    setToolbar(null);
    window.getSelection()?.removeAllRanges();
  };

  const toggle = (id: string, toCollapsed: boolean) =>
    setCollapsed(c => ({ ...c, [id]: toCollapsed }));

  /* ---- 文章渲染：批注 → 彩色高亮段 ---- */
  const renderPara = (text: string, paraIdx: number): ReactNode => {
    const ns = (file?.notes ?? [])
      .filter(n => n.para === paraIdx)
      .sort((a, b) => a.start - b.start);
    if (!ns.length) return text;
    const out: ReactNode[] = [];
    let pos = 0;
    for (const n of ns) {
      if (n.start > pos) out.push(text.slice(pos, n.start));
      if (n.end > pos) {
        out.push(
          <span
            key={n.id}
            data-nid={n.id}
            className={`iv-hl ${n.kind}${flashId === n.id ? ' flash' : ''}`}
            title="点击展开/收起批注"
            onClick={() => toggle(n.id, !collapsed[n.id])}
          >
            {text.slice(Math.max(pos, n.start), n.end)}
          </span>,
        );
      }
      pos = Math.max(pos, n.end);
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  };

  /* ---- 题目区：只读 + 标准答案；localStorage 里有本场作答则标对错 ---- */
  const savedAnswers = (() => {
    try { return JSON.parse(localStorage.getItem(tk(test.id, 'answers')) ?? '{}') as Record<number, unknown>; }
    catch { return {}; }
  })();
  const hasUserAnswers = Object.values(savedAnswers)
    .some(v => v != null && String(v).trim() !== '' && (!Array.isArray(v) || v.length > 0));
  const rowMap = new Map(
    (passage && test.answers ? gradeReading([passage], savedAnswers, test.answers).rows : [])
      .map(r => [r.no, r] as const),
  );
  /** 题组正文里的 [Q12] 占位符 → （12） */
  const renderBodyText = (body: string): ReactNode => {
    const parts = body.split(/(\[Q\d+\])/g);
    return parts.map((part, i) => {
      const m = /^\[Q(\d+)\]$/.exec(part);
      return m ? <b className="iv-q-slot" key={i}>（{m[1]}）</b> : part;
    });
  };

  /* ---- 批注框 / 折叠色点 ---- */
  const renderCard = (n: IntensiveNote) => {
    const top = tops[n.id];
    if (collapsed[n.id]) {
      return (
        <button
          key={n.id}
          className={`iv-dot ${n.kind}`}
          style={{ top: top ?? -100 }}
          title={`${KIND_LABEL[n.kind]}：${n.text}（点击展开批注）`}
          onClick={() => toggle(n.id, false)}
        />
      );
    }
    return (
      <div
        key={n.id}
        ref={el => { if (el) cardEls.current.set(n.id, el); else cardEls.current.delete(n.id); }}
        className={`iv-card ${n.kind}`}
        style={{ top: top ?? 0, visibility: top == null ? 'hidden' : 'visible' }}
      >
        <div className="iv-card-head">
          <span className="iv-chip">{KIND_LABEL[n.kind]}</span>
          <span className="iv-anchor" title={n.text}>
            {n.text.length > 46 ? `${n.text.slice(0, 46)}…` : n.text}
          </span>
          <button className="iv-x" title="折叠成小色点（不会删除）" onClick={() => toggle(n.id, true)}>✕</button>
        </div>
        <textarea
          ref={autoGrow}
          autoFocus={editingId === n.id}
          rows={2}
          placeholder="写批注…"
          value={n.note}
          onChange={e => {
            autoGrow(e.target);
            commit((file?.notes ?? []).map(x => (x.id === n.id ? { ...x, note: e.target.value } : x)));
          }}
        />
        <div className="iv-card-ops">
          <button
            className="iv-del"
            onClick={() => commit((file?.notes ?? []).filter(x => x.id !== n.id))}
          >
            删除
          </button>
        </div>
      </div>
    );
  };

  if (!passage) {
    return (
      <div className="iv-shell">
        <header className="iv-top">
          <button className="iv-back" onClick={onClose}>← 返回</button>
          <div className="iv-title"><b>{test.name}</b><span>这篇阅读在当前题包里不存在</span></div>
        </header>
      </div>
    );
  }

  return (
    <div className="iv-shell">
      <header className="iv-top">
        <button className="iv-back" onClick={onClose}>← 返回</button>
        <div className="iv-title">
          <b>{test.name}</b>
          <span>Passage {passageIdx + 1} · {passage.title}</span>
        </div>
        <span className="iv-hint">选中原文文字即可划重点、写批注</span>
        <button
          type="button"
          className={`iv-count iv-dict-toggle${showDictionary ? ' on' : ''}`}
          aria-expanded={showDictionary}
          aria-controls="iv-dictionary"
          onClick={() => {
            setShowDictionary(v => !v);
            setShowNoteList(false);
          }}
        >
          查词典
        </button>
        <button
          type="button"
          className={`iv-count${showNoteList ? ' on' : ''}`}
          aria-expanded={showNoteList}
          aria-controls="iv-note-list"
          onClick={() => {
            setShowNoteList(v => !v);
            setShowDictionary(false);
          }}
        >
          {file?.notes.length ?? 0} 条批注
        </button>
      </header>

      <div className="iv-body" ref={bodyRef}>
        <aside className="iv-side left" ref={sideLRef}>
          {(file?.notes ?? []).filter(n => n.side === 'left').map(renderCard)}
        </aside>

        <div className="iv-main" ref={mainRef}>
          <article
            className="iv-article"
            onMouseUp={onArticleMouseUp}
            onMouseDown={() => setToolbar(null)}
          >
            <h3 className="iv-article-title">{passage.title}</h3>
            {passage.paragraphs.map((para, i) => (
              <p className="iv-para" key={i}>
                {para.tag && <span className="ptag">{para.tag}</span>}
                <span className="iv-ptext" data-para={i}>{renderPara(para.text ?? '', i)}</span>
              </p>
            ))}
          </article>

          <section className="iv-questions">
            <h3 className="iv-q-heading">题目与答案</h3>
            {passage.groups.map((g, gi) => (
              <div className="iv-group" key={gi}>
                <b className="iv-g-title">{g.title}</b>
                {g.instruction && <p className="iv-g-inst">{g.instruction}</p>}
                {(g.content || g.body) && (
                  <div className="iv-g-body">{renderBodyText(g.content ?? g.body ?? '')}</div>
                )}
                {g.options && g.options.length > 0 && (
                  <div className="iv-g-opts">{g.options.map((o, i) => <div key={i}>{o}</div>)}</div>
                )}
                {g.questions.map(q => {
                  const row = rowMap.get(q.no);
                  const stem = q.stem ?? [q.gapPrefix, '＿＿＿', q.gapSuffix].filter(Boolean).join(' ');
                  return (
                    <div className="iv-q" key={q.no}>
                      <b className="iv-q-no">{q.no}</b>
                      <span className="iv-q-stem">
                        {stem}
                        {q.options && q.options.length > 0 && (
                          <span className="iv-q-opts">
                            {q.options.map((o, i) => <span key={i}>{o}</span>)}
                          </span>
                        )}
                      </span>
                      <span className="iv-q-ans">
                        答案：{row?.key ?? test.answers?.[q.no] ?? '—'}
                        {hasUserAnswers && row && (
                          <em className={row.correct ? 'ok' : 'bad'}>
                            你：{row.user} {row.correct ? '✓' : row.unanswered ? '（未答）' : '✗'}
                          </em>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        </div>

        <aside className="iv-side right" ref={sideRRef}>
          {(file?.notes ?? []).filter(n => n.side === 'right').map(renderCard)}
        </aside>

        {showNoteList && (
          <aside className="iv-note-list" id="iv-note-list" aria-label="批注列表">
            <div className="iv-note-list-head">
              <b>批注列表</b>
              <span>{file?.notes.length ?? 0} 条</span>
              <button type="button" className="iv-x" aria-label="关闭批注列表" onClick={() => setShowNoteList(false)}>✕</button>
            </div>
            <div className="iv-note-list-body">
              {(file?.notes.length ?? 0) === 0 ? (
                <div className="iv-note-list-empty">还没有批注。选中原文文字即可添加。</div>
              ) : [...(file?.notes ?? [])]
                .sort((a, b) => a.para - b.para || a.start - b.start)
                .map(n => (
                  <button
                    type="button"
                    key={n.id}
                    className={`iv-note-list-item ${n.kind}`}
                    title={`跳到第 ${n.para + 1} 段：${n.text}`}
                    onClick={() => jumpToNote(n.id)}
                  >
                    <span className="iv-note-list-meta">
                      <span className={`iv-chip ${n.kind}`}>{KIND_LABEL[n.kind]}</span>
                      <small>第 {n.para + 1} 段</small>
                    </span>
                    <b>{n.text}</b>
                    <span className={`iv-note-list-preview${n.note ? '' : ' empty'}`}>
                      {n.note || '还没有写批注'}
                    </span>
                  </button>
                ))}
            </div>
          </aside>
        )}

        <DictionaryPanel
          open={showDictionary}
          query={dictQuery}
          requestId={dictRequestId}
          onClose={() => setShowDictionary(false)}
        />

        {/* 划词工具条：单词/句子建批注；查词只打开词典 */}
        {toolbar && (
          <div
            className="iv-toolbar"
            style={{ left: toolbar.x, top: toolbar.y }}
            onMouseDown={e => e.preventDefault()}
          >
            <button onClick={() => createNote('word')}><i className="iv-swatch word" />单词</button>
            <button onClick={() => createNote('sentence')}><i className="iv-swatch sentence" />句子</button>
            <button type="button" className="iv-dict-lookup" onClick={lookupWord}>查词</button>
          </div>
        )}
      </div>
    </div>
  );
}
