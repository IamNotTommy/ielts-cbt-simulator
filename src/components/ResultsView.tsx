import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { StoredTest } from '../lib/store';
import type { GradeRow } from '../lib/scoring';
import { fmtTime, roundBand } from '../lib/scoring';
import type { QuestionType } from '../types';

interface Props {
  test: StoredTest;
  rows: GradeRow[];            // 逐题（不含标准答案原文）
  score: number;
  total: number;
  band: number | null;         // 阅读 Band（非整卷 null）
  times: Record<number, number>;
  flagged?: Record<number, boolean>;
  readingDone: boolean;
  listeningDone?: boolean;
  listeningBand?: number | null;
  detail2?: { label: string; rows: GradeRow[]; score: number; total: number; times: Record<number, number> };
  writingDone: boolean;
  writingBand: number | null;  // null = Not graded
  durationSec: number;
  onExportMd: () => void;
  onRetry: () => void;
  onHome: () => void;
  /** 精读入口：可精读的篇章（scope=passage/reading/full 且有阅读内容时由 App 传入） */
  intensivePassages?: { idx: number; title: string }[];
  onIntensive?: (passageIdx: number) => void;
  /** 精听入口：可精听的听力 section（scope=listening/lsection/full 且有听力内容时由 App 传入） */
  listenSections?: { idx: number; title: string }[];
  onListenLab?: (sectionIdx: number) => void;
  /** 结算屏里的写作判改区（已出分 / 现场判改入口），由 App 注入 */
  writingSlot?: ReactNode;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  tfng: '判断题',
  single: '单选',
  multiple: '多选',
  gapfill: '填空',
  matchingHeadings: '匹配标题',
  matchingFeatures: '匹配特征',
  matchingInfo: '匹配段落信息',
};

/** 逐题表的行结构：成绩单的 GradeRow 与练习记录里存的 AttemptRow 都归一到这个形状 */
export interface AnswerTableRow {
  no: number;
  user: string;
  correct: boolean;
  unanswered: boolean;
  flagged?: boolean;
}

type Filter = 'all' | 'wrong' | 'blank' | 'flagged';

/** 逐题对错表 —— 成绩单（A. 作答回顾）与首页「练习记录 → 看对错表」共用同一份渲染。
 *  times 传 null（练习记录里连逐题用时快照都没有）时 Time 列显示 —；列结构与成绩单完全一致。 */
