/** 全量备份与恢复（用户数据，不含题包导入导出）。
 *  ZIP 结构见《DeepSeek 功能实施规格》第 8 章；默认排除 API Key 与任何模型配置。 */
import JSZip from 'jszip';
import type { StoredTest } from './store';
import { listTests, saveTestsAll, tk } from './store';
import type { PracticeRecord } from './history';
import { listRecords, saveRecordsAll } from './history';
import {
  clearWritingAttempts, listWritingAttempts, putWritingAttempt, type WritingAttempt,
} from './writingHistory';
import type { IntensiveFile, WordbookEntry } from './intensive';
import {
  listIntensiveMeta, loadIntensive, saveIntensive, loadWordbook, saveWordbookAll,
  syncWordbookFromServer,
} from './intensive';
import type { ListenFile, LWord } from './listenLab';
import {
  listListenMeta, loadListen, saveListen, loadLWords, saveLWordsAll, syncLWordsFromServer, recMediaKey,
} from './listenLab';
import {
  clearAllMedia, dataUrlToBlob, listMediaKeys, readMediaBlob, writeMediaBlob, type MediaStore,
} from './media';
import type { LearningData } from './learningStore';
import { LEARNING_KEY, loadLearningData, saveLearningData, syncLearningFromServer } from './learningStore';
import { SESSION_STORAGE_KEYS } from './activeSession';
import { loadUiSettings, normalizeUiSettings, saveUiSettings, type UiSettings } from './uiSettings';
import { flushLocalMirrors } from './mirrorFlush';
import { mirrorMediaDelete, enqueueApi } from './serverSync';

const deleteRemote = (path: string) => enqueueApi(async () => {
  const r = await fetch(path, { method: 'DELETE' });
  if (!r.ok) throw new Error(`删除服务器数据失败 HTTP ${r.status}`);
});

export interface BackupManifest {
  format: 'ielts-cbt-backup';
  format_version: 1;
  createdAt: number;
  appBuild?: string;
  includesMedia: boolean;
  files: {
    tests: number;
    records: number;
    writingAttempts: number;
    intensive: number;
    listen: number;
    media: number;
  };
  media: { key: string; path: string; store: MediaStore; mime: string }[];
}

export interface ExportBackupResult {
  blob: Blob;
  fileName: string;
  manifest: BackupManifest;
}

/** 未完成练习要导出/恢复的存档键（含 active-session 元信息；不含派生标记 session-ended） */
const SESSION_KEYS: readonly string[] = SESSION_STORAGE_KEYS;
const MEDIA_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const SEG = /^[A-Za-z0-9._-]{1,80}$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function backupFileName(at = new Date()): string {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `英语机考模拟器-backup-${stamp}.zip`;
}

const appBuild = () => (typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '');

function localKeysWithPrefix(prefix: string): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
  } catch { /* 忽略 */ }
  return out;
}

/* ============================ 导出 ============================ */

