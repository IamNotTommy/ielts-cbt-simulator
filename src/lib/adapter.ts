/** 适配层：LLM 抽取 JSON → 渲染器使用的 Passage / WritingTask 结构 */
import type {
  ExtractedGroup,
  ExtractedListeningSection,
  ExtractedTest,
} from '../types/extracted';
import type { Passage, QuestionGroup, WritingTask } from '../types';

const NUM_WORD: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/**
 * 按题面措辞解释填空约束（实考里每条指令的判分口径本来就不同）：
 * - "ONE WORD AND/OR A NUMBER"：允许「一个词 + 一个数字」这类组合（如 12 March、17th October、£14.50），
 *   所以有效上限放宽一个单位，并在超限提示里回显官方措辞而不是硬写成 "1 WORD"。
 * - "ONE WORD ONLY" / "NO MORE THAN N WORDS"：按字数上限严格判定。
 * 返回的 wordLimit 是「有效上限」，limitLabel 用于提示文案。
 */
function wordRule(text: string, fallback?: number): { wordLimit?: number; wordLimitBase?: number; limitLabel?: string; numberOk?: boolean } {
  const t = (text ?? '').replace(/\s+/g, ' ');
  if (/AND\s*\/\s*OR\s+A\s+NUMBER/i.test(t) || /OR\s+A\s+NUMBER/i.test(t)) {
    const m = t.match(/(ONE|TWO|THREE|FOUR|FIVE|\d+)\s+WORDS?\s+AND\s*\/\s*OR\s+A\s+NUMBER/i);
    const base = m ? (NUM_WORD[m[1].toUpperCase()] ?? Number(m[1]) ?? 1) : 1;
    const label = (m ? m[0] : 'ONE WORD AND/OR A NUMBER').replace(/\s+/g, ' ').trim().toUpperCase();
    // 有效上限放宽一个单位（容纳 "词 + 数字"），但基础上限仍用于框宽/计数
    return { wordLimit: base + 1, wordLimitBase: base, limitLabel: label, numberOk: true };
  }
  if (/ONE\s+WORD\s+AND\s*\/\s*OR\s+TWO\s+NUMBERS/i.test(t)) {
    return { wordLimit: 3, wordLimitBase: 1, limitLabel: 'ONE WORD AND/OR TWO NUMBERS', numberOk: true };
  }
  if (/ONE\s+WORD\s+ONLY/i.test(t)) {
    const base = fallback ?? 1;
    return { wordLimit: base, wordLimitBase: base };
  }
  return fallback != null ? { wordLimit: fallback, wordLimitBase: fallback } : {};
}

function parseChooseCount(instruction: string): number {
  const m = instruction.match(/Choose\s+(ONE|TWO|THREE|FOUR|FIVE)/i);
  return m ? NUM_WORD[m[1].toUpperCase()] ?? 2 : 2;
}

/** 从 "A-E" / "A - F" 解析段落字母区间 */
export function parseLetterRange(text: string): string[] | null {
  const m = text.match(/\b([A-Z])\s*-\s*([A-Z])\b/);
  if (!m) return null;
  const a = m[1].charCodeAt(0);
  const b = m[2].charCodeAt(0);
  if (b <= a || b - a > 12) return null;
  return Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i));
}

const LETTER_RE = /^([A-Z]|[ivxl]+)\b/;

/** 选项归一化：题包里可能是字符串 "A fear of…"，也可能是对象 {label:'A', text:'…'}（早期转录产物）。
 *  渲染器只接受字符串，这里统一转成 "A …"；空值/无效值丢弃。 */
export function toOptions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(o => {
    if (typeof o === 'string') return o.trim();
    if (o && typeof o === 'object') {
      const rec = o as Record<string, unknown>;
      const label = typeof rec.label === 'string' ? rec.label.trim() : '';
      const text = typeof rec.text === 'string' ? rec.text.trim() : '';
      return label && text ? `${label} ${text}` : (label || text);
    }
    return o == null ? '' : String(o).trim();
  }).filter(Boolean);
}

/** 选项首 token 作为作答值（"A fear of…"→A，"i  A famous…"→i） */
function optionValue(opt: string): string {
  const m = opt.trim().match(LETTER_RE);
  return m ? m[1] : opt.trim();
}

interface AdaptResult {
  passages: Passage[];
  writingTasks: WritingTask[];
  answers: Record<number, string> | null;
  issues: string[];
}

/** 题组标题按卷面习惯写：单题 Question 26；两题 Questions 27 and 28；三题及以上 Questions 1-5 */
export function rangeTitle(range: string | undefined): string {
  const r = String(range ?? '').trim();
  if (/^\d+$/.test(r)) return `Question ${r}`;
  const m = r.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (b - a === 1) return `Questions ${a} and ${b}`;
    return `Questions ${a}-${b}`;
  }
  return `Questions ${r}`;
}