export function AnswerTable({ rows, times, filter = 'all' }: {
  rows: AnswerTableRow[];
  times?: Record<number, number> | null;
  filter?: Filter;
}) {
  const shown = rows.filter(r => {
    if (filter === 'wrong') return !r.correct && !r.unanswered;
    if (filter === 'blank') return r.unanswered;
    if (filter === 'flagged') return !!r.flagged;
    return true;
  });
  if (!shown.length) return <p className="home-empty">这个筛选下没有题目。</p>;
  return (
    <div className="result-table-wrap">
      <table className="result-table">
        <thead>
          <tr><th>Q</th><th>你的答案</th><th>结果</th><th>用时</th></tr>
        </thead>
        <tbody>
          {shown.map(r => (
            <tr key={r.no} className={r.correct ? 'ok' : 'bad'}>
              <td><b>{r.no}</b>{r.flagged ? ' ⚑' : ''}</td>
              <td className={r.unanswered ? 'dim' : ''}>{r.user}</td>
              <td>{r.correct ? '✓ 对' : r.unanswered ? '未答' : '✗ 错'}</td>
              <td>{times == null ? '—' : fmtTime(times[r.no] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const toRow = (r: GradeRow, flagged?: Record<number, boolean>): AnswerTableRow => ({
  no: r.no, user: r.user, correct: r.correct, unanswered: r.unanswered, flagged: !!flagged?.[r.no],
});

/** 交卷后：结论 → 下一步 → 明细（A 作答回顾，不显示标准答案；B 成绩报告） */
export default function ResultsView(p: Props) {
  const [tab, setTab] = useState<'detail' | 'report'>('detail');
  const [filter, setFilter] = useState<Filter>('all');
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [pickPassage, setPickPassage] = useState(false);   // 多篇时先选精读哪一篇
  const [pickSection, setPickSection] = useState(false);   // 多个听力 section 时先选精听哪一篇

  const wrong = p.rows.filter(r => !r.correct && !r.unanswered).length;
  const blank = p.rows.filter(r => r.unanswered).length;
  const accuracy = p.total ? Math.round(((p.total - wrong - blank) / p.total) * 100) : 0;

  const timeByType = useMemo(() => {
    const m = new Map<QuestionType, number>();
    for (const r of p.rows) m.set(r.type, (m.get(r.type) ?? 0) + (p.times[r.no] ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).filter(([, s]) => s > 0);
  }, [p.rows, p.times]);
  const shownTypes = showAllTypes ? timeByType : timeByType.slice(0, 4);

  // Overall：只有所有已考科目都有有效 Band 才计算，避免把部分成绩当成完整 Overall
  const bandList: number[] = [];
  if (p.listeningDone && p.listeningBand != null) bandList.push(p.listeningBand);
  if (p.readingDone && p.band != null) bandList.push(p.band);
  if (p.writingDone && p.writingBand != null) bandList.push(p.writingBand);
  const expected = (p.listeningDone ? 1 : 0) + (p.readingDone ? 1 : 0) + (p.writingDone ? 1 : 0);
  const overall = expected > 0 && bandList.length === expected
    ? roundBand(bandList.reduce((a, b) => a + b, 0) / bandList.length)
    : null;

  return (
    <div className="overlay" style={{ background: '#e9ecef', overflowY: 'auto' }}>
      <div className="result-card">
        <h2>练习完成</h2>
        <p className="result-test-name">{p.test.name} · 用时 {fmtTime(p.durationSec)}</p>

        <div className="result-summary">
          <div className="result-score">
            <div className="big band">{p.band != null ? p.band.toFixed(1) : '—'}</div>
            <div className="dim">
              {p.band != null
                ? (p.listeningDone && !p.readingDone ? 'Listening Band' : 'Reading Band')
                : '部分练习，无 Band 折算'}
            </div>
          </div>
          <div className="result-score">
            <div className="big">{p.score}<span className="dim"> / {p.total}</span></div>
            <div className="dim">原始分 · 正确率 {accuracy}%</div>
          </div>
          <div className="result-score">
            <div className="big wrong">{wrong}</div>
            <div className="dim">答错</div>
          </div>
          <div className="result-score">
            <div className="big blank">{blank}</div>
            <div className="dim">未答</div>
          </div>
        </div>

        {/* 结论后的常用操作：不再需要滚过 40 行才看得到 */}
        <div className="result-actions">
          <button className="btn-dark" onClick={p.onHome}>返回题库</button>
          {p.onIntensive && p.intensivePassages && p.intensivePassages.length > 0 && (
            <button
              className="btn-ok"
              style={{ background: '#2F6FB3' }}
              title="在原文上划重点词句、写批注；划过的内容会收进词汇册"
              onClick={() => {
                if (p.intensivePassages!.length === 1) p.onIntensive!(p.intensivePassages![0].idx);
                else setPickPassage(true);
              }}
            >
              精读
            </button>
          )}
          {p.onListenLab && p.listenSections && p.listenSections.length > 0 && (
            <button
              className="btn-ok"
              style={{ background: '#0E7C6B' }}
              data-ll="results-enter"
              title="逐句精听：断句、听写对照、生词与跟读"
              onClick={() => {
                if (p.listenSections!.length === 1) p.onListenLab!(p.listenSections![0].idx);
                else setPickSection(true);
              }}
            >
              精听
            </button>
          )}
          <button className="btn-ok" onClick={p.onExportMd}>导出作答记录（.md）</button>
          <button className="btn-ok" style={{ background: '#6c7075' }} onClick={p.onRetry}>清空答案并再练一次</button>
        </div>

        <div className="result-tabs">
          <button className={tab === 'detail' ? 'on' : ''} onClick={() => setTab('detail')}>作答回顾</button>
          <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>成绩报告</button>
        </div>

        {tab === 'detail' && (
          <>
            {timeByType.length > 0 && (
              <div className="result-times">
                <b>题型用时：</b>
                {shownTypes.map(([t, s]) => (
                  <span key={t} className="time-chip">{TYPE_LABEL[t]} {fmtTime(s)}</span>
                ))}
                {timeByType.length > 4 && (
                  <button className="link-btn" onClick={() => setShowAllTypes(v => !v)}>
                    {showAllTypes ? '收起' : `其余 ${timeByType.length - 4} 项`}
                  </button>
                )}
              </div>
            )}

            <div className="result-filters" role="group" aria-label="作答回顾筛选">
              {([
                ['all', `全部 ${p.total}`],
                ['wrong', `答错 ${wrong}`],
                ['blank', `未答 ${blank}`],
                ['flagged', `已标记 ${Object.values(p.flagged ?? {}).filter(Boolean).length}`],
              ] as [Filter, string][]).map(([f, label]) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>

            {p.detail2 && (
              <>
                <h3 style={{ margin: '16px 0 6px' }}>{p.detail2.label}: {p.detail2.score} / {p.detail2.total}</h3>
                <AnswerTable
                  rows={p.detail2.rows.map(r => toRow(r, p.flagged))}
                  times={p.detail2.times}
                  filter={filter}
                />
                <h3 style={{ margin: '18px 0 6px' }}>Reading: {p.score} / {p.total}</h3>
              </>
            )}
            <AnswerTable
              rows={p.rows.map(r => toRow(r, p.flagged))}
              times={p.times}
              filter={filter}
            />
            <p className="affil-note">只显示对错，不显示标准答案；标准答案在错题复盘或精读里查看，以保护复练价值。</p>
          </>
        )}

        {tab === 'report' && (
          <div className="trf-card">
            <div className="trf-title">Practice Test Report</div>
            <table className="trf-table">
              <tbody>
                {p.listeningDone && (
                  <tr><td>Listening</td><td>{p.listeningBand != null ? p.listeningBand.toFixed(1) : '— (partial)'}</td></tr>
                )}
                {p.readingDone && (
                  <tr><td>Reading</td><td>{p.band != null ? p.band.toFixed(1) : '— (partial)'}</td></tr>
                )}
                {p.writingDone && (
                  <tr><td>Writing</td><td>{p.writingBand != null ? p.writingBand.toFixed(1) : 'Not graded'}</td></tr>
                )}
                <tr className="trf-overall">
                  <td>Overall Band</td>
                  <td>{overall != null ? overall.toFixed(1) : '暂无法计算'}</td>
                </tr>
              </tbody>
            </table>
            {overall == null && (
              <p className="affil-note">
                Overall 需要所有已考科目都有有效 Band（整卷 40 题折算）；部分练习或未判改写作不计算 Overall。
              </p>
            )}
            <div className="trf-footer">Practice simulation — not an official score</div>
          </div>
        )}

        {p.writingSlot}

        {/* 多篇阅读：先选要精读哪一篇 */}
        {pickPassage && p.intensivePassages && (
          <div className="overlay" style={{ zIndex: 70 }} onClick={() => setPickPassage(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2>选择要精读的篇章</h2>
              {p.intensivePassages.map(ps => (
                <button
                  key={ps.idx}
                  className="iv-pick-row"
                  onClick={() => { setPickPassage(false); p.onIntensive!(ps.idx); }}
                >
                  <b>Passage {ps.idx + 1}</b>
                  <span>{ps.title}</span>
                </button>
              ))}
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button className="btn-ok" onClick={() => setPickPassage(false)}>取消</button>
              </div>
            </div>
          </div>
        )}

        {/* 多个听力 section：先选要精听哪一篇 */}
        {pickSection && p.listenSections && (
          <div className="overlay" style={{ zIndex: 70 }} onClick={() => setPickSection(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2>选择要精听的 Section</h2>
              {p.listenSections.map(s => (
                <button
                  key={s.idx}
                  className="iv-pick-row"
                  data-ll={`pick-section-${s.idx}`}
                  onClick={() => { setPickSection(false); p.onListenLab!(s.idx); }}
                >
                  <b>Section {s.idx + 1}</b>
                  <span>{s.title}</span>
                </button>
              ))}
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button className="btn-ok" onClick={() => setPickSection(false)}>取消</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
