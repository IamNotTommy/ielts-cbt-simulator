/** 写作答卷历史：独立 IndexedDB（ielts15-writing / attempts），按 recordId 一条，
 *  保存不可变原稿 + 题目快照 + 若干修改稿。修改稿判改快照与原场次成绩完全隔离。
 *  同一 recordId 的写操作走 per-record Promise 队列，避免自动保存与判改回写互相覆盖。 */
import type { WritingTask } from '../types';
import type { WritingGradeResult } from './llm';
import { roundBand } from './scoring';
import { mirrorWritingDelete, mirrorWritingPut } from './serverSync';

export interface WritingAttemptTask {
  task: 'task1' | 'task2';
  prompt: WritingTask;
  essay: string;
  wordCount: number;
}

export interface WritingRevision {
  id: string;
  createdAt: number;
  updatedAt: number;
  essays: [string, string];
  wordCounts: [number, number];
  status: 'draft' | 'grading' | 'graded';
  gradedEssays?: [string, string];
  gradedAt?: number;
  grade?: WritingGradeResult;
  reportMd?: string;
  band?: number | null;
}

export interface WritingAttempt {
  version: 1;
  recordId: string;
  testId: string;
  testName: string;
  submittedAt: number;
  durationSec: number;
  tasks: WritingAttemptTask[];
  originalGrade?: WritingGradeResult;
  originalReportMd?: string;
  originalBand?: number | null;
  revisions: WritingRevision[];
  updatedAt: number;
}

const DB_NAME = 'ielts15-writing';
const DB_VERSION = 1;
const STORE = 'attempts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'recordId' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((res, rej) => {
      const tx = db.transaction(STORE, mode);
      let out: unknown;
      const rq = fn(tx.objectStore(STORE));
      if (rq) rq.onsuccess = () => { out = rq.result; };
      tx.oncomplete = () => res(out as T);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  } finally {
    db.close();
  }
}

/* ---- per-record 串行队列 ---- */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(recordId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(recordId) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  queues.set(recordId, result.then(() => undefined, () => undefined));
  return result;
}

/* ---- 基础读写 ---- */
export async function getWritingAttempt(recordId: string): Promise<WritingAttempt | null> {
  try {
    const a = await withStore<WritingAttempt | undefined>('readonly', s => s.get(recordId));
    return a && a.version === 1 ? a : null;
  } catch {
    return null;
  }
}

export async function listWritingAttempts(): Promise<WritingAttempt[]> {
  try {
    const all = await withStore<WritingAttempt[]>('readonly', s => s.getAll());
    return (all ?? []).filter(a => a && a.version === 1).sort((a, b) => b.submittedAt - a.submittedAt);
  } catch {
    return [];
  }
}

/** 原稿落库（覆盖同 recordId）。返回值可用于等待镜像入队。 */
export function saveWritingAttempt(attempt: WritingAttempt): Promise<void> {
  return enqueue(attempt.recordId, async () => {
    const next: WritingAttempt = { ...structuredCopy(attempt), updatedAt: Date.now() };
    await withStore<void>('readwrite', s => s.put(next));
    mirrorWritingPut(next);
  });
}

/** 恢复备份等场景直接写，不进队列；mirror=false 用于"刚从服务器读回来"的情况，避免无意义的 PUT 回环 */
export async function putWritingAttempt(attempt: WritingAttempt, mirror = true): Promise<void> {
  await withStore<void>('readwrite', s => s.put(attempt));
  if (mirror) mirrorWritingPut(attempt);
}

export function deleteWritingAttempt(recordId: string): Promise<void> {
  return enqueue(recordId, async () => {
    await withStore<void>('readwrite', s => s.delete(recordId));
    mirrorWritingDelete(recordId);
  });
}

export async function clearWritingAttempts(): Promise<void> {
  const all = await listWritingAttempts();
  await withStore<void>('readwrite', s => s.clear());
  for (const a of all) mirrorWritingDelete(a.recordId);
}

/* ---- 深拷贝：交卷时把可变 state 固定成快照 ---- */
export function structuredCopy<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 写作总 Band：Task 2 权重 2/3，只有一篇则取该篇 */
export function writingBandOf(grade: WritingGradeResult | undefined | null): number | null {
  if (!grade) return null;
  const b1 = grade.task1?.band;
  const b2 = grade.task2?.band;
  if (b1 != null && b2 != null) return roundBand((b1 + 2 * b2) / 3);
  const bs = [b1, b2].filter((b): b is number => typeof b === 'number');
  return bs.length ? roundBand(bs.reduce((a, b) => a + b, 0) / bs.length) : null;
}

