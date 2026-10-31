/** 写作答卷历史：本次答卷 / 判改结果 / 修改稿与对比。
 *  原稿不可变；修改稿判改只写 revision（gradedEssays 快照），绝不覆盖原场次成绩。 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { PracticeRecord } from '../lib/history';
import type { WritingAttempt, WritingRevision } from '../lib/writingHistory';
import {
  createRevision, getWritingAttempt, saveRevisionDraft, saveRevisionGrade,
  setRevisionStatus, writingBandOf,
} from '../lib/writingHistory';
import type { WritingGradeResult } from '../lib/llm';
import { gradeWriting, gradeWritingRationale } from '../lib/llm';
import { loadLlmConfig, saveLlmConfig } from '../lib/store';
import { buildGradingMdFallback, downloadMd } from '../lib/reportMd';
import { countWords } from './WritingView';
import WritingGradeBox from './WritingGradeBox';
import WritingReportBox from './WritingReportBox';
import GradingSetupModal from './GradingSetupModal';
import { WRITING_GRADING } from '../lib/features';

interface Props {
  record: PracticeRecord;
}

type Tab = 'answer' | 'grade' | 'revision';

const DIMS: { k: 'ta' | 'cc' | 'lr' | 'gra'; label: string }[] = [
  { k: 'ta', label: 'TA/TR' },
  { k: 'cc', label: 'CC' },
  { k: 'lr', label: 'LR' },
  { k: 'gra', label: 'GRA' },
];

const delta = (from: number | undefined, to: number | undefined) => {
  if (from == null || to == null) return '—';
  const d = Math.round((to - from) * 10) / 10;
  if (d === 0) return '—';
  return d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
};

const whenText = (at?: number) => (at ? new Date(at).toLocaleString() : '—');

export default function WritingHistoryView({ record }: Props) {
  const [attempt, setAttempt] = useState<WritingAttempt | null | 'loading'>('loading');
  const [tab, setTab] = useState<Tab>('answer');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void getWritingAttempt(record.id).then(a => { if (alive) setAttempt(a); });
    return () => { alive = false; };
  }, [record.id, reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  const gradeId = record.writingGrade;

  return (
    <div className="wh-wrap">
      <div className="wh-tabs" role="tablist" aria-label="写作答卷历史">
        <button role="tab" aria-selected={tab === 'answer'} className={tab === 'answer' ? 'on' : ''} onClick={() => setTab('answer')}>本次答卷</button>
        <button role="tab" aria-selected={tab === 'grade'} className={tab === 'grade' ? 'on' : ''} onClick={() => setTab('grade')}>判改结果</button>
        <button role="tab" aria-selected={tab === 'revision'} className={tab === 'revision' ? 'on' : ''} onClick={() => setTab('revision')}>修改稿与对比</button>
      </div>

      {attempt === 'loading' ? (
        <p className="wh-empty">载入答卷…</p>
      ) : tab === 'answer' ? (
        attempt ? (
          <AnswerTab attempt={attempt} />
        ) : (
          <div className="wh-empty">
            {record.writing
              ? '该记录创建于答卷历史功能之前，未保存正文。已有的判改结果仍可在「判改结果」页查看。'
              : '这条记录没有写作部分。'}
          </div>
        )
      ) : tab === 'grade' ? (
        gradeId ? (
          <>
            <div className="wh-grade-head">
              <b>原稿判改</b>
              <span>Band {record.writingBand != null ? record.writingBand.toFixed(1) : (writingBandOf(gradeId) ?? '—')}</span>
            </div>
            <WritingGradeBox grade={gradeId} />
            <WritingReportBox
              md={record.writingReportMd ?? null}
              loading={false}
              onDownload={() => record.writingReportMd
                && downloadMd(`写作判改报告-${record.testName}.md`, record.writingReportMd)}
            />
          </>
        ) : (
          <div className="wh-empty">
            这场写作还没有 AI 判改结果。{WRITING_GRADING ? '可在交卷后的成绩单上点「现场判改」。' : ''}
          </div>
        )
      ) : attempt === null ? (
        <div className="wh-empty">
          该记录创建于答卷历史功能之前，没有保存正文，无法创建修改稿。
        </div>
      ) : (
        <RevisionTab record={record} attempt={attempt} onChanged={reload} />
      )}
    </div>
  );
}

/* ---------------- 本次答卷 ---------------- */

