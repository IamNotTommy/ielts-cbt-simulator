/** 单题/题组复盘：保留完整 QuestionGroup（共享多选、摘要表格、词库指令都不拆散），
 *  提交后才显示标准答案；复盘作答只存在本地 state，绝不写入正式考试存档。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Passage, QuestionGroup } from '../types';
import type { StoredTest } from '../lib/store';
import { adaptListening } from '../lib/adapter';
import { gradeReading } from '../lib/scoring';
import { loadAudio } from '../lib/media';
import QuestionGroups from './QuestionGroups';
import type { ReviewCause, ReviewItem } from '../lib/review';
import { REVIEW_CAUSES, REVIEW_TYPE_LABEL, addReviewAttempt, setReviewCause, setReviewStatus, skillLabel } from '../lib/review';

interface Props {
  item: ReviewItem;
  sessionItems: ReviewItem[];
  test: StoredTest;
  index: number;
  total: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onChanged: () => void;
  onOpenIntensive: (passageIdx: number) => void;
  onOpenListenLab: (sectionIdx: number) => void;
}

interface Located {
  group: QuestionGroup;
  passage: Passage;
  passageIdx: number;
}

function locate(test: StoredTest, item: ReviewItem): Located | null {
  if (item.skill === 'reading') {
    for (let pi = 0; pi < test.passages.length; pi++) {
      const ps = test.passages[pi];
      for (const g of ps.groups ?? []) {
        if (g.questions.some(q => q.no === item.no)) return { group: g, passage: ps, passageIdx: pi };
      }
    }
    return null;
  }
  if (!test.listening?.sections?.length) return null;
  const ps = adaptListening(test.listening.sections, []);
  for (let si = 0; si < ps.length; si++) {
    for (const g of ps[si].groups ?? []) {
      if (g.questions.some(q => q.no === item.no)) return { group: g, passage: ps[si], passageIdx: si };
    }
  }
  return null;
}

export default function ReviewQuestionView(p: Props) {
  const { item, test, sessionItems } = p;
  const located = useMemo(() => locate(test, item), [test, item]);
  const groupKey = located ? `${located.passageIdx}:${located.group.questions[0]?.no}` : '';
  const groupItems = useMemo(
    () => sessionItems.filter(x => x.testId === item.testId && x.skill === item.skill
      && (locate(test, x)?.group === located?.group)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionItems, item.testId, item.skill, groupKey],
  );
  const targets = groupItems.length ? groupItems : [item];

  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'submitted'>('answering');
  const submittedRef = useRef(false);
  const [rows, setRows] = useState<Record<number, { user: string; correct: boolean; key: string }>>({});
  const [cause, setCause] = useState<ReviewCause | undefined>(item.cause);
  const [statusMsg, setStatusMsg] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // 听力：挂载时载入该 section 的音频，用于重做时播放
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    if (item.skill === 'listening' && located) {
      const sec = test.listening?.sections?.[located.passageIdx];
      if (sec) {
        void loadAudio(`${test.id}/s${sec.section_number}`).then(blob => {
          if (!blob || cancelled) return;
          url = URL.createObjectURL(blob);
          setAudioUrl(url);
        });
      }
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.skill, located, test.id, test.listening]);

  useEffect(() => {
    setAnswers({});
    setPhase('answering');
    submittedRef.current = false;
    setRows({});
    setCause(item.cause);
    setStatusMsg('');
  }, [item.id, item.cause]);

  const keyMap: Record<number, string> = item.skill === 'reading'
    ? (test.answers ?? {})
    : (test.listening?.answers ?? {});

  const submit = () => {
    if (!located || submittedRef.current) return;
    submittedRef.current = true;
    setPhase('submitting');
    try {
      // 用原题包答案 + 正式判分函数，保证多选/共享选项/匹配题的判分与正式考试一致
      const { rows: graded } = gradeReading([located.passage], answers, keyMap);
      const map: Record<number, { user: string; correct: boolean; key: string }> = {};
      for (const r of graded) map[r.no] = { user: r.user, correct: r.correct, key: r.key };
      setRows(map);
      for (const t of targets) {
        const r = map[t.no];
        if (!r) continue;
        addReviewAttempt(t.id, r.user, r.correct);
      }
      setPhase('submitted');
      p.onChanged();
    } catch (e) {
      submittedRef.current = false;
      setPhase('answering');
      setStatusMsg(`判分失败：${(e as Error).message}`);
    }
  };

  const mark = (id: string, status: 'learning' | 'mastered') => {
    setReviewStatus(id, status, cause);
    setStatusMsg(status === 'mastered' ? '已标记掌握' : '已加入仍需复习');
    p.onChanged();
  };

  const setCauseFor = (id: string, c: ReviewCause) => {
    setCause(c);
    setReviewCause(id, c);
    p.onChanged();
  };

  const qt = (_block: string, text: string) => text;

  if (!located) {
    return (
      <div className="rv-view">
        <header className="rv-top">
          <button className="iv-back" onClick={p.onClose}>← 返回复盘</button>
          <div className="iv-title"><b>题目不可用</b><span>{item.testName}</span></div>
        </header>
        <div className="rv-missing">
          <p>题包内容已变化或已被删除，找不到 {skillLabel(item.skill)} Q{item.no}。</p>
          <p>可以返回列表把它标记为已掌握或删除。</p>
          <button className="as-secondary" onClick={() => { setReviewStatus(item.id, 'mastered'); p.onChanged(); p.onClose(); }}>
            标记已掌握
          </button>
        </div>
      </div>
    );
  }

  const isLast = p.index >= p.total - 1;
  const targetsShown = targets.filter(t => rows[t.no]);

  return (
    <div className="rv-view">
      <header className="rv-top">
        <button className="iv-back" onClick={p.onClose}>← 返回复盘</button>
        <div className="iv-title">
          <b>{skillLabel(item.skill)} · Q{item.no}</b>
          <span>{item.testName} · 本次 {p.index + 1}/{p.total}</span>
        </div>
        <div className="rv-nav">
          <button className="as-secondary" disabled={p.index <= 0} onClick={p.onPrev}>上一题</button>
          <button className="as-secondary" disabled={isLast} onClick={p.onNext}>下一题</button>
        </div>
      </header>

      <div className="rv-body">
        <section className="rv-context">
          <h4>{item.skill === 'reading' ? '原文上下文（只读）' : '听力材料'}</h4>
          <p className="rv-ctx-title">{located.passage.title || located.passage.label}</p>
          {item.skill === 'listening' ? (
            <>
              <p className="rv-ctx-note">{located.passage.heading}</p>
              {audioUrl ? (
                <audio controls src={audioUrl} style={{ width: '100%', margin: '8px 0' }}>
                  <track kind="captions" />
                </audio>
              ) : (
                <p className="rv-ctx-note">音频不可用：可先导入题包或在精听里练习。</p>
              )}
            </>
          ) : (
            <div className="rv-original">
              {located.passage.paragraphs.map((para, i) => (
                <p key={i}>
                  {para.tag && <span className="ptag">{para.tag}</span>}
                  {para.text}
                </p>
              ))}
            </div>
          )}
          <p className="rv-ctx-note">题组：{located.group.title}{targets.length > 1 ? ` · 同组 ${targets.length} 题一起复盘` : ''}</p>
        </section>

        <section className="rv-question">
          <QuestionGroups
            groups={[located.group]}
            answers={answers}
            onAnswer={(no, v) => setAnswers(a => ({ ...a, [no]: v }))}
            qt={qt}
          />

          <div className="rv-actions">
            {phase !== 'submitted' ? (
              <button className="as-primary" disabled={phase === 'submitting'} onClick={submit}>
                {phase === 'submitting' ? '判分中…' : '提交答案'}
              </button>
            ) : (
              <span className="rv-done">已提交，可查看结果并标注错因</span>
            )}
            {phase !== 'submitted' && (
              <span className="rv-hint">提交前不显示标准答案；同一批次的同组题会一次提交。</span>
            )}
          </div>

          {phase === 'submitted' && (
            <div className="rv-results">
              {targetsShown.map(t => {
                const r = rows[t.no];
                return (
                  <div className={`rv-result ${r.correct ? 'ok' : 'bad'}`} key={t.id}>
                    <div className="rv-result-head">
                      <b>Q{t.no}</b>
                      <span className={`rv-verdict ${r.correct ? 'ok' : 'bad'}`}>
                        {r.correct ? '✓ 正确' : r.user === '—' ? '未作答' : '✗ 错误'}
                      </span>
                      <small>{REVIEW_TYPE_LABEL[t.type]}</small>
                    </div>
                    <dl>
                      <div><dt>本次答案</dt><dd>{r.user}</dd></div>
                      <div><dt>上次答案</dt><dd>{t.lastUser}</dd></div>
                      <div><dt>标准答案</dt><dd className="rv-key">{r.key}</dd></div>
                      <div><dt>答错次数</dt><dd>{t.wrongCount} 次</dd></div>
                    </dl>
                    <div className="rv-causes">
                      <span>错因</span>
                      {REVIEW_CAUSES.filter(c => !c.skill || c.skill === t.skill).map(c => (
                        <button
                          key={c.key}
                          className={(t.cause ?? cause) === c.key ? 'on' : ''}
                          onClick={() => setCauseFor(t.id, c.key)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <div className="rv-mark">
                      <button className="as-secondary" onClick={() => mark(t.id, 'learning')}>仍需复习</button>
                      <button className="as-primary" onClick={() => mark(t.id, 'mastered')}>已掌握</button>
                      {t.skill === 'reading' ? (
                        <button className="link-btn" onClick={() => p.onOpenIntensive(located.passageIdx)}>进入精读</button>
                      ) : (
                        <button className="link-btn" onClick={() => p.onOpenListenLab(located.passageIdx)}>进入精听</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {statusMsg && <p className="rv-status" aria-live="polite">{statusMsg}</p>}
              {!isLast && (
                <button className="as-primary rv-next" onClick={p.onNext}>下一题 →</button>
              )}
            </div>
          )}

          {located.group.questions.some(q => q.type === 'multiple' || q.type === 'matchingFeatures') && (
            <p className="rv-hint">多选题与共享选项组请整组作答；判分与正式考试使用同一个判分函数。</p>
          )}
        </section>
      </div>
    </div>
  );
}