export async function exportBackupDetailed(opts: {
  includeMedia: boolean;
  onProgress?: (msg: string) => void;
}): Promise<ExportBackupResult> {
  const say = opts.onProgress ?? (() => {});
  const zip = new JSZip();
  const tests = listTests();
  const records = listRecords();
  const writing = await listWritingAttempts();

  say('读取精读记录…');
  const ivMetas = await listIntensiveMeta();
  const intensive: { key: string; file: IntensiveFile }[] = [];
  for (const m of ivMetas) {
    const f = await loadIntensive(m.key);
    if (f) intensive.push({ key: m.key, file: f });
  }

  say('读取精听记录…');
  const llMetas = await listListenMeta();
  const listen: { key: string; file: ListenFile }[] = [];
  for (const m of llMetas) {
    const f = await loadListen(m.key);
    if (f) listen.push({ key: m.key, file: f });
  }

  say('读取词汇与学习数据…');
  const wordbook = await syncWordbookFromServer();
  const lwords = await syncLWordsFromServer();
  const learning = await syncLearningFromServer();
  const ui = loadUiSettings();

  // 未完成练习：只收白名单键，且只针对题库里存在的套题
  const sessions: Record<string, Record<string, string>> = {};
  for (const t of tests) {
    const bag: Record<string, string> = {};
    for (const what of SESSION_KEYS) {
      try {
        const raw = localStorage.getItem(tk(t.id, what));
        if (raw != null) bag[what] = raw;
      } catch { /* 忽略 */ }
    }
    if (Object.keys(bag).length) sessions[t.id] = bag;
  }

  /* ---- 媒体清单 ---- */
  const mediaEntries: BackupManifest['media'] = [];
  if (opts.includeMedia) {
    const seen = new Set<string>();
    const addKey = (key: string, store: MediaStore) => {
      const [testId, name] = key.split('/');
      if (!testId || !name || !SEG.test(testId) || !MEDIA_NAME.test(name)) return;
      const uniq = `${store}:${key}`;
      if (seen.has(uniq)) return;
      seen.add(uniq);
      mediaEntries.push({ key, path: `media/${testId}/${name}`, store, mime: '' });
    };
    for (const t of tests) {
      for (const sec of t.listening?.sections ?? []) {
        addKey(`${t.id}/s${sec.section_number}`, 'audio');
      }
      for (const img of t.images ?? []) addKey(img.key, 'images');
    }
    for (const { file } of listen) {
      for (const [idx, st] of Object.entries(file.states ?? {})) {
        if (st?.rec) addKey(recMediaKey(file.testId, file.section, Number(idx)), 'audio');
      }
    }
    // IndexedDB 里可能还有已知位置以外的媒体（例如旧版本留下的录音），一并枚举
    for (const store of ['audio', 'images'] as MediaStore[]) {
      for (const key of await listMediaKeys(store)) addKey(key, store);
    }

    let done = 0;
    for (const entry of mediaEntries) {
      const got = await readMediaBlob(entry.store, entry.key);
      if (!got) continue;
      entry.mime = got.mime;
      zip.file(entry.path, got.blob);
      done++;
      if (done % 5 === 0) say(`打包媒体 ${done}/${mediaEntries.length}…`);
    }
  }

  const manifest: BackupManifest = {
    format: 'ielts-cbt-backup',
    format_version: 1,
    createdAt: Date.now(),
    appBuild: appBuild(),
    includesMedia: opts.includeMedia,
    files: {
      tests: tests.length,
      records: records.length,
      writingAttempts: writing.length,
      intensive: intensive.length,
      listen: listen.length,
      media: mediaEntries.filter(m => m.mime).length,
    },
    media: mediaEntries,
  };

  say('写入数据文件…');
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('data/tests.json', JSON.stringify(tests));
  zip.file('data/history.json', JSON.stringify(records));
  zip.file('data/learning.json', JSON.stringify(learning));
  zip.file('data/sessions.json', JSON.stringify(sessions));
  zip.file('data/wordbook.json', JSON.stringify(wordbook));
  zip.file('data/lwords.json', JSON.stringify(lwords));
  for (const it of intensive) zip.file(`data/intensive/${it.key}.json`, JSON.stringify(it.file));
  for (const it of listen) zip.file(`data/listen/${it.key}.json`, JSON.stringify(it.file));
  for (const a of writing) zip.file(`data/writing/${a.recordId}.json`, JSON.stringify(a));
  zip.file('settings/ui.json', JSON.stringify(ui));

  say('压缩…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, fileName: backupFileName(), manifest };
}

/** 规格入口：只要 Blob */
export async function exportBackup(options: { includeMedia: boolean; onProgress?: (msg: string) => void }): Promise<Blob> {
  return (await exportBackupDetailed(options)).blob;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============================ 预检 ============================ */

export interface BackupPreview {
  manifest: BackupManifest;
  tests: StoredTest[];
  records: PracticeRecord[];
  learning: LearningData | null;
  sessions: Record<string, Record<string, string>>;
  wordbook: WordbookEntry[];
  lwords: LWord[];
  intensive: { key: string; file: IntensiveFile }[];
  listen: { key: string; file: ListenFile }[];
  writing: WritingAttempt[];
  ui: UiSettings | null;
  errors: string[];
  zip: JSZip;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function parseJson<T>(zip: JSZip, path: string, errors: string[], required: boolean): Promise<T | null> {
  const f = zip.file(path);
  if (!f) {
    if (required) errors.push(`缺少 ${path}`);
    return null;
  }
  try {
    return JSON.parse(await f.async('string')) as T;
  } catch {
    errors.push(`${path} 不是合法 JSON`);
    return null;
  }
}

export async function inspectBackup(file: File | Blob): Promise<BackupPreview> {
  const errors: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return {
      manifest: {} as BackupManifest, tests: [], records: [], learning: null, sessions: {},
      wordbook: [], lwords: [], intensive: [], listen: [], writing: [], ui: null,
      errors: ['文件不是有效的 ZIP，或已损坏'], zip: new JSZip(),
    };
  }

  const manifestRaw = await parseJson<BackupManifest>(zip, 'manifest.json', errors, true);
  let manifest = manifestRaw as BackupManifest;
  if (!manifestRaw) {
    errors.push('缺少 manifest.json，无法识别备份格式');
    manifest = {} as BackupManifest;
  } else if (manifestRaw.format !== 'ielts-cbt-backup') {
    errors.push('不是本应用的备份文件（manifest.format 不匹配）');
  } else if (manifestRaw.format_version !== 1) {
    errors.push(`备份格式版本 ${String(manifestRaw.format_version)} 不受支持：请升级应用后再恢复`);
  }

  const tests = (await parseJson<StoredTest[]>(zip, 'data/tests.json', errors, true)) ?? [];
  const records = (await parseJson<PracticeRecord[]>(zip, 'data/history.json', errors, true)) ?? [];
  if (!Array.isArray(tests)) errors.push('data/tests.json 不是数组');
  if (!Array.isArray(records)) errors.push('data/history.json 不是数组');

  const learningRaw = await parseJson<LearningData>(zip, 'data/learning.json', errors, false);
  const learning = learningRaw && learningRaw.version === 1 ? {
    version: 1 as const,
    reviewItems: Array.isArray(learningRaw.reviewItems) ? learningRaw.reviewItems : [],
    vocabularyProgress: Array.isArray(learningRaw.vocabularyProgress) ? learningRaw.vocabularyProgress : [],
    processedRecordIds: Array.isArray(learningRaw.processedRecordIds) ? learningRaw.processedRecordIds : [],
    updatedAt: typeof learningRaw.updatedAt === 'number' ? learningRaw.updatedAt : 0,
  } : null;
  if (learningRaw && !learning) errors.push('data/learning.json 版本不是 1，已忽略学习数据');

  const sessionsRaw = await parseJson<Record<string, Record<string, string>>>(zip, 'data/sessions.json', errors, false);
  const sessions: Record<string, Record<string, string>> = {};
  if (sessionsRaw && isObj(sessionsRaw)) {
    for (const [testId, bag] of Object.entries(sessionsRaw)) {
      if (!SEG.test(testId) || !isObj(bag)) { errors.push(`data/sessions.json 含非法套题键：${testId}`); continue; }
      const clean: Record<string, string> = {};
      for (const [what, value] of Object.entries(bag)) {
        if (!(SESSION_KEYS as readonly string[]).includes(what)) continue;
        if (typeof value === 'string') clean[what] = value;
      }
      sessions[testId] = clean;
    }
  }

  const wordbook = (await parseJson<WordbookEntry[]>(zip, 'data/wordbook.json', errors, false)) ?? [];
  const lwords = (await parseJson<LWord[]>(zip, 'data/lwords.json', errors, false)) ?? [];
  const uiRaw = await parseJson<UiSettings>(zip, 'settings/ui.json', errors, false);
  const ui = uiRaw ? normalizeUiSettings(uiRaw) : null;

  const intensive: { key: string; file: IntensiveFile }[] = [];
  const listen: { key: string; file: ListenFile }[] = [];
  const writing: WritingAttempt[] = [];
  for (const path of Object.keys(zip.files)) {
    const f = zip.files[path];
    if (f.dir) continue;
    let m = /^data\/intensive\/([^/]+)\.json$/.exec(path);
    if (m) {
      const key = m[1];
      if (!SEG.test(key)) { errors.push(`精读文件名不合法：${path}`); continue; }
      const data = await parseJson<IntensiveFile>(zip, path, errors, false);
      if (data && Array.isArray(data.notes)) intensive.push({ key, file: data });
      continue;
    }
    m = /^data\/listen\/([^/]+)\.json$/.exec(path);
    if (m) {
      const key = m[1];
      if (!SEG.test(key)) { errors.push(`精听文件名不合法：${path}`); continue; }
      const data = await parseJson<ListenFile>(zip, path, errors, false);
      if (data && Array.isArray(data.sentences)) listen.push({ key, file: data });
      continue;
    }
    m = /^data\/writing\/([^/]+)\.json$/.exec(path);
    if (m) {
      const id = m[1];
      if (!SEG.test(id)) { errors.push(`写作答卷文件名不合法：${path}`); continue; }
      const data = await parseJson<WritingAttempt>(zip, path, errors, false);
      if (data && data.version === 1 && Array.isArray(data.tasks)) writing.push(data);
      else errors.push(`写作答卷无法识别：${path}`);
    }
  }

  const media = Array.isArray(manifest.media) ? manifest.media : [];
  for (const entry of media) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.path !== 'string'
      || (entry.store !== 'audio' && entry.store !== 'images')) {
      errors.push('manifest.media 里有非法条目');
      continue;
    }
    const [testId, name] = entry.key.split('/');
    if (!testId || !name || !SEG.test(testId) || !MEDIA_NAME.test(name)) {
      errors.push(`媒体 key 不合法：${entry.key}`);
    }
    if (entry.path.includes('..') || entry.path.startsWith('/') || entry.path.includes('\\') || !entry.path.startsWith('media/')) {
      errors.push(`媒体路径不合法：${entry.path}`);
    }
    if (!zip.file(entry.path)) errors.push(`备份中缺少媒体文件：${entry.path}`);
  }

  return { manifest, tests, records, learning, sessions, wordbook, lwords, intensive, listen, writing, ui, errors, zip };
}

