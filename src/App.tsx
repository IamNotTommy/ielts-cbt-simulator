import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import './styles/app-v2.css';
import TopBar from './components/TopBar';
import BottomNav from './components/BottomNav';
import ReadingView, { type Note } from './components/ReadingView';
import WritingView, { countWords } from './components/WritingView';
import Home from './components/Home';
import ResultsView from './components/ResultsView';
import IntensiveView from './components/IntensiveView';
import ListenLabView from './components/ListenLabView';
import ListeningView from './components/ListeningView';
import { passages as demoPassages, writingTasks as demoWriting } from './data/sampleTest';
import type { HighlightCls, HighlightRec, Passage } from './types';
import type { Segment } from './hooks/highlight';
import type { StoredTest } from './lib/store';
import { tk } from './lib/store';
import type { SessionConfig } from './lib/store';
import { bandFor, bandForListening, fmtTime, gradeReading, roundBand } from './lib/scoring';
import type { GradeRow } from './lib/scoring';
import { adaptListening } from './lib/adapter';
import { loadAudio } from './lib/media';
import { buildReportMd, buildGradingMdFallback, downloadMd } from './lib/reportMd';
import { gradeWriting, gradeWritingRationale, type WritingGradeResult } from './lib/llm';
import { loadLlmConfig, saveLlmConfig } from './lib/store';
import GradingSetupModal from './components/GradingSetupModal';
import ErrorProbe from './components/ErrorProbe';
import WritingGradeBox from './components/WritingGradeBox';
import WritingReportBox from './components/WritingReportBox';
import { WRITING_GRADING } from './lib/features';
import { addRecord, updateRecord, type PracticeRecord } from './lib/history';
import SubmitReviewModal, { type ObjectiveSummary, type SubmitSkill, type WritingSummary } from './components/SubmitReviewModal';
import {
  clearActiveSession, clearSessionEnded, discardSession, loadActiveSession, markSessionEnded, saveActiveSession,
  type ActiveSessionMeta,
} from './lib/activeSession';
import { collectReviewFromRecord } from './lib/review';
import { saveWritingAttempt, updateOriginalGrade, writingBandOf } from './lib/writingHistory';
import { loadUiSettings, saveUiSettings } from './lib/uiSettings';

type Mode = 'reading' | 'writing' | 'listening';

const DEFAULT_SESSION: SessionConfig = { scope: 'reading', passageIdx: 0, minutes: 60, writingMinutes: 60 };