async function mustGet(recordId: string): Promise<WritingAttempt> {
  const a = await getWritingAttempt(recordId);
  if (!a) throw new Error(`写作答卷不存在：${recordId}`);
  return a;
}

/* ---- 修改稿 ---- */
export function createRevision(recordId: string): Promise<WritingRevision> {
  return enqueue(recordId, async () => {
    const a = await mustGet(recordId);
    const essays: [string, string] = [a.tasks[0]?.essay ?? '', a.tasks[1]?.essay ?? ''];
    const rev: WritingRevision = {
      id: newId('wv'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      essays,
      wordCounts: [a.tasks[0]?.wordCount ?? 0, a.tasks[1]?.wordCount ?? 0],
      status: 'draft',
    };
    a.revisions = [...(a.revisions ?? []), rev];
    a.updatedAt = Date.now();
    await withStore<void>('readwrite', s => s.put(a));
    mirrorWritingPut(a);
    return rev;
  });
}

export function saveRevisionDraft(
  recordId: string,
  revisionId: string,
  essays: [string, string],
  wordCounts: [number, number],
): Promise<void> {
  return enqueue(recordId, async () => {
    const a = await mustGet(recordId);
    const rev = (a.revisions ?? []).find(r => r.id === revisionId);
    if (!rev) throw new Error(`修改稿不存在：${revisionId}`);
    rev.essays = [essays[0], essays[1]];
    rev.wordCounts = [wordCounts[0], wordCounts[1]];
    rev.updatedAt = Date.now();
    // 已判改后继续编辑：回到 draft，但保留上一版 gradedEssays/grade 作为历史结果
    if (rev.status === 'graded') rev.status = 'draft';
    a.updatedAt = Date.now();
    await withStore<void>('readwrite', s => s.put(a));
    mirrorWritingPut(a);
  });
}

export function setRevisionStatus(
  recordId: string,
  revisionId: string,
  status: WritingRevision['status'],
): Promise<void> {
  return enqueue(recordId, async () => {
    const a = await mustGet(recordId);
    const rev = (a.revisions ?? []).find(r => r.id === revisionId);
    if (!rev) throw new Error(`修改稿不存在：${revisionId}`);
    rev.status = status;
    rev.updatedAt = Date.now();
    a.updatedAt = Date.now();
    await withStore<void>('readwrite', s => s.put(a));
    mirrorWritingPut(a);
  });
}

/** 判改结果只写入 revision；快照 gradedEssays 是本次请求实际发送的正文 */
export function saveRevisionGrade(
  recordId: string,
  revisionId: string,
  gradedEssays: [string, string],
  result: WritingGradeResult,
  reportMd?: string,
): Promise<void> {
  return enqueue(recordId, async () => {
    const a = await mustGet(recordId);
    const rev = (a.revisions ?? []).find(r => r.id === revisionId);
    if (!rev) throw new Error(`修改稿不存在：${revisionId}`);
    rev.gradedEssays = [gradedEssays[0], gradedEssays[1]];
    rev.gradedAt = Date.now();
    rev.grade = result;
    rev.band = writingBandOf(result);
    if (reportMd != null) rev.reportMd = reportMd;
    // 判改期间/之后若正文已被编辑，状态保持 draft：结果仍绑定 gradedEssays 快照
    const same = rev.essays[0] === gradedEssays[0] && rev.essays[1] === gradedEssays[1];
    rev.status = same ? 'graded' : 'draft';
    rev.updatedAt = Date.now();
    a.updatedAt = Date.now();
    await withStore<void>('readwrite', s => s.put(a));
    mirrorWritingPut(a);
  });
}

/** 首次判改回写原稿判改字段（不覆盖原稿正文） */
export function updateOriginalGrade(
  recordId: string,
  grade: WritingGradeResult,
  reportMd: string,
  band: number | null,
): Promise<void> {
  return enqueue(recordId, async () => {
    const a = await getWritingAttempt(recordId);
    if (!a) throw new Error(`写作答卷尚未创建：${recordId}`);
    a.originalGrade = grade;
    a.originalReportMd = reportMd;
    a.originalBand = band;
    a.updatedAt = Date.now();
    await withStore<void>('readwrite', s => s.put(a));
    mirrorWritingPut(a);
  });
}

/* 冒烟测试钩子：自动化脚本可直接调用验证一轮 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ieltsWriting = {
    getWritingAttempt, listWritingAttempts, saveWritingAttempt, deleteWritingAttempt,
    createRevision, saveRevisionDraft, setRevisionStatus, saveRevisionGrade, updateOriginalGrade,
  };
}
