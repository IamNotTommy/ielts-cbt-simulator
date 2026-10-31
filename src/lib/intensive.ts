/** 精读（划词批注 + 词汇句子册）数据层。
 *  模式与 serverSync 一致：localStorage 为工作缓存，启动器文件夹（精读记录\）为持久层；
 *  每次变更后镜像写回服务器，API 不存在时（备用启动器）静默退化为纯浏览器存储。 */
import { serverAvailable, reportMirrorError } from './serverSync';

export type IntensiveKind = 'word' | 'sentence';

export interface IntensiveNote {
  id: string;
  kind: IntensiveKind;      // word=单词（蓝）/ sentence=句子（琥珀）
  para: number;             // 段落下标
  start: number;            // 段内字符偏移
  end: number;
  text: string;             // 被划的词/句原文
  sentence: string;         // 所在的完整句子（词汇册展示用）
  context: string;          // 前后各一句（尽量）
  note: string;             // 批注内容
  side: 'left' | 'right';   // 批注框放在哪一侧边栏（创建时按锚点横向位置定）
  createdAt: number;
}

export interface IntensiveFile {
  testId: string;
  testName: string;
  passageIdx: number;
  passageTitle: string;
  updatedAt: number;
  notes: IntensiveNote[];
}

export interface IntensiveMeta {
  key: string;
  testId: string;
  testName: string;
  passageIdx: number;
  passageTitle: string;
  count: number;
  updatedAt: number;
}

export interface WordbookEntry {
  id: string;
  kind: IntensiveKind;
  text: string;
  note: string;
  sentence: string;
  context: string;
  testId: string;
  testName: string;
  passageIdx: number;
  noteId: string;           // 最近一次出处批注 id（「跳转到原文」定位用）
  updatedAt: number;
  hits: number;             // 出现次数（= 出处批注数）
  srcs: { key: string; noteId: string }[];  // 全部出处：精读文件 key + 批注 id
}

const K_PREFIX = 'ielts15-intensive-';
const K_WORDBOOK = 'ielts15-wordbook';

/** 精读文件 key 约定：`${testId}__p${passageIdx}`（只允许 [A-Za-z0-9._-]） */
export function ivKey(testId: string, passageIdx: number): string {
  return `${testId}__p${passageIdx}`;
}

/* ---- 写操作串行化（与 serverSync 同一思路：避免并发 PUT 相互覆盖） ---- */
let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>): void {
  queue = queue.then(fn).catch(reportMirrorError);
}
async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    const value = await fn();
    if (value instanceof Response && !value.ok) throw new Error(`精读同步请求失败 HTTP ${value.status}`);
  } catch (e) {
    reportMirrorError(e);
  }
}

/* ---- 精读文件：读（服务器优先，404/不可用回退本地缓存） ---- */
export async function loadIntensive(key: string): Promise<IntensiveFile | null> {
  try {
    if (await serverAvailable()) {
      const r = await fetch(`/api/notes/${key}`);
      if (r.ok) {
        const f = (await r.json()) as IntensiveFile;
        if (f && Array.isArray(f.notes)) {
          try { localStorage.setItem(K_PREFIX + key, JSON.stringify(f)); } catch { /* 配额满则只留服务器副本 */ }
          return f;
        }
      }
      // 404 = 服务器上没有，继续看本地缓存
    }
  } catch { /* 网络异常也回退本地 */ }
  try {
    const raw = localStorage.getItem(K_PREFIX + key);
    if (!raw) return null;
    const f = JSON.parse(raw) as IntensiveFile;
    return f && Array.isArray(f.notes) ? f : null;
  } catch {
    return null;
  }
}

/* ---- 精读文件：写（先落 localStorage，再镜像 PUT，最后联动词汇句子册） ---- */
export function saveIntensive(file: IntensiveFile): void {
  const key = ivKey(file.testId, file.passageIdx);
  file.updatedAt = Date.now();
  try { localStorage.setItem(K_PREFIX + key, JSON.stringify(file)); } catch { /* 忽略 */ }
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    return await fetch(`/api/notes/${key}`, { method: 'PUT', body: JSON.stringify(file) });
  }));
  updateWordbookFromFile(file);
}

/* ---- 导入精读 JSON：校验并补全字段；不合法返回 null。
 *  字段缺失时的兜底：note/sentence/context 空串、side 按锚点位置缺省 left、时间戳补现在。
 *  testId 必须是路径安全字符（会进 URL 与文件名），否则拒收。 */
