import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HighlightCls, HighlightRec, Passage } from '../types';
import type { Segment } from '../hooks/highlight';
import { loadUiSettings, saveUiSettings } from '../lib/uiSettings';
import ContextMenu from './ContextMenu';
import QuestionGroups, { buildBodyBlocks } from './QuestionGroups';
import {
  clearSelection,
  highlightElAt,
  selectedText,
  selectionInPassage,
  selectionSegments,
} from '../hooks/highlight';

export interface Note {
  id: string;
  anchor: string;   // 被批注的原文摘录
  text: string;
}

interface Props {
  passage: Passage;
  partIdx: number;
  answers: Record<number, any>;
  onAnswer: (no: number, value: any) => void;
  onActivate?: (no: number) => void;   // 点进输入框 → 当前题跟随
  notes: Note[];
  onAddNote: (id: string, anchor: string) => void;
  onUpdateNote: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
  highlights: HighlightRec[];
  onAddHighlights: (segs: Segment[], cls: HighlightCls, noteId?: string) => void;
  onSetHlCls: (id: string, cls: HighlightCls) => void;
  onSplitHl: (cover: HighlightRec, s: Segment) => void;
  onRemoveHighlight: (id: string) => void;
  onClearHighlights: () => void;
}

interface CtxLocal {
  x: number;
  y: number;
  hasSelection: boolean;
  onHighlight: boolean;
  hid: string | null;
}

