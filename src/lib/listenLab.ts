/** 精听训练数据层：模式与 intensive.ts 一致 —— localStorage 为工作缓存，
 *  启动器文件夹（精听记录\）为持久层；变更后镜像写回服务器，API 不存在时静默退化。
 *  服务器接口：/api/lnotes（key 列表）、/api/lnotes/<key>（GET/PUT/DELETE 精听文件）、
 *  /api/lwords（GET/PUT 生词本整量）；跟读录音走 /api/media/<testId>/rec_s<section>_<句序号>。 */
import { serverAvailable } from './serverSync';
import { loadAudio, saveAudio } from './media';
import { loadLlmConfig } from './store';
import { parseJsonLoose } from './llm';
import type { DiffToken } from './segment';

/* ================= 数据结构 ================= */

export interface LLSeg { start: number; end: number }
export interface LLSentence extends LLSeg { text: string }   // text='' 表示还没有原文（遮盖态）

/** 错因标签（四选一） */
export type LLCause = 'liaison' | 'vocab' | 'distract' | 'grammar';
export const LL_CAUSES: { key: LLCause; label: string }[] = [
  { key: 'liaison', label: '连读/弱读没听出' },
  { key: 'vocab', label: '单词不认识' },
  { key: 'distract', label: '反应慢/走神' },
  { key: 'grammar', label: '语法结构没跟上' },
];

export interface LLDictation {
  at: number;
  hyp: string;
  diff: DiffToken[];
  wrong: number;          // 错词 + 漏词数
  cause?: LLCause;        // 归档的错因（未选则无）
}

export interface LLSentState {
  replays: number;        // 重听次数
  dictations: LLDictation[];
  mastered: boolean;      // 已掌握（听写全对自动置位，或手动"过了"）
  hard: boolean;          // 手动标记难点
  rec?: boolean;          // 这句有跟读录音（避免每次进入对全部句子发 404 探测）
}

export interface ListenFile {
  testId: string;
  testName: string;
  section: number;        // section_number（1 起）
  title: string;          // section 标题/场景
  accent?: string;        // 题包 section JSON 里的 accent/voice 字段（有才显示）
  updatedAt: number;
  segments: LLSeg[] | null;      // 自动切段缓存（不重复计算）
  transcript: string;            // 用户粘贴的听力原文（'' = 未粘贴）
  sentences: LLSentence[];       // 对齐后的句子（无原文时 text=''，仅音频段）
  states: Record<string, LLSentState>;
}

export interface ListenMeta {
  key: string;
  testId: string;
  testName: string;
  section: number;
  title: string;
  sentCount: number;
  updatedAt: number;
}

/** 精听生词条目（整册一个文件 /api/lwords） */
export interface LWord {
  id: string;
  word: string;
  phonetic: string;       // 音标（可能为空：未配模型）
  gloss: string;          // 释义（同上）
  updatedAt: number;
  hits: number;
  srcs: { key: string; testId: string; testName: string; section: number; sentIdx: number; sent: string }[];
}

const K_PREFIX = 'ielts15-lnote-';
const K_WORDS = 'ielts15-lwords';

/** 精听文件 key 约定：`${testId}__s${section}`（只允许 [A-Za-z0-9._-]） */
export function llKey(testId: string, section: number): string {
  return `${testId}__s${section}`;
}

export function emptyState(): LLSentState {
  return { replays: 0, dictations: [], mastered: false, hard: false };
}

/* ---- 写操作串行化 ---- */
let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>): void {
  queue = queue.then(fn).catch(() => { /* fn 内部已 warn，这里兜底 */ });
}
async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn('精听同步到本地文件夹失败：', e);
  }
}