function PromptSnapshot({ task }: { task: WritingAttempt['tasks'][number] }) {
  const p = task.prompt;
  return (
    <details className="wh-prompt">
      <summary>本题题目（历史快照）</summary>
      <div className="wh-prompt-body">
        <div className="wh-prompt-part">{p.part} · {p.timing}</div>
        {p.promptLines?.map((l, i) => <p key={i} className={l.style}>{l.text}</p>)}
        {p.hasChart && p.figureImage && <img src={p.figureImage} alt="Task 1 figure" />}
        {p.hasChart && !p.figureImage && p.figureData?.columns?.length ? (
          <table className="fig-table">
            <thead><tr>{p.figureData.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>
              {(p.figureData.rows ?? []).map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>)}
            </tbody>
          </table>
        ) : null}
        <div className="wh-prompt-min">建议最低词数：{p.minWords}</div>
      </div>
    </details>
  );
}

function AnswerTab({ attempt }: { attempt: WritingAttempt }) {
  return (
    <div className="wh-answer">
      <div className="wh-meta">
        <span>{attempt.testName}</span>
        <span>交卷 {whenText(attempt.submittedAt)}</span>
        <span>用时 {Math.max(0, Math.round(attempt.durationSec / 60))} 分钟</span>
        {attempt.originalBand != null && <span>总 Band {attempt.originalBand.toFixed(1)}</span>}
      </div>
      {attempt.tasks.length === 0 && <p className="wh-empty">这次没有保存到作文正文。</p>}
      {attempt.tasks.map(t => (
        <article className="wh-task" key={t.task}>
          <header>
            <b>Writing Task {t.task === 'task1' ? 1 : 2}</b>
            <span>{t.wordCount} 词</span>
          </header>
          <PromptSnapshot task={t} />
          <div className="wh-essay">{t.essay.trim() || '（未作答）'}</div>
        </article>
      ))}
      <p className="affil-note">正文为交卷时的不可变快照；此后在题库里修正题目或修改稿，都不会改变这份答卷。</p>
    </div>
  );
}

/* ---------------- 修改稿与对比 ---------------- */

