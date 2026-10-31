/** 错题复盘中心：筛选、统计、批量开始复盘、单题/题组重做入口。 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QuestionType } from '../types';
import type { StoredTest } from '../lib/store';
import type { ReviewCause, ReviewItem, ReviewSkill, ReviewStatus } from '../lib/review';
import {
  REVIEW_CAUSES, REVIEW_TYPE_LABEL, buildReviewSession, causeLabel, filterReviewItems,
  removeReviewItem, reviewStats, setReviewStatus, skillLabel, statusLabel,
} from '../lib/review';
import { loadLearningData } from '../lib/learningStore';
import ReviewQuestionView, { reviewGroupKey } from './ReviewQuestionView';

interface Props {
  tests: StoredTest[];
  initialSkill?: ReviewSkill;
  initialType?: QuestionType;
  onClose: () => void;
  onChanged: () => void;
  onOpenIntensive: (t: StoredTest, passageIdx: number) => void;
  onOpenListenLab: (t: StoredTest, sectionIdx: number) => void;
}

const ALL = 'all' as const;

export default function ReviewCenter(p: Props) {
  const [tick, setTick] = useState(0);
  const [skill, setSkill] = useState<ReviewSkill | typeof ALL>(p.initialSkill ?? ALL);
  const [type, setType] = useState<QuestionType | typeof ALL>(p.initialType ?? ALL);
  const [cause, setCause] = useState<ReviewCause | typeof ALL>(ALL);
  const [status, setStatus] = useState<ReviewStatus | typeof ALL>(ALL);
  const [testId, setTestId] = useState<string | typeof ALL>(ALL);
  const [showMastered, setShowMastered] = useState(false);
  const [session, setSession] = useState<{ queue: ReviewItem[]; idx: number } | null>(null);
  const [completedGroups, setCompletedGroups] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');

  // 初始筛选只在本轮打开时应用（来自分析页的跳转）
  useEffect(() => {
    setSkill(p.initialSkill ?? ALL);
    setType(p.initialType ?? ALL);
    setSession(null);
  }, [p.initialSkill, p.initialType]);

  const refresh = useCallback(() => {
    setTick(t => t + 1);
    p.onChanged();
  }, [p.onChanged]);

  const items = useMemo(() => {
    void tick;
    return loadLearningData().reviewItems;
  }, [tick]);
  const stats = useMemo(() => reviewStats(items), [items]);

  const types = useMemo(() => {
    const set = new Set<QuestionType>();
    for (const it of items) if (skill === ALL || it.skill === skill) set.add(it.type);
    return [...set];
  }, [items, skill]);

  const filtered = useMemo(() => filterReviewItems(items, { skill, type, cause, status, testId }), [items, skill, type, cause, status, testId]);

  const visible = useMemo(() => {
    const rank = (s: ReviewStatus) => (s === 'pending' ? 0 : s === 'learning' ? 1 : 2);
    return filtered
      .filter(it => showMastered || status === 'mastered' || it.status !== 'mastered')
      .sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt - a.updatedAt);
  }, [filtered, showMastered, status]);

  const startSession = () => {
    const { queue, skippedMissing } = buildReviewSession(filtered, p.tests, 10);
    if (!queue.length) { setNotice('当前筛选下没有可复盘的题。'); return; }
    setNotice(skippedMissing.length ? `有 ${skippedMissing.length} 道题的题包已删除，已跳过。` : '');
    setCompletedGroups(new Set());
    setSession({ queue, idx: 0 });
    refresh();
  };

  if (session) {
    const item = session.queue[session.idx];
    if (!item) {
      setSession(null);
      return null;
    }
    const test = p.tests.find(t => t.id === item.testId);
    if (!test) {
      setSession(null);
      return null;
    }
    return (
      <ReviewQuestionView
        key={item.id}
        item={item}
        sessionItems={session.queue}
        test={test}
        index={session.idx}
        total={session.queue.length}
        onClose={() => { setSession(null); refresh(); }}
        onNext={() => {
          const nextIdx = session.queue.findIndex((x, i) => i > session.idx && !completedGroups.has(reviewGroupKey(test, x)));
          if (nextIdx >= 0) setSession({ ...session, idx: nextIdx });
          else setSession(null);
        }}
        onPrev={() => setSession({ ...session, idx: Math.max(0, session.idx - 1) })}
        onSubmittedGroup={key => setCompletedGroups(prev => new Set(prev).add(key))}
        onChanged={refresh}
        onOpenIntensive={(pi) => p.onOpenIntensive(test, pi)}
        onOpenListenLab={(si) => p.onOpenListenLab(test, si)}
      />
    );
  }

  return (
    <div className="rv-center">
      <header className="iv-top">
        <button className="iv-back" onClick={p.onClose}>← 返回</button>
        <div className="iv-title">
          <b>错题复盘</b>
          <span>待复盘 {stats.pending} · 仍需复习 {stats.learning} · 已掌握 {stats.mastered}</span>
        </div>
        <button className="as-primary" onClick={startSession}>开始本次复盘（最多 10 题）</button>
      </header>

      <div className="rv-filters">
        <label>
          科目
          <select value={skill} onChange={e => { setSkill(e.target.value as ReviewSkill | typeof ALL); setType(ALL); }}>
            <option value={ALL}>全部</option>
            <option value="reading">阅读</option>
            <option value="listening">听力</option>
          </select>
        </label>
        <label>
          题型
          <select value={type} onChange={e => setType(e.target.value as QuestionType | typeof ALL)}>
            <option value={ALL}>全部</option>
            {types.map(t => <option key={t} value={t}>{REVIEW_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label>
          错因
          <select value={cause} onChange={e => setCause(e.target.value as ReviewCause | typeof ALL)}>
            <option value={ALL}>全部</option>
            {REVIEW_CAUSES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label>
          状态
          <select value={status} onChange={e => setStatus(e.target.value as ReviewStatus | typeof ALL)}>
            <option value={ALL}>全部</option>
            <option value="pending">待复盘</option>
            <option value="learning">仍需复习</option>
            <option value="mastered">已掌握</option>
          </select>
        </label>
        <label>
          题包
          <select value={testId} onChange={e => setTestId(e.target.value)}>
            <option value={ALL}>全部</option>
            {[...new Set(items.map(it => it.testId))].map(id => {
              const t = p.tests.find(x => x.id === id);
              return <option key={id} value={id}>{t?.name ?? `${items.find(x => x.testId === id)?.testName ?? id}（题包已删除）`}</option>;
            })}
          </select>
        </label>
        <label className="rv-check">
          <input type="checkbox" checked={showMastered} onChange={e => setShowMastered(e.target.checked)} />
          显示已掌握
        </label>
      </div>

      {notice && <p className="rv-notice" aria-live="polite">{notice}</p>}

      {visible.length === 0 ? (
        <div className="rv-empty">
          {items.length === 0
            ? '还没有错题。做完一套阅读或听力并交卷后，错题会自动收进这里。'
            : '当前筛选下没有题目。'}
        </div>
      ) : (
        <div className="rv-list">
          {visible.map(it => {
            const test = p.tests.find(t => t.id === it.testId);
            return (
              <div className={`rv-row ${it.status}`} key={it.id}>
                <div className="rv-row-main">
                  <div className="rv-row-title">
                    <b>{skillLabel(it.skill)} · {REVIEW_TYPE_LABEL[it.type]} · Q{it.no}</b>
                    <span className={`rv-status-tag ${it.status}`}>{statusLabel(it.status)}</span>
                  </div>
                  <small>
                    {it.testName}{test ? '' : '（题包已删除）'}
                    {' · '}{causeLabel(it.cause)}
                    {' · '}答错 {it.wrongCount} 次
                    {it.attempts.length > 0 ? ` · 重做 ${it.attempts.length} 次` : ''}
                    {it.wasBlank ? ' · 上次漏答' : ''}
                  </small>
                </div>
                <div className="rv-row-ops">
                  <button
                    className="as-secondary"
                    disabled={!test}
                    title={test ? '开始这道题的复盘' : '题包已删除，无法重做'}
                    onClick={() => setSession({ queue: [it], idx: 0 })}
                  >复盘</button>
                  <button className="as-secondary" onClick={() => { setReviewStatus(it.id, 'mastered'); refresh(); }}>标为已掌握</button>
                  <button
                    className="danger"
                    title="只删除复盘状态，不删除原成绩"
                    onClick={() => {
                      if (confirm('删除这道题的复盘记录？\n只删除学习状态与错因，原练习成绩不会被删除。')) {
                        removeReviewItem(it.id);
                        refresh();
                      }
                    }}
                  >删除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="affil-note">同一批次的同组题会合并成一次题组作答；标准答案在提交后显示。</p>
    </div>
  );
}
