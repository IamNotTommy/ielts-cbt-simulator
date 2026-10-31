import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HighlightCls, HighlightRec, Passage } from '../types';
import type { Segment } from '../hooks/highlight';
import {
  clearSelection,
  highlightElAt,
  selectedText,
  selectionInPassage,
  selectionSegments,
} from '../hooks/highlight';
import ContextMenu from './ContextMenu';
import QuestionGroups from './QuestionGroups';
import type { Note } from './ReadingView';

interface Props {
  sections: Passage[];                 // 适配后的听力 section（无文章，只有题组）
  lmode: 'real' | 'practice';
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
  audioUrls: Record<number, string>;   // section_number → objectURL（每节一个文件）
  running: boolean;                    // 开考 && 未收卷
  initialSection?: number;
  onSectionChange?: (index: number) => void;
  onAutoEnd: () => void;               // 实考模式全程播完自动收卷
}

type Stage = 'preview' | 'playing' | 'review' | 'idle';
const PREVIEW_SEC = 30;
const REVIEW_SEC = 30;

interface CtxLocal { x: number; y: number; hasSelection: boolean; onHighlight: boolean; hid: string | null; }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** 听力主界面：顶部音频条 + 全宽题目区（无分栏），标注/禁复制等规则与阅读一致 */
export default function ListeningView(p: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(p);
  propsRef.current = p;
  const audioRef = useRef<HTMLAudioElement>(null);

  const [ctx, setCtx] = useState<CtxLocal | null>(null);
  const [sec, setSec] = useState(() => Math.min(p.initialSection ?? 0, Math.max(0, p.sections.length - 1)));
  const [stage, setStage] = useState<Stage>(p.lmode === 'real' ? 'preview' : 'idle');
  useEffect(() => { p.onSectionChange?.(sec); }, [sec]);
  const [left, setLeft] = useState(PREVIEW_SEC);        // 读题/检查倒计时
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  /* 浮动笔记框（与阅读一致：贴在锚点文字旁） */
  const [noteFloat, setNoteFloat] = useState<{ id: string; x: number; y: number; draft: string } | null>(null);
  const pendingRectRef = useRef<{ x: number; y: number } | null>(null);

  const secNo = p.sections[sec] ? Number(p.sections[sec].label.replace(/\D/g, '')) || sec + 1 : sec + 1;
  const audioUrl = p.audioUrls[secNo];

  /* ---------- 标注（与阅读同一套交互；题块加 L 前缀避免与阅读高亮串扰） ---------- */
  const lastSelRef = useRef<Segment[]>([]);
  useEffect(() => {
    const capture = () => {
      const root = rootRef.current;
      if (!root) return;
      const anchor = window.getSelection()?.anchorNode;
      const ae = anchor instanceof Element ? anchor : anchor?.parentElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) { lastSelRef.current = []; return; }
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

  const anchorFromSegments = (segs: Segment[]): string => {
    const root = rootRef.current;
    if (!root) return '';
    return segs.map(s => {
      const el = root.querySelector(`.qtext[data-qblock="${s.qblock}"]`);
      return (el?.textContent ?? '').slice(s.start, s.end);
    }).join(' ').trim();
  };

  const doHighlight = (cls: HighlightCls = 'hl-y') => {
    const segs = takeSegments();
    if (!segs.length) return;
    propsRef.current.onAddHighlights(segs, cls);
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
    propsRef.current.onAddHighlights(segs, 'hl-y', id);
    clearSelection();
    const pos = pendingRectRef.current ?? { x: 120, y: 120 };
    pendingRectRef.current = null;
    setNoteFloat({ id, x: pos.x, y: pos.y, draft: '' }); // 浮动框直接出现在文字旁
  };

  const doStrike = () => {
    const segs = takeSegments();
    if (segs.length) { propsRef.current.onAddHighlights(segs, 'strike'); clearSelection(); }
  };

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

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const hl = highlightElAt(e.target);
    setCtx({
      x: e.clientX, y: e.clientY,
      hasSelection: selectionInPassage() || lastSelRef.current.length > 0,
      onHighlight: !!hl,
      hid: hl?.dataset.hid ?? null,
    });
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
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
    if (!rootRef.current || !selectionSegments(rootRef.current).length) return;
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    setCtx({
      x: rect ? rect.right + 6 : e.clientX,
      y: rect ? rect.bottom + 6 : e.clientY,
      hasSelection: true, onHighlight: false, hid: null,
    });
  };

  const renderSegments = (text: string, recs: HighlightRec[]): ReactNode => {
    if (!recs.length) return text;
    const sorted = [...recs].sort((a, b) => a.start - b.start);
    const out: ReactNode[] = [];
    let pos = 0;
    for (const r of sorted) {
      if (r.start > pos) out.push(text.slice(pos, r.start));
      out.push(<span key={r.id} data-hid={r.id} className={r.cls + (r.noteId ? ' has-note' : '')}>{text.slice(r.start, r.end)}</span>);
      pos = Math.max(pos, r.end);
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  };

  const qt = (block: string, text: string): ReactNode => {
    const key = `L${block}`;
    const recs = p.highlights.filter(h => h.zone === 'q' && h.qblock === key);
    return <span className="qtext" data-qblock={key}>{renderSegments(text, recs)}</span>;
  };

  /* ---------- 音频流程状态机 ---------- */
  // onAutoEnd 走 ref：若把它写进依赖，父组件每次重渲染都会重建回调并重置倒计时
  const onAutoEndRef = useRef(p.onAutoEnd);
  onAutoEndRef.current = p.onAutoEnd;
  // 倒计时（读题/检查）
  // 依赖里绝不能放整个 props 对象 p：App 每秒（甚至更密）重渲染都会生成新的 p，
  // 导致下面这个 1000ms 定时器每次都被清掉重设、永远来不及触发，倒计时会慢成约 1/3 速度。
  useEffect(() => {
    if (!p.running) return;
    if (stage !== 'preview' && stage !== 'review') return;
    if (left <= 0) {
      if (stage === 'preview') setStage('playing');
      else if (stage === 'review') {
        if (sec < p.sections.length - 1) { setSec(sec + 1); setStage('preview'); setLeft(PREVIEW_SEC); }
        else if (p.lmode === 'real') onAutoEndRef.current();
        else setStage('idle');
      }
      return;
    }
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, left, p.running, sec, p.sections.length, p.lmode]);

  // playing 阶段：装音频并播放（实考/练习进入 playing 都自动开播；练习可暂停）
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (stage === 'playing' && audioUrl) {
      if (a.dataset.sec !== String(secNo)) {
        a.src = audioUrl;
        a.dataset.sec = String(secNo);
        a.playbackRate = rate;
      }
      a.play().catch(() => {});
    } else if (stage !== 'playing') {
      a.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, audioUrl, secNo, p.lmode]);

  // 音频元数据/进度/结束
  const onAudioTime = () => {
    const a = audioRef.current;
    if (!a) return;
    setCurTime(a.currentTime);
    setDuration(a.duration || 0);
  };
  const onAudioEnded = () => {
    setPlaying(false);
    if (stage === 'playing') {
      setStage('review');
      // 实考：最后一个 section 播完是 2 分钟检查时间（非 30 秒）
      setLeft(sec === p.sections.length - 1 ? 120 : REVIEW_SEC);
    }
  };

  const practiceToggle = () => {
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    if (stage !== 'playing') { setStage('playing'); return; } // 进入 playing 由 effect 统一开播
    if (a.paused) { a.play().catch(() => {}); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  const skipPhase = () => {
    if (p.lmode !== 'practice') return; // 实考不允许跳过
    if (stage === 'preview') setStage('playing');
    else if (stage === 'review') setLeft(0);
  };

  return (
    <div
      className="content listening"
      ref={rootRef}
      onContextMenu={onContextMenu}
      onMouseUp={onMouseUp}
      onMouseDown={e => { if (e.button === 0 && !(e.target as HTMLElement).closest('.ctx-menu')) lastSelRef.current = []; }}
    >
      <div className="listening-main">
        {/* 顶部音频条 */}
        <div className="audio-bar">
          <span className="audio-sec">{p.sections[sec]?.label ?? ''}</span>
          {p.lmode === 'real' ? (
            <span className="audio-status">
              {stage === 'preview' && `Preview time ${fmt(left)} (cannot skip in exam mode)`}
              {stage === 'playing' && (audioUrl ? 'Playing… (no pause/progress in exam mode)' : '⚠ Audio missing for this section')}
              {stage === 'review' && `Review time ${fmt(left)}`}
              {stage === 'idle' && 'Playback finished'}
            </span>
          ) : (
            <>
              <button className="audio-btn" onClick={practiceToggle} disabled={!audioUrl}>
                {playing && stage === 'playing' ? '⏸' : '▶'}
              </button>
              <input
                type="range" min={0} max={duration || 0} step={0.1} value={curTime}
                onChange={e => { const a = audioRef.current; if (a) a.currentTime = Number(e.target.value); }}
                style={{ flex: 1 }}
                disabled={!audioUrl}
              />
              <span className="audio-time">{fmt(curTime)} / {fmt(duration)}</span>
              <span title="音量" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                🔊
                <input
                  type="range" min={0} max={1} step={0.05} defaultValue={1}
                  style={{ width: 70 }}
                  onChange={e => { if (audioRef.current) audioRef.current.volume = Number(e.target.value); }}
                />
              </span>
              <select
                value={rate}
                onChange={e => { const r = Number(e.target.value); setRate(r); if (audioRef.current) audioRef.current.playbackRate = r; }}
              >
                {[0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}x</option>)}
              </select>
              <span className="audio-tabs">
                {p.sections.map((_, i) => (
                  <button
                    key={i}
                    className={i === sec ? 'on' : ''}
                    onClick={() => {
                      setSec(i); setStage('idle'); setPlaying(false); setCurTime(0);
                      // 同步滚动到该 section 的题目区
                      document.querySelectorAll('.listening-section')[i]?.scrollIntoView({ block: 'start' });
                    }}
                  >
                    S{i + 1}
                  </button>
                ))}
              </span>
            </>
          )}
          {p.lmode === 'practice' && (stage === 'preview' || stage === 'review') && (
            <span className="audio-status">
              {stage === 'preview' ? `Preview ${fmt(left)}` : `Review ${fmt(left)}`}
              <button className="audio-btn" style={{ marginLeft: 8 }} onClick={skipPhase}>Skip</button>
            </span>
          )}
          {!audioUrl && <span className="audio-status" style={{ color: '#ffd43b' }}>No audio</span>}
        </div>

        {/* 全宽题目区 */}
        <div className="listening-questions">
          {p.sections.map((s, i) => (
            <div key={i} className={'listening-section' + (i === sec ? ' current' : '')}>
              <div className="part-card">
                <h2 className="part-name">{s.label}</h2>
                {!!s.heading && <p className="part-sub">{s.heading}</p>}
              </div>
              <QuestionGroups
                groups={s.groups.map(g => (g.content ? { ...g, body: g.content } : g))}
                answers={p.answers}
                onAnswer={p.onAnswer}
                onActivate={p.onActivate}
                qt={qt}
              />
            </div>
          ))}
        </div>
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

      {/* 浮动笔记框（贴在锚点文字旁，与阅读一致；✕ 仅关闭） */}
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

      <audio ref={audioRef} onTimeUpdate={onAudioTime} onLoadedMetadata={onAudioTime} onEnded={onAudioEnded}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
    </div>
  );
}