function adaptGroup(g: ExtractedGroup, passageLabels: string[], issues: string[]): QuestionGroup {
  const base: QuestionGroup = {
    title: rangeTitle(g.range),
    instruction: g.instruction,
    nb: /\bNB\b/.test(g.instruction),
    ...(g.figure_image?.startsWith('data:image/') ? { figureImage: g.figure_image } : {}),
    questions: [],
  };
  const wl = (qWl: number | null) => qWl ?? g.max_words ?? undefined;
  /** 逐空约束：按题组指令的官方措辞解释（含 "AND/OR A NUMBER" 时放宽一个单位） */
  const ruleOf = (qWl: number | null) => wordRule(g.instruction ?? '', wl(qWl));

  /** "统一正文"渲染：题干统一放在一组正文里（content 优先于旧字段 body），空位由 [Qn] 标记。
   *  summary / notes / table / flow-chart / diagram 都用它；sentence_completion 在
   *  "句子写在 content、questions[].text 只写 Blank N" 的题包里也走这条（否则界面只剩 Blank N）。 */
  const applyBodyGroup = () => {
    // 统一版：content 才是考生可见完整题干（渲染以它为准）；body 是旧字段。
    // 个别题包把"表格/摘要的小标题"写进了 body，若优先取 body 会把正文顶掉、空位全部消失，
    // 因此这里**优先取非空的 content**，只有 content 缺失时才回退到 body。
    let body = (g.content && g.content.trim()) ? g.content : (g.body ?? null);
    let questions = g.questions;
    // 旧格式迁移：题干被塞进 number=0 条目
    const zero = g.questions.find(q => q.number === 0);
    if (!body && zero) {
      body = zero.text ?? '';
      questions = (g.blank_numbers ?? []).map(no => ({ number: no, text: `Blank ${no}`, choices: null, word_limit: null }));
      issues.push(`Questions ${g.range}：题包格式较旧（题干在 number=0 条目），已自动迁移，建议重新抽取`);
    }
    base.body = body ?? g.questions.map(q => q.text ?? '').join('\n');
    // 统一版 content 保留给渲染层（听力填空正文以它为准，不被 listify 拆行逻辑改写）
    if (body) base.content = body;
    // 笔记/表格填空：原文是表格式列表结构，渲染时按列表标记逐行展示（摘要填空是连贯段落，不拆）
    if (g.type === 'notes_completion' || g.type === 'table_completion') base.listify = true;
    // 带词库的摘要/笔记题（"using the list of words, A-K"）：词库透传，前端渲染为拖拽作答
    if (toOptions(g.options).length) base.options = toOptions(g.options);
    base.questions = questions.filter(q => q.number > 0).map(q => ({
      no: q.number,
      type: 'gapfill' as const,
      pairedBlanks: ((body ?? '').match(new RegExp(`\\[Q${q.number}\\]`, 'g')) ?? []).length === 2,
      ...ruleOf(q.word_limit),
    }));
    // 图表类题（流程图/图标标注）：只有"既没有配图、正文里也没把图上文字抄下来"时才提示。
    // 很多扫描件的图表题是**把图上的标注文字抄进正文**（带 [Qn] 占位符）来作答的（如剑16 T4 阅读 P1 Q1-6），
    // 这种情况渲染完全正常，不该报"待确认"。
    const hasFig = !!(g as { figure_image?: string }).figure_image;
    const figAsText = /\[Q\d+\]/.test(`${g.content ?? ''}\n${g.body ?? ''}`);
    if ((g.type === 'diagram_labelling' || g.type === 'flow_chart_completion') && !hasFig && !figAsText) {
      issues.push(`Questions ${g.range}：${g.type} 需要配图，但题包里既没有图、正文也没有空位（可在「修正 → 媒体」补图或改题型）`);
    }
  };

  switch (g.type) {
    case 'true_false_not_given':
    case 'yes_no_not_given':
      base.questions = g.questions.map(q => ({ no: q.number, type: 'tfng', stem: q.text ?? '' }));
      break;

    case 'multiple_choice_single':
      base.questions = g.questions.map(q => ({
        no: q.number,
        type: 'single',
        stem: q.text ?? '',
        options: toOptions(q.choices ?? g.options),
      }));
      break;

    case 'multiple_choice_multi': {
      const max = parseChooseCount(g.instruction);
      const opts = toOptions(g.options);
      const letters = opts.map((_, i) => String.fromCharCode(65 + i));
      const sharedStem = g.questions.find(q => q.text)?.text ?? g.instruction;
      base.questions = g.questions.map((q, i) =>
        i === 0
          ? { no: q.number, type: 'multiple', stem: sharedStem, options: opts, optionLetters: letters, maxSelect: max }
          : { no: q.number, type: 'multiple', stem: '(same answer set)', options: [], maxSelect: 0 },
      );
      break;
    }

    case 'list_selection': {
      // "从选项框里给每题选一个字母"（剑16/17 常见：Which X does each Y mention? / Choose FOUR answers from the box,
      // write the correct letter ... next to questions 27-30）。判据用**每题是否有各自独立的题干**：
      //   每题题干各不相同（Medical terminology / Diet and nutrition / …）→ 每题一个字母下拉（与匹配特征同构）
      //   多题共用一个题干（Which TWO features …?）→ 整组共享的多选
      const distinctStems = new Set(g.questions.map(q => (q.text ?? '').trim()).filter(t => t.length > 2)).size;
      if (distinctStems >= 2) {
        base.questions = g.questions.map(q => ({
          no: q.number,
          type: 'matchingFeatures' as const,
          stem: q.text ?? '',
          options: toOptions(g.options),
        }));
      } else {
        const askCount = parseChooseCount(g.instruction);
        const opts = toOptions(g.options);
        const letters = opts.map((_, i) => String.fromCharCode(65 + i));
        const sharedStem = g.questions.find(q => q.text)?.text ?? g.instruction;
        base.questions = g.questions.map((q, i) =>
          i === 0
            ? { no: q.number, type: 'multiple', stem: sharedStem, options: opts, optionLetters: letters, maxSelect: askCount }
            : { no: q.number, type: 'multiple', stem: '(same answer set)', options: [], maxSelect: 0 },
        );
      }
      break;
    }

    case 'sentence_completion': {
      // 两种数据形态：
      //  A) 每题的 text 自己就是完整句子（含 [Qn] 占位符）→ 按题渲染（下面这段）
      //  B) 句子统一放在组 content 里、questions[].text 只写 "Blank 21" → 必须按"统一正文"渲染，
      //     否则界面只剩 "Blank 21" 两个字，考生完全无法作答（Test 4 听力 21-22 就踩过这个坑）。
      const cText = (g.content ?? '').trim();
      const needsBody = /\[Q\d+\]/.test(cText) && g.questions.every(q => !/\[Q\d+\]/.test(q.text ?? ''));
      if (needsBody) {
        applyBodyGroup();   // 句子写在 content 里 → 与 summary/notes 同一套"统一正文"渲染
        break;
      }
      base.questions = g.questions.map(q => {
        const t = q.text ?? '';
        const r = ruleOf(q.word_limit);
        const ph = t.match(/^(.*)\[Q\d+\](.*)$/); // 题面含占位符则拆分前后文
        return ph
          ? { no: q.number, type: 'gapfill', gapPrefix: ph[1], gapSuffix: ph[2], ...r }
          : { no: q.number, type: 'gapfill', gapPrefix: t, gapSuffix: '', ...r };
      });
      break;
    }

    case 'summary_completion':
    case 'notes_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'diagram_labelling': {
      // 地图/图标标注题有两种卷面形态：
      //   ① 空位在**图上**（正文没有 [Qn]）且题组给了字母选项表（如剑16 T4 听力 S2 的园区平面图 A–I）
      //      → 渲染成"配图 + 每题一个字母下拉"
      //   ② 空位在正文/流程图文字里（正文含 [Qn]）→ 按填空处理
      const hasPlaceholders = /\[Q\d+\]/.test(g.content ?? '');
      const opts = toOptions(g.options);
      if (!hasPlaceholders && opts.length >= 2) {
        base.questions = g.questions.map(q => ({
          no: q.number,
          type: 'matchingFeatures' as const,
          stem: q.text ?? '',
          options: opts,
        }));
      } else {
        applyBodyGroup();
      }
      break;
    }

    case 'matching_headings': {
      base.questions = g.questions.map(q => ({
        no: q.number,
        type: 'matchingHeadings' as const,
        stem: q.text ?? '',
        options: toOptions(g.options),
      }));
      const examples = g.examples?.length ? g.examples : (g.example ? [g.example] : []);
      if (examples.length) {
        // 原卷的 Example 行不计分，但**照卷面保留**：单独成一行渲染在题干下方（不再塞进 instruction）
        // 三种常见写法都支持：{"paragraph","answer"} / {"label","answer"} / {"text"}（整行原文）
        base.exampleText = examples
          .map(e => {
            const rec = e as { paragraph?: string; label?: string; answer?: string; text?: string };
            if (rec.text && !rec.answer) return rec.text;          // 卷面上就是一整行
            const where = rec.paragraph ?? rec.label ?? '';
            const ans = rec.answer ?? '';
            return where && ans ? `${where} → ${ans}` : (where || ans);
          })
          .filter(Boolean)
          .join('; ');
      }
      // 段落标题匹配：默认每个标题只能用一次；题面写了 NB 才可重复
      base.repeatOptions = /may use any letter more than once/i.test(g.instruction);
      break;
    }

    case 'matching_paragraph_info': {
      const letters = parseLetterRange(g.instruction) ?? passageLabels;
      base.questions = g.questions.map(q => ({
        no: q.number,
        type: 'matchingInfo',
        stem: q.text ?? '',
        paragraphs: letters,
      }));
      break;
    }

    case 'matching_features':
    case 'matching_sentence_endings':
      // 特征匹配 / 句尾匹配：独立题型（下拉框，只显示字母），同一字母可重复使用；
      // 不再借用 matchingHeadings 渲染器（那是"用掉即不可再用"的段落标题匹配）。
      base.questions = g.questions.map(q => ({
        no: q.number,
        type: 'matchingFeatures' as const,
        stem: q.text ?? '',
        options: toOptions(g.options),
      }));
      break;

    default:
      issues.push(`Questions ${g.range}：未识别题型 ${g.type}，按填空渲染，请手动修正`);
      base.questions = g.questions.map(q => ({
        no: q.number,
        type: 'gapfill',
        gapPrefix: q.text ?? '',
        gapSuffix: '',
      }));
  }
  return base;
}