export function normalizeIntensiveImport(raw: unknown): IntensiveFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const testId = typeof o.testId === 'string' ? o.testId : '';
  if (!/^[A-Za-z0-9._-]+$/.test(testId)) return null;
  const passageIdx = typeof o.passageIdx === 'number' && Number.isInteger(o.passageIdx) && o.passageIdx >= 0
    ? o.passageIdx : -1;
  if (passageIdx < 0) return null;
  if (!Array.isArray(o.notes)) return null;
  const notes: IntensiveNote[] = [];
  for (const n of o.notes) {
    if (!n || typeof n !== 'object') return null;
    const r = n as Record<string, unknown>;
    if (typeof r.para !== 'number' || typeof r.start !== 'number' || typeof r.end !== 'number'
      || typeof r.text !== 'string' || r.end <= r.start) return null;
    notes.push({
      id: typeof r.id === 'string' && r.id ? r.id : `in${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind: r.kind === 'sentence' ? 'sentence' : 'word',
      para: r.para,
      start: r.start,
      end: r.end,
      text: r.text,
      sentence: typeof r.sentence === 'string' ? r.sentence : '',
      context: typeof r.context === 'string' ? r.context : '',
      note: typeof r.note === 'string' ? r.note : '',
      side: r.side === 'right' ? 'right' : 'left',
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    });
  }
  return {
    testId,
    testName: typeof o.testName === 'string' && o.testName ? o.testName : testId,
    passageIdx,
    passageTitle: typeof o.passageTitle === 'string' ? o.passageTitle : '',
    updatedAt: Date.now(),
    notes,
  };
}

/* ---- 精读文件：删（本地缓存 + 服务器 DELETE + 词汇册联动） ---- */
export function deleteIntensive(key: string): void {
  try { localStorage.removeItem(K_PREFIX + key); } catch { /* 忽略 */ }
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    return await fetch(`/api/notes/${key}`, { method: 'DELETE' });
  }));
  const entries = loadWordbook();
  const kept = entries
    .map(e => ({ ...e, srcs: e.srcs.filter(s => s.key !== key) }))
    .filter(e => e.srcs.length > 0)
    .map(e => ({ ...e, hits: e.srcs.length }));
  saveWordbookLocal(kept);
  mirrorWordbook();
}

/* ---- 精读记录列表：合并服务器 key 列表与本地缓存；服务器上的文件逐个 GET 取元信息（并发 ≤4） ---- */
async function mapLimit<T, R>(arr: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (i < arr.length) {
      const j = i++;
      out[j] = await fn(arr[j]);
    }
  }));
  return out;
}

function metaFromFile(key: string, f: IntensiveFile): IntensiveMeta {
  return {
    key,
    testId: f.testId,
    testName: f.testName,
    passageIdx: f.passageIdx,
    passageTitle: f.passageTitle,
    count: f.notes.length,
    updatedAt: f.updatedAt,
  };
}

export async function listIntensiveMeta(): Promise<IntensiveMeta[]> {
  // 本地缓存的 key（含服务器不可用时唯一的副本）
  const localKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(K_PREFIX)) localKeys.push(k.slice(K_PREFIX.length));
    }
  } catch { /* 忽略 */ }

  let serverKeys: string[] = [];
  try {
    if (await serverAvailable()) {
      const r = await fetch('/api/notes');
      if (r.ok) {
        const arr: unknown = await r.json();
        if (Array.isArray(arr)) serverKeys = arr.filter((x): x is string => typeof x === 'string');
      }
    }
  } catch { /* 服务器列表拿不到就只用本地 */ }

  // 服务器上的文件以服务器内容为准（顺便刷新本地缓存）；本地独有的用缓存
  const serverMetas = await mapLimit(serverKeys, 4, async k => {
    const f = await loadIntensive(k);
    return f ? metaFromFile(k, f) : null;
  });
  const metas: IntensiveMeta[] = serverMetas.filter((m): m is IntensiveMeta => !!m);
  for (const k of localKeys) {
    if (serverKeys.includes(k)) continue;
    const f = await loadIntensive(k);
    if (f) metas.push(metaFromFile(k, f));
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ================= 词汇句子册 ================= */

export function loadWordbook(): WordbookEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(K_WORDBOOK) ?? '[]');
    if (!Array.isArray(arr)) return [];
    // 旧数据可能没有 srcs 字段，补上兜底
    return arr.map(e => ({ hits: 1, srcs: [], ...e })) as WordbookEntry[];
  } catch {
    return [];
  }
}

function saveWordbookLocal(entries: WordbookEntry[]): void {
  try { localStorage.setItem(K_WORDBOOK, JSON.stringify(entries)); } catch { /* 配额满忽略 */ }
}

/** 启动时/打开词汇册时：服务器为准拉一次（不可用则用本地缓存） */
export async function syncWordbookFromServer(): Promise<WordbookEntry[]> {
  try {
    if (await serverAvailable()) {
      const r = await fetch('/api/wordbook');
      if (r.ok) {
        const arr: unknown = await r.json();
        if (Array.isArray(arr)) {
          saveWordbookLocal(arr as WordbookEntry[]);
          return loadWordbook();
        }
      }
    }
  } catch { /* 回退本地 */ }
  return loadWordbook();
}

function mirrorWordbook(): void {
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    return await fetch('/api/wordbook', { method: 'PUT', body: localStorage.getItem(K_WORDBOOK) ?? '[]' });
  }));
}

const dedupKey = (kind: IntensiveKind, text: string) => `${kind}:${text.trim().toLowerCase()}`;

/** 每次精读文件保存后联动词汇册：
 *  先摘掉该文件的全部旧出处，再按当前批注重新登记 —— 同词（kind+text 忽略大小写）合并，
 *  note/sentence/context/出处更新为最新，hits = 出处批注数；没有出处的条目移除。 */
function updateWordbookFromFile(file: IntensiveFile): void {
  const key = ivKey(file.testId, file.passageIdx);
  const entries = loadWordbook();
  for (const e of entries) e.srcs = e.srcs.filter(s => s.key !== key);
  for (const n of file.notes) {
    if (!n.text.trim()) continue;
    let e = entries.find(x => dedupKey(x.kind, x.text) === dedupKey(n.kind, n.text));
    if (!e) {
      e = {
        id: `wb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        kind: n.kind,
        text: n.text.trim(),
        note: '',
        sentence: '',
        context: '',
        testId: file.testId,
        testName: file.testName,
        passageIdx: file.passageIdx,
        noteId: n.id,
        updatedAt: 0,
        hits: 0,
        srcs: [],
      };
      entries.push(e);
    }
    e.srcs.push({ key, noteId: n.id });
    e.note = n.note;
    e.sentence = n.sentence;
    e.context = n.context;
    e.testId = file.testId;
    e.testName = file.testName;
    e.passageIdx = file.passageIdx;
    e.noteId = n.id;
    e.updatedAt = file.updatedAt;
  }
  const kept = entries.filter(e => e.srcs.length > 0).map(e => ({ ...e, hits: e.srcs.length }));
  saveWordbookLocal(kept);
  mirrorWordbook();
}

