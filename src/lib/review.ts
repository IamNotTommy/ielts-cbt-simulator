/** 轻量错题复盘：只做错题引用 + 错因/状态/重做，不复制题库、不复制标准答案。
 *  收录发生在交卷（创建 PracticeRecord）的同一分支，重复打开成绩页不会重复计数。 */
import type { QuestionType } from '../types';
import type { PracticeRecord } from './history';
import type { StoredTest } from './store';
import { loadLearningData, updateLearningData } from './learningStore';
import { adaptListening } from './adapter';

export type ReviewSkill = 'reading' | 'listening';
export type ReviewStatus = 'pending' | 'learning' | 'mastered';
export type ReviewCause =
  | 'vocab'
  | 'locate'
  | 'comprehension'
  | 'instruction'
  | 'spelling'
  | 'time'
  | 'audio'
  | 'other';

export interface ReviewAttempt {
  at: number;
  user: string;
  correct: boolean;
}

export interface ReviewItem {
  id: string;                    // `${testId}:${skill}:${no}`
  testId: string;
  testName: string;
  skill: ReviewSkill;
  no: number;
  type: QuestionType;
  status: ReviewStatus;
  cause?: ReviewCause;
  lastRecordId: string;
  lastUser: string;
  wasBlank: boolean;
  wrongCount: number;
  attempts: ReviewAttempt[];
  createdAt: number;
  updatedAt: number;
  masteredAt?: number;
}

export const REVIEW_CAUSES: { key: ReviewCause; label: string; skill?: ReviewSkill }[] = [
  { key: 'vocab', label: '词汇不熟' },
  { key: 'locate', label: '定位错误' },
  { key: 'comprehension', label: '理解错误' },
  { key: 'instruction', label: '审题不清' },
  { key: 'spelling', label: '拼写/格式' },
  { key: 'time', label: '时间不足' },
  { key: 'audio', label: '音频没听清', skill: 'listening' },
  { key: 'other', label: '其他' },
];

export const causeLabel = (c?: ReviewCause) => REVIEW_CAUSES.find(x => x.key === c)?.label ?? '未标注';

export const REVIEW_TYPE_LABEL: Record<QuestionType, string> = {
  tfng: '判断题',
  single: '单选',
  multiple: '多选',
  gapfill: '填空',
  matchingHeadings: '匹配标题',
  matchingFeatures: '匹配特征',
  matchingInfo: '匹配段落信息',
};

export const skillLabel = (s: ReviewSkill) => (s === 'reading' ? '阅读' : '听力');
export const statusLabel = (s: ReviewStatus) =>
  s === 'pending' ? '待复盘' : s === 'learning' ? '仍需复习' : '已掌握';

/* ---- 收录：只在创建 PracticeRecord 后调用一次 ---- */

function typeFromTest(test: StoredTest | undefined, skill: ReviewSkill, no: number): QuestionType | undefined {
  if (!test) return undefined;
  if (skill === 'reading') {
    for (const ps of test.passages ?? []) {
      for (const g of ps.groups ?? []) {
        const q = g.questions.find(x => x.no === no);
        if (q) return q.type;
      }
    }
    return undefined;
  }
  if (!test.listening?.sections?.length) return undefined;
  for (const ps of adaptListening(test.listening.sections, [])) {
    for (const g of ps.groups ?? []) {
      const q = g.questions.find(x => x.no === no);
      if (q) return q.type;
    }
  }
  return undefined;
}

/** 把一条练习记录里的错题（含漏答）收进复盘。返回新增/更新的题数。 */
export function collectReviewFromRecord(rec: PracticeRecord, test?: StoredTest): number {
  const data = loadLearningData();
  if (data.processedRecordIds.includes(rec.id)) return 0;   // 幂等：同一场只处理一次

  const now = Date.now();
  let touched = 0;

  updateLearningData(d => {
    const push = (skill: ReviewSkill, rows: { n: number; you: string; key: string; ok: boolean; type?: QuestionType }[]) => {
      for (const r of rows) {
        if (r.key === '—' || r.ok) continue;              // 没有标准答案的题不算错题
        const type = r.type ?? typeFromTest(test, skill, r.n) ?? 'gapfill';
        const id = `${rec.testId}:${skill}:${r.n}`;
        const wasBlank = r.you === '—';
        const existing = d.reviewItems.find(x => x.id === id);
        if (existing) {
          existing.lastRecordId = rec.id;
          existing.lastUser = r.you;
          existing.wasBlank = wasBlank;
          existing.wrongCount += 1;
          existing.updatedAt = now;
          if (existing.status === 'mastered') {
            existing.status = 'pending';
            delete existing.masteredAt;
          }
        } else {
          d.reviewItems.push({
            id,
            testId: rec.testId,
            testName: rec.testName,
            skill,
            no: r.n,
            type,
            status: 'pending',
            lastRecordId: rec.id,
            lastUser: r.you,
            wasBlank,
            wrongCount: 1,
            attempts: [],
            createdAt: now,
            updatedAt: now,
          });
        }
        touched++;
      }
    };
    push('listening', rec.listening?.table ?? []);
    push('reading', rec.reading?.table ?? []);
    if (!d.processedRecordIds.includes(rec.id)) d.processedRecordIds.push(rec.id);
  });
  return touched;
}

