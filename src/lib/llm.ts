/** OpenAI 兼容端点的 LLM 客户端 + 抽取调用（Key 只存 localStorage，只打用户自己配置的端点） */
import systemPrompt from '../prompts/extract.md?raw';
import bandDescriptors from '../assets/bandDescriptors.json';
import type { PdfPageImage, PdfPageText } from './pdf';

export interface LlmSlot {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 三槽位：text=结构化抽取；vision=乱码/扫描页兜底；grader=写作 AI 判改专用 */
export interface LlmConfig {
  text: LlmSlot;
  vision: LlmSlot;
  grader: LlmSlot;
}

export const PRESET_DEEPSEEK: LlmSlot = { baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat' };
export const PRESET_GLM4V: LlmSlot = { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', model: 'glm-4v-flash' };
export const PRESET_KIMI: LlmSlot = { baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', model: 'kimi-k2-0905-preview' };

function endpoint(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, '');
  return u.includes('/chat/completions') ? u : `${u}/chat/completions`;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: any;
}

async function chatComplete(cfg: LlmSlot, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(endpoint(cfg.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM 请求失败 HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM 返回为空');
  return content;
}

/** 宽松 JSON 解析：去代码围栏、截取首个 { 到末个 } */
export function parseJsonLoose(raw: string): any {
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('输出中找不到 JSON 对象');
  return JSON.parse(s.slice(a, b + 1));
}

/** 视觉模型兜底：把乱码/扫描页图像逐字转录为纯文本 */
export async function transcribePage(cfg: LlmSlot, image: PdfPageImage): Promise<string> {
  return chatComplete(cfg, [
    {
      role: 'user',
      content: [
        { type: 'text', text: '把这一页真题书的所有文字逐字转录为纯文本，保留段落、题号与选项字母，不输出任何额外说明。' },
        { type: 'image_url', image_url: { url: image.dataUrl } },
      ],
    },
  ]);
}

export interface ExtractParams {
  testNumber: number;
  includeAnswers: boolean;
  pageHint?: string;
}

function buildUserContent(
  params: ExtractParams,
  content: { kind: 'text'; pages: PdfPageText[] } | { kind: 'images'; images: PdfPageImage[] },
): any {
  const head =
    `输入参数：test_number=${params.testNumber}，include_answers=${params.includeAnswers}` +
    (params.pageHint ? `，page_hint=${params.pageHint}` : '') +
    '。以下是上传真题 PDF 的内容，请严格按系统提示词输出一个 JSON 对象。';
  if (content.kind === 'text') {
    const body = content.pages.map(p => `=== Page ${p.page} ===\n${p.text}`).join('\n\n');
    return `${head}\n\n${body}`;
  }
  return [
    { type: 'text', text: `${head}\n（扫描版，共 ${content.images.length} 页图像，按顺序给出）` },
    ...content.images.map(im => ({
      type: 'image_url',
      image_url: { url: im.dataUrl },
    })),
  ];
}

/**
 * 调文本模型抽取一套题；JSON 不合法时按约定原样重发要求修复（最多重试 2 次）。
 * 返回解析后的对象（调用方再做 Schema 校验）。
 */
export async function runExtraction(
  cfg: LlmSlot,
  params: ExtractParams,
  content: { kind: 'text'; pages: PdfPageText[] } | { kind: 'images'; images: PdfPageImage[] },
  onLog?: (line: string) => void,
): Promise<any> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserContent(params, content) },
  ];
  let lastRaw = '';
  for (let attempt = 0; attempt <= 2; attempt++) {
    onLog?.(attempt === 0 ? `调用 ${cfg.model} 结构化中…` : `第 ${attempt} 次重试：要求修复为合法 JSON…`);
    lastRaw = await chatComplete(cfg, messages);
    try {
      const obj = parseJsonLoose(lastRaw);
      if (!obj?.reading?.passages) throw new Error('缺少 reading.passages 字段');
      return obj;
    } catch (e) {
      onLog?.(`JSON 校验未通过（${(e as Error).message}）`);
      messages.push({ role: 'assistant', content: lastRaw });
      messages.push({
        role: 'user',
        content: '上一条输出不是合法 JSON 或缺少必需字段。请只输出修复后的完整 JSON 对象，不要任何额外文字。',
      });
    }
  }
  throw new Error('重试 2 次后仍未得到合法 JSON，请更换模型或缩小页码范围后重试');
}

/** 写作四维评分结果（提示词 D/E 镣铐：展示时强制带"AI 评分仅供参考"标注） */
export interface WritingGrade {
  ta: number; cc: number; lr: number; gra: number;
  band: number;
  reason: { ta: string; cc: string; lr: string; gra: string };
  /** 每个维度引用考生原文的证据句（提示词 G：评分须言之有据） */
  evidence?: { ta: string; cc: string; lr: string; gra: string };
}
export interface WritingGradeResult {
  task1?: WritingGrade;
  task2?: WritingGrade;
}

/** 提示词 G：内置官方 Band Descriptors 摘要版作为评分锚点，要求逐维度引用考生原文证据 */
const GRADE_SYS = `你是英语写作考官。按官方四维给用户作文评分：Task Achievement/Response、Coherence & Cohesion、Lexical Resource、Grammatical Range & Accuracy。

评分锚点（官方 Band Descriptors 公开版摘要，必须严格对照执行）：
${JSON.stringify(bandDescriptors)}

评分规则：
- 每项 0-9 分（允许 0.5），逐项对照上述锚点档位描述定档，不得凭印象给分。
- 每项配一句中文理由（reason），并引用考生作文中的一句原文作为证据（evidence，英文原文摘句，不超过 30 词）。
- 每个 task 的总分 band 为四维平均后按官方规则舍入（.25 进 .5，.75 进下一整分）。
- 只输出 JSON，结构：{"task1":{"ta":0,"cc":0,"lr":0,"gra":0,"band":0,"reason":{"ta":"","cc":"","lr":"","gra":""},"evidence":{"ta":"","cc":"","lr":"","gra":""}},"task2":{同构}}。
- 没有提交的 task 不出现在输出里。不要输出任何其他文字。`;

export async function gradeWriting(
  cfg: LlmSlot,
  items: { task: 'task1' | 'task2'; prompt: string; essay: string }[],
): Promise<WritingGradeResult> {
  const body = items
    .map(it => `【${it.task}】\n题目：${it.prompt}\n\n考生作文（${it.essay.trim().split(/\s+/).filter(Boolean).length} 词）：\n${it.essay}`)
    .join('\n\n====\n\n');
  const raw = await chatComplete(cfg, [
    { role: 'system', content: GRADE_SYS },
    { role: 'user', content: body },
  ]);
  const obj = parseJsonLoose(raw);
  if (!obj?.task1 && !obj?.task2) throw new Error('AI 评分返回缺少 task1/task2');
  return obj as WritingGradeResult;
}

/** 评分理由报告提示词：分数已定不得更改，只按 Band Descriptors 解释"为什么是这个分" */
const RATIONALE_SYS = `你是英语写作考官。考生作文的四维评分已经定稿（分数不得更改）。请参照下方评分锚点，输出**中文 Markdown** 评分理由报告，解释每篇作文每个维度为什么是这个分。

评分锚点（官方 Band Descriptors 公开版摘要，必须严格对照引用）：
${JSON.stringify(bandDescriptors)}

报告结构（严格遵守）：
- 每篇 Task 一个大节：\`## Writing Task 1 — Band X.X\`（Task 2 同理，Band 用已定分数）。
- 每个大节内含四个维度小节，标题依次为：
  \`### Task Achievement\`（Task 1）或 \`### Task Response\`（Task 2）、
  \`### Coherence & Cohesion\`、\`### Lexical Resource\`、\`### Grammatical Range & Accuracy\`。
- 每个维度小节依次写清：
  1. 得分（已定分数）；
  2. 该维度该档位的官方描述要点（对照上述锚点）；
  3. 为什么定这一档：结合考生作文的具体内容，引用 1-2 句英文原文作为证据；
  4. 若要再提半分，需要改什么（具体、可执行）。
- 最后一节 \`## 总结\`：说明写作总 Band 如何按 Task 2 权重 2/3 折算（Task 1 × 1/3 + Task 2 × 2/3，再按 .25/.75 进档），并明确声明"AI 评分仅供参考，非官方成绩"。

只输出 Markdown 正文，不要用代码围栏包裹全文，不要输出任何额外说明。`;

/** 判改完成后生成"评分理由 Markdown 报告"：输入题目/作文/已定分数，输出中文 MD */
export async function gradeWritingRationale(
  cfg: LlmSlot,
  items: { task: 'task1' | 'task2'; prompt: string; essay: string }[],
  grade: WritingGradeResult,
): Promise<string> {
  const body = items
    .map(it => {
      const g = grade[it.task];
      const gline = g
        ? `已定分数：TA/TR ${g.ta}，CC ${g.cc}，LR ${g.lr}，GRA ${g.gra}，Band ${g.band}\n` +
          `评分理由（reason）：${JSON.stringify(g.reason)}\n` +
          `证据句（evidence）：${JSON.stringify(g.evidence ?? {})}`
        : '（该 task 无评分数据）';
      return `【${it.task}】\n题目：${it.prompt}\n\n考生作文：\n${it.essay}\n\n${gline}`;
    })
    .join('\n\n====\n\n');
  const raw = await chatComplete(cfg, [
    { role: 'system', content: RATIONALE_SYS },
    { role: 'user', content: body },
  ]);
  // 模型偶尔仍会用代码围栏包裹全文，剥掉再返回
  return raw.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
}
