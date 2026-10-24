/** 本地存储：LLM 配置、已抽取题库、按套题隔离的作答数据 */
import type { Passage, WritingTask } from '../types';
import type { ExtractedListeningSection, ExtractedTest } from '../types/extracted';
import type { LlmConfig } from './llm';
import { loadImage, saveImage, deleteTestMedia } from './media';
import { mirrorTests, mirrorMediaDelete } from './serverSync';

/** 题图在 IndexedDB 里的槽位：path 说明它属于哪里，key 是媒体键 */
export interface ImageSlot {
  path: string;   // 'writing/0' | 'listening/<sectionIdx>/<groupIdx>'
  key: string;    // `${testId}/img${n}`
}

export interface StoredTest {
  id: string;               // demo 或文件 hash 前 12 位
  name: string;             // 展示名，如 "真题集 7 · Test 1"
  fileHash?: string;
  source: 'demo' | 'llm' | 'import';
  createdAt: number;
  extracted?: ExtractedTest;
  passages: Passage[];
  writingTasks: WritingTask[];
  answers: Record<number, string> | null;
  issues: string[];
  /** 题图（地图/平面图/流程图/写作图表）存 IndexedDB；localStorage 里只留槽位记录。
   *  这样做是因为 localStorage 配额约 5 MB，几套题的 base64 图片就会把导入顶爆。 */
  images?: ImageSlot[];
  /** 听力：sections + 分科答案；音频 Blob 存 IndexedDB（key: `${id}/s${n}`，每节一个文件） */
  listening?: {
    sections: ExtractedListeningSection[];
    answers: Record<number, string> | null;
  };
}

// v1.5 与旧版同域共存，key 全部加前缀隔离
const K = {
  llm: 'ielts15-llm-config',
  tests: 'ielts15-tests',
};

/* ---- LLM 配置（双槽位，含旧版单槽位迁移） ---- */
export function loadLlmConfig(): LlmConfig {
  const empty: LlmConfig = {
    text: { baseUrl: '', apiKey: '', model: '' },
    vision: { baseUrl: '', apiKey: '', model: '' },
    grader: { baseUrl: '', apiKey: '', model: '' },
  };
  try {
    const raw = JSON.parse(localStorage.getItem(K.llm) ?? '{}');
    if (raw && typeof raw === 'object' && 'baseUrl' in raw) {
      // 旧版 {baseUrl, apiKey, model} → 文本槽位
      return { ...empty, text: { baseUrl: raw.baseUrl ?? '', apiKey: raw.apiKey ?? '', model: raw.model ?? '' } };
    }
    return {
      text: { ...empty.text, ...(raw.text ?? {}) },
      vision: { ...empty.vision, ...(raw.vision ?? {}) },
      grader: { ...empty.grader, ...(raw.grader ?? {}) },
    };
  } catch {
    return empty;
  }
}
export function saveLlmConfig(cfg: LlmConfig) {
  localStorage.setItem(K.llm, JSON.stringify(cfg));
}

/* ---- 题库 ---- */
export function listTests(): StoredTest[] {
  try {
    return JSON.parse(localStorage.getItem(K.tests) ?? '[]');
  } catch {
    return [];
  }
}

export function saveTest(t: StoredTest) {
  const all = listTests().filter(x => x.id !== t.id);
  all.unshift(t);
  localStorage.setItem(K.tests, JSON.stringify(all));
  mirrorTests();   // 镜像到启动器的本地文件夹（API 不存在时自动跳过）
}

export function getTest(id: string): StoredTest | null {
  return listTests().find(t => t.id === id) ?? null;
}

/** 批量写题库（恢复备份用）：只镜像一次，避免逐套 PUT */
export function saveTestsAll(list: StoredTest[]): void {
  localStorage.setItem(K.tests, JSON.stringify(list));
  mirrorTests();
}

export function deleteTest(id: string) {
  localStorage.setItem(K.tests, JSON.stringify(listTests().filter(t => t.id !== id)));
  void deleteTestMedia(id);   // 顺手清掉该套题在 IndexedDB 里的音频与图片
  mirrorTests();
  mirrorMediaDelete(id);      // 同步删除服务器文件夹里的媒体
}

/* ---- 题图与 localStorage 的分工（localStorage 配额只有 ~5 MB，图片必须放 IndexedDB） ---- */

