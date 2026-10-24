/** 阅读判分：答案归一化、逐题对错、原始分与 Band 折算 */
import type { Passage, Question, QuestionGroup } from '../types';

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
}

/** 标准答案的合法变体："in (a) hurry/in hurry" → ['in a hurry', 'in hurry']；"(a) dentist" → 含/不含冠词均可 */
export function keyVariants(key: string): string[] {
  const out = new Set<string>();
  for (const alt of key.split('/')) {
    const a = alt.trim();
    if (!a) continue;
    out.add(normalize(a));
    out.add(normalize(a.replace(/\([^)]*\)/g, ' '))); // 去掉括号内可选词
  }
  out.delete('');
  return [...out];
}

/**
 * 一个题号含两个空（阅读 Q26 "both ___ and ___"、听力 Q27 "___ to ___"）：
 * 作答按 UI 约定存成 "值1 | 值2"。原文可能用 and / to / 连字符 / 空格连接，两空也可能可互换，
 * 这些都是"书写形式"，因此把 "x | y" 通用展开成若干候选写法，再与 answers.json 里的
 * 等价写法比对 —— 判分函数里不写任何题目专属数据，顺序是否可互换也由题包数据决定。
 */
function slotCandidates(ua: string): string[] {
  const parts = ua.split(' | ').map(normalize).filter(Boolean);
  if (parts.length !== 2) return [ua];
  const [x, y] = parts;
  return [
    ua,
    `${x} ${y}`, `${x} and ${y}`, `${x} to ${y}`, `${x}-${y}`,
    `${y} ${x}`, `${y} and ${x}`, `${y} to ${x}`, `${y}-${x}`,
  ];
}

export function isCorrect(userAns: any, key: string): boolean {
  if (userAns == null) return false;
  const ua = normalize(String(userAns));
  if (!ua) return false;
  const variants = keyVariants(key);
  if (slotCandidates(ua).some(c => variants.includes(c))) return true;
  const trimmedKey = key.trim();
  // Heading labels are printed as "ii. Heading"; the answer key is just "ii".
  if (/^[ivxl]+$/i.test(trimmedKey) && ua.replace(/\.$/, '') === normalize(key)) return true;
  // 旧存档兼容（issue-07）：单选题当年存的是「字母 + 整句选项文字」，而标准答案只有单个字母
  // → 对"标准答案是单个字母 A-E"的题取作答首个字母再比（零迁移，老答卷也能判对）
  if (/^[a-e]$/i.test(trimmedKey)) return new RegExp(`^${trimmedKey}(?:\\b|[.）)])`, 'i').test(String(userAns).trim());
  return false;
}

export interface GradeRow {
  no: number;
  type: Question['type'];
  user: string;      // 我的答案（展示用）
  key: string;       // 标准答案原文
  correct: boolean;
  unanswered: boolean;
}

function displayUser(v: any): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/** 多选共享组（Q20/21 共选 A-E 中两个）：每题 1 分，按所选字母集合与各自 key 匹配 */
function isSharedMultiple(g: QuestionGroup): boolean {
  return g.questions.length > 1 && g.questions.every(q => q.type === 'multiple');
}

export function gradeReading(
  passages: Passage[],
  answers: Record<number, any>,
  key: Record<number, string>,
): { rows: GradeRow[]; score: number; total: number } {
  const rows: GradeRow[] = [];
  for (const ps of passages) {
    for (const g of ps.groups) {
      if (isSharedMultiple(g)) {
        const chosen: string[] = Array.isArray(answers[g.questions[0].no]) ? answers[g.questions[0].no] : [];
        const chosenNorm = chosen.map(normalize);
        for (const q of g.questions) {
          const k = key[q.no] ?? '';
          rows.push({
            no: q.no,
            type: q.type,
            user: chosen.join(', ') || '—',
            key: k || '—',
            correct: k ? chosenNorm.includes(normalize(k)) : false,
            unanswered: chosen.length === 0,
          });
        }
      } else {
        for (const q of g.questions) {
          const v = answers[q.no];
          const k = key[q.no] ?? '';
          rows.push({
            no: q.no,
            type: q.type,
            user: displayUser(v),
            key: k || '—',
            correct: k ? isCorrect(v, k) : false,
            unanswered: v == null || v === '' || (Array.isArray(v) && v.length === 0),
          });
        }
      }
    }
  }
  rows.sort((a, b) => a.no - b.no);
  const score = rows.filter(r => r.key !== '—' && r.correct).length;
  return { rows, score, total: rows.length };
}

/**
 * Academic Reading 原始分 → Band 折算表。
 * 来源：公开的 Academic Reading 原始分换算标准（39-40→9.0 … 4-5→2.5）。
 */
const BAND_TABLE: [number, number][] = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5],
  [23, 6], [20, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5],
  [6, 3], [4, 2.5], [0, 2],
];

/** 仅整卷（40 题）按官方表折算；非整卷返回 null */
export function bandFor(score: number, total: number): number | null {
  if (total !== 40) return null;
  for (const [min, band] of BAND_TABLE) {
    if (score >= min) return band;
  }
  return 2;
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** 官方 Overall 舍入规则：平均分四舍五入到 0.5 档（.25 进 .5，.75 进下一整分） */
export function roundBand(mean: number): number {
  return Math.round(mean * 2) / 2;
}

/**
 * Listening 原始分 → Band 折算表（与阅读不同，分开实现）。
 * 来源：公开的 Listening 原始分换算标准。
 */
const LISTENING_BAND_TABLE: [number, number][] = [
  [39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5],
  [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5],
  [6, 3], [4, 2.5], [0, 2],
];

export function bandForListening(score: number, total: number): number | null {
  if (total !== 40) return null;
  for (const [min, band] of LISTENING_BAND_TABLE) {
    if (score >= min) return band;
  }
  return 2;
}