/* ================= 划词范围工具（单词/句子边界，限本段落内） ================= */

const WORD_CHAR = /[A-Za-z'’-]/;

/** 选区收敛为所在单词：先裁掉选区首尾的非词字符，再按 [A-Za-z'’-] 扩到词边界 */
export function expandWord(text: string, start: number, end: number): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s < e && !WORD_CHAR.test(text[s])) s++;
  while (e > s && !WORD_CHAR.test(text[e - 1])) e--;
  while (s > 0 && WORD_CHAR.test(text[s - 1])) s--;
  while (e < text.length && WORD_CHAR.test(text[e])) e++;
  return { start: s, end: e };
}

/** 段落文本 → 句子区间（句末 . ? ! + 空白/结尾 为界） */
function splitSentences(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let s = 0;
  let i = 0;
  while (i < text.length) {
    if (/[.?!]/.test(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      out.push({ start: s, end: i + 1 });
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
      s = i;
    } else {
      i++;
    }
  }
  if (s < text.length) out.push({ start: s, end: text.length });
  return out;
}

/** 选区扩展为所在整句（跨句选区取起点所在的句子） */
export function expandSentence(text: string, start: number, end: number): { start: number; end: number } {
  const sents = splitSentences(text);
  const hit = sents.find(x => start >= x.start && start < x.end)
    ?? sents.find(x => start < x.end && end > x.start);
  return hit ?? { start, end };
}

/** 所在完整句子 + 前后各一句（尽量），供词汇句子册展示 */
export function sentenceAround(text: string, start: number, end: number): { sentence: string; context: string } {
  const sents = splitSentences(text);
  if (!sents.length) return { sentence: text.trim(), context: '' };
  let idx = sents.findIndex(x => start >= x.start && start < x.end);
  if (idx < 0) idx = sents.findIndex(x => start < x.end && end > x.start);
  if (idx < 0) idx = 0;
  const at = (i: number) => (i >= 0 && i < sents.length ? text.slice(sents[i].start, sents[i].end).trim() : '');
  return {
    sentence: at(idx),
    context: [at(idx - 1), at(idx + 1)].filter(Boolean).join(' '),
  };
}

/* 冒烟测试钩子：让自动化脚本能在页面上下文里直接调用存取函数验证一轮（界面不使用） */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ieltsIntensive = {
    ivKey, loadIntensive, saveIntensive, deleteIntensive, listIntensiveMeta,
    loadWordbook, syncWordbookFromServer, expandWord, expandSentence, sentenceAround,
  };
}

/** 等待精读镜像队列清空（恢复备份后必须先 flush，避免旧服务器数据回覆盖） */
export async function flushIntensive(): Promise<void> {
  let cursor = queue;
  for (;;) {
    await cursor;
    if (cursor === queue) return;
    cursor = queue;
  }
}

/** 直接写服务器词汇句子册（恢复备份用；不触发 merge 型本地联动） */
export function mirrorWordbookOnly(): void {
  mirrorWordbook();
}

/** 批量写本地词汇句子册后镜像一次（恢复备份用） */
export function saveWordbookAll(entries: WordbookEntry[]): void {
  saveWordbookLocal(entries);
  mirrorWordbook();
}