/* ---- 精听文件：读（服务器优先，404/不可用回退本地缓存） ---- */
export async function loadListen(key: string): Promise<ListenFile | null> {
  try {
    if (await serverAvailable()) {
      // 先查 key 列表再取文件：避免对从未精听过的篇目产生 404 噪音
      const lr = await fetch('/api/lnotes');
      const keys: unknown = lr.ok ? await lr.json() : [];
      if (Array.isArray(keys) && keys.includes(key)) {
        const r = await fetch(`/api/lnotes/${key}`);
        if (r.ok) {
          const f = (await r.json()) as ListenFile;
          if (f && typeof f === 'object' && Array.isArray(f.sentences)) {
            try { localStorage.setItem(K_PREFIX + key, JSON.stringify(f)); } catch { /* 配额满则只留服务器副本 */ }
            return f;
          }
        }
      }
      // 服务器上没有 → 继续看本地缓存
    }
  } catch { /* 网络异常也回退本地 */ }
  try {
    const raw = localStorage.getItem(K_PREFIX + key);
    if (!raw) return null;
    const f = JSON.parse(raw) as ListenFile;
    return f && Array.isArray(f.sentences) ? f : null;
  } catch {
    return null;
  }
}

/* ---- 精听文件：写（先落 localStorage，再镜像 PUT） ---- */
export function saveListen(file: ListenFile): void {
  const key = llKey(file.testId, file.section);
  file.updatedAt = Date.now();
  try { localStorage.setItem(K_PREFIX + key, JSON.stringify(file)); } catch { /* 忽略 */ }
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch(`/api/lnotes/${key}`, { method: 'PUT', body: JSON.stringify(file) });
  }));
}

/* ---- 精听文件：删 ---- */
export function deleteListen(key: string): void {
  try { localStorage.removeItem(K_PREFIX + key); } catch { /* 忽略 */ }
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch(`/api/lnotes/${key}`, { method: 'DELETE' });
  }));
}

/* ---- 列表：合并服务器 key 与本地缓存 ---- */
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

function metaFromFile(key: string, f: ListenFile): ListenMeta {
  return {
    key,
    testId: f.testId,
    testName: f.testName,
    section: f.section,
    title: f.title,
    sentCount: f.sentences.length,
    updatedAt: f.updatedAt,
  };
}

export async function listListenMeta(): Promise<ListenMeta[]> {
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
      const r = await fetch('/api/lnotes');
      if (r.ok) {
        const arr: unknown = await r.json();
        if (Array.isArray(arr)) serverKeys = arr.filter((x): x is string => typeof x === 'string');
      }
    }
  } catch { /* 只用本地 */ }

  const serverMetas = await mapLimit(serverKeys, 4, async k => {
    const f = await loadListen(k);
    return f ? metaFromFile(k, f) : null;
  });
  const metas: ListenMeta[] = serverMetas.filter((m): m is ListenMeta => !!m);
  for (const k of localKeys) {
    if (serverKeys.includes(k)) continue;
    const f = await loadListen(k);
    if (f) metas.push(metaFromFile(k, f));
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ================= 生词本（/api/lwords 整量） ================= */

export function loadLWords(): LWord[] {
  try {
    const arr = JSON.parse(localStorage.getItem(K_WORDS) ?? '[]');
    return Array.isArray(arr) ? (arr as LWord[]) : [];
  } catch {
    return [];
  }
}

function saveLWordsLocal(entries: LWord[]): void {
  try { localStorage.setItem(K_WORDS, JSON.stringify(entries)); } catch { /* 配额满忽略 */ }
}

function mirrorLWords(): void {
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch('/api/lwords', { method: 'PUT', body: localStorage.getItem(K_WORDS) ?? '[]' });
  }));
}

/** 服务器为准拉一次（不可用则用本地缓存） */
export async function syncLWordsFromServer(): Promise<LWord[]> {
  try {
    if (await serverAvailable()) {
      const r = await fetch('/api/lwords');
      if (r.ok) {
        const arr: unknown = await r.json();
        if (Array.isArray(arr)) {
          saveLWordsLocal(arr as LWord[]);
          return loadLWords();
        }
      }
    }
  } catch { /* 回退本地 */ }
  return loadLWords();
}

