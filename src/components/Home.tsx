import { useEffect, useMemo, useRef, useState } from 'react';
import extractPromptMd from '../prompts/extract.md?raw';
import type { SessionConfig, StoredTest } from '../lib/store';
import { deleteTest, hydrateTest, listTests, loadLlmConfig, migrateInlineImages, offloadImages, saveLlmConfig, saveTest, stripInlineImages } from '../lib/store';
import { extractTextPages, isGarbled, parsePageRange, renderPages, sha256Hex } from '../lib/pdf';
import { PRESET_DEEPSEEK, PRESET_GLM4V, PRESET_KIMI, runExtraction, transcribePage, type LlmSlot } from '../lib/llm';
import { adaptExtracted } from '../lib/adapter';
import { validateExtracted } from '../lib/validate';
import { exportZip, importZip } from '../lib/zipPack';
import { saveAudio } from '../lib/media';
import { serverAvailable, syncFromServer, syncWritingFromServer, uploadPackCopy } from '../lib/serverSync';
import type { ExtractedTest } from '../types/extracted';
import FixModal from './FixModal';
import type { FixTab } from './FixModal';
import StartModal from './StartModal';
import HistoryDetailModal from './HistoryDetailModal';
import { ADVANCED, WRITING_GRADING } from '../lib/features';
import { clearRecords, fmtDuration, listRecords, removeRecord, scopeName, type PracticeRecord } from '../lib/history';
import { deleteIntensive, ivKey, listIntensiveMeta, loadIntensive, normalizeIntensiveImport, saveIntensive, syncWordbookFromServer, type IntensiveMeta, type WordbookEntry } from '../lib/intensive';
import { listListenMeta, syncLWordsFromServer, type ListenMeta, type LWord } from '../lib/listenLab';
import ListenLabPicker from './ListenLabPicker';
import FlashcardDeck from './FlashcardDeck';
import ActiveSessionCard from './ActiveSessionCard';
import ReviewCenter from './ReviewCenter';
import AnalyticsView from './AnalyticsView';
import VocabularyCenter from './VocabularyCenter';
import DataManager from './DataManager';
import GlobalSearch from './GlobalSearch';
import type { ActiveSessionMeta } from '../lib/activeSession';
import {
  adoptLegacyTimer, clearActiveSession, discardSession, hasLooseAnswers, isSessionEnded,
  listActiveSessions, loadActiveSession, loadLegacyTimer, saveActiveSession,
} from '../lib/activeSession';
import { syncLearningFromServer, loadLearningData } from '../lib/learningStore';
import { reviewStats } from '../lib/review';
import { clearWritingAttempts, deleteWritingAttempt } from '../lib/writingHistory';
import { buildVocabularyItems } from '../lib/vocabulary';
import type { QuestionType } from '../types';

const MAX_BATCH = 10;   // 一次最多导入的题包数

/** 这条记录里有没有逐题明细（只有最近 20 条会存 table；老记录没有这个字段） */
const hasTableDetail = (r: PracticeRecord) => !!(r.listening?.table?.length || r.reading?.table?.length);
/** 可点开详情的记录：有逐题表，或写作（正文/判改） */
const hasDetail = (r: PracticeRecord) => hasTableDetail(r) || !!r.writing || !!r.writingGrade;

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** 由 scope 推一套默认配置（旧 timer 恢复 / 「尝试继续」无范围信息时使用） */
function configForScope(scope: unknown, passageIdx = 0): SessionConfig {
  const s = scope === 'passage' || scope === 'lsection' || scope === 'listening'
    || scope === 'writing' || scope === 'full' || scope === 'reading'
    ? scope : 'reading';
  const minutes = s === 'passage' ? 20 : s === 'lsection' ? 10 : s === 'listening' ? 32 : 60;
  return {
    scope: s,
    passageIdx,
    minutes,
    writingMinutes: 60,
    ...(s === 'listening' || s === 'lsection' || s === 'full' ? { listeningMode: 'real' as const } : {}),
  };
}

type Panel = 'analytics' | 'review' | 'vocabulary' | 'data' | null;

interface Props {
  demoTest: StoredTest;
  /** 统一开考入口：intent='resume' 时按 active-session 恢复，不再让用户重选范围 */
  onStart: (t: StoredTest, s: SessionConfig, intent?: 'new' | 'resume') => void;
  /** 打开精读界面（精读记录行 / 词汇册跳原文）；fromRecords 由 App 固定为 true */
  onOpenIntensive: (t: StoredTest, passageIdx: number, focusNoteId?: string) => void;
  /** 打开精听界面（精听记录行 / 篇目选择器） */
  onOpenListenLab: (t: StoredTest, sectionIdx: number) => void;
  /** 精读界面关闭时 +1：重新拉精读记录与词汇册计数 */
  ivRefresh: number;
  /** 精听界面关闭时 +1：重新拉精听记录 */
  llRefresh: number;
}

