/** 学习分析：只写纯函数，不碰存储。
 *  口径：Band 只用整卷（40 题）成绩；单篇/单 Section 只进正确率趋势；
 *  题型统计只认逐题表里带 type 的行，旧记录缺 type 不猜题型。 */
import type { PracticeRecord, SkillScore } from './history';
import type { QuestionType } from '../types';

export interface AnalyticsFilter {
  from?: number;
  to?: number;
  skill: 'all' | 'reading' | 'listening' | 'writing';
  testId?: string;
}

export interface TrendPoint {
  at: number;
  band: number | null;
  score: number;
  total: number;
}

export interface AccuracyPoint {
  at: number;
  correct: number;
  total: number;
  accuracy: number;
}

export interface TypeStat {
  skill: 'reading' | 'listening';
  type: QuestionType;
  total: number;
  correct: number;
  accuracy: number;
  timeSec: number;
  avgSec: number;
}

export interface Summary {
  sessions: number;
  totalSec: number;
  latestBand: number | null;
  latestBandAt: number | null;
  correct: number;
  total: number;
  accuracy: number | null;
}

export function filterRecords(records: PracticeRecord[], f: AnalyticsFilter): PracticeRecord[] {
  return records.filter(r => {
    if (f.from != null && r.at < f.from) return false;
    if (f.to != null && r.at > f.to) return false;
    if (f.testId && r.testId !== f.testId) return false;
    if (f.skill === 'reading') return !!r.reading;
    if (f.skill === 'listening') return !!r.listening;
    if (f.skill === 'writing') return !!r.writing;
    return true;
  });
}

const skillScore = (r: PracticeRecord, skill: 'reading' | 'listening'): SkillScore | undefined =>
  skill === 'reading' ? r.reading : r.listening;

/** Band 趋势：只使用整卷（total === 40 且 band != null）的成绩 */
export function buildBandTrend(records: PracticeRecord[], skill: 'reading' | 'listening'): TrendPoint[] {
  const points = records.map((r): TrendPoint | null => {
    const s = skillScore(r, skill);
    return s && s.band != null && s.total === 40
      ? { at: r.at, band: s.band, score: s.score, total: s.total }
      : null;
  });
  return points.filter((x): x is TrendPoint => x !== null).sort((a, b) => a.at - b.at);
}

/** 正确率趋势：部分练习也进入（与 Band 图分开） */
export function buildAccuracyTrend(records: PracticeRecord[], skill: 'reading' | 'listening'): AccuracyPoint[] {
  const points = records.map((r): AccuracyPoint | null => {
    const s = skillScore(r, skill);
    if (!s || !s.total) return null;
    return { at: r.at, correct: s.score, total: s.total, accuracy: s.score / s.total };
  });
  return points.filter((x): x is AccuracyPoint => x !== null).sort((a, b) => a.at - b.at);
}

/** 题型正确率：未答计入总数、不计入正确；无 type 的旧行跳过（不计入分母） */
export function buildTypeStats(records: PracticeRecord[], skill?: 'reading' | 'listening'): TypeStat[] {
  const acc = new Map<string, TypeStat>();
  const skills: ('reading' | 'listening')[] = skill ? [skill] : ['reading', 'listening'];
  for (const s of skills) {
    for (const r of records) {
      const score = skillScore(r, s);
      if (!score?.table?.length) continue;
      for (const row of score.table) {
        if (!row.type) continue;
        const k = `${s}:${row.type}`;
        let st = acc.get(k);
        if (!st) {
          st = { skill: s, type: row.type, total: 0, correct: 0, accuracy: 0, timeSec: 0, avgSec: 0 };
          acc.set(k, st);
        }
        st.total++;
        if (row.ok) st.correct++;
        st.timeSec += score.times?.[row.n] ?? 0;
      }
    }
  }
  return [...acc.values()]
    .map(st => ({ ...st, accuracy: st.total ? st.correct / st.total : 0, avgSec: st.total ? st.timeSec / st.total : 0 }))
    .sort((a, b) => a.accuracy - b.accuracy);
}

export interface WritingDimStat {
  dim: 'ta' | 'cc' | 'lr' | 'gra';
  avg: number;
  samples: number;
}

/** 写作四维平均：只统计有 writingGrade 的记录；修改稿成绩不纳入 */
export function buildWritingDimensionStats(records: PracticeRecord[]): WritingDimStat[] {
  const dims: WritingDimStat[] = [
    { dim: 'ta', avg: 0, samples: 0 },
    { dim: 'cc', avg: 0, samples: 0 },
    { dim: 'lr', avg: 0, samples: 0 },
    { dim: 'gra', avg: 0, samples: 0 },
  ];
  const sums = { ta: 0, cc: 0, lr: 0, gra: 0 };
  for (const r of records) {
    const g = r.writingGrade;
    if (!g) continue;
    for (const task of [g.task1, g.task2]) {
      if (!task) continue;
      for (const d of dims) {
        sums[d.dim] += task[d.dim];
        d.samples++;
      }
    }
  }
  return dims.map(d => ({ ...d, avg: d.samples ? sums[d.dim] / d.samples : 0 }));
}

export function buildSummary(records: PracticeRecord[], skill?: 'reading' | 'listening' | 'writing'): Summary {
  let totalSec = 0, correct = 0, total = 0;
  let latestBand: number | null = null;
  let latestBandAt: number | null = null;
  for (const r of records) {
    totalSec += Math.max(0, r.durationSec || 0);
    if (skill === 'writing') {
      if (r.writingBand != null && (latestBandAt == null || r.at > latestBandAt)) {
        latestBand = r.writingBand;
        latestBandAt = r.at;
      }
      continue;
    }
    for (const s of skill ? [r[skill]] : [r.reading, r.listening]) {
      if (!s) continue;
      correct += s.score;
      total += s.total;
      if (s.band != null && s.total === 40 && (latestBandAt == null || r.at > latestBandAt)) {
        latestBand = s.band;
        latestBandAt = r.at;
      }
    }
  }
  return {
    sessions: records.length,
    totalSec,
    latestBand,
    latestBandAt,
    correct,
    total,
    accuracy: total ? correct / total : null,
  };
}
