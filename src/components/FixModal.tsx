import { useEffect, useState } from 'react';
import type { StoredTest } from '../lib/store';
import { hydrateTest } from '../lib/store';
import { saveAudio, saveImage, loadImage } from '../lib/media';
import { adaptExtracted } from '../lib/adapter';
import { validateExtracted } from '../lib/validate';
import type { Passage, Question, QuestionType } from '../types';
import type { ExtractedGroup, ExtractedListeningSection, ExtractedQuestion, ExtractedQType, ExtractedTest } from '../types/extracted';

const TYPE_LABEL: Record<QuestionType, string> = {
  tfng: 'TRUE/FALSE/NOT GIVEN（或 YES/NO）',
  single: '单选',
  multiple: '多选（限选）',
  gapfill: '填空',
  matchingHeadings: '下拉匹配（段落标题）',
  matchingFeatures: '下拉匹配（特征/句尾，字母可重复）',
  matchingInfo: '段落信息匹配（表格）',
};

/** 抽取稿（原始）题型 —— 听力与导出的 JSON 用这一套 */
const RAW_TYPES: readonly [ExtractedQType, string][] = [
  ['true_false_not_given', 'TRUE/FALSE/NOT GIVEN'],
  ['yes_no_not_given', 'YES/NO/NOT GIVEN'],
  ['multiple_choice_single', '单选'],
  ['multiple_choice_multi', '多选（Choose TWO…）'],
  ['list_selection', '多选（选项表）'],
  ['matching_headings', '匹配段落标题'],
  ['matching_features', '匹配特征（字母可重复）'],
  ['matching_sentence_endings', '匹配句尾'],
  ['matching_paragraph_info', '段落信息匹配'],
  ['sentence_completion', '句子填空'],
  ['summary_completion', '摘要填空'],
  ['notes_completion', '笔记填空'],
  ['table_completion', '表格填空'],
  ['flow_chart_completion', '流程图填空'],
  ['diagram_labelling', '图标标注'],
] as const;

/** 适配后题型 ←→ 抽取稿题型（用于把我的修改写回原始数据，保证导出不丢修改） */
const TO_RAW: Partial<Record<QuestionType, ExtractedQType>> = {
  single: 'multiple_choice_single',
  multiple: 'multiple_choice_multi',
  matchingHeadings: 'matching_headings',
  matchingFeatures: 'matching_features',
  matchingInfo: 'matching_paragraph_info',
};

type Tab = 'reading' | 'listening' | 'answers' | 'media' | 'issues';
export type FixTab = Tab;

interface Props {
  test: StoredTest;
  onClose: () => void;
  onSave: (t: StoredTest) => void;
  initialTab?: Tab;
}

