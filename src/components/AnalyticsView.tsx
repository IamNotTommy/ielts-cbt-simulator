/** 学习分析看板：Band 趋势 / 正确率趋势 / 题型正确率 / 写作四维 / 错题状态。
 *  所有统计口径见 analytics.ts；图表下方都给文字摘要，颜色不是唯一信息载体。 */
import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { PracticeRecord } from '../lib/history';
import type { StoredTest } from '../lib/store';
import type { QuestionType } from '../types';
import {
  buildAccuracyTrend, buildBandTrend, buildSummary, buildTypeStats,
  buildWritingDimensionStats, filterRecords,
} from '../lib/analytics';
import { REVIEW_TYPE_LABEL, reviewStats } from '../lib/review';
import { loadLearningData } from '../lib/learningStore';

export interface AnalyticsFilters {
  range: '30' | '90' | 'all';
  skill: 'all' | 'reading' | 'listening' | 'writing';
  testId: string;
  chartSkill: 'reading' | 'listening';
}

interface Props {
  records: PracticeRecord[];
  tests: StoredTest[];
  filters: AnalyticsFilters;
  onFiltersChange: (filters: AnalyticsFilters) => void;
  onClose: () => void;
  onOpenReview: (skill?: 'reading' | 'listening', type?: QuestionType) => void;
  onOpenWriting: () => void;
}

type Range = AnalyticsFilters['range'];
type SkillFilter = AnalyticsFilters['skill'];

const fmtDur = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h${m}m` : `${m}m`;
};
const dayLabel = (at: number) => `${new Date(at).getMonth() + 1}/${new Date(at).getDate()}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const ChartEmpty = ({ text }: { text: string }) => <div className="an-empty">{text}</div>;

