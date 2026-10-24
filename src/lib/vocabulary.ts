/** 统一词条模型 + 词汇间隔复习（SRS）。
 *  精读词汇册与精听生词本先合并成 VocabularyItem，再由 learningStore 里的
 *  VocabularyProgress 决定到期队列；句子只浏览，不进入 SRS。 */
import type { LWord } from './listenLab';
import type { WordbookEntry } from './intensive';

export interface VocabularyItem {
  key: string;                 // `word:${text.trim().toLowerCase()}`
  text: string;
  kind: 'word' | 'sentence';
  updatedAt: number;
  note?: string;
  phonetic?: string;
  gloss?: string;
  sentence?: string;
  context?: string;
  reading?: {
    entryId: string;
    testId: string;
    testName: string;
    passageIdx: number;
    noteId: string;
  };
  listening?: {
    entryId: string;
    testId: string;
    testName: string;
    section: number;
    sentIdx: number;
    sentence: string;
  };
}

const wordKey = (text: string) => `word:${text.trim().toLowerCase()}`;
const sentKey = (text: string) => `sentence:${text.trim().toLowerCase()}`;

/** 同词（忽略大小写）合并精读与精听来源，两个来源都保留，不互相覆盖 */
export function buildVocabularyItems(wbEntries: WordbookEntry[], lwEntries: LWord[]): VocabularyItem[] {
  const map = new Map<string, VocabularyItem>();

  for (const e of wbEntries) {
    const text = (e.text ?? '').trim();
    if (!text) continue;
    const kind: 'word' | 'sentence' = e.kind === 'sentence' ? 'sentence' : 'word';
    const key = kind === 'word' ? wordKey(text) : sentKey(text);
    const item: VocabularyItem = {
      key,
      text,
      kind,
      updatedAt: e.updatedAt || 0,
      ...(e.note ? { note: e.note } : {}),
      ...(e.sentence ? { sentence: e.sentence } : {}),
      ...(e.context ? { context: e.context } : {}),
      reading: {
        entryId: e.id,
        testId: e.testId,
        testName: e.testName,
        passageIdx: e.passageIdx,
        noteId: e.noteId,
      },
    };
    const prev = map.get(key);
    if (prev) {
      // 同词已在精听里出现：保留两个来源，批注/例句取较新的
      prev.reading = item.reading;
      if (!prev.note && e.note) prev.note = e.note;
      if (!prev.sentence && e.sentence) prev.sentence = e.sentence;
      if (!prev.context && e.context) prev.context = e.context;
      prev.updatedAt = Math.max(prev.updatedAt, item.updatedAt);
    } else {
      map.set(key, item);
    }
  }

  for (const e of lwEntries) {
    const text = (e.word ?? '').trim();
    if (!text) continue;
    const key = wordKey(text);
    const src = e.srcs?.[0];
    const prev = map.get(key);
    const listening = src
      ? {
        entryId: e.id,
        testId: src.testId,
        testName: src.testName,
        section: src.section,
        sentIdx: src.sentIdx,
        sentence: src.sent ?? '',
      }
      : undefined;
    if (prev) {
      if (listening) prev.listening = listening;
      if (!prev.phonetic && e.phonetic) prev.phonetic = e.phonetic;
      if (!prev.gloss && e.gloss) prev.gloss = e.gloss;
      if (!prev.sentence && src?.sent) prev.sentence = src.sent;
      prev.updatedAt = Math.max(prev.updatedAt, e.updatedAt || 0);
    } else {
      map.set(key, {
        key,
        text,
        kind: 'word',
        updatedAt: e.updatedAt || 0,
        ...(e.phonetic ? { phonetic: e.phonetic } : {}),
        ...(e.gloss ? { gloss: e.gloss } : {}),
        ...(src?.sent ? { sentence: src.sent } : {}),
        ...(listening ? { listening } : {}),
      });
    }
  }

  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ================= 复习进度（SRS） ================= */

export type ReviewRating = 'again' | 'hard' | 'good';

export interface VocabularyProgress {
  key: string;
  text: string;
  reps: number;
  intervalDays: number;
  dueAt: number;
  lastReviewedAt?: number;
  lastRating?: ReviewRating;
  lapses: number;
  suspended?: boolean;
}

export const GOOD_INTERVALS = [3, 7, 14, 30, 60, 120, 180] as const;
const AGAIN_DELAY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** good 的下一个间隔：3 → 7 → 14 → 30 → 60 → 120 → 180（超过保持 180） */
export function nextGoodInterval(intervalDays: number): number {
  for (const d of GOOD_INTERVALS) if (d > intervalDays) return d;
  return GOOD_INTERVALS[GOOD_INTERVALS.length - 1];
}

/** 三档反馈 → 新进度。item 必传，旧进度不存在时用它补 key/text */
export function applyRating(
  item: VocabularyItem,
  progress: VocabularyProgress | undefined,
  rating: ReviewRating,
  now: number,
): VocabularyProgress {
  const base: VocabularyProgress = progress
    ? { ...progress }
    : { key: item.key, text: item.text, reps: 0, intervalDays: 0, dueAt: now, lapses: 0 };
  base.key = item.key;
  base.text = item.text;
  base.lastReviewedAt = now;
  base.lastRating = rating;

  if (rating === 'again') {
    base.reps = 0;
    base.intervalDays = 0;
    base.lapses += 1;
    base.dueAt = now + AGAIN_DELAY_MS;
    return base;
  }
  if (rating === 'hard') {
    base.intervalDays = progress && progress.intervalDays > 0
      ? Math.max(1, Math.round(progress.intervalDays * 0.5))
      : 1;
    base.reps = progress ? progress.reps : 1;
    base.dueAt = now + base.intervalDays * DAY_MS;
    return base;
  }
  // good
  base.intervalDays = nextGoodInterval(progress ? progress.intervalDays : 0);
  base.reps = (progress ? progress.reps : 0) + 1;
  base.dueAt = now + base.intervalDays * DAY_MS;
  return base;
}

export const progressMap = (list: VocabularyProgress[]): Map<string, VocabularyProgress> =>
  new Map((list ?? []).map(p => [p.key, p]));

export interface ReviewQueueOptions {
  newLimit?: number;   // 新词上限（默认 10）
  cap?: number;        // 本次最多展示（默认 50）
}

/** 今日队列：到期词按 dueAt 升序，再补没有进度的新词（按 updatedAt 从早到晚） */
export function buildReviewQueue(
  items: VocabularyItem[],
  progress: VocabularyProgress[] | Map<string, VocabularyProgress>,
  now: number,
  options: ReviewQueueOptions = {},
): VocabularyItem[] {
  const map = progress instanceof Map ? progress : progressMap(progress);
  const newLimit = options.newLimit ?? 10;
  const cap = options.cap ?? 50;
  const words = items.filter(it => it.kind === 'word');

  const due: { item: VocabularyItem; dueAt: number }[] = [];
  const fresh: VocabularyItem[] = [];
  for (const it of words) {
    const p = map.get(it.key);
    if (!p) { fresh.push(it); continue; }
    if (p.suspended) continue;
    if (p.dueAt <= now) due.push({ item: it, dueAt: p.dueAt });
  }
  due.sort((a, b) => a.dueAt - b.dueAt);
  fresh.sort((a, b) => a.updatedAt - b.updatedAt);
  return [...due.map(d => d.item), ...fresh.slice(0, newLimit)].slice(0, cap);
}

export interface QueueCounts {
  due: number;
  fresh: number;
  total: number;
  queueLength: number;
  overflow: number;
  nextDueAt: number | null;
}

export function queueCounts(
  items: VocabularyItem[],
  progress: VocabularyProgress[] | Map<string, VocabularyProgress>,
  now: number,
  options: ReviewQueueOptions = {},
): QueueCounts {
  const map = progress instanceof Map ? progress : progressMap(progress);
  const words = items.filter(it => it.kind === 'word');
  let due = 0, fresh = 0, nextDueAt: number | null = null;
  for (const it of words) {
    const p = map.get(it.key);
    if (!p) { fresh++; continue; }
    if (p.suspended) continue;
    if (p.dueAt <= now) due++;
    else nextDueAt = nextDueAt == null ? p.dueAt : Math.min(nextDueAt, p.dueAt);
  }
  const newLimit = options.newLimit ?? 10;
  const cap = options.cap ?? 50;
  const queueLength = Math.min(cap, due + Math.min(fresh, newLimit));
  return { due, fresh, total: due + fresh, queueLength, overflow: due + Math.min(fresh, newLimit) - queueLength, nextDueAt };
}

/** 某词下次到期时间的可读文案 */
export function dueLabel(p: VocabularyProgress | undefined, now: number): string {
  if (!p) return '新词';
  if (p.suspended) return '已暂停';
  const diff = p.dueAt - now;
  if (diff <= 0) return '今日到期';
  if (diff < 3600000) return '1 小时内到期';
  if (diff < DAY_MS) return `${Math.round(diff / 3600000)} 小时后到期`;
  const days = Math.round(diff / DAY_MS);
  return days <= 1 ? '明天到期' : `${days} 天后到期`;
}

export const ratingLabel = (r: ReviewRating) =>
  r === 'again' ? '不认识' : r === 'hard' ? '模糊' : '认识';