/** 结构化修正界面：阅读 / 听力 / 答案 / 媒体 / 提示 —— 全部可改，且改动会写回导出所用的原始数据 */
export default function FixModal({ test, onClose, onSave, initialTab = 'reading' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [passages, setPassages] = useState<Passage[]>(() => JSON.parse(JSON.stringify(test.passages ?? [])));
  const [sections, setSections] = useState<ExtractedListeningSection[]>(
    () => JSON.parse(JSON.stringify(test.listening?.sections ?? [])));
  const [listAnswers, setListAnswers] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(test.listening?.answers ?? {}).map(([k, v]) => [k, v])));
  const [readAnswers, setReadAnswers] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(test.answers ?? {}).map(([k, v]) => [k, v])));
  const [issues, setIssues] = useState<string[]>(() => [...(test.issues ?? [])]);
  const [audio, setAudio] = useState<Record<number, File>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [figNew, setFigNew] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  /* 载入题图缩略（题图存在 IndexedDB，列表里的对象不带 data URL） */
  useEffect(() => {
    (async () => {
      const out: Record<string, string> = {};
      for (const slot of test.images ?? []) {
        const v = await loadImage(slot.key).catch(() => null);
        if (v) out[slot.path] = v;
      }
      setThumbs(out);
    })();
  }, [test]);

  /* ---------- 阅读编辑 ---------- */
  const patchQ = (pi: number, gi: number, qi: number, patch: Partial<Question>) => {
    setPassages(ps => ps.map((p, i) => i !== pi ? p : {
      ...p,
      groups: p.groups.map((g, j) => j !== gi ? g : {
        ...g,
        questions: g.questions.map((q, k) => (k === qi ? { ...q, ...patch } : q)),
      }),
    }));
  };
  const patchGroup = (pi: number, gi: number, patch: Partial<Passage['groups'][number]>) => {
    setPassages(ps => ps.map((p, i) => i !== pi ? p : {
      ...p,
      groups: p.groups.map((g, j) => (j === gi ? { ...g, ...patch } : g)),
    }));
  };

  /* ---------- 听力编辑（原始抽取结构） ---------- */
  const patchSecGroup = (si: number, gi: number, patch: Partial<ExtractedGroup>) => {
    setSections(ss => ss.map((s, i) => i !== si ? s : {
      ...s,
      question_groups: s.question_groups.map((g, j) => (j === gi ? { ...g, ...patch } : g)),
    }));
  };
  const patchSecQ = (si: number, gi: number, qi: number, patch: Partial<ExtractedQuestion>) => {
    setSections(ss => ss.map((s, i) => i !== si ? s : {
      ...s,
      question_groups: s.question_groups.map((g, j) => j !== gi ? g : {
        ...g,
        questions: g.questions.map((q, k) => (k === qi ? { ...q, ...patch } : q)),
      }),
    }));
  };

  /* ---------- 保存：把阅读的修改也写回 extracted（导出用的是原始结构） ---------- */
  const syncExtracted = (): ExtractedTest | undefined => {
    if (!test.extracted) return undefined;
    const ex = JSON.parse(JSON.stringify(test.extracted)) as ExtractedTest;
    const rawPassages = ex.reading?.passages ?? [];
    passages.forEach((p, pi) => {
      const rp = rawPassages[pi];
      if (!rp) return;
      (p.groups ?? []).forEach((g, gi) => {
        const rg = rp.question_groups?.[gi];
        if (!rg) return;
        rg.instruction = g.instruction ?? rg.instruction;
        if (g.body != null) rg.content = g.body;
        const mapped = TO_RAW[g.questions[0]?.type as QuestionType];
        if (mapped) rg.type = mapped;
        (g.questions ?? []).forEach((q, qi) => {
          const rq = rg.questions?.[qi];
          if (!rq) return;
          const text = (q.stem ?? q.gapPrefix ?? rq.text ?? '') as string;
          if (text) rq.text = text;
          if (q.options) rq.choices = q.options;
          if (q.wordLimit) (rq as { word_limit?: number }).word_limit = q.wordLimit;
        });
      });
    });
    return ex;
  };

  const save = async () => {
    const next: StoredTest = {
      ...test,
      passages,
      answers: Object.keys(readAnswers).length ? (readAnswers as unknown as Record<number, string>) : test.answers,
      issues,
      ...(test.listening ? {
        listening: {
          sections,
          answers: Object.keys(listAnswers).length ? (listAnswers as unknown as Record<number, string>) : test.listening.answers,
        },
      } : {}),
    };
    const ex = syncExtracted();
    if (ex) next.extracted = ex;
    try {
      for (const [no, blob] of Object.entries(audio)) await saveAudio(`${test.id}/s${no}`, blob);
      for (const [path, dataUrl] of Object.entries(figNew)) {
        const slot = (test.images ?? []).find(s => s.path === path);
        if (slot) await saveImage(slot.key, dataUrl);
      }
    } catch (e) {
      setMsg(`媒体写入失败：${(e as Error).message}`);
      return;
    }
    onSave(next);
  };

  const readFile = (f: File, cb: (dataUrl: string) => void) => {
    const r = new FileReader();
    r.onload = () => cb(String(r.result));
    r.readAsDataURL(f);
  };

  const ansRows = (obj: Record<string, string>, set: (o: Record<string, string>) => void, lo: number, hi: number) => (
    <div className="fix-ans-grid">
      {Array.from({ length: hi - lo + 1 }, (_, k) => String(lo + k)).map(no => (
        <label key={no} className="fix-ans-cell">
          <span>{no}</span>
          <input value={obj[no] ?? ''} onChange={e => set({ ...obj, [no]: e.target.value })} placeholder="—" />
        </label>
      ))}
    </div>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal fix-modal" style={{ maxWidth: 1180, width: '94vw' }} onClick={e => e.stopPropagation()}>
        <h2>修正题目 — {test.name}</h2>
        <div className="fix-tabs">
          {([['reading', '阅读'], ['listening', '听力'], ['answers', '答案'], ['media', '媒体（音频/题图）'], ['issues', '提示']] as [Tab, string][])
            .map(([k, l]) => (
              <button key={k} className={'fix-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
            ))}
        </div>
        {msg && <div className="fix-issues">{msg}</div>}

        <div className="fix-body">
          {/* ---------- 阅读 ---------- */}
          {tab === 'reading' && passages.map((p, pi) => (
            <div key={pi} className="fix-passage">
              <h3>{p.label} · {p.title}</h3>
              {p.groups.map((g, gi) => (
                <div key={gi} className="fix-group">
                  <div className="fix-group-head">
                    <b>{g.title}</b>
                    <input className="fix-instruction" value={g.instruction}
                      onChange={e => patchGroup(pi, gi, { instruction: e.target.value })} title="指令原文" />
                  </div>
                  {g.body != null && (
                    <textarea className="fix-body-text" rows={3} value={g.body}
                      onChange={e => patchGroup(pi, gi, { body: e.target.value })}
                      title="摘要/表格正文，空位用 [Q题号] 占位" />
                  )}
                  {g.questions.map((q, qi) => (
                    <div key={q.no} className="fix-q">
                      <span className="q-no">{q.no}</span>
                      <select value={q.type} onChange={e => patchQ(pi, gi, qi, { type: e.target.value as QuestionType })}>
                        {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input className="fix-stem" placeholder="题干 / 填空前文"
                        value={q.stem ?? q.gapPrefix ?? ''}
                        onChange={e => patchQ(pi, gi, qi, q.type === 'gapfill' && !g.body
                          ? { gapPrefix: e.target.value } : { stem: e.target.value })} />
                      {(q.type === 'single' || q.type === 'multiple' || q.type === 'matchingHeadings' || q.type === 'matchingFeatures') && (
                        <textarea className="fix-opts" rows={2} placeholder="选项，一行一个"
                          value={(q.options ?? []).join('\n')}
                          onChange={e => patchQ(pi, gi, qi, { options: e.target.value.split('\n').filter(Boolean) })} />
                      )}
                      {q.type === 'multiple' && (
                        <input className="fix-num" type="number" min={1} max={5} title="限选数量"
                          value={q.maxSelect ?? 2} onChange={e => patchQ(pi, gi, qi, { maxSelect: Number(e.target.value) || 2 })} />
                      )}
                      {q.type === 'gapfill' && (
                        <input className="fix-num" type="number" min={1} max={5} title="字数上限"
                          value={q.wordLimit ?? 2} onChange={e => patchQ(pi, gi, qi, { wordLimit: Number(e.target.value) || undefined })} />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          {/* ---------- 听力 ---------- */}
          {tab === 'listening' && (sections.length === 0
            ? <div style={{ padding: 12, color: '#6c7075' }}>这套题没有听力数据。</div>
            : sections.map((s, si) => (
              <div key={si} className="fix-passage">
                <h3>Section {s.section_number ?? si + 1} · {s.context ?? s.title ?? ''}</h3>
                {(s.question_groups ?? []).map((g, gi) => (
                  <div key={gi} className="fix-group">
                    <div className="fix-group-head">
                      <b>Q{g.range}</b>
                      <select value={g.type}
                        onChange={e => patchSecGroup(si, gi, { type: e.target.value as ExtractedQType })}>
                        {RAW_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input className="fix-instruction" value={g.instruction ?? ''}
                        onChange={e => patchSecGroup(si, gi, { instruction: e.target.value })} title="指令原文" />
                    </div>
                    <textarea className="fix-body-text" rows={3} value={g.content ?? ''}
                      onChange={e => patchSecGroup(si, gi, { content: e.target.value })}
                      title="题干正文，空位用 [Q题号] 占位（表格用 | 分列）" />
                    {(g.questions ?? []).map((q, qi) => (
                      <div key={q.number} className="fix-q">
                        <span className="q-no">{q.number}</span>
                        <input className="fix-stem" placeholder="题干"
                          value={q.text ?? ''} onChange={e => patchSecQ(si, gi, qi, { text: e.target.value })} />
                        {q.choices && (
                          <textarea className="fix-opts" rows={2} placeholder="选项，一行一个"
                            value={(q.choices ?? []).join('\n')}
                            onChange={e => patchSecQ(si, gi, qi, { choices: e.target.value.split('\n').filter(Boolean) })} />
                        )}
                        <input className="fix-num" type="number" min={1} max={5} title="字数上限"
                          value={(q as { word_limit?: number }).word_limit ?? ''} placeholder="词数"
                          onChange={e => patchSecQ(si, gi, qi, { word_limit: Number(e.target.value) || undefined })} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )))}

          {/* ---------- 答案 ---------- */}
          {tab === 'answers' && (
            <>
              <h3>听力答案（1–40）</h3>
              {ansRows(listAnswers, setListAnswers, 1, 40)}
              <h3 style={{ marginTop: 16 }}>阅读答案（1–40）</h3>
              {ansRows(readAnswers, setReadAnswers, 1, 40)}
              <div style={{ fontSize: 12, color: '#6c7075', marginTop: 8 }}>
                等价写法用 <code>/</code> 分隔（如 <code>10 / ten</code>）；放在括号里表示可省略（如 <code>metal(s)</code>）。
              </div>
            </>
          )}

          {/* ---------- 媒体 ---------- */}
          {tab === 'media' && (
            <>
              <h3>听力音频（每节一个文件）</h3>
              {[1, 2, 3, 4].map(no => {
                const has = audio[no] || (test.listening?.sections ?? []).some(s => (s.section_number ?? 0) === no);
                const sectionExists = (test.listening?.sections ?? []).some(s => (s.section_number ?? 0) === no);
                if (!sectionExists) return null;
                return (
                  <div key={no} className="fix-q">
                    <span className="q-no">S{no}</span>
                    <span style={{ minWidth: 150 }}>{audio[no] ? `待写入：${audio[no].name ?? '新文件'}` : (has ? '已就绪（IndexedDB）' : '缺失')}</span>
                    <label className="btn-dark" style={{ padding: '4px 12px', cursor: 'pointer' }}>
                      选择音频文件
                      <input type="file" accept="audio/*" style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) setAudio(a => ({ ...a, [no]: f })); }} />
                    </label>
                  </div>
                );
              })}
              <h3 style={{ marginTop: 16 }}>题图（地图 / 平面图 / 流程图 / 写作图表）</h3>
              {(test.images ?? []).length === 0 && <div style={{ color: '#6c7075' }}>这套题没有题图。</div>}
              <div className="fix-figs">
                {(test.images ?? []).map(slot => (
                  <div key={slot.key} className="fix-fig">
                    <div style={{ fontSize: 12, color: '#6c7075' }}>{slot.path}</div>
                    <img src={figNew[slot.path] ?? thumbs[slot.path] ?? ''} alt={slot.path} />
                    <label className="btn-dark" style={{ padding: '4px 12px', cursor: 'pointer' }}>
                      替换图片
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f, u => setFigNew(m => ({ ...m, [slot.path]: u }))); }} />
                    </label>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ---------- 提示 ---------- */}
          {tab === 'issues' && (
            <>
              <h3>待确认项（{issues.length}）</h3>
              <div style={{ marginBottom: 10 }}>
                <button className="btn-dark" style={{ padding: '6px 14px' }} onClick={async () => {
                  if (!test.extracted) { setMsg('这套题没有结构化原始数据，无法重新诊断。'); return; }
                  const hydrated = await hydrateTest(test);
                  const ex = hydrated.extracted!;
                  const v = validateExtracted(ex);
                  const adapted = adaptExtracted(ex);
                  setIssues([...(ex.uncertain ?? []), ...v.warnings, ...adapted.issues]);
                  setMsg(`已按当前题包重新诊断（题图/音频以题库现状为准）`);
                }}>重新诊断</button>
                <span style={{ fontSize: 12, color: '#6c7075', marginLeft: 10 }}>
                  导入早于题包更新时，旧的问题记录会留在这里；点一下即可按当前内容重算。
                </span>
              </div>
              {issues.length === 0
                ? <div style={{ color: '#6c7075' }}>没有待确认项。</div>
                : issues.map((s, i) => (
                  <div key={i} className="fix-q">
                    <span style={{ flex: 1 }}>⚠ {s}</span>
                    <button className="btn-dark" style={{ padding: '2px 10px' }}
                      onClick={() => setIssues(v => v.filter((_, k) => k !== i))}>已处理</button>
                  </div>
                ))}
              {issues.length > 0 && (
                <button className="btn-dark" style={{ marginTop: 10 }} onClick={() => setIssues([])}>全部标记为已处理</button>
              )}
            </>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginBottom: 0 }}>
          <button className="btn-dark" style={{ padding: '10px 24px' }} onClick={onClose}>取消</button>
          <button className="btn-ok" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