/** 阅读主界面：左文章右题目 + 高亮/笔记（规格第 3 章） */
export default function ReadingView(p: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(p);
  propsRef.current = p;
  const [ctx, setCtx] = useState<CtxLocal | null>(null);
  const [noteFloat, setNoteFloat] = useState<{ id: string; x: number; y: number; draft: string } | null>(null);
  const pendingRectRef = useRef<{ x: number; y: number } | null>(null);

  /* 兜底选区：右键点击若落在选区外，浏览器会先塌陷选区，
     导致菜单里 Highlight/Notes 灰掉——持续记录最近一次有效选区备用 */
  const lastSelRef = useRef<Segment[]>([]);
  useEffect(() => {
    const capture = () => {
      const root = rootRef.current;
      if (!root) return;
      const anchor = window.getSelection()?.anchorNode;
      const ae = anchor instanceof Element ? anchor : anchor?.parentElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
        lastSelRef.current = []; // 输入框/笔记框内的选区不算
        return;
      }
      const segs = selectionSegments(root);
      if (segs.length) lastSelRef.current = segs;
    };
    document.addEventListener('selectionchange', capture);
    return () => document.removeEventListener('selectionchange', capture);
  }, []);

  const takeSegments = (): Segment[] => {
    const root = rootRef.current;
    if (!root) return [];
    const live = selectionSegments(root);
    if (live.length) return live;
    const last = lastSelRef.current;
    lastSelRef.current = [];
    return last;
  };

  /** 从兜底选区还原被选文字（笔记锚点用） */
  const anchorFromSegments = (segs: Segment[]): string => {
    const root = rootRef.current;
    if (!root) return '';
    return segs.map(s => {
      const el = s.zone === 'q'
        ? root.querySelector(`.qtext[data-qblock="${s.qblock}"]`)
        : root.querySelector(`.ptext[data-para="${s.para}"]`);
      return (el?.textContent ?? '').slice(s.start, s.end);
    }).join(' ').trim();
  };

  /* ---------- 高亮 / 笔记 / 删除线 ---------- */

  const doHighlight = (cls: HighlightCls = 'hl-y') => {
    const segs = takeSegments();
    if (!segs.length) return;
    propsRef.current.onAddHighlights(segs, cls); // 重叠段自动合并、新色覆盖
    clearSelection();
  };

  const doNotes = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      pendingRectRef.current = { x: Math.min(r.right + 8, window.innerWidth - 280), y: Math.min(r.bottom + 8, window.innerHeight - 200) };
    }
    const segs = takeSegments();
    if (!segs.length) return;
    const anchor = selectedText() || anchorFromSegments(segs);
    if (!anchor) return;
    const id = `n${Date.now()}`;
    propsRef.current.onAddNote(id, anchor);
    propsRef.current.onAddHighlights(segs, 'hl-y', id); // 笔记锚点同步上高亮（默认黄）
    clearSelection();
    const pos = pendingRectRef.current ?? { x: 120, y: 120 };
    pendingRectRef.current = null;
    setNoteFloat({ id, x: pos.x, y: pos.y, draft: '' }); // 浮动框直接出现在文字旁
  };

  const doStrike = () => {
    const segs = takeSegments();
    if (segs.length) {
      propsRef.current.onAddHighlights(segs, 'strike');
      clearSelection();
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const hl = highlightElAt(e.target);
    setCtx({
      x: e.clientX,
      y: e.clientY,
      hasSelection: selectionInPassage() || lastSelRef.current.length > 0,
      onHighlight: !!hl,
      hid: hl?.dataset.hid ?? null,
    });
  };

  /* 真机行为：拖选文本后自动弹出 Highlight/Notes 菜单（无需右键） */
  const onMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // 单击（无选区）带笔记的高亮 → 打开笔记面板并定位；拖选经过高亮不拦截
    const hl = highlightElAt(e.target);
    if (hl?.dataset.hid && window.getSelection()?.isCollapsed) {
      const rec = propsRef.current.highlights.find(h => h.id === hl.dataset.hid);
      if (rec?.noteId) {
        const note = propsRef.current.notes.find(n => n.id === rec.noteId);
        const r = hl.getBoundingClientRect();
        setNoteFloat({
          id: rec.noteId,
          x: Math.min(r.right + 8, window.innerWidth - 280),
          y: Math.min(r.bottom + 8, window.innerHeight - 200),
          draft: note?.text ?? '',
        });
      }
      return;
    }
    if (!rootRef.current || !selectionSegments(rootRef.current).length) return; // 选区起点在段标字母上也算
    // 菜单贴近选区末尾（而不是鼠标松开点）
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    setCtx({
      x: rect ? rect.right + 6 : e.clientX,
      y: rect ? rect.bottom + 6 : e.clientY,
      hasSelection: true,
      onHighlight: false,
      hid: null,
    });
  };

  // 快捷键：Ctrl+H 高亮 / Ctrl+M 笔记 / Ctrl+S 删除线（规格 3.5）；Esc 关菜单
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setCtx(null); return; }
      if (!e.ctrlKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === 'h') { e.preventDefault(); doHighlight('hl-y'); }
      else if (k === 'm') { e.preventDefault(); doNotes(); }
      else if (k === 's') { e.preventDefault(); doStrike(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 文本 + 高亮记录 → 分段渲染 */
  const renderSegments = (text: string, recs: HighlightRec[]): ReactNode => {
    if (!recs.length) return text;
    const sorted = [...recs].sort((a, b) => a.start - b.start);
    const out: ReactNode[] = [];
    let pos = 0;
    for (const r of sorted) {
      if (r.start > pos) out.push(text.slice(pos, r.start));
      out.push(
        <span key={r.id} data-hid={r.id} className={r.cls + (r.noteId ? ' has-note' : '')}>
          {text.slice(r.start, r.end)}
        </span>,
      );
      pos = Math.max(pos, r.end);
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  };

  const passageRecs = (paraIdx: number) =>
    p.highlights.filter(h => h.zone !== 'q' && h.part === p.partIdx && h.para === paraIdx);
  const qRecs = (block: string) =>
    p.highlights.filter(h => h.zone === 'q' && h.qblock === block);

  /** 题目侧可高亮文本块 */
  const qt = (block: string, text: string): ReactNode => (
    <span className="qtext" data-qblock={block}>{renderSegments(text, qRecs(block))}</span>
  );

  /* ---------- 分栏比例拖拽（记忆在 ielts15-ui-settings） ---------- */
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
  /** 键盘调整分栏：左右方向键 ±5%，双击/Enter 重置 50% */
  const onDividerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setSplit(s => persistSplit(s - 5)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setSplit(s => persistSplit(s + 5)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSplit(persistSplit(50)); }
  };

  const { passage } = p;
  return (
    <div
      className="content"
      ref={rootRef}
      style={{ ['--split' as any]: `${split}%` }}
      onContextMenu={onContextMenu}
      onMouseUp={onMouseUp}
      onMouseDown={e => {
        // 左键重新选择时清掉兜底选区；点在右键菜单上除外（菜单自顾保住选区）
        if (e.button === 0 && !(e.target as HTMLElement).closest('.ctx-menu')) lastSelRef.current = [];
      }}
    >
      <div className="pane passage">
        <div className="part-card">
          <h2 className="part-name">{passage.label}</h2>
          <p className="part-sub">{passage.heading}</p>
        </div>
        <h3 className="article-title">{passage.title}</h3>
        {passage.paragraphs.map((para, i) => {
          /* 正文里也可能带原卷表格（如 "Table 1: …" 后面的数据表）：`|` 分隔行同样渲染成真表格，
             否则只剩一行标题、数据全丢。 */
          const blocks = buildBodyBlocks(para.text ?? '');
          const withTable = blocks.length > 1 || blocks.some(b => b.kind === 'table');
          if (!withTable) {
            return (
              <p className="para" key={i}>
                {para.tag && <span className="ptag">{para.tag}</span>}
                <span className="ptext" data-para={i}>{renderSegments(para.text, passageRecs(i))}</span>
              </p>
            );
          }
          return (
            <div className="para" key={i}>
              {para.tag && <span className="ptag">{para.tag}</span>}
              {blocks.map((b, bi) =>
                b.kind === 'table' ? (
                  <div className="md-table-wrap" key={`tb${bi}`}>
                    <table className="md-table">
                      {(b.header ?? []).length > 0 && (
                        <thead>
                          <tr>{(b.header ?? []).map((c, ci) => <th key={ci}>{c}</th>)}</tr>
                        </thead>
                      )}
                      <tbody>
                        {(b.rows ?? []).map((r, ri) => (
                          <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <span className="ptext" data-para={i} key={`tx${bi}`}>{renderSegments(b.text ?? '', passageRecs(i))}</span>
                ),
              )}
            </div>
          );
        })}
      </div>

      <div
        className="divider"
        onMouseDown={dragStart}
        onDoubleClick={() => setSplit(persistSplit(50))}
        onKeyDown={onDividerKey}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动或按左右方向键调整原文与题目宽度，回车重置为 50%"
        aria-valuenow={Math.round(split)}
        aria-valuemin={25}
        aria-valuemax={75}
        tabIndex={0}
        title="拖动或按 ←/→ 调整宽度（回车重置 50%）"
      />

      <div className="pane questions">
        <QuestionGroups groups={passage.groups} answers={p.answers} onAnswer={p.onAnswer} onActivate={p.onActivate} qt={qt} />
      </div>

      {ctx && (
        <ContextMenu
          state={{ x: ctx.x, y: ctx.y, hasSelection: ctx.hasSelection, onHighlight: ctx.onHighlight }}
          onPickColor={cls => doHighlight(cls)}
          onNotes={doNotes}
          onClear={() => { if (ctx.hid) p.onRemoveHighlight(ctx.hid); }}
          onClearAll={p.onClearHighlights}
          onClose={() => setCtx(null)}
        />
      )}

      {/* 浮动笔记框（贴在锚点文字旁；✕ 仅关闭，Save 保存，Delete 删除笔记与高亮） */}
      {noteFloat && (
        <div className="note-float" style={{ left: noteFloat.x, top: noteFloat.y }}>
          <button className="nf-close" onClick={() => setNoteFloat(null)} title="Close">✕</button>
          <span className="anchor">“{(p.notes.find(n => n.id === noteFloat.id)?.anchor ?? '').slice(0, 40)}”</span>
          <textarea
            autoFocus
            rows={3}
            placeholder="Write a note…"
            value={noteFloat.draft}
            onChange={e => setNoteFloat(f => (f ? { ...f, draft: e.target.value } : f))}
          />
          <div className="ops">
            <button className="del" onClick={() => {
              p.onDeleteNote(noteFloat.id);
              const rec = p.highlights.find(h => h.noteId === noteFloat.id);
              if (rec) p.onRemoveHighlight(rec.id);
              setNoteFloat(null);
            }}>Delete</button>
            <button className="save" onClick={() => {
              p.onUpdateNote(noteFloat.id, noteFloat.draft);
              setNoteFloat(null);
            }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