export function findLWord(word: string): LWord | undefined {
  const w = word.trim().toLowerCase();
  return loadLWords().find(e => e.word.trim().toLowerCase() === w);
}

/** 加入生词本：同词（忽略大小写）合并，登记出处；返回整册 */
export function addLWord(
  word: string,
  src: { key: string; testId: string; testName: string; section: number; sentIdx: number; sent: string },
  phonetic = '',
  gloss = '',
): LWord[] {
  const entries = loadLWords();
  const w = word.trim();
  let e = entries.find(x => x.word.trim().toLowerCase() === w.toLowerCase());
  if (!e) {
    e = {
      id: `lw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      word: w,
      phonetic,
      gloss,
      updatedAt: 0,
      hits: 0,
      srcs: [],
    };
    entries.push(e);
  }
  if (!e.srcs.some(s => s.key === src.key && s.sentIdx === src.sentIdx)) e.srcs.push(src);
  if (phonetic) e.phonetic = phonetic;
  if (gloss) e.gloss = gloss;
  e.updatedAt = Date.now();
  e.hits = e.srcs.length;
  saveLWordsLocal(entries);
  mirrorLWords();
  return entries;
}

export function removeLWord(id: string): LWord[] {
  const entries = loadLWords().filter(e => e.id !== id);
  saveLWordsLocal(entries);
  mirrorLWords();
  return entries;
}

/* ================= 单词释义/音标（文本模型，可选） ================= */

export function llmTextReady(): boolean {
  const c = loadLlmConfig().text;
  return !!(c.baseUrl && c.apiKey && c.model);
}

/** 调文本模型取单词释义+音标（JSON 返回）；失败抛错，由调用方降级展示 */
export async function lookupWord(word: string, sentence: string): Promise<{ phonetic: string; gloss: string }> {
  const cfg = loadLlmConfig().text;
  const base = cfg.baseUrl.trim().replace(/\/+$/, '');
  const url = base.includes('/chat/completions') ? base : `${base}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: '你是词典。用户给一个英文单词和它所在的听力句子，你返回该词在此语境下的音标和简明中文释义。'
            + '只输出 JSON：{"phonetic":"/…/","gloss":"词性 释义（不超过 30 字）"}，不要任何其他文字。',
        },
        { role: 'user', content: `单词：${word}\n句子：${sentence}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM 请求失败 HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM 返回为空');
  const obj = parseJsonLoose(content);
  return {
    phonetic: typeof obj.phonetic === 'string' ? obj.phonetic : '',
    gloss: typeof obj.gloss === 'string' ? obj.gloss : '',
  };
}

/* ================= 跟读录音（IndexedDB + 镜像 /api/media/<testId>/rec_s<n>_<idx>） ================= */

export const recMediaKey = (testId: string, section: number, sentIdx: number) =>
  `${testId}/rec_s${section}_${sentIdx}`;

export async function saveRecording(testId: string, section: number, sentIdx: number, blob: Blob): Promise<void> {
  await saveAudio(recMediaKey(testId, section, sentIdx), blob);   // saveAudio 内部已镜像 /api/media
}

export async function loadRecording(testId: string, section: number, sentIdx: number): Promise<Blob | null> {
  return loadAudio(recMediaKey(testId, section, sentIdx));
}

/* 冒烟测试钩子 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ieltsListenLab = {
    llKey, loadListen, saveListen, deleteListen, listListenMeta,
    loadLWords, syncLWordsFromServer, addLWord, removeLWord, lookupWord,
    saveRecording, loadRecording,
  };
}

/** 等待精听镜像队列清空（恢复备份后必须先 flush） */
export async function flushListenLab(): Promise<void> {
  let cursor = queue;
  for (;;) {
    await cursor;
    if (cursor === queue) return;
    cursor = queue;
  }
}

/** 批量写本地生词本后镜像一次（恢复备份用） */
export function saveLWordsAll(entries: LWord[]): void {
  saveLWordsLocal(entries);
  mirrorLWords();
}