export default function AnalyticsView(p: Props) {
  const { range, skill, testId, chartSkill } = p.filters;
  const setRange = (value: Range) => p.onFiltersChange({ ...p.filters, range: value });
  const setSkill = (value: SkillFilter) => p.onFiltersChange({ ...p.filters, skill: value });
  const setTestId = (value: string) => p.onFiltersChange({ ...p.filters, testId: value });
  const setChartSkill = (value: 'reading' | 'listening') => p.onFiltersChange({ ...p.filters, chartSkill: value });

  const filtered = useMemo(() => {
    const to = Date.now();
    const from = range === 'all' ? undefined : to - Number(range) * 24 * 60 * 60 * 1000;
    return filterRecords(p.records, {
      skill,
      testId: testId === 'all' ? undefined : testId,
      ...(from != null ? { from } : {}),
      to,
    });
  }, [p.records, range, skill, testId]);

  const summary = useMemo(() => buildSummary(filtered, skill === 'all' ? undefined : skill), [filtered, skill]);
  const effectiveSkill: 'reading' | 'listening' = skill === 'listening' ? 'listening' : skill === 'reading' ? 'reading' : chartSkill;
  const trendRecords = skill === 'writing' ? [] : filtered;
  const bandTrend = useMemo(() => buildBandTrend(trendRecords, effectiveSkill), [trendRecords, effectiveSkill]);
  const accTrend = useMemo(() => buildAccuracyTrend(trendRecords, effectiveSkill), [trendRecords, effectiveSkill]);
  const typeStats = useMemo(() => skill === 'writing' ? [] : buildTypeStats(filtered, skill === 'all' ? undefined : skill), [filtered, skill]);
  const writing = useMemo(() => buildWritingDimensionStats(filtered), [filtered]);
  const review = useMemo(() => reviewStats(loadLearningData().reviewItems), []);

  const bandData = bandTrend.map(x => ({ ...x, day: dayLabel(x.at) }));
  const accData = accTrend.map(x => ({ ...x, day: dayLabel(x.at), percent: Math.round(x.accuracy * 100) }));
  const typeData = typeStats.map(s => ({
    ...s,
    label: `${s.skill === 'reading' ? '阅读' : '听力'} · ${REVIEW_TYPE_LABEL[s.type]}`,
    percent: Math.round(s.accuracy * 100),
  }));

  return (
    <div className="an-wrap">
      <header className="iv-top">
        <button className="iv-back" onClick={p.onClose}>← 返回</button>
        <div className="iv-title">
          <b>学习分析</b>
          <span>{filtered.length} 场练习{summary.total ? ` · ${summary.total} 题` : ''}</span>
        </div>
      </header>

      <div className="an-filters">
        <label>
          时间
          <select value={range} onChange={e => setRange(e.target.value as Range)}>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
            <option value="all">全部</option>
          </select>
        </label>
        <label>
          科目
          <select value={skill} onChange={e => setSkill(e.target.value as SkillFilter)}>
            <option value="all">全部科目</option>
            <option value="reading">阅读</option>
            <option value="listening">听力</option>
            <option value="writing">写作</option>
          </select>
        </label>
        <label>
          题包
          <select value={testId} onChange={e => setTestId(e.target.value)}>
            <option value="all">全部题包</option>
            {p.tests.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>

      <div className="an-cards">
        <div className="an-card">
          <b>{summary.sessions}</b>
          <span>练习场次</span>
        </div>
        <div className="an-card">
          <b>{fmtDur(summary.totalSec)}</b>
          <span>总练习时间</span>
        </div>
        <div className="an-card">
          <b>{summary.latestBand != null ? summary.latestBand.toFixed(1) : '—'}</b>
          <span>最近整卷 Band</span>
        </div>
        <div className="an-card">
          <b>{summary.accuracy != null ? pct(summary.accuracy) : '—'}</b>
          <span>平均正确率</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="an-empty an-empty-big">
          <p>当前筛选下还没有练习记录。</p>
          <p>做完一套并交卷后，这里会显示趋势、题型正确率与写作四维。</p>
        </div>
      ) : (
        <>
          <section className="an-panel">
            <div className="an-panel-head">
              <h3>Band 趋势（仅整卷）</h3>
              {skill === 'all' && (
                <div className="an-tabs">
                  <button className={chartSkill === 'reading' ? 'on' : ''} onClick={() => setChartSkill('reading')}>阅读</button>
                  <button className={chartSkill === 'listening' ? 'on' : ''} onClick={() => setChartSkill('listening')}>听力</button>
                </div>
              )}
            </div>
            {bandData.length < 2 ? (
              <ChartEmpty text={bandData.length === 1
                ? `只有 1 个有效整卷成绩（Band ${bandData[0].band?.toFixed(1)}），再积累一场才能画趋势。`
                : '还没有整卷成绩。单篇/单 Section 练习不生成 Band，请看下面的正确率趋势。'} />
            ) : (
              <>
                <div className="an-chart">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={bandData} margin={{ top: 8, right: 16, bottom: 0, left: -18 }}>
                      <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis domain={[4, 9]} ticks={[4, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9]} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(v: number) => [`Band ${Number(v).toFixed(1)}`, '整卷']}
                        labelFormatter={(_l, payload) => payload?.[0]?.payload?.day ?? ''}
                      />
                      <Line type="monotone" dataKey="band" stroke="#2F669E" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="an-caption">
                  基于最近 {bandData.length} 场整卷{effectiveSkill === 'reading' ? '阅读' : '听力'}成绩。
                  单篇与单 Section 不计入 Band。
                </p>
              </>
            )}
          </section>

          <section className="an-panel">
            <div className="an-panel-head">
              <h3>正确率趋势</h3>
            </div>
            {accData.length === 0 ? (
              <ChartEmpty text="还没有可用于统计正确率的记录。" />
            ) : (
              <>
                <div className="an-chart">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={accData} margin={{ top: 8, right: 16, bottom: 0, left: -18 }}>
                      <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                      <Tooltip formatter={(v: number) => [`${v}%`, '正确率']} />
                      <Line type="monotone" dataKey="percent" stroke="#247A46" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="an-caption">
                  基于 {accData.length} 场练习、{accTrend.reduce((n, x) => n + x.total, 0)} 题（含未答）；{effectiveSkill === 'reading' ? '阅读' : '听力'}单独统计。
                </p>
              </>
            )}
          </section>

          <section className="an-panel">
            <div className="an-panel-head">
              <h3>题型正确率</h3>
              <small>点击条形可直接进入错题复盘</small>
            </div>
            {typeData.length === 0 ? (
              <ChartEmpty text="还没有带题型的新记录。旧记录没有题型字段，不做猜测；新交卷的记录会补齐。" />
            ) : (
              <>
                <div className="an-chart an-chart-tall">
                  <ResponsiveContainer width="100%" height={Math.max(180, typeData.length * 34)}>
                    <BarChart data={typeData} layout="vertical" margin={{ top: 4, right: 46, bottom: 4, left: 8 }}>
                      <CartesianGrid stroke="#eef1f4" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: number, _n, item) => [`${v}%（${item?.payload?.correct}/${item?.payload?.total} 题）`, '正确率']} />
                      <Bar dataKey="percent" barSize={16} radius={[0, 3, 3, 0]} onClick={(d: { payload?: { skill: 'reading' | 'listening'; type: QuestionType } }) => {
                        if (d?.payload) p.onOpenReview(d.payload.skill, d.payload.type);
                      }}>
                        {typeData.map(d => (
                          <Cell key={d.label} fill={d.percent < 60 ? '#B0243A' : d.percent < 80 ? '#8A5C06' : '#247A46'} cursor="pointer" />
                        ))}
                        <LabelList dataKey="percent" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 11, fill: '#5F6B76' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="an-caption">
                  基于有题型记录的 {summary.total} 题中的可统计部分；样本题数见条形末尾的百分比与提示。
                  未答题计入总数、不计入正确。
                </p>
              </>
            )}
          </section>

          <section className="an-panel">
            <div className="an-panel-head">
              <h3>写作四维平均</h3>
              <button className="link-btn" onClick={p.onOpenWriting}>去看写作详情 →</button>
            </div>
            {writing.every(w => w.samples === 0) ? (
              <ChartEmpty text="完成并判改写作后生成四维分析。" />
            ) : (
              <>
                <div className="an-chart">
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart
                      data={writing.map(w => ({ ...w, label: w.dim === 'ta' ? 'TA/TR' : w.dim.toUpperCase() }))}
                      layout="vertical"
                      margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
                    >
                      <CartesianGrid stroke="#eef1f4" horizontal={false} />
                      <XAxis type="number" domain={[0, 9]} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="label" width={70} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: number) => [Number(v).toFixed(1), '平均分']} />
                      <Bar dataKey="avg" fill="#2F6FB3" barSize={18} radius={[0, 3, 3, 0]}>
                        <LabelList dataKey="avg" position="right" formatter={(v: number) => Number(v).toFixed(1)} style={{ fontSize: 11, fill: '#5F6B76' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="an-caption">
                  基于 {writing[0]?.samples ?? 0} 个 Task 的判改结果；修改稿成绩不纳入原场次趋势。
                </p>
              </>
            )}
          </section>
        </>
      )}

      <section className="an-panel an-review">
        <div className="an-panel-head">
          <h3>错题状态</h3>
          <button className="as-secondary" onClick={() => p.onOpenReview()}>打开错题复盘</button>
        </div>
        <div className="an-review-stats">
          <button onClick={() => p.onOpenReview()}><b>{review.pending}</b><span>待复盘</span></button>
          <button onClick={() => p.onOpenReview()}><b>{review.learning}</b><span>仍需复习</span></button>
          <button onClick={() => p.onOpenReview()}><b>{review.mastered}</b><span>已掌握</span></button>
        </div>
      </section>

      <p className="affil-note">
        统计口径：Band 只用整卷成绩；正确率含单篇/单 Section；Full length 的听力与阅读分别统计，时长不重复计算。
      </p>
    </div>
  );
}