/* ============================ 合并计划 ============================ */

export type RestoreMode = 'merge-keep' | 'merge-replace' | 'replace';
export type MergeAction = 'add' | 'keep-current' | 'use-backup';

export interface MergeDecision {
  module: string;
  key: string;
  action: MergeAction;
}

export interface MergeCounts { add: number; keep: number; replace: number; total: number }

export type PlanModule =
  | 'tests' | 'history' | 'writing' | 'intensive' | 'listen' | 'sessions'
  | 'reviewItems' | 'vocabularyProgress' | 'wordbook' | 'lwords' | 'media' | 'ui';

export interface RestorePlan {
  decisions: MergeDecision[];
  counts: Record<PlanModule, MergeCounts>;
}

const emptyCounts = (): MergeCounts => ({ add: 0, keep: 0, replace: 0, total: 0 });

export async function planRestore(preview: BackupPreview, mode: RestoreMode): Promise<RestorePlan> {
  const decisions: MergeDecision[] = [];
  const counts: Record<PlanModule, MergeCounts> = {
    tests: emptyCounts(), history: emptyCounts(), writing: emptyCounts(), intensive: emptyCounts(),
    listen: emptyCounts(), sessions: emptyCounts(), reviewItems: emptyCounts(),
    vocabularyProgress: emptyCounts(), wordbook: emptyCounts(), lwords: emptyCounts(),
    media: emptyCounts(), ui: emptyCounts(),
  };
  const push = (module: PlanModule, key: string, conflict: boolean) => {
    const action: MergeAction = !conflict ? 'add' : mode === 'replace' || mode === 'merge-replace' ? 'use-backup' : 'keep-current';
    decisions.push({ module, key, action });
    const c = counts[module];
    c.total++;
    if (action === 'add') c.add++;
    else if (action === 'use-backup') c.replace++;
    else c.keep++;
  };

  const testIds = new Set(listTests().map(t => t.id));
  for (const t of preview.tests) push('tests', String(t?.id ?? ''), testIds.has(t.id));

  const recordIds = new Set(listRecords().map(r => r.id));
  for (const r of preview.records) push('history', String(r?.id ?? ''), recordIds.has(r.id));

  const localWriting = new Set((await listWritingAttempts()).map(a => a.recordId));
  for (const a of preview.writing) push('writing', a.recordId, localWriting.has(a.recordId));

  const localIv = new Set(localKeysWithPrefix('ielts15-intensive-'));
  for (const it of preview.intensive) push('intensive', it.key, localIv.has(it.key));

  const localLl = new Set(localKeysWithPrefix('ielts15-lnote-'));
  for (const it of preview.listen) push('listen', it.key, localLl.has(it.key));

  const localSession = new Set<string>();
  for (const testId of Object.keys(preview.sessions)) {
    if (localStorage.getItem(tk(testId, 'active-session'))) localSession.add(testId);
    push('sessions', testId, localSession.has(testId));
  }

  const localLearning = loadLearningData();
  const reviewIds = new Set(localLearning.reviewItems.map(x => x.id));
  for (const it of preview.learning?.reviewItems ?? []) push('reviewItems', it.id, reviewIds.has(it.id));
  const vocabKeys = new Set(localLearning.vocabularyProgress.map(x => x.key));
  for (const p of preview.learning?.vocabularyProgress ?? []) push('vocabularyProgress', p.key, vocabKeys.has(p.key));

  const wbIds = new Set(loadWordbook().map(x => x.id));
  for (const e of preview.wordbook) push('wordbook', e.id, wbIds.has(e.id));
  const lwIds = new Set(loadLWords().map(x => x.id));
  for (const e of preview.lwords) push('lwords', e.id, lwIds.has(e.id));

  const localMedia = new Set<string>();
  for (const store of ['audio', 'images'] as MediaStore[]) {
    for (const k of await listMediaKeys(store)) localMedia.add(`${store}:${k}`);
  }
  for (const m of preview.manifest.media ?? []) push('media', `${m.store}:${m.key}`, localMedia.has(`${m.store}:${m.key}`));

  if (preview.ui) push('ui', 'ui', true);

  return { decisions, counts };
}

