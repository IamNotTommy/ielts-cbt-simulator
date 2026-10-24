import { useState } from 'react';
import type { PracticeRecord, SkillScore } from '../lib/history';
import { fmtDuration, scopeName } from '../lib/history';
import { AnswerTable, type AnswerTableRow } from './ResultsView';
import WritingHistoryView from './WritingHistoryView';

/** 练习记录里存的逐题明细 → 成绩单表格的行结构（列与成绩单完全一致） */
const toRows = (s: SkillScore): AnswerTableRow[] =>
  (s.table ?? []).map(t => ({ no: t.n, user: t.you, correct: t.ok, unanswered: t.you === '—' }));

const hasTable = (s?: SkillScore) => !!s?.table?.length;

type Filter = 'all' | 'wrong' | 'blank';

/**
 * 首页「练习记录 → 详情」：逐题明细（成绩单同一套表格）与写作答卷历史（正文 / 判改 / 修改稿）。
 * 老记录没有逐题表或没有正文时只给明确说明，不报错、不显示空白页。
 */
export default function HistoryDetailModal({ record, testHasListening, testName, onClose }: {
  record: PracticeRecord;
  testHasListening: boolean;
  /** 当前题库里的题包名（题包可能已删除，则用记录里的快照名） */
  testName?: string;
  onClose: () => void;
}) {
  const tables: { label: string; s: SkillScore }[] = [];
  if (hasTable(record.listening)) tables.push({ label: '听力', s: record.listening! });
  if (hasTable(record.reading)) tables.push({ label: '阅读', s: record.reading! });

  const [tab, setTab] = useState<'table' | 'writing'>('table');
  const [filter, setFilter] = useState<Filter>('all');

  const multiple = tables.length + (record.writing ? 1 : 0) > 1;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="result-card hd-card" onClick={e => e.stopPropagation()}>
        <h2>练习详情</h2>
        <p className="result-test-name">
          {new Date(record.at).toLocaleString()} · {testName ?? record.testName} ·
          {' '}{scopeName(record.scope, testHasListening)} · 用时 {fmtDuration(record.durationSec)}
        </p>

        {multiple && (
          <div className="result-tabs">
            {tables.length > 0 && (
              <button className={tab === 'table' ? 'on' : ''} onClick={() => setTab('table')}>逐题明细</button>
            )}
            {record.writing && (
              <button className={tab === 'writing' ? 'on' : ''} onClick={() => setTab('writing')}>写作答卷</button>
            )}
          </div>
        )}

        {record.writing && (tab === 'writing' || tables.length === 0) ? (
          <WritingHistoryView record={record} />
        ) : (
          <>
            {tables.length === 0 && (
              <p className="home-empty">
                这场没存逐题明细（只有分数与 Band）。最近 20 条记录才保留逐题对错表。
              </p>
            )}
            {tables.length > 0 && (
              <div className="result-filters" role="group" aria-label="明细筛选">
                {([
                  ['all', '全部'],
                  ['wrong', '答错'],
                  ['blank', '未答'],
                ] as [Filter, string][]).map(([f, label]) => (
                  <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{label}</button>
                ))}
              </div>
            )}
            {tables.map(sec => (
              <div key={sec.label}>
                <h3 style={{ margin: '16px 0 6px' }}>
                  {sec.label}：{sec.s.score} / {sec.s.total}
                  {sec.s.band != null ? `（Band ${sec.s.band}）` : ''}
                </h3>
                <AnswerTable rows={toRows(sec.s)} times={sec.s.times ?? null} filter={filter} />
              </div>
            ))}
            {!record.listening?.table?.length && !record.reading?.table?.length && record.writingWords?.length ? (
              <p className="affil-note">
                写作词数：{record.writingWords.map((w, i) => `Task ${i + 1} ${w} 词`).join(' · ')}
              </p>
            ) : null}
          </>
        )}

        <div className="hd-ops">
          <button className="btn-ok" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