/* ---- 查询 / 筛选 ---- */

export interface ReviewFilters {
  skill?: ReviewSkill | 'all';
  type?: QuestionType | 'all';
  cause?: ReviewCause | 'all';
  status?: ReviewStatus | 'all';
  testId?: string | 'all';
}

export function filterReviewItems(items: ReviewItem[], f: ReviewFilters): ReviewItem[] {
  return items.filter(it =>
    (!f.skill || f.skill === 'all' || it.skill === f.skill)
    && (!f.type || f.type === 'all' || it.type === f.type)
    && (!f.cause || f.cause === 'all' || it.cause === f.cause)
    && (!f.status || f.status === 'all' || it.status === f.status)
    && (!f.testId || f.testId === 'all' || it.testId === f.testId));
}

export function reviewStats(items: ReviewItem[]) {
  let pending = 0, learning = 0, mastered = 0;
  for (const it of items) {
    if (it.status === 'pending') pending++;
    else if (it.status === 'learning') learning++;
    else mastered++;
  }
  return { pending, learning, mastered, total: items.length };
}

/** 本次复盘队列：pending 优先 → learning → 同优先级按 updatedAt 从早到晚；题包已删的跳过 */
export function buildReviewSession(
  items: ReviewItem[],
  tests: StoredTest[],
  limit = 10,
): { queue: ReviewItem[]; skippedMissing: ReviewItem[] } {
  const hasTest = (id: string) => tests.some(t => t.id === id);
  const rank = (s: ReviewStatus) => (s === 'pending' ? 0 : s === 'learning' ? 1 : 2);
  const open = items.filter(it => it.status !== 'mastered');
  const skippedMissing = open.filter(it => !hasTest(it.testId));
  const usable = open
    .filter(it => hasTest(it.testId))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.updatedAt - b.updatedAt);
  return { queue: usable.slice(0, limit), skippedMissing };
}

/* ---- 状态变更 ---- */

export function setReviewStatus(id: string, status: ReviewStatus, cause?: ReviewCause): void {
  updateLearningData(d => {
    const it = d.reviewItems.find(x => x.id === id);
    if (!it) return;
    it.status = status;
    it.updatedAt = Date.now();
    if (cause) it.cause = cause;
    if (status === 'mastered') it.masteredAt = Date.now();
    else delete it.masteredAt;
  });
}

export function setReviewCause(id: string, cause?: ReviewCause): void {
  updateLearningData(d => {
    const it = d.reviewItems.find(x => x.id === id);
    if (!it) return;
    if (cause) it.cause = cause;
    else delete it.cause;
    it.updatedAt = Date.now();
  });
}

/** 追加一次重做记录（每个 attemptId 只能调用一次，由 UI 的提交锁保证） */
export function addReviewAttempt(id: string, user: string, correct: boolean): void {
  updateLearningData(d => {
    const it = d.reviewItems.find(x => x.id === id);
    if (!it) return;
    it.attempts = [...(it.attempts ?? []), { at: Date.now(), user, correct }];
    it.lastUser = user;
    it.updatedAt = Date.now();
  });
}

export function removeReviewItem(id: string): void {
  updateLearningData(d => {
    d.reviewItems = d.reviewItems.filter(x => x.id !== id);
  });
}

/** 某场练习被删除时只保留复盘引用（按规格：删除练习记录不删复盘） */
export function reviewItemsForRecord(recordId: string): ReviewItem[] {
  return loadLearningData().reviewItems.filter(it => it.lastRecordId === recordId);
}
