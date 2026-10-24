/** 学习数据容器：错题复盘 + 词汇复习进度。体积小，整量 JSON 存 localStorage，
 *  同时镜像到启动器 做题记录\学习数据.json（/api/store/learning）。 */
import type { ReviewItem } from './review';
import type { VocabularyProgress } from './vocabulary';
import { enqueueApi, serverAvailable } from './serverSync';

export interface LearningData {
  version: 1;
  reviewItems: ReviewItem[];
  vocabularyProgress: VocabularyProgress[];
  processedRecordIds: string[];
  updatedAt: number;
}

export const LEARNING_KEY = 'ielts15-learning-data';

export const emptyLearningData = (): LearningData => ({
  version: 1,
  reviewItems: [],
  vocabularyProgress: [],
  processedRecordIds: [],
  updatedAt: 0,
});

function sanitize(raw: unknown): LearningData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<LearningData>;
  if (o.version !== 1) return null;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    version: 1,
    reviewItems: arr<ReviewItem>(o.reviewItems).filter(x => x && typeof x.id === 'string'),
    vocabularyProgress: arr<VocabularyProgress>(o.vocabularyProgress).filter(x => x && typeof x.key === 'string'),
    processedRecordIds: arr<unknown>(o.processedRecordIds).filter((x): x is string => typeof x === 'string'),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
  };
}

export function loadLearningData(): LearningData {
  try {
    const raw = localStorage.getItem(LEARNING_KEY);
    if (!raw) return emptyLearningData();
    return sanitize(JSON.parse(raw)) ?? emptyLearningData();
  } catch {
    return emptyLearningData();
  }
}

export function saveLearningData(data: LearningData): void {
  const next: LearningData = { ...data, version: 1, updatedAt: Date.now() };
  try {
    localStorage.setItem(LEARNING_KEY, JSON.stringify(next));
  } catch {
    /* 配额满：保留内存态，镜像仍会尝试写服务器 */
  }
  mirrorLearning();
}

export function updateLearningData(mutator: (d: LearningData) => void): LearningData {
  const d = loadLearningData();
  mutator(d);
  d.updatedAt = Date.now();
  try {
    localStorage.setItem(LEARNING_KEY, JSON.stringify(d));
  } catch {
    /* 忽略 */
  }
  mirrorLearning();
  return d;
}

export function mirrorLearning(): void {
  enqueueApi(async () => {
    try {
      if (!(await serverAvailable())) return;
      await fetch('/api/store/learning', {
        method: 'PUT',
        body: localStorage.getItem(LEARNING_KEY) ?? JSON.stringify(emptyLearningData()),
      });
    } catch (e) {
      console.warn('学习数据同步失败：', e);
    }
  });
}

/** 启动恢复：服务器有有效数据则以服务器为准；服务器空而本地有则播种。API 失败保留本地。 */
export async function syncLearningFromServer(): Promise<LearningData> {
  const local = loadLearningData();
  try {
    if (!(await serverAvailable())) return local;
    const r = await fetch('/api/store/learning');
    if (r.ok) {
      const server = sanitize(await r.json());
      if (server && (server.reviewItems.length || server.vocabularyProgress.length || server.processedRecordIds.length)) {
        try { localStorage.setItem(LEARNING_KEY, JSON.stringify(server)); } catch { /* 忽略 */ }
        return server;
      }
    }
    // 服务器为空：本地有数据就播种
    if (local.reviewItems.length || local.vocabularyProgress.length || local.processedRecordIds.length) {
      mirrorLearning();
    }
  } catch (e) {
    console.warn('从本地文件夹恢复学习数据失败：', e);
  }
  return local;
}

/* 冒烟测试钩子 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ieltsLearning = {
    loadLearningData, saveLearningData, updateLearningData, syncLearningFromServer, mirrorLearning,
  };
}