export default function Home({ demoTest, onStart, onOpenIntensive, onOpenListenLab, ivRefresh, llRefresh }: Props) {
  const [cfg, setCfg] = useState(loadLlmConfig);
  const [tests, setTests] = useState<StoredTest[]>(listTests);
  const [testNumber, setTestNumber] = useState(1);
  const [includeAnswers, setIncludeAnswers] = useState(false);
  const [pageRange, setPageRange] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [fixing, setFixing] = useState<StoredTest | null>(null);
  const [fixTab, setFixTab] = useState<FixTab>('reading');
  const [importErrors, setImportErrors] = useState<{ source: string; errors: string[] } | null>(null);
  const [starting, setStarting] = useState<StoredTest | null>(null);
  const [startChoice, setStartChoice] = useState<{ test: StoredTest; meta: ActiveSessionMeta } | null>(null);
  const [looseChoice, setLooseChoice] = useState<StoredTest | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [records, setRecords] = useState<PracticeRecord[]>(listRecords);
  const [detail, setDetail] = useState<PracticeRecord | null>(null);   // 「看详情」弹层里的那条记录
  const [recSkill, setRecSkill] = useState<'all' | 'reading' | 'listening' | 'writing'>('all');
  const [recRange, setRecRange] = useState<'all' | '7' | '30'>('all');
  const [ivMetas, setIvMetas] = useState<IntensiveMeta[]>([]);       // 精读记录列表
  const [wbEntries, setWbEntries] = useState<WordbookEntry[]>([]);   // 精读词汇册条目
  const [llMetas, setLlMetas] = useState<ListenMeta[]>([]);            // 精听记录列表
  const [lwEntries, setLwEntries] = useState<LWord[]>([]);             // 精听生词
  const [showLlPicker, setShowLlPicker] = useState(false);             // 精听篇目三级选择弹层
  const [showCfg, setShowCfg] = useState(false);                       // 高级设置（模型配置）默认折叠
  const [openBooks, setOpenBooks] = useState<Set<string> | null>(null);      // 题库分组展开；null=只开最新一册
  const [recTab, setRecTab] = useState<'iv' | 'll'>('iv');             // 学习记录卡内的 tab
  const [showAllRecs, setShowAllRecs] = useState(false);               // 练习记录默认只显示 5 条
  const [panel, setPanel] = useState<Panel>(null);
  const [reviewInit, setReviewInit] = useState<{ skill?: 'reading' | 'listening'; type?: QuestionType }>({});
  const [reviewBackTo, setReviewBackTo] = useState<Panel>(null);
  const [reviewSeq, setReviewSeq] = useState(0);
  const [vocabKey, setVocabKey] = useState<string | undefined>(undefined);
  const [learningTick, setLearningTick] = useState(0);
  const [sessionTick, setSessionTick] = useState(0);
  const [restoreTick, setRestoreTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const ivImportRef = useRef<HTMLInputElement>(null);   // 精读 JSON 导入

  const say = (line: string) => setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ${line}`]);
  const persistCfg = (next: typeof cfg) => { setCfg(next); saveLlmConfig(next); };
  /** 列表里的题包要"补回 IndexedDB 里的题图"再展示/开考 */
  const refresh = async () => {
    const raw = listTests();
    const full = await Promise.all(raw.map(hydrateTest));
    setTests(full);
  };
  /** 写入 localStorage。配额溢出时先自动迁移旧题包的图片，再重试一次；仍不够才提示用户删旧题包。 */
  const persistTest = async (t: StoredTest) => {
    try {
      saveTest(t);
      return true;
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      const quota = (e as DOMException)?.name === 'QuotaExceededError' || /quota|exceeded/i.test(msg);
      if (!quota) {
        say(`保存失败：${msg}`);
        return false;
      }
      say('本地存储已满，正在把旧题包的图片搬到 IndexedDB 腾空间…');
      try { await migrateInlineImages(); } catch { /* 忽略，继续尝试 */ }
      try {
        saveTest(t);
        say('已腾出空间并保存。');
        return true;
      } catch {
        say('本地存储仍然不够：请在「我的题库」里删除不再需要的旧题包，然后重新导入。');
        return false;
      }
    }
  };

  /* 启动时：先从启动器的本地文件夹恢复题库/练习记录/写作答卷/学习数据，
     再做一次性迁移：把历史版本内联在 localStorage 里的题图搬到 IndexedDB，腾出配额 */
  useEffect(() => {
    (async () => {
      try {
        if (await serverAvailable()) {
          const restored = await syncFromServer();
          if (restored) say('已与本地文件夹同步题库与练习记录。');
          const w = await syncWritingFromServer();
          if (w) say('已从本地文件夹恢复写作答卷。');
        }
        await syncLearningFromServer();
        const migrated = await migrateInlineImages();
        if (migrated) say('已把旧题包的图片移到 IndexedDB，释放了本地存储空间。');
      } catch { /* 忽略：不影响使用 */ }
      await refresh();
      setRecords(listRecords());
      setLearningTick(t => t + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 精读记录 + 词汇句子册：挂载时拉一次，精读界面关闭（ivRefresh 变化）后刷新 */
  const loadIntensiveData = async () => {
    try {
      setIvMetas(await listIntensiveMeta());
      setWbEntries(await syncWordbookFromServer());
    } catch { /* 忽略：不影响首页其他区块 */ }
  };
  useEffect(() => { void loadIntensiveData(); }, [ivRefresh, restoreTick]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* 精听记录 + 生词本：挂载时拉一次，精听界面关闭（llRefresh 变化）后刷新 */
  const loadListenData = async () => {
    try {
      setLlMetas(await listListenMeta());
      setLwEntries(await syncLWordsFromServer());
    } catch { /* 忽略：不影响首页其他区块 */ }
  };
  useEffect(() => { void loadListenData(); }, [llRefresh, restoreTick]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* 统一词条模型：精读词汇册 + 精听生词合并（忽略大小写），供翻卡/搜索/词汇中心共用 */
  const vocabItems = useMemo(() => buildVocabularyItems(wbEntries, lwEntries), [wbEntries, lwEntries]);

  const lastIv = ivMetas[0] ?? null;   // 两个列表本身按 updatedAt 倒序
  const lastLl = llMetas[0] ?? null;

  /* 未完成练习：以题库为准逐套读取，最近更新在前 */
  const sessions = useMemo(() => listActiveSessions(tests), [tests, sessionTick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const sessionFor = (id: string) => sessions.find(s => s.testId === id);

  const reviewCounts = useMemo(() => {
    void learningTick;
    return reviewStats(loadLearningData().reviewItems);
  }, [learningTick]);

  /** 精读记录/词汇册按 testId 找回题包（demo 不在题库列表里，单独判断） */
  const findTest = (id: string): StoredTest | undefined =>
    id === demoTest.id ? demoTest : tests.find(x => x.id === id);

  /* ---------- 统一开考入口（继续卡 / 题库 / 搜索共用） ---------- */

  const resumeWith = (meta: ActiveSessionMeta, t: StoredTest) => onStart(t, meta.config, 'resume');
  const restartWith = (meta: ActiveSessionMeta, t: StoredTest) => {
    discardSession(t.id);
    clearActiveSession(t.id);
    setSessionTick(x => x + 1);
    onStart(t, meta.config, 'new');
  };

  /** 把旧版 timer 存档升级成 v1 active-session（只有它才能被自动识别为可恢复） */
  const withLegacy = (t: StoredTest): ActiveSessionMeta | null => {
    const existing = loadActiveSession(t.id);
    if (existing) return existing;
    const lt = loadLegacyTimer(t.id);
    if (!lt) return null;
    const base = configForScope(lt.scope);
    const fullWithListening = base.scope === 'full' && !!t.listening?.sections?.length;
    const cfg2: SessionConfig = {
      ...base,
      ...(base.scope === 'listening' || base.scope === 'lsection' || fullWithListening
        ? { listeningMode: lt.mode === 'listening' ? 'real' as const : 'practice' as const }
        : {}),
    };
    const meta = adoptLegacyTimer(t.id, lt, cfg2);
    setSessionTick(x => x + 1);
    say(`已把 ${t.name} 的旧版未完成进度升级为可继续的会话。`);
    return meta;
  };

  /** 题库「开始/继续」与搜索结果：有 active session 时统一弹出三选一 */
  const startPractice = (t: StoredTest) => {
    const meta = withLegacy(t);
    if (meta) { setStartChoice({ test: t, meta }); return; }
    // 已交卷留下的作答不算"未完成进度"，直接进入开始弹窗
    if (!isSessionEnded(t.id) && hasLooseAnswers(t.id)) { setLooseChoice(t); return; }
    setStarting(t);
  };

  /** 只有非空作答、没有 timer：只能让用户决定「尝试继续」或「清除后开始」，不猜测 */
  const continueLoose = (t: StoredTest) => {
    const lans = readStored<Record<string, unknown>>(`ielts15-${t.id}-lanswers`, {});
    const essays = readStored<string[]>(`ielts15-${t.id}-essays`, ['', '']);
    const hasL = Object.values(lans).some(v => String(v ?? '').trim() !== '');
    const hasW = essays.some(e => String(e ?? '').trim() !== '');
    const scope: SessionConfig['scope'] = hasL ? 'listening' : hasW ? 'writing' : 'reading';
    const now = Date.now();
    const meta: ActiveSessionMeta = {
      version: 1,
      testId: t.id,
      startedAt: now,
      updatedAt: now,
      config: { ...configForScope(scope), ...(scope === 'listening' ? { listeningMode: 'practice' as const } : {}) },
      mode: scope === 'listening' ? 'listening' : scope === 'writing' ? 'writing' : 'reading',
      fullPhase: 'reading',
      current: 1,
      partIdx: 0,
      wPart: 0,
      untimed: scope === 'listening',
    };
    saveActiveSession(meta);
    setLooseChoice(null);
    setSessionTick(x => x + 1);
    resumeWith(meta, t);
  };

  const clearLoose = (t: StoredTest) => {
    discardSession(t.id);
    setLooseChoice(null);
    setSessionTick(x => x + 1);
    setStarting(t);
  };

  /* 学习数据变更（复盘/词汇）后刷新徽标 */
  const bumpLearning = () => setLearningTick(t => t + 1);

  /* 题库按册分组（保持 tests 原有的新旧排序），默认只展开最新一册，其余册折叠成一行 */
  const bookGroups: { book: string; items: StoredTest[] }[] = [];
  for (const t of tests) {
    const book = t.name.split('·')[0]?.trim() || t.name;
    const g = bookGroups.find(x => x.book === book);
    if (g) g.items.push(t); else bookGroups.push({ book, items: [t] });
  }
  const bookOpen = (book: string, idx: number) => (openBooks ? openBooks.has(book) : idx === 0);
  const toggleBook = (book: string, idx: number) => {
    const cur = new Set(openBooks ?? new Set(bookGroups[0] ? [bookGroups[0].book] : []));
    if (bookOpen(book, idx)) cur.delete(book); else cur.add(book);
    setOpenBooks(cur);
  };

  const reviewEntries = vocabItems
    .filter(it => it.kind === 'word')
    .map(it => ({
      id: it.key,
      kind: 'word' as const,
      text: it.text,
      note: it.note,
      phonetic: it.phonetic,
      gloss: it.gloss,
      sentence: it.sentence,
      context: it.context,
      source: [it.reading ? `精读：${it.reading.testName} · Passage ${it.reading.passageIdx + 1}` : '',
        it.listening ? `精听：${it.listening.testName} · Section ${it.listening.section}` : ''].filter(Boolean).join('；'),
    }));

  /* ---------- 精读 JSON 导入（精读记录区的入口，文件即 精读记录\ 下的单篇格式） ---------- */
  async function handleImportIntensive(file: File) {
    try {
      const f = normalizeIntensiveImport(JSON.parse(await file.text()));
      if (!f) { say('导入被拒：不是合法的精读文件（需要 testId / passageIdx / notes 结构）'); return; }
      const t = findTest(f.testId);
      if (t) {   // 套题名与篇名以本地题库为准补全
        f.testName = t.name;
        f.passageTitle = t.passages[f.passageIdx]?.title ?? f.passageTitle;
      } else {
        say(`提示：题库里没有 ${f.testId} 这套题，记录照存，但「打开精读」要在导入该题包后才能用`);
      }
      const existing = await loadIntensive(ivKey(f.testId, f.passageIdx));
      if (existing && existing.notes.length > 0
        && !confirm(`这篇已有 ${existing.notes.length} 条批注，导入将覆盖。继续？`)) return;
      saveIntensive(f);   // 落 localStorage + 镜像到 精读记录\ + 联动词汇册
      await loadIntensiveData();
      say(`已导入精读：${f.testName} · Passage ${f.passageIdx + 1}（${f.notes.length} 条批注）`);
    } catch (e) {
      say(`导入被拒：${(e as Error).message}`);
    } finally {
      if (ivImportRef.current) ivImportRef.current.value = '';
    }
  }

  const slotOk = (s: LlmSlot) => !!(s.baseUrl && s.apiKey && s.model);

  /* ---------- 通道 B：内置 API 抽取 ---------- */
  async function handleExtract(file: File) {
    if (!slotOk(cfg.text)) {
      say('请先填写文本模型的 Base URL / Key / 模型名');
      return;
    }
    setBusy(true);
    try {
      say(`读取 ${file.name}…`);
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);
      const id = hash.slice(0, 12);
      if (tests.some(t => t.id === id)) {
        say('该文件已抽取过（命中缓存），未重复消耗 token');
        return;
      }
      const range = parsePageRange(pageRange);
      if (pageRange.trim() && !range) say('页码范围格式无效，按整本处理');

      say('解析 PDF 文字层…');
      const { pages } = await extractTextPages(buf, range);

      // 逐页检测乱码/空页 → 仅问题页渲染成图走视觉模型转录
      const bad = pages.filter(p => isGarbled(p.text));
      if (bad.length > 0) {
        say(`检测到 ${bad.length} 页文字层损坏/扫描页（第 ${bad.map(p => p.page).join(',')} 页）`);
        if (!slotOk(cfg.vision)) {
          throw new Error('上述页面需要视觉模型兜底转录，请在配置区填写视觉模型（可用 GLM-4V 预设）后重试');
        }
        const images = await renderPages(buf, bad.map(p => p.page));
        for (const im of images) {
          say(`视觉模型转录第 ${im.page} 页…`);
          const text = await transcribePage(cfg.vision, im);
          const target = pages.find(p => p.page === im.page);
          if (target) target.text = text.trim();
        }
        say('问题页转录完成，合并全文');
      } else {
        say(`文字层完好（${pages.length} 页），无需视觉模型`);
      }

      const raw = await runExtraction(
        cfg.text,
        { testNumber, includeAnswers, pageHint: pageRange.trim() || undefined },
        { kind: 'text', pages },
        say,
      );
      const ex = raw as ExtractedTest;
      const v = validateExtracted(ex);
      if (v.errors.length) {
        v.errors.forEach(e => say(`校验失败：${e}`));
        throw new Error('抽取结果未通过完整性校验，请重试或缩小页码范围');
      }
      const adapted = adaptExtracted(ex);
      const t: StoredTest = {
        id,
        name: `${ex.book || file.name.replace(/\.pdf$/i, '')} · Test ${ex.test_number ?? testNumber}`,
        fileHash: hash,
        source: 'llm',
        createdAt: Date.now(),
        extracted: ex,
        passages: adapted.passages,
        writingTasks: adapted.writingTasks,
        answers: adapted.answers,
        issues: [...(ex.uncertain ?? []), ...v.warnings, ...adapted.issues],
      };
      saveTest(stripInlineImages(t));
      refresh();
      say(`抽取完成：阅读 ${t.passages.length} 篇，写作 2 个 Task`);
      if (t.issues.length) say(`有 ${t.issues.length} 条待确认项，请点击该套题的「修正」处理`);
    } catch (e) {
      say(`失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /* ---------- 通道 A：导入 / 粘贴 JSON（默认推荐路径） ---------- */
  function importJsonObject(ex: ExtractedTest, sourceName: string) {
    const v = validateExtracted(ex);
    if (v.errors.length) {
      reportImportErrors(v.errors, `${ex.book || sourceName} · Test ${ex.test_number ?? '?'}`);
      return;
    }
    const adapted = adaptExtracted(ex);
    const t: StoredTest = {
      id: `import-${Date.now().toString(36)}`,
      name: `${ex.book || sourceName} · Test ${ex.test_number ?? '?'}`,
      source: 'import',
      createdAt: Date.now(),
      extracted: ex,
      passages: adapted.passages,
      writingTasks: adapted.writingTasks,
      answers: adapted.answers,
      issues: [...(ex.uncertain ?? []), ...v.warnings, ...adapted.issues],
    };
    void (async () => {
      await offloadImages(t);
      saveTest(stripInlineImages(t));
      refresh();
    })();
    say(`已导入 ${t.name}${v.warnings.length ? `（${v.warnings.length} 条提示，见「修正」）` : ''}`);
  }

  async function handleImportFile(file: File) {
    setBusy(true);
    try {
      importJsonObject(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
    } catch (e) {
      say(`导入被拒：JSON 不合法（${(e as Error).message}）`);
    } finally {
      setBusy(false);
      if (jsonRef.current) jsonRef.current.value = '';
    }
  }

  /* ---------- 导入错误分级：≤5 条一次性全列；>5 条生成修复日志发给 AI ---------- */
  function reportImportErrors(errors: string[], source: string) {
    if (!errors.length) return;
    if (errors.length <= 5) {
      setImportErrors({ source, errors });
      say(`导入被拒：${source} 共 ${errors.length} 处问题，已在上方红框中全部列出`);
    } else {
      const logText = [
        `# 导入错误日志 — ${source}`,
        `时间：${new Date().toLocaleString()}`,
        `共 ${errors.length} 处结构问题：`,
        '',
        ...errors.map((e, i) => `${i + 1}. ${e}`),
        '',
        '—— 把这个文件发给 AI，让它按上述问题逐条修正抽取结果，重新导出 JSON 后再导入。',
      ].join('\n');
      const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `导入错误日志-${source.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      setImportErrors({ source, errors: [...errors.slice(0, 5), `…其余 ${errors.length - 5} 条已写入下载的日志文件，请发给 AI 按日志修正`] });
      say(`共 ${errors.length} 处问题，已生成错误日志文件（见下载），发给 AI 按日志修正后重新导入`);
    }
  }

  /* ---------- zip 题包 ---------- */
  async function handleImportZip(file: File) {
    setBusy(true);
    try {
      say(`读取题包 ${file.name}…`);
      // 历史版本可能把题图内联在 localStorage 里（几套题就能占满 5 MB 配额）：导入前先迁一次
      try { await migrateInlineImages(); } catch { /* 忽略，不影响导入 */ }
      const { extracted, warnings, listening, audio, figureImage } = await importZip(file);
      warnings.forEach(w => say(`提示：${w}`));
      const v = validateExtracted(extracted);
      if (v.errors.length) {
        reportImportErrors(v.errors, file.name.replace(/\.zip$/i, ''));
        return;
      }
      const adapted = adaptExtracted(extracted);
      if (figureImage && adapted.writingTasks[0]) adapted.writingTasks[0].figureImage = figureImage;
      const id = `pack-${Date.now().toString(36)}`;
      // 音频入 IndexedDB（体积大，不进 localStorage）
      for (const [secNo, blob] of Object.entries(audio)) {
        await saveAudio(`${id}/s${secNo}`, blob);
      }
      // 整场音频已按用户要求不支持：音频一律"每节一个文件"

      const t: StoredTest = {
        id,
        name: `${extracted.book} · Test ${extracted.test_number}`,
        source: 'import',
        createdAt: Date.now(),
        extracted,
        passages: adapted.passages,
        writingTasks: adapted.writingTasks,
        answers: adapted.answers,
        issues: [...(extracted.uncertain ?? []), ...v.warnings, ...adapted.issues],
        ...(listening ? { listening } : {}),
      };
      // 题图（地图/平面图/流程图/写作图表）搬进 IndexedDB：localStorage 只留槽位，否则几套题就超配额
      await offloadImages(t);
      if (await persistTest(stripInlineImages(t))) {
        refresh();
        say(`题包导入完成：${t.name}${listening ? `（含听力 ${listening.sections.length} 个 section）` : ''}`);
        uploadPackCopy(file.name, file);   // zip 原文件备份一份到启动器目录
      }
    } catch (e) {
      say(`题包导入失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (zipRef.current) zipRef.current.value = '';
    }
  }

  /** 一次拖入/选择多个题包：最多 10 个，逐个导入 */
  async function handleImportZips(files: File[]) {
    const zips = files.filter(f => /\.zip$/i.test(f.name));
    if (!zips.length) { say('只支持 .zip 题包文件'); return; }
    const list = zips.slice(0, MAX_BATCH);
    if (zips.length > MAX_BATCH) say(`一次最多导入 ${MAX_BATCH} 个题包，本次只处理前 ${MAX_BATCH} 个`);
    for (let i = 0; i < list.length; i++) {
      say(`—— 第 ${i + 1}/${list.length} 个：${list[i].name}`);
      await handleImportZip(list[i]);
    }
    if (list.length > 1) say(`本批 ${list.length} 个题包处理完毕`);
  }

  async function handleExportZip(t: StoredTest) {
    try {
      const blob = await exportZip(t);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${t.name.replace(/[\/:*?"<>|]/g, '_')}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      say(`已导出 ${a.download}（含听力音频、全部题图与答案，可直接再导入）`);
    } catch (e) {
      say(`导出失败：${(e as Error).message}`);
    }
  }

  function handleImportPasted() {
    if (!pasted.trim()) return;
    try {
      importJsonObject(JSON.parse(pasted), '粘贴导入');
      setPasted('');
    } catch (e) {
      say(`导入被拒：JSON 不合法（${(e as Error).message}）`);
    }
  }

  function downloadPrompt() {
    const blob = new Blob([extractPromptMd], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '题目PDF抽取_提示词.md';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const slotForm = (key: 'text' | 'vision' | 'grader', preset: LlmSlot, presetLabel: string) => (
    <>
      <label>Base URL</label>
      <span style={{ display: 'flex', gap: 8 }}>
        <input placeholder={preset.baseUrl} value={cfg[key].baseUrl}
          onChange={e => persistCfg({ ...cfg, [key]: { ...cfg[key], baseUrl: e.target.value } })} />
        <button type="button" className="preset-btn" onClick={() => persistCfg({ ...cfg, [key]: { ...cfg[key], baseUrl: preset.baseUrl, model: preset.model } })}>
          {presetLabel}
        </button>
      </span>
      <label>API Key</label>
      <input type="password" placeholder="sk-…" value={cfg[key].apiKey}
        onChange={e => persistCfg({ ...cfg, [key]: { ...cfg[key], apiKey: e.target.value } })} />
      <label>模型名</label>
      <input placeholder={preset.model} value={cfg[key].model}
        onChange={e => persistCfg({ ...cfg, [key]: { ...cfg[key], model: e.target.value } })} />
    </>
  );

  /* ---------- 记录筛选与删除 ---------- */
  const rangeCut = recRange === 'all' ? 0 : Date.now() - Number(recRange) * 24 * 60 * 60 * 1000;
  const recordsFiltered = records
    .filter(r => rangeCut === 0 || r.at >= rangeCut)
    .filter(r =>
      recSkill === 'all'
      || (recSkill === 'reading' && !!r.reading)
      || (recSkill === 'listening' && !!r.listening)
      || (recSkill === 'writing' && !!r.writing));
  const recordsShown = showAllRecs ? recordsFiltered : recordsFiltered.slice(0, 5);

  const deleteRecord = async (r: PracticeRecord) => {
    if (!confirm(`删除这条练习记录？\n\n${new Date(r.at).toLocaleString()} · ${r.testName}\n\n同场的写作答卷正文会一并删除；错题复盘与词汇学习数据保留。`)) return;
    removeRecord(r.id);
    try { await deleteWritingAttempt(r.id); } catch { /* 正文可能本就没有 */ }
    setRecords(listRecords());
  };

  const clearAllRecords = async () => {
    if (!confirm('清空全部练习记录？\n\n所有逐题明细、写作答卷正文会一并清空；错题复盘与词汇学习数据保留。\n建议先在「数据管理」里创建备份。')) return;
    clearRecords();
    try { await clearWritingAttempts(); } catch { /* 忽略 */ }
    setRecords([]);
  };

  const navHidden = tests.length === 0 && records.length === 0 && reviewCounts.total === 0;
  const newUser = tests.length === 0 && records.length === 0;

  return (
    <div className="home-wrap">
      <header className="home-hero">
        <div className="hero-text">
          <h1>英语机考模拟器</h1>
          <p>导入题包即可开始练习 · 所有数据只保存在你自己的电脑上</p>
        </div>
        <div className="hero-right">
          <GlobalSearch
            tests={tests}
            records={records}
            vocabulary={vocabItems}
            onPickTest={id => { const t = findTest(id); if (t) startPractice(t); }}
            onPickRecord={id => { const r = records.find(x => x.id === id); if (r) setDetail(r); }}
            onPickVocabulary={key => { setVocabKey(key); setPanel('vocabulary'); }}
          />
          <button className="hero-btn" onClick={() => setPanel('data')} title="全量备份与恢复">数据管理</button>
          {(ADVANCED || WRITING_GRADING) && (
            <button className="hero-btn" aria-pressed={showCfg} onClick={() => setShowCfg(v => !v)}>高级设置</button>
          )}
        </div>
      </header>

      <nav className="home-nav" aria-label="主导航">
        <button className="on" onClick={() => setPanel(null)}>练习首页</button>
        {!navHidden && (
          <>
            <button onClick={() => setPanel('analytics')}>学习分析</button>
            <button onClick={() => { setReviewInit({}); setReviewSeq(n => n + 1); setReviewBackTo(null); setPanel('review'); }}>
              错题复盘{reviewCounts.pending > 0 ? <em>{reviewCounts.pending}</em> : null}
            </button>
          </>
        )}
        <button onClick={() => { setVocabKey(undefined); setPanel('vocabulary'); }}>
          词汇复习
        </button>
        <span className="home-nav-spacer" />
        <span className="home-nav-meta">{tests.length} 套题 · {records.length} 场练习</span>
      </nav>

      {!newUser && (
        <ActiveSessionCard
          sessions={sessions}
          tests={tests}
          onContinue={(m, t) => resumeWith(m, t)}
          onRestart={(m, t) => restartWith(m, t)}
          onDiscard={() => setSessionTick(x => x + 1)}
        />
      )}

      {newUser ? (
        <section className="home-card first-run" aria-label="开始使用">
          <h2>导入题包</h2>
          <div
            className={'dropbar' + (dragOver ? ' over' : '') + (busy ? ' disabled' : '')}
            onDragOver={e => { e.preventDefault(); if (!busy) setDragOver(true); }}
            onDragEnter={e => { e.preventDefault(); if (!busy) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              if (busy) return;
              const fs = Array.from(e.dataTransfer?.files ?? []);
              if (fs.length) handleImportZips(fs);
            }}
            onClick={() => { if (!busy) zipRef.current?.click(); }}
            onKeyDown={e => {
              if (!busy && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                zipRef.current?.click();
              }
            }}
            role="button"
            aria-disabled={busy}
            tabIndex={busy ? -1 : 0}
          >
            <input ref={zipRef} type="file" accept=".zip,application/zip" multiple hidden
              onChange={e => {
                const fs = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (fs.length) handleImportZips(fs);
              }} />
            <span className="db-icon">{dragOver ? '📥' : '⬆'}</span>
            <span>{busy ? '正在导入，请稍候…' : (dragOver ? '松手即可导入' : '把 .zip 题包拖到这里，或点击选择文件（一次最多 10 个）')}</span>
          </div>
          <p className="first-run-hint">
            文件只保存在本机 · 支持一次批量导入 · 导入后点「开始练习」即可作答。
            练习后可以做：成绩复盘 · 精读 · 精听 · 单词复习 · 错题复盘。
          </p>
          <div className="first-run-steps">
            <div><b>1</b> 导入 .zip 题包</div>
            <div><b>2</b> 在「我的题库」点开始练习</div>
            <div><b>3</b> 交卷后看成绩与复盘</div>
          </div>
        </section>
      ) : (
        <div className="home-workspace">
          <section className="import-strip" aria-label="导入题包">
            <div
              className={'dropbar' + (dragOver ? ' over' : '') + (busy ? ' disabled' : '')}
              onDragOver={e => { e.preventDefault(); if (!busy) setDragOver(true); }}
              onDragEnter={e => { e.preventDefault(); if (!busy) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                if (busy) return;
                const fs = Array.from(e.dataTransfer?.files ?? []);
                if (fs.length) handleImportZips(fs);
              }}
              onClick={() => { if (!busy) zipRef.current?.click(); }}
              onKeyDown={e => {
                if (!busy && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  zipRef.current?.click();
                }
              }}
              role="button"
              aria-disabled={busy}
              tabIndex={busy ? -1 : 0}
            >
              <input ref={zipRef} type="file" accept=".zip,application/zip" multiple hidden
                onChange={e => {
                  const fs = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (fs.length) handleImportZips(fs);
                }} />
              <span className="db-icon">{dragOver ? '📥' : '⬆'}</span>
              <span>{busy ? '正在导入，请稍候…' : (dragOver ? '松手即可导入' : '把 .zip 题包拖到这里，或点击选择文件（一次最多 10 个）')}</span>
            </div>
          </section>

          {(ADVANCED || WRITING_GRADING) && showCfg && (
            <section className="home-card cfg-card open">
              <h2 className="fold-head" role="button" tabIndex={0} aria-expanded={true}
                onClick={() => setShowCfg(false)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowCfg(false); } }}
              >
                高级：模型配置 ▾
                <small>
                  文本模型 {slotOk(cfg.text) ? '✓ 已配置' : '未配置'} · 判改模型 {slotOk(cfg.grader) ? '✓ 已配置' : '未配置'}
                </small>
              </h2>
              <>
                {ADVANCED && (
                  <>
                    <h3 className="slot-title">导入 JSON / 抽取提示词</h3>
                    <div className="home-form">
                      <label>导入 .json 文件</label>
                      <input ref={jsonRef} type="file" accept="application/json" disabled={busy}
                        onChange={e => e.target.files?.[0] && handleImportFile(e.target.files[0])} />
                      <label>或粘贴 JSON</label>
                      <span>
                        <textarea className="paste-box" rows={3} placeholder='{"book": "…", "reading": {"passages": […'
                          value={pasted} onChange={e => setPasted(e.target.value)} disabled={busy} />
                      </span>
                      <label></label>
                      <span style={{ display: 'flex', gap: 10 }}>
                        <button className="preset-btn" disabled={busy || !pasted.trim()} onClick={handleImportPasted}>导入粘贴内容</button>
                        <button className="preset-btn" onClick={downloadPrompt}>下载抽取提示词</button>
                      </span>
                    </div>
                  </>
                )}
                {ADVANCED && (
                  <>
                    <h3 className="slot-title">内置 API 抽取（PDF → 题包）</h3>
                    <div className="home-form">{slotForm('text', PRESET_DEEPSEEK, 'DeepSeek 预设')}</div>
                    <h3 className="slot-title">视觉模型（可选，仅乱码/扫描页兜底）</h3>
                    <div className="home-form">{slotForm('vision', PRESET_GLM4V, 'GLM-4V 预设')}</div>
                    <div className="home-form" style={{ marginTop: 8 }}>
                      <label>PDF 文件</label>
                      <input ref={fileRef} type="file" accept="application/pdf" disabled={busy}
                        onChange={e => e.target.files?.[0] && handleExtract(e.target.files[0])} />
                      <label>第几套 Test</label>
                      <input type="number" min={1} max={4} value={testNumber}
                        onChange={e => setTestNumber(Number(e.target.value) || 1)} disabled={busy} />
                      <label>页码范围（可选）</label>
                      <input placeholder="如 22-35；扫描版建议填写以省 token" value={pageRange}
                        onChange={e => setPageRange(e.target.value)} disabled={busy} />
                      <label>同时抽答案</label>
                      <span>
                        <input type="checkbox" checked={includeAnswers}
                          onChange={e => setIncludeAnswers(e.target.checked)} disabled={busy} />
                        <small style={{ marginLeft: 6 }}>答案在书末 Answer keys 时才勾</small>
                      </span>
                    </div>
                  </>
                )}
                {WRITING_GRADING && (
                  <>
                    <h3 className="slot-title">写作判分模型</h3>
                    <div className="home-form">{slotForm('grader', PRESET_KIMI, 'Kimi 预设')}</div>
                  </>
                )}
              </>
            </section>
          )}

          {importErrors && (
            <div className="import-error-box">
              <div className="head">
                <b>导入被拒 — {importErrors.source}（共 {importErrors.errors.length} 条提示）</b>
                <button className="notes-close" onClick={() => setImportErrors(null)}>✕</button>
              </div>
              {importErrors.errors.map((e, i) => <div key={i}>✗ {e}</div>)}
            </div>
          )}
          {log.length > 0 && (
            <details className="log-box">
              <summary>技术详情（{log.length} 条）</summary>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </details>
          )}

          <section className="home-card library-card">
            <h2>
              我的题库 <small>（{tests.length} 套）</small>
              <span className="lib-actions">
                <button type="button" className="link-btn" disabled={bookGroups.length === 0}
                  onClick={() => setOpenBooks(new Set(bookGroups.map(g => g.book)))}>展开全部</button>
                <button type="button" className="link-btn" disabled={bookGroups.length === 0}
                  onClick={() => setOpenBooks(new Set())}>全部收起</button>
              </span>
            </h2>
            {ADVANCED && (
              <div className="test-row">
                <div className="test-info">
                  <b>{demoTest.name}</b>
                  <small>内置演示 · 3 篇阅读 40 题 + 写作 2 Task（自撰内容非真题）</small>
                </div>
                <button className="btn-start" onClick={() => setStarting(demoTest)}>开始练习</button>
              </div>
            )}
            {bookGroups.map((g, gi) => (
              <div key={g.book}>
                {bookGroups.length > 1 && (
                  <button className="book-head" onClick={() => toggleBook(g.book, gi)}>
                    {bookOpen(g.book, gi) ? '▾' : '▸'} {g.book} <small>（{g.items.length} 套）</small>
                  </button>
                )}
                {bookOpen(g.book, gi) && (
                  <div className="lib-grid">
                    {g.items.map(t => {
                      const sess = sessionFor(t.id);
                      const last = records.find(r => r.testId === t.id);
                      const lastBand = last ? (last.reading?.band ?? last.listening?.band ?? last.writingBand ?? null) : null;
                      return (
                        <div className="lib-item" key={t.id}>
                          <div className="lib-info">
                            <b>{t.name.split('·')[1]?.trim() || t.name}</b>
                            <small>
                              {sess ? <em className="lib-progress">进行中</em> : null}
                              {t.answers ? '含答案' : '无答案'}
                              {t.listening ? ' · 含听力' : ''}
                              {lastBand != null ? ` · 最近 Band ${lastBand}` : last ? ` · 最近 ${last.reading?.score ?? last.listening?.score ?? '已练'}` : ''}
                              {t.issues.length > 0 && (
                                <em
                                  className="issue-tag"
                                  title={`${t.issues.join('\n')}\n（点这里打开「修正题目」处理）`}
                                  onClick={() => { setFixTab('issues'); setFixing(t); }}
                                >
                                  ⚠{t.issues.length}
                                </em>
                              )}
                            </small>
                          </div>
                          <button className={'btn-start lib-go' + (sess ? ' continue' : '')} onClick={() => startPractice(t)}>
                            {sess ? '继续' : '开始练习'}
                          </button>
                          <button className="lib-op" onClick={() => { setFixTab('reading'); setFixing(t); }} title="改题干、选项、答案；也能替换音频/题图">修正</button>
                          {ADVANCED && t.extracted && <button className="lib-op" onClick={() => handleExportZip(t)} title="导出为 .zip 题包">导出</button>}
                          <button className="danger lib-op" title="删除这套题（历史成绩保留）"
                            onClick={() => {
                              if (confirm(`删除「${t.name}」？\n\n这套题的当前作答进度、音频和题图会被删除；已交卷的练习记录与写作答卷会保留。`)) {
                                discardSession(t.id);
                                clearActiveSession(t.id);
                                deleteTest(t.id);
                                setSessionTick(x => x + 1);
                                void refresh();
                              }
                            }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {tests.length === 0 && <p className="home-empty">还没有题包。把 .zip 题包拖到导入框里就能开始练习了。</p>}
          </section>
        </div>
      )}

      {!newUser && (
        <div className="records-grid">
          <section className="home-card practice-card" id="home-records">
            <h2>
              练习记录 <small>（{records.length} 条）</small>
              {records.length > 0 && (
                <button className="link-btn" onClick={() => setPanel('data')}>备份 →</button>
              )}
            </h2>
            <div className="rec-filters" role="group" aria-label="练习记录筛选">
              {([['all', '全部'], ['reading', '阅读'], ['listening', '听力'], ['writing', '写作']] as const).map(([k, label]) => (
                <button key={k} className={recSkill === k ? 'on' : ''} onClick={() => setRecSkill(k)}>{label}</button>
              ))}
              <select
                aria-label="按时间筛选练习记录"
                value={recRange}
                onChange={e => setRecRange(e.target.value as 'all' | '7' | '30')}
              >
                <option value="all">全部时间</option>
                <option value="7">最近 7 天</option>
                <option value="30">最近 30 天</option>
              </select>
            </div>
            {records.length === 0
              ? <p className="home-empty">还没有记录。做完一套卷子并交卷后，这里会留下成绩，方便回头对比。</p>
              : recordsShown.length === 0
                ? <p className="home-empty">这个筛选下没有记录。</p>
                : recordsShown.map(r => {
                  const t = tests.find(x => x.id === r.testId);
                  const scoreText = [
                    r.listening ? `听力 ${r.listening.score}/${r.listening.total}${r.listening.band != null ? `（Band ${r.listening.band}）` : ''}` : '',
                    r.reading ? `阅读 ${r.reading.score}/${r.reading.total}${r.reading.band != null ? `（Band ${r.reading.band}）` : ''}` : '',
                    r.writing ? (r.writingBand != null ? `写作 Band ${r.writingBand}` : '写作已作答') : '',
                  ].filter(Boolean).join(' · ');
                  return (
                    <div className="test-row rec-row" key={r.id}>
                      <div className="test-info">
                        <b>{r.testName}</b>
                        <small>
                          {new Date(r.at).toLocaleString()} · {scopeName(r.scope, !!t?.listening)} · 用时 {fmtDuration(r.durationSec)}
                          {scoreText ? ` · ${scoreText}` : ''}
                        </small>
                      </div>
                      <button className="btn-start" disabled={!t} title={t ? '' : '题包已被删除，重新导入后可再练'}
                        onClick={() => t && startPractice(t)}>再做一次</button>
                      {hasDetail(r) ? (
                        <button onClick={() => setDetail(r)} title="逐题明细 / 写作答卷">看详情</button>
                      ) : (
                        <button disabled title="这条记录没有逐题明细，也没有写作正文">这场没存明细</button>
                      )}
                      <button className="danger" onClick={() => void deleteRecord(r)}>删除</button>
                    </div>
                  );
                })}
            {recordsFiltered.length > 5 && (
              <button className="link-btn rec-more" onClick={() => setShowAllRecs(v => !v)}>
                {showAllRecs ? '收起 ▴' : `展开全部 ${recordsFiltered.length} 条 ▾`}
              </button>
            )}
            {records.length > 0 && (
              <button className="link-btn rec-clear" onClick={() => void clearAllRecords()}>清空记录</button>
            )}
            <p className="affil-note">仅最近 20 场保留逐题明细；重要数据请用「数据管理」创建完整备份。</p>
          </section>

          <section className="home-card study-card">
            <h2>
              学习记录
              <span className="rc-tabs">
                <button className={recTab === 'iv' ? 'on' : ''} onClick={() => setRecTab('iv')}>精读（{ivMetas.length}）</button>
                <button className={recTab === 'll' ? 'on' : ''} onClick={() => setRecTab('ll')}>精听（{llMetas.length}）</button>
              </span>
              {recTab === 'iv' ? (
                <button className="link-btn" onClick={() => ivImportRef.current?.click()}>导入精读 JSON</button>
              ) : (
                <button className="link-btn" data-ll="home-pick" onClick={() => setShowLlPicker(true)}>选择篇目开始精听</button>
              )}
              <input
                ref={ivImportRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleImportIntensive(f); }}
              />
            </h2>
            {recTab === 'iv' ? (
              ivMetas.length === 0
                ? <p className="home-empty">还没有精读记录。交卷后在成绩单点「精读」，在文章里划重点、写批注，这里就会留下记录。</p>
                : ivMetas.map(m => {
                  const t = findTest(m.testId);
                  const ok = !!(t && t.passages[m.passageIdx]);
                  return (
                    <div className="test-row rec-compact" key={m.key}>
                      <div className="test-info">
                        <b>{m.testName}</b>
                        <small>
                          Passage {m.passageIdx + 1} · {m.passageTitle} · {m.count} 条批注 · {new Date(m.updatedAt).toLocaleString()}
                        </small>
                      </div>
                      <button className="btn-start" disabled={!ok} title={ok ? '' : '题包已被删除，重新导入后可查看'}
                        onClick={() => ok && onOpenIntensive(t!, m.passageIdx)}>打开精读</button>
                      <button className="danger"
                        onClick={() => { if (confirm(`删除这篇精读（${m.count} 条批注）？词汇册里只属于这篇的条目也会一并移除。`)) { deleteIntensive(m.key); void loadIntensiveData(); } }}>
                        删除
                      </button>
                    </div>
                  );
                })
            ) : (
              llMetas.length === 0
                ? <p className="home-empty">还没有精听记录。交听力卷后在成绩单点「精听」，或点右上角「选择篇目开始精听」。</p>
                : llMetas.map(m => {
                  const t = findTest(m.testId);
                  const si = t?.listening?.sections.findIndex(s => s.section_number === m.section) ?? -1;
                  const ok = !!(t && si >= 0);
                  return (
                    <div className="test-row rec-compact" key={m.key} data-ll="home-row">
                      <div className="test-info">
                        <b>{m.testName}</b>
                        <small>
                          Section {m.section}{m.title ? ` · ${m.title}` : ''} · {m.sentCount} 句 · {new Date(m.updatedAt).toLocaleString()}
                        </small>
                      </div>
                      <button className="btn-start" disabled={!ok} title={ok ? '' : '题包已被删除，重新导入后可继续'}
                        onClick={() => ok && onOpenListenLab(t!, si)}>继续精听</button>
                    </div>
                  );
                })
            )}
          </section>
        </div>
      )}

      {!newUser && reviewEntries.length > 0 && (
        <section className="home-card flashcard-home" aria-label="单词翻卡复习">
          <h2>翻卡复习 <small>最近 {Math.min(10, reviewEntries.length)} 个单词</small></h2>
          <FlashcardDeck
            entries={reviewEntries}
            limit={10}
            onMore={() => { setVocabKey(undefined); setPanel('vocabulary'); }}
            emptyText="还没有单词卡片。精读时划出单词，或在精听时加入生词，就能在这里复习。"
          />
        </section>
      )}

      {!newUser && (lastIv || lastLl) ? (
        <div className="home-card slim-row">
          <span className="slim-title">上次练到 <small>精读/精听</small></span>
          {lastIv && (() => {
            const t = findTest(lastIv.testId);
            const ok = !!(t && t.passages[lastIv.passageIdx]);
            return (
              <span className="rc-cont-item">
                <b>{lastIv.testName} · Passage {lastIv.passageIdx + 1} 精读</b>
                <button className="link-btn" disabled={!ok}
                  onClick={() => ok && onOpenIntensive(t!, lastIv.passageIdx)}>继续 →</button>
              </span>
            );
          })()}
          {lastIv && lastLl && <span className="rc-sep">|</span>}
          {lastLl && (() => {
            const t = findTest(lastLl.testId);
            const si = t?.listening?.sections.findIndex(s => s.section_number === lastLl.section) ?? -1;
            const ok = !!(t && si >= 0);
            return (
              <span className="rc-cont-item">
                <b>{lastLl.testName} · Section {lastLl.section} 精听</b>
                <button className="link-btn" disabled={!ok}
                  onClick={() => ok && onOpenListenLab(t!, si)}>继续 →</button>
              </span>
            );
          })()}
        </div>
      ) : null}

      <footer className="home-footer">
        <b>非官方练习界面</b> · 与任何考试主办方无关联，未使用其商标与标识；题包内容由使用者自行提供。
        <br />
        Unofficial practice interface · not affiliated with or endorsed by any examination body.
        <br />
        <span className="build-tag">build {__BUILD_TIME__}</span>
      </footer>

      {detail && (
        <HistoryDetailModal
          record={detail}
          testHasListening={!!tests.find(x => x.id === detail.testId)?.listening}
          testName={tests.find(x => x.id === detail.testId)?.name}
          onClose={() => setDetail(null)}
        />
      )}
      {fixing && (
        <FixModal
          test={fixing}
          initialTab={fixTab}
          onClose={() => setFixing(null)}
          onSave={updated => { saveTest(stripInlineImages(updated)); refresh(); setFixing(null); }}
        />
      )}
      {starting && (
        <StartModal
          test={starting}
          onCancel={() => setStarting(null)}
          onStart={s => { const t = starting; setStarting(null); onStart(t, s, 'new'); }}
        />
      )}
      {showLlPicker && (
        <ListenLabPicker
          tests={tests}
          onPick={(t, si) => { setShowLlPicker(false); onOpenListenLab(t, si); }}
          onClose={() => setShowLlPicker(false)}
        />
      )}

      {/* 题库条目已有进度：统一三选一，不各自实现恢复逻辑 */}
      {startChoice && (
        <div className="overlay" onClick={() => setStartChoice(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sc-title" onClick={e => e.stopPropagation()}>
            <h2 id="sc-title">这套题有未完成进度</h2>
            <p style={{ margin: '0 0 4px', fontWeight: 700 }}>{startChoice.test.name}</p>
            <p style={{ color: '#5F6B76', marginTop: 0 }}>
              上次作答：{new Date(startChoice.meta.updatedAt).toLocaleString()}
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button className="as-secondary" onClick={() => setStartChoice(null)}>取消</button>
              <button className="as-secondary" onClick={() => { const c = startChoice; setStartChoice(null); restartWith(c.meta, c.test); }}>
                重新开始
              </button>
              <button className="as-primary" onClick={() => { const c = startChoice; setStartChoice(null); resumeWith(c.meta, c.test); }}>
                继续上次
              </button>
            </div>
            <p className="affil-note">重新开始会清除这套题当前的作答、作文、笔记、高亮和计时，但保留历史成绩。</p>
          </div>
        </div>
      )}

      {/* 只有非空作答、没有 timer：不下结论，让用户决定 */}
      {looseChoice && (
        <div className="overlay" onClick={() => setLooseChoice(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="lc-title" onClick={e => e.stopPropagation()}>
            <h2 id="lc-title">发现这套题已有作答</h2>
            <p>{looseChoice.name}</p>
            <p style={{ color: '#5F6B76' }}>
              没有找到可靠的计时存档，无法确定这是「进行中的练习」还是「已交卷的旧作答」。
              你可以尝试继续，或清除后重新开始。
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button className="as-secondary" onClick={() => setLooseChoice(null)}>取消</button>
              <button className="as-secondary" onClick={() => clearLoose(looseChoice)}>清除后开始</button>
              <button className="as-primary" onClick={() => continueLoose(looseChoice)}>尝试继续</button>
            </div>
          </div>
        </div>
      )}

      {panel === 'analytics' && (
        <AnalyticsView
          records={records}
          tests={tests}
          onClose={() => setPanel(null)}
          onOpenReview={(skill, type) => {
            setReviewInit({ skill, type });
            setReviewSeq(n => n + 1);
            setReviewBackTo('analytics');
            setPanel('review');
          }}
          onOpenWriting={() => {
            setPanel(null);
            setRecSkill('writing');
            setTimeout(() => document.getElementById('home-records')?.scrollIntoView({ block: 'start' }), 0);
          }}
        />
      )}

      {panel === 'review' && (
        <ReviewCenter
          key={`review-${reviewSeq}`}
          tests={tests}
          initialSkill={reviewInit.skill}
          initialType={reviewInit.type}
          onClose={() => { setPanel(reviewBackTo === 'analytics' ? 'analytics' : null); setReviewBackTo(null); }}
          onChanged={bumpLearning}
          onOpenIntensive={(t, pi) => { setPanel(null); onOpenIntensive(t, pi); }}
          onOpenListenLab={(t, si) => { setPanel(null); onOpenListenLab(t, si); }}
        />
      )}

      {panel === 'vocabulary' && (
        <VocabularyCenter
          tests={tests}
          initialTab={vocabKey ? 'all' : 'today'}
          initialEntryKey={vocabKey}
          onClose={() => { setPanel(null); setVocabKey(undefined); void loadIntensiveData(); void loadListenData(); }}
          onJumpReading={(t, pi, nid) => { setPanel(null); onOpenIntensive(t, pi, nid); }}
          onJumpListening={(t, si) => { setPanel(null); onOpenListenLab(t, si); }}
          onChanged={bumpLearning}
        />
      )}

      {panel === 'data' && (
        <DataManager
          onClose={() => setPanel(null)}
          onRestored={() => {
            setRestoreTick(t => t + 1);
            setLearningTick(t => t + 1);
            setSessionTick(t => t + 1);
            void refresh();
            setRecords(listRecords());
            void loadIntensiveData();
            void loadListenData();
          }}
        />
      )}
    </div>
  );
}