const decided = (plan: RestorePlan | undefined, module: PlanModule, key: string) =>
  plan?.decisions.find(d => d.module === module && d.key === key)?.action;

/* ============================ 恢复 ============================ */

export interface RestoreOptions {
  mode: RestoreMode;
  includeMedia: boolean;
  plan?: RestorePlan;
  onProgress?: (msg: string) => void;
}

export interface RestoreSummary {
  added: number;
  kept: number;
  replaced: number;
  failed: number;
  modules: Record<string, MergeCounts>;
  warnings: string[];
  flushed: boolean;
}

export async function restoreBackup(preview: BackupPreview, opts: RestoreOptions): Promise<RestoreSummary> {
  const say = opts.onProgress ?? (() => {});
  const plan = opts.plan ?? await planRestore(preview, opts.mode);
  const mode = opts.mode;
  const summary: RestoreSummary = { added: 0, kept: 0, replaced: 0, failed: 0, modules: {}, warnings: [], flushed: false };

  const tally = (module: string, action: MergeAction) => {
    const c = summary.modules[module] ?? (summary.modules[module] = emptyCounts());
    c.total++;
    if (action === 'add') { c.add++; summary.added++; }
    else if (action === 'use-backup') { c.replace++; summary.replaced++; }
    else { c.keep++; summary.kept++; }
  };

  /* ---- 完整替换：先清空本应用拥有的数据（不碰 LLM 配置，不 clear() 整个 localStorage） ---- */
  if (mode === 'replace') {
    say('清理当前数据…');
    const localTestsBefore = listTests();
    const localIvBefore = localKeysWithPrefix('ielts15-intensive-');
    const localLlBefore = localKeysWithPrefix('ielts15-lnote-');
    try {
      for (const key of ['ielts15-tests', 'ielts15-history', 'ielts15-wordbook', 'ielts15-lwords', LEARNING_KEY]) {
        localStorage.removeItem(key);
      }
      for (const k of localIvBefore) localStorage.removeItem(`ielts15-intensive-${k}`);
      for (const k of localLlBefore) localStorage.removeItem(`ielts15-lnote-${k}`);
      const knownTestIds = new Set([
        ...localTestsBefore.map(t => t.id),
        ...preview.tests.map(t => t.id),
        ...Object.keys(preview.sessions),
      ]);
      for (const id of knownTestIds) {
        for (const what of SESSION_STORAGE_KEYS) localStorage.removeItem(tk(id, what));
        mirrorMediaDelete(id);
      }
      // 服务器上本地独有的精读/精听文件也一并删除（保持服务器与备份一致）
      const backupIv = new Set(preview.intensive.map(x => x.key));
      const backupLl = new Set(preview.listen.map(x => x.key));
      for (const k of localIvBefore) {
        if (!backupIv.has(k)) deleteRemote(`/api/notes/${encodeURIComponent(k)}`);
      }
      for (const k of localLlBefore) {
        if (!backupLl.has(k)) deleteRemote(`/api/lnotes/${encodeURIComponent(k)}`);
      }
      await clearWritingAttempts();
    } catch (e) {
      summary.warnings.push(`清理旧数据时出错：${(e as Error).message}`);
    }
  }

  /* ---- 题库 ---- */
  say('恢复题库…');
  try {
    const current = listTests();
    const curMap = new Map(current.map(t => [t.id, t]));
    const merged: StoredTest[] = [...current];
    for (const t of preview.tests) {
      if (!t || typeof t.id !== 'string') { summary.failed++; continue; }
      const action = mode === 'replace' ? 'use-backup' : (decided(plan, 'tests', t.id) ?? (curMap.has(t.id) ? 'keep-current' : 'add'));
      tally('tests', action);
      if (action === 'keep-current') continue;
      if (action === 'add') merged.unshift(t);
      else {
        const i = merged.findIndex(x => x.id === t.id);
        if (i >= 0) merged[i] = t; else merged.unshift(t);
      }
    }
    saveTestsAll(mode === 'replace' ? preview.tests : merged);
  } catch (e) {
    summary.failed++;
    summary.warnings.push(`题库恢复失败：${(e as Error).message}`);
  }

  /* ---- 练习记录 ---- */
  say('恢复练习记录…');
  try {
    const current = listRecords();
    const curIds = new Set(current.map(r => r.id));
    const merged: PracticeRecord[] = [...current];
    for (const r of preview.records) {
      if (!r || typeof r.id !== 'string') { summary.failed++; continue; }
      const action = mode === 'replace' ? 'use-backup' : (decided(plan, 'history', r.id) ?? (curIds.has(r.id) ? 'keep-current' : 'add'));
      tally('history', action);
      if (action === 'keep-current') continue;
      if (action === 'add') merged.unshift(r);
      else {
        const i = merged.findIndex(x => x.id === r.id);
        if (i >= 0) merged[i] = r; else merged.unshift(r);
      }
    }
    const out = (mode === 'replace' ? preview.records : merged).slice().sort((a, b) => b.at - a.at);
    saveRecordsAll(out);
  } catch (e) {
    summary.failed++;
    summary.warnings.push(`练习记录恢复失败：${(e as Error).message}`);
  }

  /* ---- 写作答卷 ---- */
  say('恢复写作答卷…');
  for (const a of preview.writing) {
    try {
      const existing = (await listWritingAttempts()).some(x => x.recordId === a.recordId);
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'writing', a.recordId) ?? (existing ? 'keep-current' : 'add'));
      tally('writing', action);
      if (action === 'keep-current') continue;
      await putWritingAttempt(a);
    } catch (e) {
      summary.failed++;
      summary.warnings.push(`写作答卷 ${a.recordId} 恢复失败：${(e as Error).message}`);
    }
  }

  /* ---- 精读 / 精听 ---- */
  say('恢复精读与精听…');
  const localIvKeys = new Set(localKeysWithPrefix('ielts15-intensive-'));
  for (const it of preview.intensive) {
    try {
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'intensive', it.key) ?? (localIvKeys.has(it.key) ? 'keep-current' : 'add'));
      tally('intensive', action);
      if (action === 'keep-current') continue;
      saveIntensive(it.file);
    } catch (e) {
      summary.failed++;
      summary.warnings.push(`精读 ${it.key} 恢复失败：${(e as Error).message}`);
    }
  }
  const localLlKeys = new Set(localKeysWithPrefix('ielts15-lnote-'));
  for (const it of preview.listen) {
    try {
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'listen', it.key) ?? (localLlKeys.has(it.key) ? 'keep-current' : 'add'));
      tally('listen', action);
      if (action === 'keep-current') continue;
      saveListen(it.file);
    } catch (e) {
      summary.failed++;
      summary.warnings.push(`精听 ${it.key} 恢复失败：${(e as Error).message}`);
    }
  }

  /* ---- 词汇册 / 生词本（放在精读精听之后，避免被文件联动覆盖） ---- */
  say('恢复词汇…');
  try {
    const wb = loadWordbook();
    const wbMap = new Map(wb.map(e => [e.id, e]));
    for (const e of preview.wordbook) {
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'wordbook', e.id) ?? (wbMap.has(e.id) ? 'keep-current' : 'add'));
      tally('wordbook', action);
      if (action !== 'keep-current') wbMap.set(e.id, e);
    }
    saveWordbookAll([...wbMap.values()]);
    const lw = loadLWords();
    const lwMap = new Map(lw.map(e => [e.id, e]));
    for (const e of preview.lwords) {
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'lwords', e.id) ?? (lwMap.has(e.id) ? 'keep-current' : 'add'));
      tally('lwords', action);
      if (action !== 'keep-current') lwMap.set(e.id, e);
    }
    saveLWordsAll([...lwMap.values()]);
  } catch (e) {
    summary.failed++;
    summary.warnings.push(`词汇恢复失败：${(e as Error).message}`);
  }

  /* ---- 学习数据 ---- */
  say('恢复错题与复习进度…');
  try {
    const local = await syncLearningFromServer();
    const base: LearningData = mode === 'replace'
      ? { version: 1, reviewItems: [], vocabularyProgress: [], processedRecordIds: [], updatedAt: Date.now() }
      : local;
    const reviewMap = new Map(base.reviewItems.map(x => [x.id, x]));
    for (const it of preview.learning?.reviewItems ?? []) {
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'reviewItems', it.id) ?? (reviewMap.has(it.id) ? 'keep-current' : 'add'));
      tally('reviewItems', action);
      if (action !== 'keep-current') reviewMap.set(it.id, it);
    }
    const progMap = new Map(base.vocabularyProgress.map(x => [x.key, x]));
    for (const p of preview.learning?.vocabularyProgress ?? []) {
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'vocabularyProgress', p.key) ?? (progMap.has(p.key) ? 'keep-current' : 'add'));
      tally('vocabularyProgress', action);
      if (action !== 'keep-current') progMap.set(p.key, p);
    }
    const processed = new Set([...base.processedRecordIds, ...(preview.learning?.processedRecordIds ?? [])]);
    saveLearningData({
      version: 1,
      reviewItems: [...reviewMap.values()],
      vocabularyProgress: [...progMap.values()],
      processedRecordIds: [...processed],
      updatedAt: Date.now(),
    });
  } catch (e) {
    summary.failed++;
    summary.warnings.push(`学习数据恢复失败：${(e as Error).message}`);
  }

  /* ---- 未完成练习 ---- */
  say('恢复未完成练习…');
  for (const [testId, bag] of Object.entries(preview.sessions)) {
    try {
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'sessions', testId) ?? (localStorage.getItem(tk(testId, 'active-session')) ? 'keep-current' : 'add'));
      tally('sessions', action);
      if (action === 'keep-current') continue;
      if (action === 'use-backup') {
        for (const what of SESSION_STORAGE_KEYS) localStorage.removeItem(tk(testId, what));
      }
      for (const [what, value] of Object.entries(bag)) {
        if (!(SESSION_KEYS as readonly string[]).includes(what)) continue;
        localStorage.setItem(tk(testId, what), value);
      }
      if (!bag['active-session'] && bag['timer']) {
        // 旧备份只带 timer：补一份 active-session，恢复后才能出现在「继续上次练习」
        try {
          const t = JSON.parse(bag['timer']) as { scope?: string; mode?: string; fullPhase?: string; secondsLeft?: number };
          localStorage.setItem(tk(testId, 'active-session'), JSON.stringify({
            version: 1,
            testId,
            startedAt: Date.now() - Number(t.secondsLeft ?? 0) * 1000,
            updatedAt: Date.now(),
            config: { scope: t.scope ?? 'reading', passageIdx: 0, minutes: 60, writingMinutes: 60 },
            mode: t.mode === 'listening' || t.mode === 'writing' ? t.mode : 'reading',
            fullPhase: t.fullPhase === 'listening' || t.fullPhase === 'writing' ? t.fullPhase : 'reading',
            current: 1, partIdx: 0, wPart: 0, untimed: false,
          }));
        } catch { /* 忽略 */ }
      }
    } catch (e) {
      summary.failed++;
      summary.warnings.push(`套题 ${testId} 的进度恢复失败：${(e as Error).message}`);
    }
  }

  /* ---- 媒体 ---- */
  say('恢复媒体…');
  const localMediaNow = new Set<string>();
  for (const store of ['audio', 'images'] as MediaStore[]) {
    for (const k of await listMediaKeys(store)) localMediaNow.add(`${store}:${k}`);
  }
  if (mode === 'replace') {
    if (!opts.includeMedia) summary.warnings.push('备份不包含媒体：当前音频、题图与录音已随完整替换移除，且无法从本包恢复。');
    await clearAllMedia();
  }
  for (const entry of preview.manifest.media ?? []) {
    try {
      const uniq = `${entry.store}:${entry.key}`;
      const action: MergeAction = mode === 'replace' ? 'use-backup'
        : (decided(plan, 'media', uniq) ?? (localMediaNow.has(uniq) ? 'keep-current' : 'add'));
      tally('media', action);
      if (action === 'keep-current') continue;
      if (!opts.includeMedia) { summary.warnings.push(`未选择包含媒体，跳过 ${entry.key}`); continue; }
      const f = preview.zip.file(entry.path);
      if (!f) { summary.failed++; summary.warnings.push(`备份中找不到媒体 ${entry.path}`); continue; }
      if (entry.store === 'images') {
        const b64 = await f.async('base64');
        const mime = entry.mime || 'image/png';
        await writeMediaBlob('images', entry.key, dataUrlToBlob(`data:${mime};base64,${b64}`));
      } else {
        const buf = await f.async('arraybuffer');
        await writeMediaBlob('audio', entry.key, new Blob([buf], { type: entry.mime || 'audio/mpeg' }));
      }
    } catch (e) {
      summary.failed++;
      summary.warnings.push(`媒体 ${entry.key} 恢复失败：${(e as Error).message}`);
    }
  }

  /* ---- 界面设置 ---- */
  if (preview.ui) {
    const action = mode === 'replace' ? 'use-backup' : 'keep-current';
    tally('ui', action);
    if (action === 'use-backup') saveUiSettings(preview.ui);
  }

  /* ---- 镜像 flush：恢复后必须等队列清空，才能让调用方刷新或重启同步 ---- */
  say('正在同步到本地文件夹…');
  const flushed = await flushLocalMirrors();
  summary.flushed = flushed.ok;
  if (!flushed.ok) {
    summary.warnings.push(`镜像同步未完成（${flushed.error ?? '未知错误'}）：本地恢复结果已保留，请稍后重试，避免用旧文件覆盖。`);
  }
  return summary;
}
