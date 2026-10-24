/** 作答记录导出为 Markdown（提示词 E 第 2 节）。
 *  红线：判分后也只写对错，绝不写标准答案原文（保护复练价值）。 */
import type { StoredTest } from './store';
import type { GradeRow } from './scoring';
import { fmtTime, roundBand } from './scoring';
import bandDescriptors from '../assets/bandDescriptors.json';
import type { WritingGrade, WritingGradeResult } from './llm';

export interface ReportData {
  test: StoredTest;
  modeLabel: string;          // 阅读整卷 / 写作 / Full length 等
  durationSec: number;        // 实际用时
  rows: GradeRow[] | null;    // 兼容旧调用：单一科目逐题
  times: Record<number, number>;
  essays: string[];
  wordCounts: number[];
  /** 分科逐题（阅读/听力/全科各一段），有则优先于 rows */
  sections?: { label: string; rows: GradeRow[]; times: Record<number, number> }[];
}

export function buildReportMd(d: ReportData): string {
  const L: string[] = [];
  L.push(`# 作答记录 — ${d.test.name}`);
  L.push('');
  L.push(`- 日期：${new Date().toLocaleString()}`);
  L.push(`- 模式：${d.modeLabel}`);
  L.push(`- 完成用时：${fmtTime(d.durationSec)}`);
  L.push(`- 本记录由练习工具生成，仅供自查`);
  L.push('');

  const sections = d.sections ?? (d.rows ? [{ label: '阅读', rows: d.rows, times: d.times }] : []);
  for (const sec of sections) {
    if (!sec.rows.length) continue;
    const hasKey = sec.rows.some(r => r.key !== '—');
    L.push(`## ${sec.label}逐题作答`);
    L.push('');
    L.push('| 题号 | 我的答案 | 对错 | 用时 |');
    L.push('|---|---|---|---|');
    for (const r of sec.rows) {
      const verdict = !hasKey ? '—' : r.correct ? '✓ 对' : r.unanswered ? '未答' : '✗ 错';
      L.push(`| ${r.no} | ${r.user.replace(/\|/g, '\\|')} | ${verdict} | ${fmtTime(sec.times[r.no] ?? 0)} |`);
    }
    L.push('');
  }

  if (d.essays.some(e => e.trim())) {
    L.push('## 写作存档');
    L.push('');
    d.essays.forEach((e, i) => {
      if (!e.trim()) return;
      L.push(`### Task ${i + 1}（${d.wordCounts[i]} 词）`);
      L.push('');
      L.push(e.trim());
      L.push('');
    });
  }

  return L.join('\n');
}

export function downloadMd(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- 写作判改报告：离线兜底版（模型生成失败时本地拼装，保证报告绝不缺失） ---------- */

type GradeDim = 'ta' | 'cc' | 'lr' | 'gra';

const DIM_LABEL = (task: 'task1' | 'task2', d: GradeDim): string =>
  d === 'ta'
    ? task === 'task1' ? 'Task Achievement' : 'Task Response'
    : d === 'cc' ? 'Coherence & Cohesion'
    : d === 'lr' ? 'Lexical Resource'
    : 'Grammatical Range & Accuracy';

/** 取该维度在 Band Descriptors 摘要里的官方描述要点（Task 2 后三维标注"同 Task 1"时回退 Task 1 条目） */
function descriptorFor(task: 'task1' | 'task2', d: GradeDim): string {
  const t1 = bandDescriptors.task1_dimensions as Record<string, string>;
  const t2 = bandDescriptors.task2_dimensions as Record<string, string>;
  const key = d === 'ta'
    ? task === 'task1' ? 'task_achievement' : 'task_response'
    : d === 'cc' ? 'coherence_cohesion'
    : d === 'lr' ? 'lexical_resource'
    : 'grammatical_range_accuracy';
  const v = (task === 'task1' ? t1[key] : t2[key]) ?? '';
  return /^同\s*Task\s*1/.test(v) ? t1[key] ?? v : v;
}

export interface GradingReportItem {
  task: 'task1' | 'task2';
  prompt: string;
  essay: string;
  wordCount: number;
}

/** 纯本地兜底报告：不调模型，用 grade 的 reason/evidence + 内置评分标准摘要拼同结构中文 MD */
export function buildGradingMdFallback(
  testName: string,
  grade: WritingGradeResult,
  items: GradingReportItem[],
): string {
  const L: string[] = [];
  L.push(`# 写作判改报告 — ${testName}`);
  L.push('');
  L.push(`- 日期：${new Date().toLocaleString()}`);
  L.push('- 本报告由练习工具生成，AI 评分仅供参考，非官方成绩。');
  L.push('');

  const dims: GradeDim[] = ['ta', 'cc', 'lr', 'gra'];
  for (const it of items) {
    const g: WritingGrade | undefined = grade[it.task];
    if (!g) continue;
    const no = it.task === 'task1' ? 1 : 2;
    L.push(`## Writing Task ${no} — Band ${g.band.toFixed(1)}`);
    L.push('');
    L.push(`（作答 ${it.wordCount} 词）`);
    L.push('');
    for (const d of dims) {
      L.push(`### ${DIM_LABEL(it.task, d)}`);
      L.push('');
      L.push(`- 得分：**${g[d].toFixed(1)}**`);
      L.push(`- 该维度官方描述要点（Band Descriptors 摘要）：${descriptorFor(it.task, d)}`);
      L.push(`- 判分理由：${g.reason[d]}`);
      if (g.evidence?.[d]) L.push(`- 证据句（考生原文）："${g.evidence[d]}"`);
      L.push('');
    }
  }

  const b1 = grade.task1?.band;
  const b2 = grade.task2?.band;
  L.push('## 总结');
  L.push('');
  if (b1 != null && b2 != null) {
    L.push(`写作总 Band = Task 1（${b1.toFixed(1)}）× 1/3 + Task 2（${b2.toFixed(1)}）× 2/3，` +
      `按 .25/.75 进档后为 **${roundBand((b1 + 2 * b2) / 3).toFixed(1)}**（Task 2 权重 2/3）。`);
  } else {
    const b = (b1 ?? b2)!;
    L.push(`只批改了一篇，写作 Band 以该篇为准：**${roundBand(b).toFixed(1)}**。`);
  }
  L.push('');
  L.push('AI 评分仅供参考，非官方成绩。');
  L.push('');
  L.push('## 附：评分标准摘要（Band Descriptors 公开版摘要）');
  L.push('');
  L.push(`- 评分口径：${bandDescriptors.scoring_protocol}`);
  for (const [task, dimsObj] of [
    ['Task 1', bandDescriptors.task1_dimensions],
    ['Task 2', bandDescriptors.task2_dimensions],
  ] as const) {
    for (const [k, v] of Object.entries(dimsObj)) {
      L.push(`- ${task} · ${k}：${v}`);
    }
  }
  L.push('');
  return L.join('\n');
}
