/** 练习历史记录（只存浏览器本地）：
 *  每交卷一次记一条，含科目、得分、用时，用于首页「练习记录」列表与「再做一次」。 */
import type { WritingGradeResult } from './llm';
import type { QuestionType } from '../types';
import { mirrorHistory } from './serverSync';

/** 交卷后逐题明细的一行（全部题号，不只错题）。
 *  ⚠ you 取的是**判分函数**给出的"你的答案"（gradeReading 的 row.user），
 *  共享选项组（21+22 共用一个 A-E 选项组）这种只挂在组内首题的作答，
 *  经由判分函数读取后每一行都是同一份所选字母，不会出现组内其余题空白 ✗。 */
export interface AttemptRow {
  n: number;                  // 题号
  you: string;                // 你的答案（未作答为 '—'）
  key: string;                // 标准答案原文（未给答案的题为 '—'）
  ok: boolean;                // 是否判对
  /** 题型（新记录写入；旧记录允许缺省 → 分析里计为"题型未知"） */
  type?: QuestionType;
}

export interface SkillScore {
  score: number;
  total: number;
  band: number | null;   // 分数表可能给不出 Band（题数异常时）→ null
  /** 逐题对错表（最近 TABLE_KEEP 条记录才保留；老记录没有这个字段） */
  table?: AttemptRow[];
  /** 逐题用时快照（成绩单表格里那一列；缺省时「看对错表」把该列显示为 —） */
  times?: Record<number, number>;
}

export interface PracticeRecord {
  id: string;
  at: number;                 // 交卷时间戳
  testId: string;             // 对应题库里的题包 id（题包被删也能显示记录）
  testName: string;
  scope: string;              // passage / reading / listening / lsection / writing / full
  mode: string;               // reading / listening / writing
  durationSec: number;
  reading?: SkillScore;
  listening?: SkillScore;
  writing?: boolean;          // 写作是否写了内容（写作不自动判分）
  writingWords?: number[];    // 各 Task 词数（可选）
  /** 写作 AI 判改总 Band（Task2 权重 2/3 折算后；判改是交卷后异步完成的，由 updateRecord 回写） */
  writingBand?: number | null;
  /** 写作四维判改结果（体积小，所有记录都保留） */
  writingGrade?: WritingGradeResult;
  /** 评分理由 Markdown 报告（约 12 KB/条，与逐题表同策略：只有最近 TABLE_KEEP 条保留） */
  writingReportMd?: string;
}

const KEY = 'ielts15-history';
const MAX = 200;              // 最多保留 200 条，避免无限增长
/** 只给最近 N 条记录保留完整逐题表：一张 80 行的表约 6 KB，200 条会挤爆 localStorage 配额 */
export const TABLE_KEEP = 20;

export function listRecords(): PracticeRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as PracticeRecord[]) : [];
  } catch {
    return [];
  }
}

/** 去掉一条记录里的逐题表与 MD 报告（保留分数与 Band），用于配额裁剪与超配额兜底 */
function withoutTables(r: PracticeRecord): PracticeRecord {
  const strip = (s?: SkillScore): SkillScore | undefined =>
    s ? { score: s.score, total: s.total, band: s.band } : s;
  const out: PracticeRecord = {
    ...r,
    ...(r.reading ? { reading: strip(r.reading) } : {}),
    ...(r.listening ? { listening: strip(r.listening) } : {}),
  };
  delete out.writingReportMd;   // MD 与逐题表同策略裁剪；writingGrade/writingBand 体积小，保留
  return out;
}

/** 记录一条练习：最新在前；只有最近 TABLE_KEEP 条保留逐题表，更早的自动裁掉（分数/Band 仍在）。
 *  at 倒序 → 数组下标 0 就是最新那条，下标 >= TABLE_KEEP 的整条记录裁掉 table。 */
export function addRecord(r: PracticeRecord): void {
  const all = [r, ...listRecords()].slice(0, MAX);
  const capped = all.map((rec, i) => (i < TABLE_KEEP ? rec : withoutTables(rec)));
  try {
    localStorage.setItem(KEY, JSON.stringify(capped));
  } catch {
    /* 配额不够（表体积大）：退化为所有记录都不存逐题表，至少把成绩留下 */
    try {
      localStorage.setItem(KEY, JSON.stringify(capped.map(withoutTables)));
    } catch {
      /* 存储不可用时忽略：不影响交卷 */
    }
  }
  mirrorHistory();
}

/** 交卷后异步补齐字段（写作 AI 判改结果 / Band / MD 报告）：找到 id 合并 patch 写回。
 *  配额失败时退化为去掉所有记录的逐题表与 MD 报告再写一次（分数与 Band 仍在）。 */
export function updateRecord(id: string, patch: Partial<PracticeRecord>): void {
  const all = listRecords();
  const idx = all.findIndex(r => r.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(all.map(withoutTables)));
    } catch { /* 存储不可用时忽略：不影响界面 */ }
  }
  mirrorHistory();
}

export function removeRecord(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listRecords().filter(r => r.id !== id)));
  } catch { /* 忽略 */ }
  mirrorHistory();
}

/** 批量写练习记录（恢复备份用）：只镜像一次 */
export function saveRecordsAll(list: PracticeRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* 忽略 */ }
  mirrorHistory();
}

export function clearRecords(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* 忽略 */ }
  mirrorHistory();
}

/** 时长显示：mm:ss（>1 小时显示 h:mm:ss） */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/** 科目/范围的中文名 */
export function scopeName(scope: string, testHasListening?: boolean): string {
  switch (scope) {
    case 'passage': return '阅读单篇';
    case 'reading': return '阅读整卷';
    case 'listening': return '听力';
    case 'lsection': return '听力单节';
    case 'writing': return '写作';
    case 'full': return testHasListening ? '全套（听力+阅读+写作）' : '整套（阅读+写作）';
    default: return scope;
  }
}