/** 找出对象里所有内联图片（data URL）及其所属位置 */
export function collectInlineImages(t: StoredTest): { path: string; value: string }[] {
  const out: { path: string; value: string }[] = [];
  (t.writingTasks ?? []).forEach((w, i) => {
    if (typeof w.figureImage === 'string' && w.figureImage.startsWith('data:')) out.push({ path: `writing/${i}`, value: w.figureImage });
  });
  (t.listening?.sections ?? []).forEach((s, si) => {
    (s.question_groups ?? []).forEach((g, gi) => {
      const v = (g as { figure_image?: string }).figure_image;
      if (typeof v === 'string' && v.startsWith('data:')) out.push({ path: `listening/${si}/${gi}`, value: v });
    });
  });
  // 阅读：passages 存的是**适配后**的结构（题组字段名是 groups），题图字段是 camelCase 的 figureImage
  (t.passages ?? []).forEach((p, pi) => {
    (p.groups ?? []).forEach((g, gi) => {
      const v = g.figureImage;
      if (typeof v === 'string' && v.startsWith('data:')) out.push({ path: `reading/${pi}/${gi}`, value: v });
    });
  });
  return out;
}

/** 把内联图片换成空串（返回副本）：用于写 localStorage。所有长 data URL 都会被清掉，防止漏改字段。 */
export function stripInlineImages(t: StoredTest): StoredTest {
  const copy = JSON.parse(JSON.stringify(t, (_k, v) =>
    (typeof v === 'string' && v.startsWith('data:') && v.length > 4096) ? '' : v));
  return copy;
}

/** 依据槽位把图片填回对象（返回副本） */
export function attachImages(t: StoredTest, values: Record<string, string>): StoredTest {
  const copy: StoredTest = JSON.parse(JSON.stringify(t));
  for (const slot of t.images ?? []) {
    const v = values[slot.path];
    if (!v) continue;
    const [kind, a, b] = slot.path.split('/');
    if (kind === 'writing') {
      const i = Number(a);
      if (copy.writingTasks?.[i]) copy.writingTasks[i].figureImage = v;
    } else if (kind === 'listening') {
      const g = copy.listening?.sections?.[Number(a)]?.question_groups?.[Number(b)] as { figure_image?: string } | undefined;
      if (g) g.figure_image = v;
    } else if (kind === 'reading') {
      const g = copy.passages?.[Number(a)]?.groups?.[Number(b)];
      if (g) g.figureImage = v;
    }
  }
  return copy;
}

/** 把某套题的内联图片搬进 IndexedDB，并在对象上记录槽位（返回带槽位、图片仍在内存里的对象） */
export async function offloadImages(t: StoredTest): Promise<StoredTest> {
  const inline = collectInlineImages(t);
  if (!inline.length) return t;
  const slots: ImageSlot[] = [];
  for (let i = 0; i < inline.length; i++) {
    const key = `${t.id}/img${i}`;
    try { await saveImage(key, inline[i].value); } catch { /* 存储不可用时忽略：退化为不存图片 */ }
    slots.push({ path: inline[i].path, key });
  }
  t.images = slots;
  return t;
}

/** 从 IndexedDB 把图片填回（供读取题库时使用） */
export async function hydrateTest(t: StoredTest): Promise<StoredTest> {
  if (!t.images?.length) return t;
  const values: Record<string, string> = {};
  for (const slot of t.images) {
    try {
      const v = await loadImage(slot.key);
      if (v) values[slot.path] = v;
    } catch { /* 忽略 */ }
  }
  return attachImages(t, values);
}

/** 一次性迁移：把历史版本里"图片内联在 localStorage"的题包搬到 IndexedDB，腾出配额。
 *  返回是否发生了迁移（调用方据此刷新列表）。 */
export async function migrateInlineImages(): Promise<boolean> {
  const all = listTests();
  let changed = false;
  for (const t of all) {
    if (!collectInlineImages(t).length) continue;
    await offloadImages(t);
    try {
      saveTest(stripInlineImages(t));   // 写回"无图片"版本（体积骤减，通常能成功）
      changed = true;
    } catch { /* 配额仍不够就跳过，保持原样 */ }
  }
  return changed;
}

/* ---- 按套题隔离的作答数据 ---- */
export const tk = (testId: string, what: string) => `ielts15-${testId}-${what}`;

/* ---- 做题会话配置（模式 + 计时） ---- */
export interface SessionConfig {
  scope: 'passage' | 'reading' | 'writing' | 'listening' | 'lsection' | 'full';
  passageIdx: number;      // scope=passage 时生效
  minutes: number;         // 阅读（或单篇）分钟数
  writingMinutes: number;  // 写作分钟数
  gradeWriting?: boolean;  // 开考时选择：写作 AI 判改（需已配文本模型）
  listeningMode?: 'real' | 'practice'; // scope=listening 时：实考/练习模式
}
