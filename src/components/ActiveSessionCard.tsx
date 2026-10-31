/** 首页「继续上次练习」卡片：展示未完成会话的范围、进度、剩余时间与最后作答时间。
 *  继续 / 重新开始 / 放弃进度 三个动作都走 App 的统一入口，避免各入口各写一套恢复逻辑。 */
import { useMemo, useState } from 'react';
import type { StoredTest } from '../lib/store';
import { tk } from '../lib/store';
import type { ActiveSessionMeta } from '../lib/activeSession';
import { clearActiveSession, discardSession } from '../lib/activeSession';
import { countWords } from './WritingView';
import { fmtDuration } from '../lib/history';

interface Props {
  sessions: ActiveSessionMeta[];
  tests: StoredTest[];
  onContinue: (m: ActiveSessionMeta, t: StoredTest) => void;
  onRestart: (m: ActiveSessionMeta, t: StoredTest) => void;
  onDiscard: (m: ActiveSessionMeta) => void;
}

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

function scopeText(m: ActiveSessionMeta): string {
  const c = m.config;
  switch (c.scope) {
    case 'passage': return `阅读单篇 Passage ${c.passageIdx + 1}`;
    case 'reading': return '阅读整卷';
    case 'writing': return '写作';
    case 'listening': return c.listeningMode === 'practice' ? '听力整套（练习模式）' : '听力整套';
    case 'lsection': return `听力单节 Section ${c.passageIdx + 1}`;
    case 'full': {
      const phase = m.fullPhase === 'listening' ? '听力段' : m.fullPhase === 'writing' ? '写作段' : '阅读段';
      return `全科连练 · 当前${phase}`;
    }
    default: return c.scope;
  }
}

function phaseOf(m: ActiveSessionMeta): 'reading' | 'listening' | 'writing' {
  if (m.config.scope === 'full') return m.fullPhase;
  if (m.config.scope === 'writing') return 'writing';
  if (m.config.scope === 'listening' || m.config.scope === 'lsection') return 'listening';
  return 'reading';
}

function isUntimed(m: ActiveSessionMeta): boolean {
  const c = m.config;
  return c.listeningMode === 'practice'
    && (c.scope === 'listening' || c.scope === 'lsection' || (c.scope === 'full' && m.fullPhase === 'listening'));
}

interface Progress {
  text: string;
  remain: string;
  position: string;
}

function progressOf(m: ActiveSessionMeta, test?: StoredTest): Progress {
  const phase = phaseOf(m);
  const c = m.config;
  let text = '';
  if (phase === 'writing') {
    const essays = readJson<string[]>(tk(m.testId, 'essays'), ['', '']);
    const w1 = countWords(essays[0] ?? '');
    const w2 = countWords(essays[1] ?? '');
    text = `Task 1 ${w1} 词 · Task 2 ${w2} 词`;
  } else {
    const ans = readJson<Record<string, unknown>>(tk(m.testId, phase === 'listening' ? 'lanswers' : 'answers'), {});
    const counted = Object.values(ans).filter(v =>
      Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '').length;
    const passages = phase === 'listening' ? [] : (test?.passages ?? []);
    const scoped = phase === 'reading' && c.scope === 'passage'
      ? passages.slice(c.passageIdx, c.passageIdx + 1)
      : passages;
    const readingTotal = scoped.reduce((n, p) => n + p.groups.reduce((k, g) => k + g.questions.length, 0), 0);
    const listeningSections = phase === 'listening' ? (test?.listening?.sections ?? []) : [];
    const listeningTotal = listeningSections.reduce((n, s) => n + (s.question_groups ?? [])
      .reduce((k, g) => k + (g.questions?.length ?? 0), 0), 0);
    const total = phase === 'listening' ? listeningTotal : readingTotal;
    text = total ? `已答 ${counted}/${total}` : `已答 ${counted}`;
  }

  let remain = '';
  if (m.untimed || isUntimed(m)) {
    remain = '当前阶段不限时';
  } else {
    const timer = readJson<{ secondsLeft?: number } | null>(tk(m.testId, 'timer'), null);
    if (timer && Number(timer.secondsLeft) > 0) {
      remain = `剩余 ${fmtDuration(Number(timer.secondsLeft)).padStart(5, '0')}`;
    } else if (phase === 'writing') {
      remain = `剩余 ${fmtDuration(c.writingMinutes * 60)}`;
    } else {
      remain = `剩余 ${fmtDuration(c.minutes * 60)}`;
    }
  }
  const position = phase === 'writing'
    ? `Task ${m.wPart + 1}`
    : phase === 'listening'
      ? `Section ${(m.listeningSection ?? 0) + 1} · 第 ${m.current} 题`
      : `Part ${m.partIdx + 1} · 第 ${m.current} 题`;
  return { text, remain, position };
}