export function adaptExtracted(ex: ExtractedTest): AdaptResult {
  const issues: string[] = [...(ex.warnings ?? [])];

  const passages: Passage[] = (ex.reading?.passages ?? []).map((p, i) => {
    const firstNo = p.question_groups.flatMap(g => g.questions.map(q => q.number)).sort((a, b) => a - b);
    const labels = p.paragraphs.map(x => x.label).filter(Boolean);
    return {
      label: `Part ${i + 1}`,
      heading: `Read the text below and answer questions ${firstNo[0] ?? ''} - ${firstNo[firstNo.length - 1] ?? ''}.`,
      title: p.title || `Passage ${i + 1}`,
      paragraphs: p.paragraphs.map(x => ({ tag: x.label ?? '', text: x.text })),
      groups: p.question_groups.map(g => adaptGroup(g, labels, issues)),
    };
  });

  const mkTask = (t: typeof ex.writing.task1, part: string, defMin: number, defMins: number): WritingTask => ({
    part,
    timing: `You should spend about ${t?.suggested_minutes ?? defMins} minutes on this task. Write at least ${t?.min_words ?? defMin} words.`,
    promptLines: (t?.prompt ?? '')
      .split(/\n+/)
      .filter(Boolean)
      .map(line => ({ text: line, style: 'italic' as const })),
    hasChart: !!t?.figure || !!t?.figure_data,
    minWords: t?.min_words ?? defMin,
    ...(t?.figure_type ? { figureType: t.figure_type } : {}),
    ...(t?.figure_data ? { figureData: t.figure_data } : {}),
  });
  const writingTasks = [
    mkTask(ex.writing?.task1, 'Part 1', 150, 20),
    mkTask(ex.writing?.task2, 'Part 2', 250, 40),
  ];

  let answers: Record<number, string> | null = null;
  if (ex.answers) {
    answers = {};
    for (const [k, v] of Object.entries(ex.answers)) {
      const n = Number(k);
      if (Number.isFinite(n)) answers[n] = v;
    }
  }

  // 题号连续性校验
  const nums = passages.flatMap(p => p.groups.flatMap(g => g.questions.map(q => q.no))).sort((a, b) => a - b);
  for (let i = 1; i <= nums.length; i++) {
    if (nums[i - 1] !== i) {
      issues.push(`题号不连续：期望 ${i}，实际 ${nums[i - 1]}，请在修正界面检查`);
      break;
    }
  }

  return { passages, writingTasks, answers, issues };
}

export { optionValue };

/** 听力 sections → 类 Passage 结构（无文章段落，只有题组） */
export function adaptListening(sections: ExtractedListeningSection[], issues: string[]): Passage[] {
  return sections.map((sec, i) => ({
    label: `Section ${sec.section_number ?? i + 1}`,
    heading: sec.title ?? '',
    title: sec.title ?? `Section ${sec.section_number ?? i + 1}`,
    paragraphs: [],
    groups: (sec.question_groups ?? []).map(g => adaptGroup(g, [], issues)),
  }));
}
