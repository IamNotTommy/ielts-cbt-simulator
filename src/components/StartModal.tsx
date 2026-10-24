import { useEffect, useRef, useState } from 'react';
import type { SessionConfig, StoredTest } from '../lib/store';
import { loadLlmConfig } from '../lib/store';
import { WRITING_GRADING } from '../lib/features';

interface Props {
  test: StoredTest;
  onCancel: () => void;
  onStart: (cfg: SessionConfig) => void;
}

type Scope = SessionConfig['scope'];

/** 开始练习前的配置：按「练习内容 / 作答方式 / 计时 / 说明」分组，降低初始拥挤。 */
export default function StartModal({ test, onCancel, onStart }: Props) {
  const hasReading = test.passages.length > 0;
  const hasWriting = test.writingTasks.length > 0;
  const [scope, setScope] = useState<Scope>(hasReading ? 'reading' : 'writing');
  const [passageIdx, setPassageIdx] = useState(0);
  const [custom, setCustom] = useState(false);
  const [minutes, setMinutes] = useState('60');          // 字符串态：像普通文本一样自由编辑
  const [writingMinutes, setWritingMinutes] = useState('60');
  const [lMode, setLMode] = useState<'real' | 'practice'>('practice');
  const [timeErr, setTimeErr] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape 关闭 + 打开后聚焦标题
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLElement>('h2')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** 自定义计时校验：正整数，1-180 分钟；非法 → 红字提示且不允许开始 */
  const validMinutes = (s: string) => /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 180;
  const digitsOnly = (s: string) => s.replace(/[^\d]/g, '');

  const llmOk = (() => {
    const c = loadLlmConfig();
    const ok = (s: { baseUrl: string; apiKey: string; model: string }) => !!(s.baseUrl && s.apiKey && s.model);
    return ok(c.grader) || ok(c.text); // 判改槽位优先，未配则回退抽取文本模型
  })();
  const hasListening = !!test.listening?.sections?.length;
  const showGradeOpt = scope === 'writing' || scope === 'full';
  // 配了模型就自动判改，不再需要勾选；未配置则写作只存档（Not graded）
  // 判改关闭（WRITING_GRADING=false）时即便本机存过模型配置也不进入判改流程
  const gradeWriting = WRITING_GRADING && showGradeOpt && llmOk;

  const strictMinutes = (s: Scope) => (s === 'passage' ? 20 : s === 'listening' ? 32 : s === 'lsection' ? 10 : 60);

  const start = () => {
    // 自定义计时：先校验可见输入框（正整数 1-180），不合法 → 红字提示，不开始
    if (custom) {
      const needReading = scope !== 'writing';
      const needWriting = scope === 'writing' || scope === 'full';
      if ((needReading && !validMinutes(minutes)) || (needWriting && !validMinutes(writingMinutes))) {
        setTimeErr('请输入有效数字：大于 0 的整数分钟数（最长 180 分钟）');
        return;
      }
    }
    setTimeErr('');
    onStart({
      scope,
      passageIdx,
      minutes: custom ? Number(minutes) : strictMinutes(scope),
      writingMinutes: custom ? Number(writingMinutes) : 60,
      gradeWriting,
      listeningMode: scope === 'listening' || scope === 'lsection' || scope === 'full' ? lMode : undefined,
    });
  };

  const opt = (value: Scope, label: string, sub: string) => (
    <label className={'scope-opt' + (scope === value ? ' on' : '')}>
      <input type="radio" name="scope" checked={scope === value} onChange={() => setScope(value)} />
      <span>
        <b>{label}</b>
        <small>{sub}</small>
      </span>
    </label>
  );

  const scopeLabel: Record<Scope, string> = {
    passage: `单篇 Passage ${passageIdx + 1}`,
    reading: '阅读整卷',
    lsection: `单个 Section ${passageIdx + 1}`,
    listening: '听力整套',
    writing: '写作',
    full: '全科连练',
  };
  const totalMinutes = custom
    ? (scope === 'writing' ? Number(writingMinutes || 0) : scope === 'full' ? Number(minutes || 0) + Number(writingMinutes || 0) : Number(minutes || 0))
    : scope === 'writing' ? 60 : scope === 'full' ? (hasListening ? 32 + 60 + 60 : 60 + 60) : strictMinutes(scope);

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="modal start-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-title"
        ref={dialogRef}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="start-title" tabIndex={-1}>开始练习</h2>
        <p className="start-sub">{test.name}</p>

        <h3 className="start-group">练习内容</h3>
        <div className="scope-list">
          {hasReading && (
            <div className={'scope-opt' + (scope === 'passage' ? ' on' : '')} style={{ display: 'flex', gap: 10 }}>
              <label style={{ display: 'flex', gap: 10, flex: 1, cursor: 'pointer' }}>
                <input type="radio" name="scope" checked={scope === 'passage'} onChange={() => setScope('passage')} />
                <span>
                  <b>单篇 Passage</b>
                  <small>严格实考 20 分钟</small>
                </span>
              </label>
              <select
                aria-label="选择要练习的 Passage"
                value={passageIdx}
                onChange={e => { setPassageIdx(Number(e.target.value)); setScope('passage'); }}
                onClick={e => e.stopPropagation()}
              >
                {test.passages.map((p, i) => (
                  <option key={i} value={i}>{p.label} · {p.title.slice(0, 24)}</option>
                ))}
              </select>
            </div>
          )}
          {hasReading && opt('reading', '阅读整卷', '3 篇 40 题 · 60 分钟')}
          {hasListening && (
            <div className={'scope-opt' + (scope === 'lsection' ? ' on' : '')} style={{ display: 'flex', gap: 10 }}>
              <label style={{ display: 'flex', gap: 10, flex: 1, cursor: 'pointer' }}>
                <input type="radio" name="scope" checked={scope === 'lsection'} onChange={() => setScope('lsection')} />
                <span>
                  <b>单个 Section</b>
                  <small>严格实考约 10 分钟</small>
                </span>
              </label>
              <select
                aria-label="选择要练习的 Section"
                value={passageIdx}
                onChange={e => { setPassageIdx(Number(e.target.value)); setScope('lsection'); }}
                onClick={e => e.stopPropagation()}
              >
                {test.listening!.sections.map((sec, i) => (
                  <option key={i} value={i}>Section {sec.section_number ?? i + 1}</option>
                ))}
              </select>
            </div>
          )}
          {hasListening && opt('listening', '听力整套', '4 个 Section 40 题 · 约 32 分钟')}
          {hasWriting && opt('writing', '写作', 'Task 1 + Task 2 · 60 分钟')}
          {hasReading && hasWriting && opt('full', '全科连练', hasListening
            ? `按实考顺序：听力（${lMode === 'real' ? '实考' : '练习'}模式）→ 阅读 → 写作`
            : '按实考顺序：阅读 → 写作')}
        </div>

        {(scope === 'listening' || scope === 'lsection' || (scope === 'full' && hasListening)) && (
          <>
            <h3 className="start-group">作答方式</h3>
            <div className="row">
              <label>听力模式</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" name="lmode" checked={lMode === 'real'} onChange={() => setLMode('real')} />
                实考模式
                <small style={{ color: '#6c7075' }}>连续播放，无暂停/进度条/跳过</small>
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" name="lmode" checked={lMode === 'practice'} onChange={() => setLMode('practice')} />
                练习模式
                <small style={{ color: '#6c7075' }}>可暂停/拖进度/倍速/跳过读题</small>
              </label>
              {lMode === 'practice' && (
                <small style={{ color: '#0b4f78', fontSize: 12.5 }}>
                  {scope === 'full'
                    ? '仅听力段不限时（∞），进入阅读后按阅读计时继续；每题用时照常统计'
                    : '练习模式听力不限时（∞），每题用时照常统计'}
                </small>
              )}
            </div>
          </>
        )}

        <h3 className="start-group">计时</h3>
        <div className="row">
          <label>计时方式</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" name="timing" checked={!custom} onChange={() => setCustom(false)} />
            严格实考
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" name="timing" checked={custom} onChange={() => setCustom(true)} />
            自定义
          </label>
        </div>
        {custom && (
          <div className="row">
            <label>分钟数</label>
            {scope !== 'writing' && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                阅读
                <input type="text" inputMode="numeric" value={minutes}
                  onChange={e => { setMinutes(digitsOnly(e.target.value)); setTimeErr(''); }}
                  style={{ width: 70, padding: '6px 8px', fontFamily: 'inherit', fontSize: 14 }} />
              </span>
            )}
            {(scope === 'writing' || scope === 'full') && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                写作
                <input type="text" inputMode="numeric" value={writingMinutes}
                  onChange={e => { setWritingMinutes(digitsOnly(e.target.value)); setTimeErr(''); }}
                  style={{ width: 70, padding: '6px 8px', fontFamily: 'inherit', fontSize: 14 }} />
              </span>
            )}
            <span style={{ color: '#6c7075', fontSize: 12.5 }}>分钟（1-180）</span>
          </div>
        )}
        {custom && timeErr && (
          <div className="row" style={{ color: '#B0243A', fontSize: 13, marginTop: 4 }}>{timeErr}</div>
        )}

        {WRITING_GRADING && showGradeOpt && (
          <p className="start-note">
            {llmOk
              ? '判改模型已配置：交卷后自动进行写作 AI 判改（四维评分，仅供参考）。'
              : '判改模型未配置：点「开始」后会让你选择要不要判改，并现场填写 Base URL / API Key / 模型名；也可以先跳过、交卷后在成绩单上再判改。'}
          </p>
        )}

        <div className="start-summary" aria-live="polite">
          {scopeLabel[scope]} · {custom ? `${totalMinutes || '—'} 分钟（自定义）` : `${totalMinutes} 分钟`}
          {(scope === 'listening' || scope === 'lsection' || (scope === 'full' && hasListening))
            ? ` · ${lMode === 'real' ? '听力实考模式' : '听力练习模式'}`
            : ''}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14, marginBottom: 0 }}>
          <button className="as-secondary" onClick={onCancel}>取消</button>
          <button className="as-primary" onClick={start}>开始练习</button>
        </div>
        <p className="affil-note">Unofficial practice interface · not affiliated with any examination body</p>
      </div>
    </div>
  );
}
