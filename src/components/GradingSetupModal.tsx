import { useState } from 'react';
import type { LlmConfig, LlmSlot } from '../lib/llm';
import { PRESET_KIMI } from '../lib/llm';

interface Props {
  /** pre = 开考前配置；post = 交卷后在成绩单上现场判改 */
  mode: 'pre' | 'post';
  /** 已保存的判改槽位（可能只填了一部分） */
  cfg: LlmConfig;
  /** 保存判改槽位（只写 grader 槽，不动抽取用的 text/vision） */
  onSave: (slot: LlmSlot) => void;
  /** 确认：chosen=true 表示要判改（此时 slot 一定是合法且已保存的） */
  onSubmit: (chosen: boolean) => void;
  /** 交卷后那一版：直接放弃判改 */
  onSkip?: () => void;
  busy?: boolean;
  error?: string;          // 判改请求失败等外部错误
}

/**
 * 判改模型配置弹窗（开考前 / 交卷后两用）。
 * 校验分两层：必填缺失、以及格式明显不对（URL 不是 http(s)、Key/模型名含空白或中文）。
 * 任一不通过 → 红字提示并阻止提交。
 */
export default function GradingSetupModal({ mode, cfg, onSave, onSubmit, onSkip, busy, error }: Props) {
  const saved = cfg.grader;
  const complete = !!(saved.baseUrl && saved.apiKey && saved.model);
  // 已配好 → 默认"要判改"；没配好 → 默认"不判改"，避免用户没准备就被判改拦住
  const [choice, setChoice] = useState<'yes' | 'no'>(complete ? 'yes' : 'no');
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl || PRESET_KIMI.baseUrl);
  const [apiKey, setApiKey] = useState(saved.apiKey);
  const [model, setModel] = useState(saved.model || PRESET_KIMI.model);
  const [errs, setErrs] = useState<{ baseUrl?: string; apiKey?: string; model?: string; top?: string }>({});

  /** 逐字段校验：空 → 缺失提示；格式明显不对 → 格式提示 */
  const validate = () => {
    const e: typeof errs = {};
    const u = baseUrl.trim();
    if (!u) e.baseUrl = '请填写 Base URL（如 https://api.moonshot.cn/v1）';
    else if (!/^https?:\/\//i.test(u)) e.baseUrl = 'Base URL 必须以 http:// 或 https:// 开头';
    else if (/\s/.test(u)) e.baseUrl = 'Base URL 不能包含空格';
    else if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(u) && !/^https?:\/\/localhost(:\d+)?/i.test(u)) {
      e.baseUrl = 'Base URL 看起来不完整，示例：https://api.moonshot.cn/v1';
    }

    const k = apiKey.trim();
    if (!k) e.apiKey = '请填写 API Key';
    else if (/\s/.test(k)) e.apiKey = 'API Key 不能包含空格';
    else if (/[\u4e00-\u9fa5]/.test(k)) e.apiKey = 'API Key 不应包含中文，请检查是否粘贴错行';
    else if (k.length < 8) e.apiKey = 'API Key 太短，请检查是否完整';

    const m = model.trim();
    if (!m) e.model = '请填写模型名（如 kimi-k2-0905-preview / deepseek-chat）';
    else if (/\s/.test(m)) e.model = '模型名不能包含空格';
    else if (/[\u4e00-\u9fa5]/.test(m)) e.model = '模型名不应包含中文';

    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (choice === 'no') { onSubmit(false); return; }
    if (!validate()) return;
    const slot: LlmSlot = { baseUrl: baseUrl.trim().replace(/\/+$/, ''), apiKey: apiKey.trim(), model: model.trim() };
    onSave(slot);
    onSubmit(true);
  };

  const preset = () => { setApiKey(''); setBaseUrl(PRESET_KIMI.baseUrl); setModel(PRESET_KIMI.model); setErrs({}); };
  const fieldErr = (k: 'baseUrl' | 'apiKey' | 'model') => errs[k] ? <div className="field-err">{errs[k]}</div> : null;

  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <h2>{mode === 'pre' ? '写作 AI 判改设置' : '现场判改'}</h2>
        <p style={{ margin: '0 0 14px', color: '#6c7075', fontSize: 13.5 }}>
          {mode === 'pre'
            ? '这套题包含写作。可以先决定交卷后要不要 AI 判改；判改需要判改模型的 Base URL / API Key / 模型名（Key 只存本机浏览器）。'
            : '这套题考试已结束。填写判改模型后即可立刻批改刚才的作文；不填也可以直接看成绩。'}
        </p>

        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <label>判改</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
            <input type="radio" name="gradeChoice" checked={choice === 'yes'} onChange={() => { setChoice('yes'); setErrs({}); }} />
            要判改
            <small style={{ color: '#868e96' }}>交卷后按四维给分</small>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
            <input type="radio" name="gradeChoice" checked={choice === 'no'} onChange={() => { setChoice('no'); setErrs({}); }} />
            不判改
            <small style={{ color: '#868e96' }}>
              {mode === 'pre' ? '只存作文，成绩显示 Not graded' : '直接看成绩，写作显示 Not graded'}
            </small>
          </label>
        </div>

        {choice === 'yes' && (
          <div style={{ marginTop: 6 }}>
            <div className="row">
              <label>Base URL</label>
              <input
                type="text"
                placeholder="https://api.moonshot.cn/v1"
                value={baseUrl}
                onChange={e => { setBaseUrl(e.target.value); setErrs(er => ({ ...er, baseUrl: undefined, top: undefined })); }}
                style={{ flex: 1, borderColor: errs.baseUrl ? '#c92a2a' : undefined }}
                disabled={busy}
              />
              <button type="button" className="preset-btn" onClick={preset} disabled={busy}>Kimi 预设</button>
            </div>
            {fieldErr('baseUrl')}

            <div className="row">
              <label>API Key</label>
              <input
                type="password"
                placeholder="sk-…"
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setErrs(er => ({ ...er, apiKey: undefined, top: undefined })); }}
                style={{ flex: 1, borderColor: errs.apiKey ? '#c92a2a' : undefined }}
                disabled={busy}
              />
            </div>
            {fieldErr('apiKey')}

            <div className="row">
              <label>模型名</label>
              <input
                type="text"
                placeholder={PRESET_KIMI.model}
                value={model}
                onChange={e => { setModel(e.target.value); setErrs(er => ({ ...er, model: undefined, top: undefined })); }}
                style={{ flex: 1, borderColor: errs.model ? '#c92a2a' : undefined }}
                disabled={busy}
              />
            </div>
            {fieldErr('model')}

            <p style={{ margin: '4px 0 0', color: '#868e96', fontSize: 12.5 }}>
              判改端点需兼容 OpenAI 的 /chat/completions；这里填的配置与首页「判改模型配置」是同一份。
            </p>
          </div>
        )}

        {(errs.top || error) && <div className="form-err-box">{error ?? errs.top}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 18, marginBottom: 0 }}>
          {mode === 'post' && (
            <button className="btn-dark" style={{ padding: '10px 22px' }} onClick={() => onSkip?.()} disabled={busy}>
              先不看判改
            </button>
          )}
          <button className="btn-ok" onClick={submit} disabled={busy}>
            {busy ? '判改中…' : mode === 'pre' ? (choice === 'yes' ? '保存并开始' : '不判改，开始') : (choice === 'yes' ? '开始判改' : '查看成绩')}
          </button>
        </div>
        <p className="affil-note">AI 评分仅供参考，非官方成绩</p>
      </div>
    </div>
  );
}
