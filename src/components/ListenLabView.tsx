/** 精听训练主界面：左栏（生词本/薄弱句）| 中栏句子流 | 右栏（统计），顶栏 + 底部固定播放器。
 *  句子时间轴 = segment.ts 自动切段（缓存进精听文件）；原文由用户粘贴后按字符比例对齐到纯语音时间轴。
 *  数据走 listenLab.ts（localStorage 缓存 + 启动器 精听记录\ 文件夹镜像）。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredTest } from '../lib/store';
import { listTests } from '../lib/store';
import { loadAudio } from '../lib/media';
import {
  addLWord,
  emptyState,
  findLWord,
  llKey,
  llmTextReady,
  loadListen,
  loadRecording,
  lookupWord,
  removeLWord,
  saveListen,
  saveRecording,
  syncLWordsFromServer,
  LL_CAUSES,
  type ListenFile,
  type LLCause,
  type LLSentState,
  type LWord,
} from '../lib/listenLab';
import { alignTranscript, diffWords, diffWrongCount, segmentAudio, splitTranscript } from '../lib/segment';
import ListenLabPicker from './ListenLabPicker';

interface Props {
  test: StoredTest;
  sectionIdx: number;          // test.listening.sections 下标（0 起）
  onClose: () => void;
  onSwitch: (t: StoredTest, sectionIdx: number) => void;   // 顶栏「篇目」切换
}

type Filter = { kind: 'sent'; idx: number } | { kind: 'cause'; cause: LLCause } | { kind: 'weak' } | null;
type LeftTab = 'words-this' | 'words-all' | 'weak';

interface WordPop { x: number; y: number; word: string; sentIdx: number }

const RATES = [0.5, 0.75, 1, 1.25, 1.5];
const MASK = '████████';

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const firstWords = (text: string, n = 6) => text.split(/\s+/).slice(0, n).join(' ');
const stateOf = (f: ListenFile, i: number): LLSentState => f.states[String(i)] ?? emptyState();
const latestWrong = (st: LLSentState): number => {
  const d = st.dictations[st.dictations.length - 1];
  return d ? d.wrong : 0;
};
const isWeak = (st: LLSentState): boolean => st.replays >= 3 || latestWrong(st) >= 2 || st.hard;

export default function ListenLabView({ test, sectionIdx, onClose, onSwitch }: Props) {
  const section = test.listening?.sections[sectionIdx];
  const key = llKey(test.id, section?.section_number ?? sectionIdx + 1);

  const [file, setFile] = useState<ListenFile | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioErr, setAudioErr] = useState('');
  const [segPhase, setSegPhase] = useState<'idle' | 'working' | 'ready' | 'err'>('idle');
  const [segErr, setSegErr] = useState('');

  const [mode, setMode] = useState<'intensive' | 'extensive'>('intensive');
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [abA, setAbA] = useState<number | null>(null);
  const [abB, setAbB] = useState<number | null>(null);

  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [dictIdx, setDictIdx] = useState<number | null>(null);
  const [dictInput, setDictInput] = useState('');
  const [filter, setFilter] = useState<Filter>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('words-this');
  const [words, setWords] = useState<LWord[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [pop, setPop] = useState<WordPop | null>(null);
  const [popData, setPopData] = useState<{ loading: boolean; phonetic: string; gloss: string; err: string; configured: boolean } | null>(null);
  const [recUrls, setRecUrls] = useState<Record<number, string>>({});
  const [recBusy, setRecBusy] = useState<number | null>(null);
  const [recErr, setRecErr] = useState('');

  const audioRef = useRef<HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<number, HTMLDivElement>());
  const saveTimer = useRef(0);
  const lookupCache = useRef(new Map<string, { phonetic: string; gloss: string }>());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abARef = useRef<number | null>(null);
  const abBRef = useRef<number | null>(null);
  abARef.current = abA;
  abBRef.current = abB;

  const sentences = file?.sentences ?? [];
  const hasTranscript = !!file?.transcript.trim();

  /* ---- 改精听文件（state 立即生效；500ms 防抖落盘 + 镜像） ---- */
  const commit = (mut: (f: ListenFile) => ListenFile) => {
    setFile(f => {
      if (!f) return f;
      const next = mut(f);
      next.updatedAt = Date.now();
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveListen(next), 500);
      return next;
    });
  };
  const commitState = (idx: number, mut: (st: LLSentState) => LLSentState) =>
    commit(f => ({ ...f, states: { ...f.states, [String(idx)]: mut(stateOf(f, idx)) } }));

  /* ---- 载入：精听文件 + 音频 + 自动切段（结果缓存进文件，只算一次） ---- */
  useEffect(() => {
    let alive = true;
    let objUrl = '';
    (async () => {
      const secNo = section?.section_number ?? sectionIdx + 1;
      const blob = await loadAudio(`${test.id}/s${secNo}`);
      if (!alive) return;
      if (!blob) { setAudioErr('找不到本篇听力音频（题包可能不完整，重新导入题包试试）'); return; }
      objUrl = URL.createObjectURL(blob);
      setAudioUrl(objUrl);

      let f = await loadListen(key);
      if (!alive) return;
      if (!f) {
        f = {
          testId: test.id,
          testName: test.name,
          section: secNo,
          title: section?.title || section?.context || '',
          updatedAt: Date.now(),
          segments: null,
          transcript: '',
          sentences: [],
          states: {},
        };
      }
      // 题包可能重新导入过：名称/标题/口音标记以当前题包为准
      f = { ...f, testName: test.name, title: section?.title || section?.context || '' };
      const accentRaw = (section as unknown as Record<string, unknown>)?.accent
        ?? (section as unknown as Record<string, unknown>)?.voice;
      if (typeof accentRaw === 'string' && accentRaw.trim()) f.accent = accentRaw.trim();
      setFile(f);

      if (f.segments && f.sentences.length) {
        setSegPhase('ready');
      } else {
        setSegPhase('working');
        try {
          const segs = await segmentAudio(blob);
          if (!alive) return;
          const sents = f.transcript.trim()
            ? alignTranscript(segs, splitTranscript(f.transcript))
            : segs.map(s => ({ ...s, text: '' }));
          setFile(prev => {
            if (!prev) return prev;
            const next = { ...prev, segments: segs, sentences: sents, updatedAt: Date.now() };
            saveListen(next);
            return next;
          });
          setSegPhase('ready');
        } catch (e) {
          if (!alive) return;
          setSegErr((e as Error)?.message ?? '切段失败');
          setSegPhase('err');
        }
      }
      // 生词本（本篇 + 全部）
      setWords(await syncLWordsFromServer());
      // 已有跟读录音：只探测标记过的句子（states[i].rec=true），避免全量 404 探测
      const urls: Record<number, string> = {};
      for (const [k, st] of Object.entries(f.states)) {
        if (!st.rec) continue;
        const i = Number(k);
        const rec = await loadRecording(test.id, secNo, i);
        if (rec) urls[i] = URL.createObjectURL(rec);
      }
      if (alive) setRecUrls(urls);
    })();
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
      Object.values(recUrls).forEach(u => URL.revokeObjectURL(u));
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.id, sectionIdx]);

  /* ---- 播放器底层事件 ---- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    const onTime = () => {
      const t = a.currentTime;
      setTime(t);
      // AB 循环优先
      if (abARef.current != null && abBRef.current != null && t >= abBRef.current) {
        a.currentTime = abARef.current;
        return;
      }
      if (stopAtRef.current != null && t >= stopAtRef.current) {
        stopAtRef.current = null;
        a.pause();
      }
      // 连续播放时跟随当前句
      if (stopAtRef.current == null && file) {
        const idx = file.sentences.findIndex(s => t >= s.start && t < s.end);
        if (idx >= 0 && idx !== curRef.current) setCur(idx);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => setDuration(a.duration || 0);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('loadedmetadata', onMeta);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('loadedmetadata', onMeta);
    };
  }, [audioUrl, file]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate, audioUrl]);

  const curRef = useRef(cur);
  curRef.current = cur;

  /* ---- 当前句自动居中 ---- */
  useEffect(() => {
    const el = cardEls.current.get(cur);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [cur, filter, mode]);

  /* ---- 播放控制 ---- */
  const playSentence = (i: number, countReplay = true) => {
    const a = audioRef.current;
    const s = sentences[i];
    if (!a || !s) return;
    stopAtRef.current = s.end;
    a.currentTime = Math.max(0, s.start);
    void a.play().catch(() => { /* 自动播放策略拒绝时保持暂停态 */ });
    setCur(i);
    if (countReplay && mode === 'intensive') {
      commitState(i, st => ({ ...st, replays: st.replays + 1 }));
    }
  };
  const togglePlay = () => {
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    if (a.paused) {
      stopAtRef.current = null;   // 底栏播放 = 连续播放
      void a.play().catch(() => { /* 忽略 */ });
    } else {
      a.pause();
    }
  };
  const stepSentence = (d: number) => {
    const next = Math.max(0, Math.min(sentences.length - 1, curRef.current + d));
    if (playing) playSentence(next, false);
    else setCur(next);
  };
  const replayCurrent = () => playSentence(curRef.current);

  /* ---- 快捷键：仅本界面挂载时生效；输入框聚焦时让位 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); replayCurrent(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepSentence(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepSentence(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, sentences.length, playing]);

  /* ---- 听写 ---- */
  const submitDictation = (i: number) => {
    if (!file || !dictInput.trim()) return;
    const sent = sentences[i];
    const diff = diffWords(sent.text, dictInput);
    const wrong = diffWrongCount(diff);
    const rec = { at: Date.now(), hyp: dictInput.trim(), diff, wrong };
    commitState(i, st => ({
      ...st,
      dictations: [...st.dictations, rec],
      mastered: wrong === 0 ? true : st.mastered,
    }));
    setDictIdx(null);
    setDictInput('');
    setRevealed(r => ({ ...r, [i]: true }));   // 交卷即显示原文对照
  };
  const setCause = (i: number, cause: LLCause) => {
    commitState(i, st => {
      const ds = [...st.dictations];
      const last = ds[ds.length - 1];
      if (!last) return st;
      ds[ds.length - 1] = { ...last, cause };
      return { ...st, dictations: ds };
    });
  };

  /* ---- 单词气泡 ---- */
  const openWord = (e: React.MouseEvent, word: string, sentIdx: number) => {
    e.stopPropagation();
    const clean = word.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
    if (!clean) return;
    const x = Math.min(e.clientX, window.innerWidth - 300);
    const y = Math.min(e.clientY + 10, window.innerHeight - 220);
    setPop({ x, y, word: clean, sentIdx });
    const cached = findLWord(clean);
    if (cached && (cached.phonetic || cached.gloss)) {
      setPopData({ loading: false, phonetic: cached.phonetic, gloss: cached.gloss, err: '', configured: llmTextReady() });
      return;
    }
    const mem = lookupCache.current.get(clean.toLowerCase());
    if (mem) {
      setPopData({ loading: false, phonetic: mem.phonetic, gloss: mem.gloss, err: '', configured: true });
      return;
    }
    if (!llmTextReady()) {
      setPopData({ loading: false, phonetic: '', gloss: '', err: '', configured: false });
      return;
    }
    setPopData({ loading: true, phonetic: '', gloss: '', err: '', configured: true });
    lookupWord(clean, sentences[sentIdx]?.text ?? '')
      .then(r => {
        lookupCache.current.set(clean.toLowerCase(), r);
        setPopData({ loading: false, phonetic: r.phonetic, gloss: r.gloss, err: '', configured: true });
      })
      .catch(err => setPopData({ loading: false, phonetic: '', gloss: '', err: (err as Error)?.message ?? '查询失败', configured: true }));
  };
  const addToWordbook = () => {
    if (!pop) return;
    const phonetic = popData?.phonetic ?? '';
    const gloss = popData?.gloss ?? '';
    const next = addLWord(pop.word, {
      key, testId: test.id, testName: test.name,
      section: section?.section_number ?? sectionIdx + 1,
      sentIdx: pop.sentIdx, sent: sentences[pop.sentIdx]?.text ?? '',
    }, phonetic, gloss);
    setWords(next);
    setPop(null);
  };
  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [pop]);

  /* ---- 跟读录音（按住录，松开停） ---- */
  const startRec = async (i: number) => {
    if (recorderRef.current || recBusy != null) return;
    setRecErr('');
    setRecBusy(i);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecBusy(null);
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (!blob.size) return;
        const secNo = section?.section_number ?? sectionIdx + 1;
        void saveRecording(test.id, secNo, i, blob).catch(() => { /* 存储失败忽略 */ });
        commitState(i, st => ({ ...st, rec: true }));
        setRecUrls(m => {
          if (m[i]) URL.revokeObjectURL(m[i]);
          return { ...m, [i]: URL.createObjectURL(blob) };
        });
      };
      rec.start();
    } catch {
      setRecBusy(null);
      setRecErr('麦克风不可用（需要允许麦克风权限）');
    }
  };
  const stopRec = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  /* ---- 原文粘贴 / 重新对齐 ---- */
  const openTranscriptEditor = () => {
    setTranscriptDraft(file?.transcript ?? '');
    setShowTranscript(true);
  };
  const saveTranscriptDraft = () => {
    const txt = transcriptDraft.trim();
    commit(f => {
      if (!f.segments) return { ...f, transcript: txt };
      const sents = txt ? alignTranscript(f.segments, splitTranscript(txt)) : f.segments.map(s => ({ ...s, text: '' }));
      return { ...f, transcript: txt, sentences: sents };
    });
    setRevealed({});
    setShowTranscript(false);
  };

  /* ---- 统计 ---- */
  const stats = useMemo(() => {
    if (!file) return null;
    const causeCount: Record<LLCause, number> = { liaison: 0, vocab: 0, distract: 0, grammar: 0 };
    const heat: { idx: number; level: number }[] = [];
    let masteredCount = 0;
    const weakIdxs: number[] = [];
    file.sentences.forEach((_s, i) => {
      const st = stateOf(file, i);
      const d = st.dictations[st.dictations.length - 1];
      if (d?.cause) causeCount[d.cause]++;
      const score = st.replays + latestWrong(st) * 2 + (st.hard ? 2 : 0);
      heat.push({ idx: i, level: score === 0 ? 0 : score < 3 ? 1 : score < 6 ? 2 : score < 10 ? 3 : 4 });
      if (st.mastered) masteredCount++;
      if (isWeak(st)) weakIdxs.push(i);
    });
    return { causeCount, heat, masteredCount, weakIdxs };
  }, [file]);

  const weakOnly = filter?.kind === 'weak';
  const visibleIdxs = useMemo(() => {
    if (!file || !filter) return sentences.map((_, i) => i);
    if (filter.kind === 'sent') return [filter.idx];
    if (filter.kind === 'weak') return stats?.weakIdxs ?? [];
    return sentences.map((_, i) => i).filter(i => {
      const d = stateOf(file, i).dictations;
      return d[d.length - 1]?.cause === filter.cause;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, filter, sentences, stats]);

  const jumpToSentence = (i: number) => {
    setFilter(null);
    setLeftTab('words-this');
    setCur(i);
    const el = cardEls.current.get(i);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  };

  /* ---- 生词本数据 ---- */
  const wordsThis = words.filter(w => w.srcs.some(s => s.key === key));

  if (!section) {
    return (
      <div className="ll-shell">
        <header className="ll-top">
          <button className="iv-back" onClick={onClose}>← 返回</button>
          <div className="iv-title"><b>{test.name}</b><span>这个 Section 在当前题包里不存在</span></div>
        </header>
      </div>
    );
  }

  const secNo = section.section_number;
  const renderText = (i: number): React.ReactNode => {
    const sent = sentences[i];
    if (!hasTranscript) {
      return <span className="ll-mask" title="先粘贴本篇听力原文，才能显示文本、听写和查词">{MASK}</span>;
    }
    if (!revealed[i] && mode === 'intensive') {
      return (
        <span className="ll-mask">
          {sent.text.split(/\s+/).filter(Boolean).map((w, k) => (
            <span key={k}>{'█'.repeat(Math.min(10, Math.max(2, w.length)))} </span>
          ))}
        </span>
      );
    }
    // 已显示：逐词可点（查词气泡）
    return sent.text.split(/(\s+)/).map((piece, k) => {
      if (!piece.trim()) return piece;
      return (
        <span key={k} className="ll-word" onClick={e => openWord(e, piece, i)}>{piece}</span>
      );
    });
  };

  const renderCard = (i: number) => {
    const sent = sentences[i];
    const st = file ? stateOf(file, i) : emptyState();
    const last = st.dictations[st.dictations.length - 1];
    if (st.mastered && mode === 'intensive') {
      return (
        <div
          key={i}
          ref={el => { if (el) cardEls.current.set(i, el); else cardEls.current.delete(i); }}
          className={`ll-card done${cur === i ? ' cur' : ''}`}
          data-ll={`card-${i}`}
        >
          <button className="ll-done-line" onClick={() => playSentence(i, false)} title="点击重听这句">
            <b>{i + 1}</b> {hasTranscript ? sent.text : `（${fmt(sent.start)} 起，无原文）`}
          </button>
          <button className="ll-mini" title="取消「已掌握」，回到普通卡片"
            onClick={() => commitState(i, s => ({ ...s, mastered: false }))}>撤销</button>
        </div>
      );
    }
    return (
      <div
        key={i}
        ref={el => { if (el) cardEls.current.set(i, el); else cardEls.current.delete(i); }}
        className={`ll-card${cur === i ? ' cur' : ''}${st.hard ? ' hard' : ''}`}
        data-ll={`card-${i}`}
      >
        <div className="ll-card-head">
          <span className="ll-no">{i + 1}</span>
          {st.replays > 0 && <span className="ll-badge" title={`重听 ${st.replays} 次`}>↻ {st.replays}</span>}
          {st.hard && <span className="ll-badge hard">难点</span>}
          <span className="ll-card-time">{fmt(sent.start)}</span>
          <span className="ll-card-ops">
            <button className="ll-mini" onClick={() => playSentence(i)} title="重听这句（R）">重听</button>
            <button
              className="ll-mini"
              disabled={!hasTranscript}
              title={hasTranscript ? '显示/隐藏这句文本' : '先粘贴原文'}
              onClick={() => setRevealed(r => ({ ...r, [i]: !r[i] }))}
            >
              {revealed[i] ? '遮住文本' : '显示文本'}
            </button>
            <button
              className={`ll-mini${st.hard ? ' on' : ''}`}
              onClick={() => commitState(i, s => ({ ...s, hard: !s.hard }))}
              title="标记/取消难点（计入薄弱句）"
            >
              标记难点
            </button>
            <button
              className="ll-mini"
              disabled={!hasTranscript}
              title={hasTranscript ? '听写这句' : '先粘贴原文才能听写'}
              onClick={() => { setDictIdx(dictIdx === i ? null : i); setDictInput(''); }}
            >
              听写
            </button>
            <button
              className={`ll-mini ll-mic${recBusy === i ? ' recording' : ''}`}
              disabled={!audioUrl}
              title="按住录音，松开后与原音对比"
              onPointerDown={() => void startRec(i)}
              onPointerUp={stopRec}
              onPointerLeave={stopRec}
            >
              {recBusy === i ? '● 录音中' : '🎙 跟读'}
            </button>
          </span>
        </div>

        <div className="ll-text">{renderText(i)}</div>

        {dictIdx === i && (
          <div className="ll-dict">
            <textarea
              autoFocus
              rows={2}
              placeholder="把听到的句子打出来，回车或点「提交」"
              value={dictInput}
              data-ll="dict-input"
              onChange={e => setDictInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDictation(i); }
                e.stopPropagation();
              }}
            />
            <div className="ll-dict-ops">
              <button className="ll-mini on" data-ll="dict-submit" onClick={() => submitDictation(i)}>提交</button>
              <button className="ll-mini" onClick={() => setDictIdx(null)}>取消</button>
            </div>
          </div>
        )}

        {last && dictIdx !== i && (
          <div className="ll-diff" data-ll="diff">
            {last.diff.map((t, k) => {
              if (t.kind === 'ok') return <span key={k} className="ok">{t.ref} </span>;
              if (t.kind === 'wrong') return <span key={k} className="wrong" title={`原文：${t.ref}`}>{t.hyp} </span>;
              if (t.kind === 'miss') return <span key={k} className="miss" title="漏听的词">{t.ref} </span>;
              return <span key={k} className="extra" title="多写的词">{t.hyp} </span>;
            })}
            <span className="ll-diff-score">{last.wrong === 0 ? '全对 ✓' : `${last.wrong} 处问题`}</span>
          </div>
        )}
        {last && last.wrong > 0 && dictIdx !== i && (
          <div className="ll-causes" data-ll="causes">
            {last.cause ? (
              <span className="ll-cause-tag">错因：{LL_CAUSES.find(c => c.key === last.cause)?.label}</span>
            ) : (
              LL_CAUSES.map(c => (
                <button key={c.key} className="ll-cause" data-ll={`cause-${c.key}`} onClick={() => setCause(i, c.key)}>
                  {c.label}
                </button>
              ))
            )}
          </div>
        )}

        {recUrls[i] && (
          <div className="ll-rec-row">
            <button className="ll-mini" onClick={() => playSentence(i, false)}>▶ 原音</button>
            <button
              className="ll-mini"
              onClick={() => {
                const u = recUrls[i];
                if (!u) return;
                const a = new Audio(u);
                void a.play().catch(() => { /* 忽略 */ });
              }}
            >
              ▶ 我的录音
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ll-shell">
      <header className="ll-top">
        <button className="iv-back" onClick={onClose}>← 返回</button>
        <div className="iv-title">
          <b>{test.name}</b>
          <span>Part {secNo}{file?.title ? ` · ${file.title}` : ''}</span>
        </div>
        {file?.accent && <span className="ll-accent" title="题包标注的口音">{file.accent}</span>}
        <button className="ll-top-btn" onClick={() => setShowPicker(true)}>篇目</button>
        <button className="ll-top-btn" data-ll="open-transcript" onClick={openTranscriptEditor}>
          {hasTranscript ? '编辑原文' : '粘贴原文'}
        </button>
        <span className="ll-mode">
          <button className={mode === 'intensive' ? 'on' : ''} data-ll="mode-intensive" onClick={() => setMode('intensive')}>精听</button>
          <button className={mode === 'extensive' ? 'on' : ''} data-ll="mode-extensive" onClick={() => setMode('extensive')}>泛听</button>
        </span>
      </header>

      <div className="ll-body">
        {/* ---------- 左栏 ---------- */}
        <aside className="ll-left">
          <div className="ll-side-tabs">
            <button className={leftTab === 'words-this' ? 'on' : ''} onClick={() => setLeftTab('words-this')}>本篇生词</button>
            <button className={leftTab === 'words-all' ? 'on' : ''} onClick={() => setLeftTab('words-all')}>全部生词</button>
            <button className={leftTab === 'weak' ? 'on' : ''} onClick={() => setLeftTab('weak')}>薄弱句</button>
          </div>
          <div className="ll-side-body">
            {leftTab !== 'weak' && (
              (leftTab === 'words-this' ? wordsThis : words).length === 0 ? (
                <p className="ll-side-empty">
                  {leftTab === 'words-this' ? '本篇还没有生词。显示句子文本后，点任意单词可以查释义并加进生词本。' : '生词本还是空的。'}
                </p>
              ) : (
                (leftTab === 'words-this' ? wordsThis : words).map(w => (
                  <div className="ll-word-row" key={w.id} data-ll="word-row">
                    <div className="ll-word-main">
                      <b>{w.word}</b>
                      {w.phonetic && <span className="ll-phon">{w.phonetic}</span>}
                      {w.gloss && <div className="ll-gloss">{w.gloss}</div>}
                      {w.srcs.filter(s => s.key === key).map(s => (
                        <button key={`${s.key}-${s.sentIdx}`} className="ll-src-link"
                          title={s.sent ? firstWords(s.sent, 10) : ''}
                          onClick={() => jumpToSentence(s.sentIdx)}>
                          第 {s.sentIdx + 1} 句
                        </button>
                      ))}
                      {leftTab === 'words-all' && w.srcs.filter(s => s.key !== key).length > 0 && (
                        <span className="ll-phon">另见 {w.srcs.filter(s => s.key !== key).map(s => s.testName).filter((v, i, a) => a.indexOf(v) === i).join('、')}</span>
                      )}
                    </div>
                    <button className="ll-mini danger" title="从生词本移除"
                      onClick={() => setWords(removeLWord(w.id))}>✕</button>
                  </div>
                ))
              )
            )}
            {leftTab === 'weak' && (
              <>
                <p className="ll-side-note">自动聚合：重听 ≥3 次、听写错误 ≥2 处，或手动标了难点。</p>
                {(stats?.weakIdxs.length ?? 0) === 0 ? (
                  <p className="ll-side-empty">还没有薄弱句。多听多写，难点会自己浮出来。</p>
                ) : (
                  <>
                    <button className="ll-weak-all" data-ll="weak-only" onClick={() => setFilter(weakOnly ? null : { kind: 'weak' })}>
                      {weakOnly ? '显示全部句子' : `只刷这些句（${stats!.weakIdxs.length}）`}
                    </button>
                    {stats!.weakIdxs.map(i => {
                      const st = file ? stateOf(file, i) : emptyState();
                      return (
                        <button key={i} className="ll-weak-row" onClick={() => jumpToSentence(i)}>
                          <b>第 {i + 1} 句</b>
                          <span>↻{st.replays}{latestWrong(st) ? ` · 错 ${latestWrong(st)}` : ''}{st.hard ? ' · 难点' : ''}</span>
                        </button>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ---------- 中栏：句子流 ---------- */}
        <main className="ll-main" ref={mainRef}>
          {audioErr && <p className="ll-center-note">{audioErr}</p>}
          {segPhase === 'working' && (
            <p className="ll-center-note" data-ll="segmenting">正在分析音频，自动切分句子…（首次进入需要几秒钟，结果会缓存）</p>
          )}
          {segPhase === 'err' && <p className="ll-center-note">自动切段失败：{segErr}</p>}

          {segPhase === 'ready' && !hasTranscript && mode === 'intensive' && (
            <div className="ll-need-transcript" data-ll="need-transcript">
              <b>还没有本篇听力原文</b>
              <p>粘贴原文后，句子会按长度自动对齐到语音时间轴，就能显示文本、听写和点词查释义了。<br />没有原文也能照常逐句精听（文本显示为遮盖条）。</p>
              <button className="ll-btn" data-ll="paste-transcript" onClick={openTranscriptEditor}>粘贴本篇听力原文</button>
            </div>
          )}

          {filter && (
            <div className="ll-filter-bar" data-ll="filter-bar">
              {filter.kind === 'sent' && `只看第 ${filter.idx + 1} 句`}
              {filter.kind === 'cause' && `只看错因「${LL_CAUSES.find(c => c.key === filter.cause)?.label}」的句子`}
              {filter.kind === 'weak' && `只刷薄弱句（${visibleIdxs.length}）`}
              <button className="ll-mini" onClick={() => setFilter(null)}>显示全部</button>
            </div>
          )}

          {segPhase === 'ready' && mode === 'extensive' && (
            <div className="ll-extensive" data-ll="extensive">
              {hasTranscript ? (
                sentences.map((s, i) => (
                  <span
                    key={i}
                    className={`ll-ext-sent${cur === i ? ' cur' : ''}`}
                    onClick={() => { stopAtRef.current = null; const a = audioRef.current; if (a) { a.currentTime = s.start; void a.play().catch(() => {}); } }}
                  >
                    {s.text}{' '}
                  </span>
                ))
              ) : (
                <p className="ll-center-note">泛听模式需要原文才有字幕。点顶栏「粘贴原文」补上。</p>
              )}
            </div>
          )}

          {segPhase === 'ready' && mode === 'intensive' && (
            <div className="ll-stream" data-ll="stream">
              {visibleIdxs.map(renderCard)}
              {visibleIdxs.length === 0 && <p className="ll-center-note">这个筛选条件下没有句子。</p>}
            </div>
          )}
        </main>

        {/* ---------- 右栏：本篇统计 ---------- */}
        <aside className="ll-right">
          <h3 className="ll-side-h">重听热力</h3>
          <div className="ll-heat" data-ll="heat">
            {(stats?.heat ?? []).map(h => (
              <button
                key={h.idx}
                className={`ll-heat-cell h${h.level}`}
                title={`第 ${h.idx + 1} 句${hasTranscript ? `：${firstWords(sentences[h.idx]?.text ?? '')}` : ''}`}
                onClick={() => setFilter({ kind: 'sent', idx: h.idx })}
              >
                {h.idx + 1}
              </button>
            ))}
          </div>
          <h3 className="ll-side-h">错因分布</h3>
          <div className="ll-causes-stat" data-ll="cause-stat">
            {LL_CAUSES.map(c => {
              const n = stats?.causeCount[c.key] ?? 0;
              const max = Math.max(1, ...LL_CAUSES.map(x => stats?.causeCount[x.key] ?? 0));
              return (
                <button key={c.key} className="ll-cause-row" data-ll={`cause-stat-${c.key}`}
                  onClick={() => setFilter(n ? { kind: 'cause', cause: c.key } : null)}>
                  <span className="ll-cause-label">{c.label}</span>
                  <span className="ll-cause-bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
                  <span className="ll-cause-n">{n}</span>
                </button>
              );
            })}
          </div>
          <h3 className="ll-side-h">进度</h3>
          <p className="ll-progress-note">
            {stats?.masteredCount ?? 0} / {sentences.length} 句已掌握
          </p>
          {recErr && <p className="ll-side-note">{recErr}</p>}
        </aside>
      </div>

      {/* ---------- 底栏播放器（固定悬浮） ---------- */}
      <footer className="ll-player" data-ll="player">
        <div className="ll-transport">
          <button className="ll-t-btn" onClick={() => stepSentence(-1)} title="上一句（←）">⏮</button>
          <button className="ll-t-btn main" data-ll="play" onClick={togglePlay} title="播放/暂停（空格）">{playing ? '⏸' : '▶'}</button>
          <button className="ll-t-btn" onClick={() => stepSentence(1)} title="下一句（→）">⏭</button>
          <button className="ll-t-btn" onClick={replayCurrent} title="重听当前句（R）">↻</button>
        </div>
        <div className="ll-rates">
          {RATES.map(r => (
            <button key={r} className={`ll-rate${rate === r ? ' on' : ''}`} onClick={() => setRate(r)}>{r}×</button>
          ))}
        </div>
        <div className="ll-ab">
          <button className={`ll-t-btn${abA != null ? ' on' : ''}`} onClick={() => setAbA(time)} title="把当前播放位置设为 A 点">设A</button>
          <button className={`ll-t-btn${abB != null ? ' on' : ''}`} disabled={abA == null} onClick={() => setAbB(Math.max(time, (abA ?? 0) + 0.2))} title="把当前播放位置设为 B 点（之后 A→B 循环）">设B</button>
          <button className="ll-t-btn" disabled={abA == null && abB == null} onClick={() => { setAbA(null); setAbB(null); }}>清除</button>
        </div>
        <div className="ll-prog-wrap">
          <div
            className="ll-prog"
            data-ll="progress"
            onClick={e => {
              const a = audioRef.current;
              if (!a || !duration) return;
              const r = e.currentTarget.getBoundingClientRect();
              stopAtRef.current = null;
              a.currentTime = ((e.clientX - r.left) / r.width) * duration;
            }}
          >
            <div className="ll-prog-fill" style={{ width: duration ? `${(time / duration) * 100}%` : 0 }} />
            {abA != null && duration > 0 && (
              <div
                className="ll-ab-band"
                style={{
                  left: `${(abA / duration) * 100}%`,
                  width: abB != null ? `${((abB - abA) / duration) * 100}%` : `${100 - (abA / duration) * 100}%`,
                }}
              />
            )}
            {duration > 0 && sentences.map((s, i) => (
              <i
                key={i}
                className="ll-tick"
                style={{ left: `${(s.start / duration) * 100}%` }}
                title={`第 ${i + 1} 句${hasTranscript ? `：${firstWords(s.text)}` : ''}`}
              />
            ))}
          </div>
          <span className="ll-time-label">{fmt(time)} / {fmt(duration)}</span>
        </div>
        <div className="ll-keys">空格 播放/暂停 · R 重听 · ←→ 切句</div>
      </footer>

      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

      {/* 篇目三级选择 */}
      {showPicker && (
        <ListenLabPicker
          tests={listTests()}
          title="切换到其他篇目"
          onPick={(t, si) => { setShowPicker(false); onSwitch(t, si); }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* 原文粘贴/编辑 */}
      {showTranscript && (
        <div className="overlay" style={{ zIndex: 1260 }} onClick={() => setShowTranscript(false)}>
          <div className="modal ll-transcript-modal" onClick={e => e.stopPropagation()}>
            <h2>本篇听力原文</h2>
            <p className="hint small" style={{ marginTop: 0 }}>
              整段粘贴即可：会按 . ? ! 断句，并按句长比例对齐到语音时间轴（不用手工标时间）。
            </p>
            <textarea
              className="ll-transcript-input"
              data-ll="transcript-input"
              rows={12}
              placeholder="Paste the listening transcript here…"
              value={transcriptDraft}
              onChange={e => setTranscriptDraft(e.target.value)}
            />
            <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
              <button className="btn-ok" style={{ background: '#6c7075' }} onClick={() => setShowTranscript(false)}>取消</button>
              <button className="btn-ok ll-save" data-ll="transcript-save" disabled={!file?.segments} onClick={saveTranscriptDraft}>
                保存并对齐
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 单词气泡 */}
      {pop && (
        <div className="ll-pop" style={{ left: pop.x, top: pop.y }} data-ll="word-pop" onMouseDown={e => e.stopPropagation()}>
          <div className="ll-pop-head">
            <b>{pop.word}</b>
            <button className="iv-x" onClick={() => setPop(null)}>✕</button>
          </div>
          {popData?.loading && <p className="ll-pop-line">查询释义中…</p>}
          {!popData?.loading && (popData?.phonetic || popData?.gloss) && (
            <p className="ll-pop-line">
              {popData?.phonetic && <span className="ll-phon">{popData.phonetic} </span>}
              {popData?.gloss}
            </p>
          )}
          {!popData?.loading && popData?.err && <p className="ll-pop-line ll-pop-err">释义查询失败：{popData.err}</p>}
          {!popData?.loading && !popData?.configured && !popData?.err && !popData?.gloss && (
            <p className="ll-pop-line">未配置文本模型，暂无释义与音标（在首页「高级：内置 API 抽取」里配置文本模型后可用）。</p>
          )}
          <div className="ll-pop-ops">
            {findLWord(pop.word) ? (
              <span className="ll-pop-saved">已在生词本</span>
            ) : (
              <button className="ll-mini on" data-ll="add-word" onClick={addToWordbook}>+ 生词本</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