function RevisionTab({ record, attempt, onChanged }: {
  record: PracticeRecord;
  attempt: WritingAttempt;
  onChanged: () => void;
}) {
  const revisions = attempt.revisions ?? [];
  const [revId, setRevId] = useState<string | null>(revisions[0]?.id ?? null);
  const rev = revisions.find(r => r.id === revId) ?? null;
  const [draft, setDraft] = useState<[string, string]>([rev?.essays[0] ?? '', rev?.essays[1] ?? '']);
  const [task, setTask] = useState<0 | 1>(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [gradeBusy, setGradeBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [compareTask, setCompareTask] = useState<0 | 1>(0);
  const timer = useRef<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const revRef = useRef(rev);
  revRef.current = rev;

  useEffect(() => {
    if (rev) {
      setDraft([rev.essays[0] ?? '', rev.essays[1] ?? '']);
      setSaveState('idle');
    }
  }, [rev?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    const r = revRef.current;
    if (!r) return;
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
    setSaveState('saving');
    try {
      await saveRevisionDraft(record.id, r.id, draftRef.current, [
        countWords(draftRef.current[0]), countWords(draftRef.current[1]),
      ]);
      setSaveState('saved');
      onChanged();
    } catch (e) {
      setSaveState('error');
      setErr(`保存失败：${(e as Error).message}`);
    }
  }, [record.id, onChanged]);

  const edit = (text: string) => {
    const next: [string, string] = task === 0 ? [text, draft[1]] : [draft[0], text];
    setDraft(next);
    setSaveState('saving');
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, 500);
  };

  useEffect(() => () => {
    // 关闭前 flush：500ms 防抖窗口内尚未落盘的编辑不能丢
    if (timer.current == null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    const r = revRef.current;
    const d = draftRef.current;
    if (r) {
      void saveRevisionDraft(record.id, r.id, d, [countWords(d[0]), countWords(d[1])]).catch(() => {});
    }
  }, [record.id]);

  const chooseRevision = async (id: string) => {
    setSwitching(true);
    try {
      await flush();
      setRevId(id);
    } finally {
      setSwitching(false);
    }
  };

  const createNew = async () => {
    setErr('');
    setSwitching(true);
    try {
      await flush();
      const r = await createRevision(record.id);
      setRevId(r.id);
      onChanged();
    } catch (e) {
      setErr(`创建修改稿失败：${(e as Error).message}`);
    } finally {
      setSwitching(false);
    }
  };

  const startGrade = async () => {
    const r = revRef.current;
    if (!r) return;
    setErr('');
    await flush();
    const gradedEssays: [string, string] = [draftRef.current[0], draftRef.current[1]];
    const items = ([
      { task: 'task1' as const, prompt: (attempt.tasks[0]?.prompt.promptLines ?? []).map(l => l.text).join('\n'), essay: gradedEssays[0] },
      { task: 'task2' as const, prompt: (attempt.tasks[1]?.prompt.promptLines ?? []).map(l => l.text).join('\n'), essay: gradedEssays[1] },
    ]).filter(it => it.essay.trim());
    if (!items.length) { setErr('修改稿两个 Task 都是空的，没有可判改的内容。'); return; }
    setGradeBusy(true);
    try {
      await setRevisionStatus(record.id, r.id, 'grading');
      const cfg = loadLlmConfig();
      const ok = (s: { baseUrl: string; apiKey: string; model: string }) => !!(s.baseUrl && s.apiKey && s.model);
      const slot = ok(cfg.grader) ? cfg.grader : cfg.text;
      const grade: WritingGradeResult = await gradeWriting(slot, items);
      let md: string;
      try {
        md = await gradeWritingRationale(slot, items, grade);
      } catch {
        md = buildGradingMdFallback(attempt.testName, grade,
          items.map(it => ({ ...it, wordCount: countWords(it.essay) })))
          + '\n\n（本报告为离线简版：模型生成详细理由失败）';
      }
      await saveRevisionGrade(record.id, r.id, gradedEssays, grade, md);
      await flush();           // 若判改期间继续编辑，把草稿状态落盘（不会改判改快照）
      onChanged();
    } catch (e) {
      setErr(`判改失败：${(e as Error).message}`);
      try { await setRevisionStatus(record.id, r.id, 'draft'); } catch { /* 忽略 */ }
    } finally {
      setGradeBusy(false);
    }
  };

  if (!revisions.length) {
    return (
      <div className="wh-empty">
        <p>还没有修改稿。原稿保持不变，修改稿单独保存与判改。</p>
        <button className="as-primary" onClick={() => void createNew()}>复制为修改稿</button>
        {err && <div className="form-err-box">{err}</div>}
      </div>
    );
  }

  const graded = !!rev?.grade && !!rev.gradedEssays;
  const originalBand = writingBandOf(attempt.originalGrade ?? record.writingGrade);
  const newBand = rev?.band ?? writingBandOf(rev?.grade);

  return (
    <div className="wh-rev">
      <div className="wh-rev-bar">
        <label>
          修改稿
          <select value={revId ?? ''} onChange={e => { void chooseRevision(e.target.value); }}>
            {revisions.map((r, i) => (
              <option key={r.id} value={r.id}>
                第 {i + 1} 稿 · {r.status === 'graded' ? '已判改' : r.status === 'grading' ? '判改中' : '草稿'} · {new Date(r.updatedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <button className="link-btn" onClick={() => void createNew()}>新建修改稿</button>
      </div>

      {rev && (
        <>
          <div className="wh-rev-grid">
            <section className="wh-rev-pane">
              <header>原稿（只读）</header>
              {attempt.tasks.map((t, i) => (
                <div className="wh-orig" key={t.task}>
                  <div className="wh-orig-head">
                    <b>Task {i + 1}</b><span>{countWords(attempt.tasks[i]?.essay ?? '')} 词</span>
                  </div>
                  <div className="wh-orig-text">{attempt.tasks[i]?.essay.trim() || '（未作答）'}</div>
                </div>
              ))}
            </section>
            <section className="wh-rev-pane">
              <header>
                修改稿（自动保存）
                <span className={`wh-save ${saveState}`}>
                  {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败' : ''}
                </span>
              </header>
              <div className="wh-rev-tasks">
                <button className={task === 0 ? 'on' : ''} onClick={() => setTask(0)}>
                  Task 1 · {countWords(draft[0])} 词
                </button>
                <button className={task === 1 ? 'on' : ''} onClick={() => setTask(1)}>
                  Task 2 · {countWords(draft[1])} 词
                </button>
              </div>
              <textarea
                className="wh-editor"
                spellCheck={false}
                disabled={switching || gradeBusy}
                value={draft[task]}
                onChange={e => edit(e.target.value)}
                placeholder="在这里修改作文…"
              />
            </section>
          </div>

          <div className="wh-rev-ops">
            {WRITING_GRADING ? (
              <button
                className="as-primary"
                disabled={gradeBusy}
                onClick={() => {
                  const cfg = loadLlmConfig();
                  const ready = !!(cfg.grader.baseUrl && cfg.grader.apiKey && cfg.grader.model)
                    || !!(cfg.text.baseUrl && cfg.text.apiKey && cfg.text.model);
                  if (!ready) { setShowSetup(true); return; }
                  void startGrade();
                }}
              >
                {gradeBusy ? '判改中…' : rev.status === 'graded' ? '再次判改' : '提交判改'}
              </button>
            ) : (
              <span className="wh-rev-note">本版本关闭了写作 AI 判改，只能保存修改稿。</span>
            )}
            <button className="as-secondary" onClick={() => void flush()}>保存并关闭</button>
            {WRITING_GRADING && <span className="wh-rev-note">判改只使用点击瞬间的正文快照；之后继续编辑不会改写这次结果。</span>}
          </div>

          {err && <div className="form-err-box">{err}</div>}

          {graded && (
            <section className="wh-compare">
              <h4>版本对比（原稿 → 修改稿）</h4>
              <table className="wh-diff">
                <thead>
                  <tr><th>维度</th><th>原稿</th><th>修改稿</th><th>变化</th></tr>
                </thead>
                <tbody>
                  {[0, 1].map(i => {
                    const key = i === 0 ? 'task1' as const : 'task2' as const;
                    const g0 = attempt.originalGrade?.[key];
                    const g1 = rev.grade?.[key];
                    if (!g0 && !g1) return null;
                    return (
                      <Fragment key={`t${i}`}>
                        <tr className="wh-diff-task">
                          <td colSpan={4}>Writing Task {i + 1}</td>
                        </tr>
                        {DIMS.map(d => (
                          <tr key={`${i}-${d.k}`}>
                            <td>{d.label}</td>
                            <td>{g0 ? g0[d.k].toFixed(1) : '—'}</td>
                            <td>{g1 ? g1[d.k].toFixed(1) : '—'}</td>
                            <td>{g0 && g1 ? delta(g0[d.k], g1[d.k]) : '—'}</td>
                          </tr>
                        ))}
                        <tr className="wh-diff-band">
                          <td>Task Band</td>
                          <td>{g0 ? g0.band.toFixed(1) : '—'}</td>
                          <td>{g1 ? g1.band.toFixed(1) : '—'}</td>
                          <td>{g0 && g1 ? delta(g0.band, g1.band) : '—'}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  <tr className="wh-diff-band">
                    <td>写作总 Band</td>
                    <td>{originalBand != null ? originalBand.toFixed(1) : '—'}</td>
                    <td>{newBand != null ? newBand.toFixed(1) : '—'}</td>
                    <td>{delta(originalBand ?? undefined, newBand ?? undefined)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="wh-compare-text">
                <div className="wh-compare-tabs">
                  <button className={compareTask === 0 ? 'on' : ''} onClick={() => setCompareTask(0)}>Task 1 正文</button>
                  <button className={compareTask === 1 ? 'on' : ''} onClick={() => setCompareTask(1)}>Task 2 正文</button>
                </div>
                <div className="wh-compare-cols">
                  <div>
                    <b>原稿</b>
                    <div className="wh-essay">{attempt.tasks[compareTask]?.essay.trim() || '（未作答）'}</div>
                  </div>
                  <div>
                    <b>修改稿（已判改快照）</b>
                    <div className="wh-essay">{rev.gradedEssays?.[compareTask]?.trim() || '（未作答）'}</div>
                  </div>
                </div>
              </div>

              {rev.reportMd && (
                <WritingReportBox
                  md={rev.reportMd}
                  loading={false}
                  onDownload={() => rev.reportMd && downloadMd(`写作修改稿判改报告-${attempt.testName}.md`, rev.reportMd)}
                />
              )}
              <p className="affil-note">
                修改稿成绩只保存在修改稿里，不会改写原场次成绩。{
                  rev.status === 'draft' ? '（判改后继续编辑，当前状态为草稿；上次判改结果仍保留。）' : ''}
              </p>
            </section>
          )}
        </>
      )}

      {showSetup && (
        <GradingSetupModal
          mode="post"
          cfg={loadLlmConfig()}
          busy={gradeBusy}
          error={err}
          onSave={slot => {
            const c = loadLlmConfig();
            saveLlmConfig({ ...c, grader: slot });
          }}
          onSubmit={chosen => {
            setShowSetup(false);
            if (chosen) void startGrade();
          }}
          onSkip={() => setShowSetup(false)}
        />
      )}
    </div>
  );
}

export type { WritingRevision };