function whenText(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${hm}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 卡片内的一行 */
function SessionRow({ m, test, expanded, onContinue, onRestart, onDiscard }: {
  m: ActiveSessionMeta;
  test?: StoredTest;
  expanded: boolean;
  onContinue: () => void;
  onRestart: () => void;
  onDiscard: () => void;
}) {
  const p = progressOf(m, test);
  if (!expanded) {
    return (
      <button className="as-collapsed" onClick={onContinue} title="继续这套练习">
        <b>{test?.name ?? m.testId}</b>
        <span>{scopeText(m)} · {p.position} · {p.text} · {p.remain}</span>
        <span className="as-go">继续 →</span>
      </button>
    );
  }
  return (
    <div className="as-card">
      <div className="as-head">
        <span className="as-label">继续上次练习</span>
        <span className="as-when">上次作答：{whenText(m.updatedAt)}</span>
      </div>
      <div className="as-title">{test?.name ?? m.testId}</div>
      <div className="as-meta">
        {scopeText(m)} · {p.position} · {p.text}
        {p.remain ? ` · ${p.remain}` : ''}
      </div>
      <div className="as-ops">
        <button className="as-primary" onClick={onContinue}>继续练习</button>
        <button className="as-secondary" onClick={() => {
          if (confirm(`重新开始「${test?.name ?? m.testId}」？\n\n将清除这套题当前的作答、作文、笔记、高亮和计时，然后从第 1 题重新开始。\n练习记录、写作答卷、精读/精听、词汇和错题复盘都会保留。`)) {
            onRestart();
          }
        }}>重新开始</button>
        <button className="as-danger" onClick={() => {
          if (confirm(`放弃「${test?.name ?? m.testId}」的当前进度？\n\n将删除这套题的作答、作文、笔记、高亮和计时。\n已交卷的练习记录、写作答卷和学习数据不会被删除。此操作不可撤销。`)) {
            discardSession(m.testId);
            clearActiveSession(m.testId);
            onDiscard();
          }
        }}>放弃进度</button>
      </div>
    </div>
  );
}

export default function ActiveSessionCard({ sessions, tests, onContinue, onRestart, onDiscard }: Props) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => sessions
    .map(m => ({ m, test: tests.find(t => t.id === m.testId) }))
    .filter(x => !!x.test), [sessions, tests]);

  if (!rows.length) return null;
  const [first, ...rest] = rows;
  return (
    <section className="as-wrap" aria-label="继续上次练习">
      <SessionRow
        m={first.m}
        test={first.test}
        expanded
        onContinue={() => onContinue(first.m, first.test!)}
        onRestart={() => onRestart(first.m, first.test!)}
        onDiscard={() => onDiscard(first.m)}
      />
      {rest.length > 0 && (
        <div className="as-more">
          <button className="link-btn" onClick={() => setShowAll(v => !v)}>
            {showAll ? '收起其他进度 ▴' : `还有 ${rest.length} 套未完成练习 ▾`}
          </button>
          {showAll && rest.map(({ m, test }) => (
            <SessionRow
              key={m.testId}
              m={m}
              test={test}
              expanded={false}
              onContinue={() => onContinue(m, test!)}
              onRestart={() => onRestart(m, test!)}
              onDiscard={() => onDiscard(m)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