const demoTest: StoredTest = {
  id: 'demo',
  name: 'Built-in Demo (practice content, not real exam)',
  source: 'demo',
  createdAt: 0,
  passages: demoPassages,
  writingTasks: demoWriting,
  answers: null,
  issues: [],
};

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function uid(): string {
  return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export default function App() {
  /* ---- 路由：home ↔ test ---- */
  const [screen, setScreen] = useState<'home' | 'test'>('home');
  const [test, setTest] = useState<StoredTest>(demoTest);
  const [session, setSession] = useState<SessionConfig>(DEFAULT_SESSION);
  const [fullPhase, setFullPhase] = useState<'listening' | 'reading' | 'writing'>('reading');

  /* ---- 精读：全屏 overlay，挂在 App 层，与考试计时/作答状态机完全隔离 ---- */
  const [intensive, setIntensive] = useState<{
    test: StoredTest;
    passageIdx: number;
    fromRecords: boolean;
    focusNoteId?: string;
  } | null>(null);
  const [ivRefresh, setIvRefresh] = useState(0);   // 精读关闭时 +1，让首页重拉精读记录/词汇册
  const closeIntensive = () => { setIntensive(null); setIvRefresh(t => t + 1); };
  const intensiveNode = intensive && (
    <IntensiveView
      key={`${intensive.test.id}-${intensive.passageIdx}`}
      test={intensive.test}
      passageIdx={intensive.passageIdx}
      fromRecords={intensive.fromRecords}
      focusNoteId={intensive.focusNoteId}
      onClose={closeIntensive}
    />
  );

  /* ---- 精听：全屏 overlay，模式同精读，与考试状态机隔离 ---- */
  const [listenLab, setListenLab] = useState<{ test: StoredTest; sectionIdx: number } | null>(null);
  const [llRefresh, setLlRefresh] = useState(0);   // 精听关闭时 +1，让首页重拉精听记录
  const closeListenLab = () => { setListenLab(null); setLlRefresh(t => t + 1); };
  const listenLabNode = listenLab && (
    <ListenLabView
      key={`${listenLab.test.id}-s${listenLab.sectionIdx}`}
      test={listenLab.test}
      sectionIdx={listenLab.sectionIdx}
      onClose={closeListenLab}
      onSwitch={(t, si) => setListenLab({ test: t, sectionIdx: si })}
    />
  );

  /* ---- 全局状态机 ---- */
  const [mode, setMode] = useState<Mode>('reading');
  const [opened, setOpened] = useState(false);
  const [attemptSeq, setAttemptSeq] = useState(0);
  const [testEnded, setTestEnded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [submitReview, setSubmitReview] = useState<null | {
    skill: SubmitSkill;
    summary: ObjectiveSummary | WritingSummary;
    fullTransition: boolean;
  }>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_SESSION.minutes * 60);

  /* ---- 真实用时（墙钟） ----
     曾经的 durationSec = allotted - secondsLeft 是"按剩余时间反推"：练习模式听力不限时、
     开考后没在答题的时间都会被算进去 —— 实测 23 秒的一场被记成 5528 秒（1:32:08）。
     现在改为累计"本场考试真正在跑"的墙钟：
       · 起点 = 点 OK 开始 / Full length 点 Continue 进入下一段（opened=true 且未交卷）
       · 终点 = 交卷（endTest）；各段之间连续累计，阶段过渡屏不计入
       · Hide（隐藏屏幕）**计入** —— 实考里倒计时本来就在走，屏幕隐藏不等于停考
       · 开考前等待、成绩单/过渡屏停留不计入；累计毫秒写入 active-session，继续练习时接着累计 */
  const clockRef = useRef<{ accMs: number; since: number | null }>({ accMs: 0, since: null });
  const [finalMs, setFinalMs] = useState(0);          // 交卷瞬间定格的累计墙钟（毫秒）
  /** 结算当前墙钟（把正在跑的一段并入累计值并停表），返回累计毫秒 */
  const closeClock = () => {
    const c = clockRef.current;
    if (c.since != null) { c.accMs += Date.now() - c.since; c.since = null; }
    return c.accMs;
  };
  const resetClock = () => { clockRef.current = { accMs: 0, since: null }; setFinalMs(0); };
  const currentElapsedMs = () => {
    const c = clockRef.current;
    return c.accMs + (c.since == null ? 0 : Date.now() - c.since);
  };
  useEffect(() => {
    const c = clockRef.current;
    if (opened && !testEnded) { if (c.since == null) c.since = Date.now(); }
    else if (c.since != null) { c.accMs += Date.now() - c.since; c.since = null; }
  }, [opened, testEnded]);

  /* ---- Settings（字号 / 配色 / 亮度，持久化到 ielts15-ui-settings，随备份导出） ---- */
  const initialUi = useRef(loadUiSettings()).current;
  const [fontSize, setFontSize] = useState<'std' | 'lg' | 'xl'>(initialUi.fontSize);
  const [scheme, setScheme] = useState<'bow' | 'wob' | 'yob'>(initialUi.scheme);
  const [brightness, setBrightness] = useState(initialUi.brightness);

  /* ---- 阅读 ---- */
  const [partIdx, setPartIdx] = useState(0);
  const [current, setCurrent] = useState(1);
  /* D1：当前题只由「主动导航」更新（点底部题号 / ←→ / Review），作答与聚焦都不改它。
     D2：主动跳题时用显式命令滚动（nearest = 已在视口内则完全不动），不再跟随 current。 */
  const [navSeq, setNavSeq] = useState(0);
  const scrollTargetRef = useRef<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [reviewed, setReviewed] = useState<Record<number, boolean>>({});
  const [reviewMode, setReviewMode] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [highlights, setHighlights] = useState<HighlightRec[]>([]);
  const [times, setTimes] = useState<Record<number, number>>({}); // 每题用时（秒）

  /* ---- 写作 ---- */
  const [wPart, setWPart] = useState(0);
  const [essays, setEssays] = useState<string[]>(['', '']);
  /* ---- 听力 ---- */
  const [lAnswers, setLAnswers] = useState<Record<number, any>>({});
  const [lTimes, setLTimes] = useState<Record<number, number>>({});
  const [lSection, setLSection] = useState(0);
  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({});

  const allListeningSections: Passage[] = useMemo(
    () => (test.listening ? adaptListening(test.listening.sections, []) : []),
    [test],
  );
  const listeningSections = session.scope === 'lsection'
    ? allListeningSections.slice(session.passageIdx, session.passageIdx + 1)
    : allListeningSections;
  const passages = session.scope === 'passage'
    ? test.passages.slice(session.passageIdx, session.passageIdx + 1)
    : test.passages;
  const writingTasks = test.writingTasks;

  /** 判改槽位是否填全（三个字段都要有） */
  const graderReady = (c = loadLlmConfig()) => !!(c.grader.baseUrl && c.grader.apiKey && c.grader.model);
  const scopeHasWriting = (s: SessionConfig) => s.scope === 'writing' || s.scope === 'full';

  /* ---- 开考：载入该套题的作答数据并重置状态机；有未完成存档时恢复剩余时间 ---- */
  const [resumeInfo, setResumeInfo] = useState<{ secondsLeft: number } | null>(null);
  const [wGrade, setWGrade] = useState<WritingGradeResult | null>(null);
  const [wGradeState, setWGradeState] = useState<'idle' | 'loading' | 'error'>('idle');
  /* ---- 评分理由 Markdown 报告：判改成功后生成；模型失败时用本地兜底版，绝不让 MD 缺失 ---- */
  const [wGradeMd, setWGradeMd] = useState<string | null>(null);
  const [wGradeMdState, setWGradeMdState] = useState<'idle' | 'loading'>('idle');
  /* ---- 判改模型弹窗：开考前(pre) / 交卷后现场判改(post) ---- */
  const [gradeModal, setGradeModal] = useState<null | 'pre' | 'post'>(null);
  const [gradeErr, setGradeErr] = useState('');
  const [gradeRunId, setGradeRunId] = useState(0);          // 递增即触发一次判改
  const [gradeAsked, setGradeAsked] = useState(false);      // 交卷后弹窗只自动弹一次
  const [pendingSession, setPendingSession] = useState<{
    test: StoredTest;
    session: SessionConfig;
    gradeWriting: boolean;
    intent: 'new' | 'resume';
  } | null>(null);
  /** 本次交卷写入的练习记录 id：判改异步完成后按它回写判改结果/MD 报告（见判改 useEffect） */
  const recordIdRef = useRef<string | null>(null);
  const gradeRequestRef = useRef(0);
  /** 当前 active-session 的最新快照（供 20 秒 heartbeat 刷新 updatedAt） */
  const sessionMetaRef = useRef<ActiveSessionMeta | null>(null);

  /** 真正开考（唯一入口）。调用方负责把 screen 切到 'test'。
   *  intent='resume' 时按 active-session 恢复范围/阶段/题号；'new' 从第 1 题开始。 */
  const beginTest = (o: { test: StoredTest; session: SessionConfig; gradeWriting: boolean; intent: 'new' | 'resume' }) => {
    const { test: t, gradeWriting, intent } = o;
    const active = intent === 'resume' ? loadActiveSession(t.id) : null;
    setAttemptSeq(n => n + 1);
    gradeRequestRef.current += 1;
    if (intent === 'new') {
      discardSession(t.id);
      resetClock();
      sessionMetaRef.current = null;
    } else {
      clockRef.current = { accMs: active?.elapsedMs ?? 0, since: null };
      setFinalMs(0);
    }
    setTest(t);
    clearSessionEnded(t.id);
    setAnswers(active ? load(tk(t.id, 'answers'), {}) : {});
    setNotes(active ? load(tk(t.id, 'notes'), []) : []);
    setHighlights(active ? load(tk(t.id, 'highlights'), []) : []);
    setEssays(active ? load(tk(t.id, 'essays'), ['', '']) : ['', '']);
    setTimes(active ? load(tk(t.id, 'times'), {}) : {});
    setLAnswers(active ? load(tk(t.id, 'lanswers'), {}) : {});
    setLTimes(active ? load(tk(t.id, 'ltimes'), {}) : {});
    setReviewed(active?.reviewed ?? {});
    setLSection(active?.listeningSection ?? 0);
    setWGrade(null);
    setWGradeState('idle');
    setWGradeMd(null);
    setWGradeMdState('idle');
    setGradeRunId(0);
    setGradeErr('');
    setGradeAsked(false);
    recordIdRef.current = null;

    const s = active ? { ...active.config, gradeWriting } : o.session;
    setSession(s);
    const fullWithListening = s.scope === 'full' && !!t.listening?.sections?.length;
    const startUntimed = s.listeningMode === 'practice' &&
      (s.scope === 'listening' || s.scope === 'lsection' || fullWithListening);

    if (active) {
      setMode(active.mode);
      setFullPhase(active.fullPhase);
      setPartIdx(active.partIdx);
      setCurrent(active.current);
      setWPart(active.wPart);
      const timer = load<{ secondsLeft?: number } | null>(tk(t.id, 'timer'), null);
      const untimedPhase = active.mode === 'listening' && (active.untimed || startUntimed);
      if (untimedPhase) {
        setSecondsLeft(0);
        setResumeInfo(null);
      } else if (timer && Number(timer.secondsLeft) > 0) {
        setSecondsLeft(Number(timer.secondsLeft));
        setResumeInfo({ secondsLeft: Number(timer.secondsLeft) });
      } else {
        const fallback = active.mode === 'writing' ? s.writingMinutes * 60
          : fullWithListening ? 32 * 60 : s.minutes * 60;
        setSecondsLeft(fallback);
        setResumeInfo(null);
      }
    } else {
      setFullPhase(fullWithListening ? 'listening' : 'reading');
      setMode(s.scope === 'writing' ? 'writing'
        : s.scope === 'listening' || s.scope === 'lsection' || fullWithListening ? 'listening'
        : 'reading');
      setSecondsLeft(fullWithListening ? 32 * 60 : (s.scope === 'writing' ? s.writingMinutes : s.minutes) * 60);
      setResumeInfo(null);
      setPartIdx(0);
      setCurrent(1);
      setWPart(0);
    }
    setReviewMode(false);
    setOpened(false);
    setTestEnded(false);
    setHidden(false);
    scrollTargetRef.current = null;
  };

  /* ---- active-session：结构变化立即写，运行中每 20 秒刷新 updatedAt（不在每秒倒计时里写） ---- */
  useEffect(() => {
    if (screen !== 'test' || testEnded || !opened) return;
    const prev = sessionMetaRef.current?.testId === test.id ? sessionMetaRef.current : loadActiveSession(test.id);
    const meta: ActiveSessionMeta = {
      version: 1,
      testId: test.id,
      startedAt: prev?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
      config: session,
      mode,
      fullPhase,
      current: mode === 'writing' ? wPart + 1 : current,
      partIdx,
      wPart,
      untimed: mode === 'listening' && session.listeningMode === 'practice',
      elapsedMs: currentElapsedMs(),
      reviewed,
      listeningSection: lSection,
    };
    sessionMetaRef.current = meta;
    saveActiveSession(meta);
  }, [screen, test.id, session, mode, fullPhase, current, partIdx, wPart, opened, testEnded, reviewed, lSection]);

  useEffect(() => {
    if (screen !== 'test' || testEnded || !opened) return;
    const id = window.setInterval(() => {
      const m = sessionMetaRef.current;
      if (m) saveActiveSession({ ...m, elapsedMs: currentElapsedMs(), updatedAt: Date.now() });
    }, 20000);
    return () => window.clearInterval(id);
  }, [screen, opened, testEnded]);

  /** 判改弹窗节点：开考前（Home 还在屏幕上）与交卷后（成绩单上）两条渲染路径共用，
   *  否则 Home 的 early-return 会把弹窗吞掉。
   *  判改关闭（WRITING_GRADING=false）时这个节点**根本不进 DOM** —— 它是"交卷后自动弹窗预填用户配置"的泄露路径。 */
  const gradeModalNode = WRITING_GRADING && gradeModal ? (
    <ErrorProbe label="GradingSetupModal">
      <GradingSetupModal
        mode={gradeModal}
        cfg={loadLlmConfig()}
        busy={wGradeState === 'loading'}
        error={gradeErr}
        onSave={slot => {
          const c = loadLlmConfig();
          saveLlmConfig({ ...c, grader: slot });   // 只写 grader 槽，不影响抽取模型
        }}
        onSubmit={chosen => {
          setGradeErr('');
          if (gradeModal === 'pre') {
            const p = pendingSession;
            setGradeModal(null);
            if (p) {
              setScreen('test');                       // 先切屏，Home 才会让位
              beginTest({ test: p.test, session: p.session, gradeWriting: chosen, intent: p.intent });
            }
            return;
          }
          // post：要判改 → 真正跑；不判改 → 只关窗看成绩
          if (chosen) {
            setGradeRunId(n => n + 1);
            setSession(s => ({ ...s, gradeWriting: true }));  // 让 Band 折算把写作算进去
          } else setGradeModal(null);
        }}
        onSkip={() => { setGradeErr(''); setGradeModal(null); }}
      />
    </ErrorProbe>
  ) : null;

  const startTest = (t: StoredTest, s: SessionConfig, intent: 'new' | 'resume' = 'new') => {
    const active = intent === 'resume' ? loadActiveSession(t.id) : null;
    // 新练习才询问判改配置；继续时沿用 active-session 中已保存的选择。
    const needAsk = intent === 'new' && WRITING_GRADING && scopeHasWriting(s) && !graderReady();
    const gradeWriting = intent === 'resume'
      ? WRITING_GRADING && scopeHasWriting(s) && !!active?.config.gradeWriting && graderReady()
      : WRITING_GRADING && scopeHasWriting(s) && graderReady();
    setPendingSession({ test: t, session: s, gradeWriting, intent });
    if (needAsk) {
      setGradeModal('pre');   // Home 保持挂载，弹窗叠在首页上；确认后才真正开考
      return;
    }
    setGradeModal(null);
    setScreen('test');
    beginTest({ test: t, session: s, gradeWriting, intent });
  };

  /* ---- 自动保存（按套题隔离，断线保护） ---- */
  useEffect(() => { if (screen === 'test') localStorage.setItem(tk(test.id, 'answers'), JSON.stringify(answers)); }, [answers, screen, test.id]);
  useEffect(() => { if (screen === 'test') localStorage.setItem(tk(test.id, 'notes'), JSON.stringify(notes)); }, [notes, screen, test.id]);
  useEffect(() => { if (screen === 'test') localStorage.setItem(tk(test.id, 'essays'), JSON.stringify(essays)); }, [essays, screen, test.id]);
  useEffect(() => { if (screen === 'test') localStorage.setItem(tk(test.id, 'highlights'), JSON.stringify(highlights)); }, [highlights, screen, test.id]);
  useEffect(() => { if (screen === 'test') localStorage.setItem(tk(test.id, 'times'), JSON.stringify(times)); }, [times, screen, test.id]);
  useEffect(() => { if (screen === 'test') localStorage.setItem(tk(test.id, 'lanswers'), JSON.stringify(lAnswers)); }, [lAnswers, screen, test.id]);
  useEffect(() => { if (screen === 'test') localStorage.setItem(tk(test.id, 'ltimes'), JSON.stringify(lTimes)); }, [lTimes, screen, test.id]);

  /* ---- 听力音频：IndexedDB → objectURL（不入 localStorage）；每节一个文件 ---- */
  useEffect(() => {
    let revoked: string[] = [];
    if (!test.listening) { setAudioUrls({}); return; }
    (async () => {
      const urls: Record<number, string> = {};
      for (const sec of test.listening!.sections) {
        const blob = await loadAudio(`${test.id}/s${sec.section_number}`);
        if (blob) {
          const u = URL.createObjectURL(blob);
          urls[sec.section_number] = u;
          revoked.push(u);
        }
      }
      setAudioUrls(urls);
    })();
    return () => revoked.forEach(u => URL.revokeObjectURL(u));
  }, [test]);

  /* ---- Settings 应用到 body ---- */
  useEffect(() => {
    document.body.classList.toggle('font-lg', fontSize === 'lg');
    document.body.classList.toggle('font-xl', fontSize === 'xl');
    document.body.classList.toggle('scheme-wob', scheme === 'wob');
    document.body.classList.toggle('scheme-yob', scheme === 'yob');
    document.body.style.filter = brightness === 100 ? '' : `brightness(${brightness}%)`;
  }, [fontSize, scheme, brightness]);

  /* 设置变化即写回 ui-settings（保留分栏记忆，不覆盖 split） */
  useEffect(() => {
    const cur = loadUiSettings();
    saveUiSettings({ ...cur, fontSize, scheme, brightness });
  }, [fontSize, scheme, brightness]);

  /* ---- 高亮记录操作（同文本块内重叠段自动合并，新样式覆盖旧段） ---- */
  const addHighlights = (segs: Segment[], cls: HighlightCls, noteId?: string) =>
    setHighlights(hs => {
      let list = [...hs];
      const added: HighlightRec[] = [];
      const sameBlock = (o: HighlightRec, s: Segment) =>
        s.zone === 'q'
          ? o.zone === 'q' && o.qblock === s.qblock
          : o.zone !== 'q' && o.part === partIdx && o.para === s.para;
      for (const s of segs) {
        const ov = list.filter(o => sameBlock(o, s) && o.start < s.end && o.end > s.start);
        const start = ov.length ? Math.min(s.start, ...ov.map(o => o.start)) : s.start;
        const end = ov.length ? Math.max(s.end, ...ov.map(o => o.end)) : s.end;
        if (ov.length) {
          const ids = new Set(ov.map(o => o.id));
          list = list.filter(o => !ids.has(o.id));
        }
        added.push({
          id: uid(),
          part: partIdx,
          para: s.para,
          start,
          end,
          cls,
          zone: s.zone,
          ...(s.qblock ? { qblock: s.qblock } : {}),
          ...(noteId ? { noteId } : {}),
        });
      }
      return [...list, ...added];
    });
  const setHlCls = (id: string, cls: HighlightCls) =>
    setHighlights(hs => hs.map(h => (h.id === id ? { ...h, cls } : h)));
  /** 二次高亮子区间：拆成 棕-玫红-棕 三段（带笔记的锚点不拆） */
  const splitHl = (cover: HighlightRec, s: Segment) =>
    setHighlights(hs => hs.flatMap(h => {
      if (h.id !== cover.id) return [h];
      const pieces: HighlightRec[] = [];
      if (h.start < s.start) pieces.push({ ...h, id: uid(), end: s.start });
      pieces.push({ ...h, id: uid(), start: s.start, end: s.end, cls: 'hl2' });
      if (h.end > s.end) pieces.push({ ...h, id: uid(), start: s.end });
      return pieces;
    }));
  const removeHighlight = (id: string) =>
    setHighlights(hs => hs.filter(h => h.id !== id));
  const clearHighlights = () => setHighlights([]);

  /* ---- 收卷统一入口：先自动保存（作答本就实时落盘）再收卷，并清计时存档 ---- */
  const endTest = () => {
    const elapsedMs = closeClock();   // 先定格真实用时（墙钟），成绩单与练习记录用的是同一个值
    setFinalMs(elapsedMs);
    setTestEnded(true);
    localStorage.removeItem(tk(test.id, 'timer'));
    /* 记一笔练习历史（首页「练习记录」用）；任何异常都不影响收卷。
       Full length 的听力→阅读、阅读→写作各会走一次本函数（那是"阶段结束"，不是"整场结束"），
       只有整场真正结束时（非 full，或 full 已进入写作段）才记一条，否则会重复记账。 */
    try {
      if (session.scope === 'full' && fullPhase !== 'writing') {
        // 阶段结束：保留 active-session，下一段由 Continue 按钮继续（不能在这里清进度）
        return;
      }
      clearActiveSession(test.id);      // 整场结束：不再出现「继续已交卷的练习」
      markSessionEnded(test.id);        // 现存作答属于已交卷，下次开始不再提示"未完成"
      sessionMetaRef.current = null;
      const answered = (o: Record<number, string>) => Object.values(o ?? {}).filter(v => String(v ?? '').trim() !== '').length;
      // 只有"这一场真的考了、而且确实作答了"的科目才记分，否则会出现"只做阅读却记听力 0/40"
      const didReading = (session.scope === 'reading' || session.scope === 'passage' || session.scope === 'full')
        && !!test.answers && answered(answers) > 0;
      const didListening = (session.scope === 'listening' || session.scope === 'lsection' || session.scope === 'full')
        && !!test.listening?.answers && answered(lAnswers) > 0;
      const didWriting = essays.some(e => e && e.trim());
      /* 逐题明细落库：**全部题号**（不只错题），行结构与成绩单完全一致。
         关键：you/correct 一律取 gradeReading 判分函数的输出，而不是自己 answers[q.no] 直读 ——
         共享选项组（如 21+22 共用一个 A-E 选项组）整组的作答只挂在组内首题上，
         直读会让组内其余题显示成空白 ✗，判分函数则会把这组所选字母铺开到每一行。
         type 从 GradeRow 写进记录，供学习分析的题型统计；旧记录缺省不猜。 */
      const detail = (rows: GradeRow[], t: Record<number, number>) => ({
        table: rows.map(r => ({ n: r.no, you: r.user, key: r.key, ok: r.correct, type: r.type })),
        times: t,
      });
      if (didReading || didListening || didWriting) {
        const rec: PracticeRecord = {
          id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          at: Date.now(),
          testId: test.id,
          testName: test.name,
          scope: session.scope,
          mode,
          durationSec: Math.round(elapsedMs / 1000),   // 真实作答墙钟（不再用 allotted - secondsLeft 反推）
          ...(didReading
            ? (() => { const r = gradeReading(passages, answers, test.answers!); return { reading: { score: r.score, total: r.total, band: bandFor(r.score, r.total), ...detail(r.rows, times) } }; })()
            : {}),
          ...(didListening
            ? (() => { const r = gradeReading(listeningSections, lAnswers, test.listening!.answers!); return { listening: { score: r.score, total: r.total, band: bandForListening(r.score, r.total), ...detail(r.rows, lTimes) } }; })()
            : {}),
          ...(didWriting ? { writing: true, writingWords: essays.map(e => countWords(e ?? '')) } : {}),
        };
        addRecord(rec);
        recordIdRef.current = rec.id;   // 判改异步出分后按这个 id 回写判改结果/MD 报告

        /* 写作原稿：无论是否配置模型、判改成功与否，都先保存不可变正文与题目快照。
           判改字段初始为空，稍后由 updateOriginalGrade 回填。 */
        if (didWriting) {
          const now = Date.now();
          const tasks = [0, 1]
            .filter(i => !!test.writingTasks[i])
            .map(i => ({
              task: i === 0 ? 'task1' as const : 'task2' as const,
              prompt: JSON.parse(JSON.stringify(test.writingTasks[i])),
              essay: essays[i] ?? '',
              wordCount: countWords(essays[i] ?? ''),
            }));
          void saveWritingAttempt({
            version: 1,
            recordId: rec.id,
            testId: test.id,
            testName: test.name,
            submittedAt: now,
            durationSec: rec.durationSec,
            tasks,
            revisions: [],
            updatedAt: now,
          }).catch(e => console.warn('保存写作答卷失败：', e));
        }

        /* 错题自动收录：与创建记录同一分支，重复打开成绩页不会重复计数 */
        try { collectReviewFromRecord(rec, test); } catch (e) { console.warn('错题收录失败：', e); }
      }
    } catch { /* 忽略 */ }
  };

  /* ---- 倒计时：开考后走字，Hide 不停，到 0 收卷；同时累计当前题用时 ---- */
  /* 练习模式的听力段不限时（untimed）：不走字、不收卷、不存档计时；每题用时照常累计 */
  const untimed = mode === 'listening' && session.listeningMode === 'practice';
  useEffect(() => {
    if (!opened || testEnded) return;
    const t = setInterval(() => {
      if (!untimed) setSecondsLeft(s => Math.max(0, s - 1));
      if (mode === 'reading') setTimes(tm => ({ ...tm, [current]: (tm[current] ?? 0) + 1 }));
      if (mode === 'listening') setLTimes(tm => ({ ...tm, [current]: (tm[current] ?? 0) + 1 }));
    }, 1000);
    return () => clearInterval(t);
  }, [opened, testEnded, mode, current, untimed]);
  useEffect(() => {
    if (opened && secondsLeft === 0 && !untimed) endTest(); // 归零自动收卷
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, opened, untimed]);

  /* ---- 计时器持久化：每秒存剩余时间（中途退出可恢复；写 localStorage 开销可忽略） ---- */
  useEffect(() => {
    if (screen !== 'test' || !opened || testEnded || untimed || secondsLeft <= 0) return;
    localStorage.setItem(
      tk(test.id, 'timer'),
      JSON.stringify({ scope: session.scope, mode, fullPhase, secondsLeft, savedAt: Date.now() }),
    );
  }, [secondsLeft, screen, opened, testEnded, mode, fullPhase, session.scope, test.id]);

  /* ---- 已答状态推导 ---- */
  const activeListening = mode === 'listening';
  const flatNos = useMemo(
    () => (activeListening ? listeningSections : passages).flatMap(ps => ps.groups.flatMap(g => g.questions.map(q => q.no))),
    [passages, listeningSections, activeListening],
  );
  const answered = useMemo(() => {
    const src = activeListening ? listeningSections : passages;
    const ans = activeListening ? lAnswers : answers;
    const m: Record<number, boolean> = {};
    for (const ps of src) {
      for (const g of ps.groups) {
        for (const q of g.questions) {
          const v = ans[q.no];
          if (q.type === 'gapfill') {
            m[q.no] = !!String(v ?? '').trim();
          } else if (q.type === 'multiple') {
            const srcQ = q.options?.length
              ? q
              : g.questions.find(x => x.type === 'multiple' && x.options?.length);
            const sv = srcQ ? ans[srcQ.no] : null;
            m[q.no] = Array.isArray(sv) && sv.length === (srcQ?.maxSelect ?? 0);
          } else {
            m[q.no] = v != null && v !== '';
          }
        }
      }
    }
    return m;
  }, [answers, lAnswers, passages, listeningSections, activeListening]);

  const wAnswered: Record<number, boolean> = {
    1: countWords(essays[0] ?? '') >= writingTasks[0].minWords,
    2: countWords(essays[1] ?? '') >= writingTasks[1].minWords,
  };

  /* ---- 交卷前检查：从现有 answers/reviewed 计算摘要，不复用 wAnswered 判断空白 ---- */
  const requestFinish = () => {
    if (mode === 'writing') {
      const tasks: WritingSummary['tasks'] = [0, 1]
        .filter(i => !!writingTasks[i])
        .map(i => ({
          task: (i === 0 ? 1 : 2) as 1 | 2,
          words: countWords(essays[i] ?? ''),
          minWords: writingTasks[i].minWords,
          hasText: (essays[i] ?? '').trim().length > 0,
        }));
      setSubmitReview({
        skill: 'writing',
        summary: { kind: 'writing', tasks, flagged: [] },
        fullTransition: session.scope === 'full' && fullPhase !== 'writing',
      });
      return;
    }
    const src = mode === 'listening' ? listeningSections : passages;
    const unanswered: number[] = [];
    const flagged: number[] = [];
    let total = 0;
    for (const ps of src) {
      for (const g of ps.groups) {
        for (const q of g.questions) {
          total++;
          if (!answered[q.no]) unanswered.push(q.no);
          if (reviewed[q.no]) flagged.push(q.no);
        }
      }
    }
    setSubmitReview({
      skill: mode === 'listening' ? 'listening' : 'reading',
      summary: {
        kind: 'objective',
        answered: total - unanswered.length,
        total,
        unanswered: unanswered.sort((a, b) => a - b),
        flagged: flagged.sort((a, b) => a - b),
      },
      fullTransition: session.scope === 'full' && fullPhase !== 'writing',
    });
  };

  const finishLabel = session.scope === 'full'
    ? fullPhase === 'listening' ? '结束听力并进入阅读'
      : fullPhase === 'reading' ? '结束阅读并进入写作'
        : '确认交卷'
    : '交卷';

  const navParts =
    mode === 'reading'
      ? passages.map(ps => ({ label: ps.label, questions: ps.groups.flatMap(g => g.questions.map(q => q.no)) }))
      : mode === 'listening'
        ? listeningSections.map(ps => ({ label: ps.label, questions: ps.groups.flatMap(g => g.questions.map(q => q.no)) }))
        : writingTasks.map((t, i) => ({ label: t.part, questions: [i + 1] }));

  const nos = mode === 'reading' || mode === 'listening' ? flatNos : writingTasks.map((_, i) => i + 1);
  const cur = mode === 'writing' ? wPart + 1 : current;
  const curIdx = nos.indexOf(cur);

  /* ---- 跳题：切 Part + 滚动定位；Review 模式下勾选旗标 ---- */
  const jump = (no: number) => {
    if (mode === 'writing') {
      setWPart(Math.min(writingTasks.length - 1, Math.max(0, no - 1)));
      return;
    }
    scrollTargetRef.current = no;   // 只有主动导航才请求滚动（D2）
    setNavSeq(s => s + 1);
    if (mode === 'listening') {
      setCurrent(no);
      if (reviewMode) setReviewed(r => ({ ...r, [no]: true }));
      return;
    }
    const pi = passages.findIndex(ps => ps.groups.some(g => g.questions.some(q => q.no === no)));
    if (pi >= 0) setPartIdx(pi);
    setCurrent(no);
    if (reviewMode) setReviewed(r => ({ ...r, [no]: true }));
  };

  /* 主动跳题 → 滚动定位。nearest：目标已在视口内则不动（真机点题号的手感）。
     依赖 navSeq 而不是 current，因此「作答/聚焦」永远不会触发滚动（issue-04）。
     这个目标**只消费一次**：用完立刻清空，否则后续任何无关的依赖变化（例如开考时 opened 变 true）
     都可能拿着上一套题遗留的题号再滚一次 —— 现象就是"点开始后自己跳到中间"。 */
  useEffect(() => {
    if (mode === 'writing' || !opened) return;
    const no = scrollTargetRef.current;
    scrollTargetRef.current = null;
    if (no == null) return;
    document.getElementById(`q-${no}`)?.scrollIntoView({ block: 'nearest' });
  }, [navSeq, opened, mode]);

  /* ---- 模式切换 / 收卷重置 / Full length 过渡 ---- */
  const scopeSeconds = (m: Mode) => (m === 'writing' ? session.writingMinutes : session.minutes) * 60;

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setSecondsLeft(scopeSeconds(m));
    setOpened(false);
    setTestEnded(false);
    setHidden(false);
  };
  const continueToWriting = () => {
    setFullPhase('writing');
    setMode('writing');
    setSecondsLeft(session.writingMinutes * 60);
    setTestEnded(false);
    setOpened(true); // Full length 连续作答，不再出开考弹窗
  };
  const continueToReading = () => {
    setFullPhase('reading');
    setMode('reading');
    setSecondsLeft(session.minutes * 60);
    setTestEnded(false);
    setOpened(true);
  };

  /* ---- 写作 AI 判改：收卷后自动触发一次，或在成绩单上点「现场判改」触发（镣铐在 UI 层） ---- */
  const writingEndedNow = testEnded && mode === 'writing' && !(session.scope === 'full' && fullPhase === 'reading');
  useEffect(() => {
    if (!WRITING_GRADING) return;   // 判改关闭时：任何情况下都不进判改流程（哪怕 localStorage 里存过模型配置）
    const wanted = (writingEndedNow && session.gradeWriting) || gradeRunId > 0;
    if (!wanted || wGrade || wGradeState === 'loading') return;
    const items = ([
      { task: 'task1' as const, prompt: (writingTasks[0]?.promptLines ?? []).map(l => l.text).join('\n'), essay: essays[0] ?? '' },
      { task: 'task2' as const, prompt: (writingTasks[1]?.promptLines ?? []).map(l => l.text).join('\n'), essay: essays[1] ?? '' },
    ]).filter(it => it.essay.trim());
    if (!items.length) {
      // 没写作文：自动流程沿用原行为；手动现场判改则明确提示
      if (gradeRunId > 0) setGradeErr('这两个写作 Task 都是空的，没有可批改的内容。');
      else setWGradeState('error');
      return;
    }
    setWGradeState('loading');
    setGradeErr('');
    const c = loadLlmConfig();
    const ok = (s: { baseUrl: string; apiKey: string; model: string }) => !!(s.baseUrl && s.apiKey && s.model);
    const slot = ok(c.grader) ? c.grader : c.text;
    /* 绑定到"本次交卷"的记录：必须在发起请求前固定下来。
       之后的异步回调只认这个 id，绝不会把结果写进用户重开后另一场练习。 */
    const targetRecordId = recordIdRef.current;
    const requestId = ++gradeRequestRef.current;
    gradeWriting(slot, items)
      .then(r => {
        const isCurrent = requestId === gradeRequestRef.current;
        if (isCurrent) {
          setWGrade(r); setWGradeState('idle'); setGradeAsked(true); setGradeModal(null);
        }
        const band = writingBandOf(r);
        if (isCurrent) setWGradeMdState('loading');
        (async () => {
          let md: string;
          try {
            md = await gradeWritingRationale(slot, items, r);
          } catch {
            md = buildGradingMdFallback(test.name, r, items.map(it => ({ ...it, wordCount: countWords(it.essay) }))) +
              '\n\n（本报告为离线简版：模型生成详细理由失败）';
          }
          if (requestId === gradeRequestRef.current) {
            setWGradeMd(md);
            setWGradeMdState('idle');
          }
          // 历史始终按 targetRecordId 回写；UI 只更新当前场次
          if (!targetRecordId) {
            if (requestId === gradeRequestRef.current) setGradeErr('判改结果未能绑定到练习记录（没有可回写的历史），本次结果只在当前页面显示。');
            return;
          }
          try {
            updateRecord(targetRecordId, { writingGrade: r, writingBand: band, writingReportMd: md });
          } catch (e) { console.warn('判改结果写回练习记录失败：', e); }
          try {
            await updateOriginalGrade(targetRecordId, r, md, band);
          } catch (e) {
            console.warn('判改结果写回写作答卷失败：', e);
            if (requestId === gradeRequestRef.current) setGradeErr('判改结果已写到练习记录，但写作答卷回写失败；可在下次打开时重试判改。');
          }
        })();
      })
      .catch((e: unknown) => {
        if (requestId !== gradeRequestRef.current) return;
        setWGradeState('error');
        setGradeErr(`判改失败：${(e as Error)?.message ?? '未知错误'}\n请检查 Base URL / API Key / 模型名是否正确，以及该模型是否可用。`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingEndedNow, session.gradeWriting, gradeRunId]);

  /* ---- 交卷后：考前选了「不判改」时，在结算画面自动弹一次判改窗口。
          判改关闭（WRITING_GRADING=false）时**绝不**自动弹 —— 这个弹窗会把 localStorage 里的判改模型
          配置（Base URL / 模型名 / Key）预填到 DOM 上，属于配置泄露路径。
          考前已选自动判改（session.gradeWriting）时也不弹：判改已在跑/已出分，除非判改失败留作重试入口。 ---- */
  const writingTotalsNow = testEnded && scopeHasWriting(session) && !!(essays[0]?.trim() || essays[1]?.trim());
  useEffect(() => {
    if (!WRITING_GRADING) return;
    if (!writingTotalsNow || gradeAsked || gradeRunId > 0) return;
    if (wGrade || wGradeState === 'loading') return;
    if (session.gradeWriting && wGradeState !== 'error') return;
    setGradeAsked(true);
    setGradeErr('');
    setGradeModal('post');
  }, [writingTotalsNow, gradeAsked, gradeRunId, wGrade, wGradeState, session.gradeWriting]);

  /* ---- 写作 Band：官方 Task2 权重 2/3，再按 .25/.75 舍入。
          注意不能用 session.gradeWriting 当守卫：那是"考前是否选择判改"，
          现场判改时它为 false，会把已经判出来的分挡成 Not graded。 */
  const writingBand = (() => {
    if (!wGrade) return null;
    const b1 = wGrade.task1?.band;
    const b2 = wGrade.task2?.band;
    if (b1 != null && b2 != null) return roundBand((b1 + 2 * b2) / 3);
    const bs = [b1, b2].filter((b): b is number => typeof b === 'number');
    return bs.length ? roundBand(bs.reduce((a, b) => a + b, 0) / bs.length) : null;
  })();

  /* ---- 导出作答记录 md ---- */
  const scopeLabel = { passage: `单篇 Passage ${session.passageIdx + 1}`, reading: '阅读整卷', writing: '写作', full: 'Full length', listening: session.listeningMode === 'real' ? '听力（实考模式）' : '听力（练习模式）', lsection: `单篇 Section ${session.passageIdx + 1}` }[session.scope];
  /* 练习模式听力不限时：顶栏计时器（secondsLeft）停摆，用"总时长 - 剩余"反推会让用时永远偏大，
     所以这里的用时统一取墙钟累计（endTest 时定格在 finalMs），与练习记录里写的 durationSec 同源。
     lTimes（每题用时）照常在练习模式累计，只用于成绩单的"每题用时/题型用时"展示。 */
  const durationSec = Math.round(finalMs / 1000);
  const exportMd = () => {
    /* 按当前科目生成：听力用 listeningSections + lAnswers + lTimes；
       全科连练两科都导出；不再把阅读数据硬套到听力上。 */
    const sections: { label: string; rows: GradeRow[]; times: Record<number, number> }[] = [];
    const didListening = session.scope === 'listening' || session.scope === 'lsection' || session.scope === 'full';
    const didReading = session.scope === 'reading' || session.scope === 'passage' || session.scope === 'full';
    if (didListening) {
      sections.push({
        label: '听力',
        rows: gradeReading(allListeningSections, lAnswers, test.listening?.answers ?? {}).rows,
        times: lTimes,
      });
    }
    if (didReading) {
      sections.push({
        label: '阅读',
        rows: gradeReading(passages, answers, test.answers ?? {}).rows,
        times,
      });
    }
    downloadMd(`作答记录-${test.name}.md`, buildReportMd({
      test, modeLabel: scopeLabel, durationSec, rows: null, times, essays,
      wordCounts: essays.map(countWords), sections,
    }));
  };

  /** 「再做一次」：明确清空本场作答（含作文/笔记/高亮/计时），不删除历史成绩 */
  const retryTest = () => {
    if (!confirm('清空本场答案并再练一次？\n\n将清除本场的作答、作文、笔记、高亮和计时。\n已交卷的练习记录、写作答卷与学习数据不会被删除。')) return;
    discardSession(test.id);
    clearActiveSession(test.id);
    sessionMetaRef.current = null;
    setAttemptSeq(n => n + 1);
    gradeRequestRef.current += 1;
    setAnswers({});
    setLAnswers({});
    setEssays(['', '']);
    setNotes([]);
    setHighlights([]);
    setTimes({});
    setLTimes({});
    setLSection(0);
    setReviewed({});
    setReviewMode(false);
    resetClock();
    setTestEnded(false);
    setOpened(false);
    setCurrent(1);
    setPartIdx(0);
    setWPart(0);
    setWGrade(null);
    setWGradeState('idle');
    setWGradeMd(null);
    setWGradeMdState('idle');
    setGradeRunId(0);
    setGradeAsked(false);
    setGradeErr('');
    setGradeModal(null);
    setResumeInfo(null);
    const fullWithListening = session.scope === 'full' && !!test.listening?.sections?.length;
    setFullPhase(fullWithListening ? 'listening' : 'reading');
    setMode(session.scope === 'writing' ? 'writing'
      : session.scope === 'listening' || session.scope === 'lsection' || fullWithListening ? 'listening'
        : 'reading');
    setSecondsLeft(fullWithListening ? 32 * 60 : (session.scope === 'writing' ? session.writingMinutes : session.minutes) * 60);
  };

  /** 返回题库：有进行中的作答时给轻量确认（只离开页面，不清进度） */
  const goHome = () => {
    if (opened && !testEnded) {
      if (!confirm('答案已自动保存，返回题库后可以在首页「继续上次练习」里接着做。要现在返回吗？')) return;
      const m = sessionMetaRef.current;
      if (m) saveActiveSession({
        ...m,
        elapsedMs: currentElapsedMs(),
        reviewed,
        listeningSection: lSection,
        updatedAt: Date.now(),
      });
    }
    setScreen('home');
  };

  if (screen === 'home') {
    return (
      <>
        <Home
          demoTest={demoTest}
          onStart={startTest}
          ivRefresh={ivRefresh}
          llRefresh={llRefresh}
          onOpenIntensive={(t, pi, nid) => setIntensive({ test: t, passageIdx: pi, fromRecords: true, focusNoteId: nid })}
          onOpenListenLab={(t, si) => setListenLab({ test: t, sectionIdx: si })}
        />
        {gradeModalNode}
        {intensiveNode}
        {listenLabNode}
      </>
    );
  }

  /* ---- 收卷屏 / 成绩单 ---- */
  const isFullTransitionL = testEnded && session.scope === 'full' && fullPhase === 'listening';
  const isFullTransition = testEnded && session.scope === 'full' && fullPhase === 'reading';
  const hasReadingAnswers = !!test.answers;
  const hasListeningAnswers = !!test.listening?.answers;
  const showResults = testEnded && !isFullTransition && !isFullTransitionL &&
    ((hasReadingAnswers && (mode === 'reading' || (session.scope === 'full' && fullPhase === 'writing'))) ||
      (hasListeningAnswers && (mode === 'listening' || (session.scope === 'full' && fullPhase === 'writing'))));
  const readingResult = (() => {
    if (!showResults) return null;
    if (mode === 'listening') {
      const { rows, score, total } = gradeReading(listeningSections, lAnswers, test.listening!.answers!);
      return { rows, score, total, band: bandForListening(score, total) };
    }
    const { rows, score, total } = gradeReading(passages, answers, test.answers!);
    return { rows, score, total, band: bandFor(score, total) };
  })();
  const listeningResult = (() => {
    if (!showResults || session.scope !== 'full' || !test.listening?.answers) return null;
    const { rows, score, total } = gradeReading(allListeningSections, lAnswers, test.listening.answers);
    return { rows, score, total, band: bandForListening(score, total) };
  })();

  const modeName = mode === 'reading' ? 'Reading' : mode === 'listening' ? 'Listening' : 'Writing';

  /* 精读入口：scope 为单篇/阅读整卷/Full length 且有阅读内容时，成绩单上出现「精读」按钮 */
  const intensivePassages =
    (session.scope === 'passage' || session.scope === 'reading' || session.scope === 'full') && test.passages.length > 0
      ? (session.scope === 'passage' ? [session.passageIdx] : test.passages.map((_, i) => i))
        .filter(i => !!test.passages[i])
        .map(i => ({ idx: i, title: test.passages[i].title }))
      : undefined;

  /* 精听入口：scope 为听力/单 section/Full length 且有听力内容时，成绩单上出现「精听」按钮 */
  const listenSections =
    (session.scope === 'listening' || session.scope === 'lsection' || session.scope === 'full')
      && (test.listening?.sections?.length ?? 0) > 0
      ? (session.scope === 'lsection' ? [session.passageIdx] : test.listening!.sections.map((_, i) => i))
        .filter(i => !!test.listening!.sections[i])
        .map(i => ({ idx: i, title: test.listening!.sections[i].title || test.listening!.sections[i].context || '' }))
      : undefined;

  /* 写作判改区（成绩单与收卷卡共用一份）。判改关闭（WRITING_GRADING=false）时整块为 undefined：
     既没有「现场判改」按钮，也没有"AI grading is for reference only"横幅和 Not graded 文案，
     于是任何界面都不会出现判改入口/字样。 */
  const writingGradeSlot = WRITING_GRADING && (session.scope === 'writing' || session.scope === 'full') ? (
    wGrade ? (
      <>
        <WritingGradeBox grade={wGrade} hasChart={!!writingTasks[0]?.hasChart} />
        <WritingReportBox
          md={wGradeMd}
          loading={wGradeMdState === 'loading'}
          onDownload={() => wGradeMd && downloadMd(`写作判改报告-${test.name}.md`, wGradeMd)}
        />
      </>
    ) : (
      <div className="ai-grade-box">
        <div className="ai-grade-banner">AI grading is for reference only — not an official score</div>
        <div style={{ padding: '6px 16px 12px' }}>
          {wGradeState === 'loading' ? (
            <p>AI judging in progress…</p>
          ) : (
            <>
              <p style={{ margin: '4px 0 8px' }}>Writing: <b>Not graded</b> — 这套写作还没有批改。</p>
              {gradeErr && <div className="form-err-box">{gradeErr}</div>}
              <button
                className="preset-btn"
                onClick={() => { setGradeErr(''); setGradeModal('post'); }}
              >
                现场判改（填写判改模型后立即批改）
              </button>
            </>
          )}
        </div>
      </div>
    )
  ) : undefined;

  return (
    <div className="app-shell">
      <TopBar
        secondsLeft={secondsLeft}
        mode={mode}
        onMode={switchMode}
        hideModeTabs={session.scope === 'full' || session.scope === 'listening' || session.scope === 'lsection'}
        onSettings={() => setShowSettings(true)}
        onHelp={() => setShowHelp(true)}
        onHide={() => setHidden(true)}
        onFinish={requestFinish}
        onHome={goHome}
        flagged={!!reviewed[cur]}
        onToggleFlag={() => setReviewed(r => ({ ...r, [cur]: !r[cur] }))}
        untimed={untimed}
        demo={test.source === 'demo'}
        finishLabel={finishLabel}
      />

      {mode === 'listening' ? (
        <ListeningView
          key={attemptSeq}
          sections={listeningSections}
          lmode={session.listeningMode ?? (session.scope === 'full' ? 'real' : 'practice')}
          answers={lAnswers}
          onAnswer={(no, v) => setLAnswers(a => ({ ...a, [no]: v }))}
          notes={notes}
          onAddNote={(id, anchor) => setNotes(n => [...n, { id, anchor, text: '' }])}
          onUpdateNote={(id, text) => setNotes(n => n.map(x => (x.id === id ? { ...x, text } : x)))}
          onDeleteNote={id => setNotes(n => n.filter(x => x.id !== id))}
          highlights={highlights}
          onAddHighlights={addHighlights}
          onSetHlCls={setHlCls}
          onSplitHl={splitHl}
          onRemoveHighlight={removeHighlight}
          onClearHighlights={clearHighlights}
          audioUrls={audioUrls}
          running={opened && !testEnded}
          initialSection={lSection}
          onSectionChange={setLSection}
          onAutoEnd={endTest}
        />
      ) : mode === 'reading' ? (
        <ReadingView
          passage={passages[partIdx]}
          partIdx={partIdx}
          answers={answers}
          onAnswer={(no, v) => setAnswers(a => ({ ...a, [no]: v }))}
          notes={notes}
          onAddNote={(id, anchor) => setNotes(n => [...n, { id, anchor, text: '' }])}
          onUpdateNote={(id, text) => setNotes(n => n.map(x => (x.id === id ? { ...x, text } : x)))}
          onDeleteNote={id => setNotes(n => n.filter(x => x.id !== id))}
          highlights={highlights}
          onAddHighlights={addHighlights}
          onSetHlCls={setHlCls}
          onSplitHl={splitHl}
          onRemoveHighlight={removeHighlight}
          onClearHighlights={clearHighlights}
        />
      ) : (
        <WritingView
          task={writingTasks[wPart]}
          text={essays[wPart] ?? ''}
          onChange={t => setEssays(e => e.map((x, i) => (i === wPart ? t : x)))}
        />
      )}

      <BottomNav
        parts={navParts}
        current={cur}
        answered={mode === 'writing' ? wAnswered : answered}
        reviewed={reviewed}
        reviewMode={reviewMode}
        onToggleReviewMode={() => setReviewMode(v => !v)}
        onJump={jump}
        onPrev={() => curIdx > 0 && jump(nos[curIdx - 1])}
        onNext={() => curIdx < nos.length - 1 && jump(nos[curIdx + 1])}
        disablePrev={curIdx <= 0}
        disableNext={curIdx < 0 || curIdx >= nos.length - 1}
      />

      {/* 开考确认（未点 OK 计时不走；有未完成存档时提示恢复） */}
      {opened || testEnded ? null : (
        <div className="overlay">
          <div className="modal" style={{ textAlign: 'center' }}>
            <h2>{modeName} test</h2>
            <p style={{ margin: '0 0 6px', fontWeight: 700 }}>{test.name}</p>
            {resumeInfo ? (
              <p style={{ marginBottom: 14 }}>
                继续上次作答 — 剩余 <b>{fmtTime(resumeInfo.secondsLeft)}</b>。范围与题号已按上次进度恢复。
              </p>
            ) : (
              <p style={{ marginBottom: 22 }}>Press OK to start the {modeName} test.</p>
            )}
            <button className="btn-ok" onClick={() => setOpened(true)}>{resumeInfo ? '继续作答' : '开始作答'}</button>
            {resumeInfo && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="preset-btn"
                  onClick={() => {
                    localStorage.removeItem(tk(test.id, 'timer'));
                    setResumeInfo(null);
                    setSecondsLeft(scopeSeconds(mode));
                  }}
                >
                  Discard and restart timer
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 收卷屏：阅读且有标准答案 → 成绩单（A/B 双视图）；Full length 阅读段 → 过渡屏；否则通用结束卡 */}
      {testEnded && readingResult && (
        <ResultsView
          test={test}
          rows={readingResult.rows}
          score={readingResult.score}
          total={readingResult.total}
          band={readingResult.band}
          times={mode === 'listening' ? lTimes : times}
          flagged={reviewed}
          readingDone={session.scope !== 'writing' && session.scope !== 'listening' && session.scope !== 'lsection'}
          listeningDone={session.scope === 'listening' || session.scope === 'lsection' || (session.scope === 'full' && !!test.listening)}
          listeningBand={listeningResult?.band ?? (mode === 'listening' ? readingResult?.band ?? null : null)}
          writingDone={session.scope === 'writing' || session.scope === 'full'}
          writingBand={writingBand}
          detail2={listeningResult ? {
            label: 'Listening',
            rows: listeningResult.rows,
            score: listeningResult.score,
            total: listeningResult.total,
            times: lTimes,
          } : undefined}
          durationSec={durationSec}
          onExportMd={exportMd}
          onRetry={retryTest}
          onHome={goHome}
          intensivePassages={intensivePassages}
          onIntensive={pi => setIntensive({ test, passageIdx: pi, fromRecords: false })}
          listenSections={listenSections}
          onListenLab={si => setListenLab({ test, sectionIdx: si })}
          writingSlot={writingGradeSlot}
        />
      )}
      {isFullTransition && (
        <div className="overlay" style={{ background: '#e9ecef' }}>
          <div className="ended-card">
            <h2>Reading test ended</h2>
            <p>Your Reading answers have been stored.</p>
            <p>The Writing test will begin when you continue.</p>
            <div style={{ textAlign: 'center', marginTop: 28 }}>
              <button className="btn-dark" onClick={continueToWriting}>Continue to Writing</button>
            </div>
          </div>
        </div>
      )}
      {isFullTransitionL && (
        <div className="overlay" style={{ background: '#e9ecef' }}>
          <div className="ended-card">
            <h2>Listening test ended</h2>
            <p>Your Listening answers have been stored.</p>
            <p>The Reading test will begin when you continue.</p>
            <div style={{ textAlign: 'center', marginTop: 28 }}>
              <button className="btn-dark" onClick={continueToReading}>Continue to Reading</button>
            </div>
          </div>
        </div>
      )}
      {testEnded && !readingResult && !isFullTransition && !isFullTransitionL && (
        <div className="overlay" style={{ background: '#e9ecef', overflowY: 'auto' }}>
          <div className="ended-card">
            <h2>Test ended</h2>
            <p>Your test has finished.</p>
            <p>All of your answers have been stored.</p>

            {/* 写作 AI 判改结果（镣铐：固定标注、不进历史曲线）；判改关闭时整块不渲染 */}
            {writingGradeSlot}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
              <button className="btn-dark" onClick={retryTest}>清空答案并再练一次</button>
              <button className="btn-ok" onClick={exportMd}>Export answers (.md)</button>
              <button className="btn-dark" style={{ background: '#44474c' }} onClick={() => setScreen('home')}>Back to library</button>
            </div>
          </div>
        </div>
      )}

      {/* 交卷前检查：未答 / Flag / 写作词数；确认后才真正收卷 */}
      {submitReview && (
        <SubmitReviewModal
          skill={submitReview.skill}
          testName={test.name}
          scopeLabel={scopeLabel}
          elapsedSec={Math.round(currentElapsedMs() / 1000)}
          fullTransition={submitReview.fullTransition}
          summary={submitReview.summary}
          actionLabel={finishLabel}
          onJump={no => { setSubmitReview(null); jump(no); }}
          onClose={() => setSubmitReview(null)}
          onConfirm={() => { setSubmitReview(null); endTest(); }}
        />
      )}

      {/* 判改模型配置弹窗：开考前(pre) / 交卷后现场判改(post)；节点在组件顶部构造，两条渲染路径共用 */}
      {gradeModalNode}

      {/* 精读：全屏 overlay（盖在成绩单之上，关闭后回到成绩单） */}
      {intensiveNode}

      {/* 精听：全屏 overlay（同精读档位） */}
      {listenLabNode}

      {/* Hide 屏（时间照走） */}
      {hidden && (
        <div className="hidden-screen">
          <div style={{ fontSize: 18 }}>Screen hidden — time is still running.</div>
          <button className="btn-ok" onClick={() => setHidden(false)}>Resume</button>
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Settings</h2>
            <div className="row">
              <label>Text size</label>
              <select value={fontSize} onChange={e => setFontSize(e.target.value as typeof fontSize)}>
                <option value="std">Regular</option>
                <option value="lg">Large</option>
                <option value="xl">Extra large</option>
              </select>
            </div>
            <div className="row">
              <label>Colour scheme</label>
              <select value={scheme} onChange={e => setScheme(e.target.value as typeof scheme)}>
                <option value="bow">Black on white</option>
                <option value="wob">White on black</option>
                <option value="yob">Yellow on black</option>
              </select>
            </div>
            <div className="row">
              <label>Brightness</label>
              <input
                type="range"
                min={50}
                max={100}
                value={brightness}
                onChange={e => setBrightness(Number(e.target.value))}
                style={{ flex: 1 }}
              />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
              <button className="btn-ok" onClick={() => setShowSettings(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Help */}
      {showHelp && (
        <div className="overlay" onClick={() => setShowHelp(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Help</h2>
            <p><b>Highlight</b> — select text and the toolbar pops up; pick yellow / green / pink (or Ctrl+H for quick yellow).</p>
            <p><b>Notes</b> — select text → "Add note" on the toolbar (or Ctrl+M). The note box floats next to the text; Save to keep, Delete to remove, ✕ to just close.</p>
            <p><b>Strikethrough</b> — select text, Ctrl+S.</p>
            <p><b>Remove highlight</b> — click a highlight and choose "Remove highlight", or "Clear all" to wipe everything.</p>
            <p><b>Flag</b> — the "⚑ Flag" button in the top bar flags the question you are working on; a circle appears on its number below.</p>
            <p><b>Matching</b> — drag an option into its slot, or click the option then click the slot; click a placed option to take it back.</p>
            <p>Copy &amp; paste (Ctrl+C / Ctrl+V) works in the Writing answer box.</p>
            <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
              <button className="btn-ok" onClick={() => setShowHelp(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
