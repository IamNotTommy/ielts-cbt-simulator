// 题型定义 —— 对应规格说明书 3.4 的七种题型
export type HighlightCls = 'hl1' | 'hl2' | 'strike' | 'hl-y' | 'hl-g' | 'hl-p'; // hl1/hl2 为旧存档兼容

export interface HighlightRec {
  id: string;
  part: number;         // passage 下标（zone='q' 时不使用）
  para: number;         // 段落下标（zone='q' 时为 -1）
  start: number;        // 文本块内偏移
  end: number;
  cls: HighlightCls;
  zone?: 'p' | 'q';     // 缺省 = 文章段落；'q' = 题目文本块
  qblock?: string;      // zone='q' 时的块标识（q12 / gQuestions 1-5）
  noteId?: string;
}

export type QuestionType =
  | 'tfng'            // TRUE/FALSE/NOT GIVEN
  | 'single'          // 单选
  | 'multiple'        // 多选（限选 N）
  | 'gapfill'         // 填空（句子/摘要/表格）
  | 'matchingHeadings'// 段落标题匹配（选项唯一，用掉即不可再用）
  | 'matchingFeatures'// 特征匹配/句尾匹配（每题一个下拉框，只显示字母；同一字母可重复）
  | 'matchingInfo';   // 段落信息匹配（表格点选）

export interface Question {
  no: number;
  type: QuestionType;
  stem?: string;                // 题干（gapfill 用 gapPrefix/gapSuffix 代替）
  options?: string[];           // single/multiple/matchingHeadings/matchingFeatures 选项
  optionLetters?: string[];     // multiple 的 A-E
  maxSelect?: number;           // multiple 限选数量
  instruction?: string;         // 斜体指令（题组级放在 group）
  gapPrefix?: string;           // 填空框前文字
  gapSuffix?: string;           // 填空框后文字
  wordLimit?: number;           // 填空字数上限（按题面措辞解释后的有效值）
  wordLimitBase?: number;       // 指令里写的原值（1 = ONE WORD…），用于输入框宽度/计数，不受放宽影响
  limitLabel?: string;          // 超限提示里回显的官方措辞，如 "ONE WORD AND/OR A NUMBER"
  numberOk?: boolean;           // 该空允许写数字（"AND/OR A NUMBER"），超限判定放宽一个单位
  pairedBlanks?: boolean;        // 单题含两个空（如 Test 2 阅读 Q26），存一项复合答案
  paragraphs?: string[];        // matchingInfo 可选段落字母 ['A'..'H']
}

export interface QuestionGroup {
  title: string;                // "Questions 1 - 6"
  instruction: string;          // 斜体，含大写限制语
  nb?: boolean;                 // 2026 新规：NB 仅题干末尾普通小字
  body?: string;                // 摘要/表格填空正文（含 [Q12] 占位符）
  content?: string;             // 统一版：完整可见题干（含 [Qn] 占位符），优先于 body
  options?: string[];           // 带词库的摘要/笔记题：词库（含字母编号，如 "A spectacular"）
  listify?: boolean;            // 笔记/表格填空：原文是列表式结构，渲染时按列表标记拆行
  repeatOptions?: boolean;      // 段落标题匹配："NB You may use any letter more than once" 时置位（matchingFeatures 天然可重复，不走这里）
  exampleText?: string;         // 原卷印的 Example 行（不计分），如 "Example: Paragraph A → iv"；照卷面保留并在题干下方渲染
  figureImage?: string;         // 原题地图、流程图的内嵌图片
  questions: Question[];
}

export interface Passage {
  label: string;                // "Part 1"
  heading: string;              // 说明框里那句 "Read the text below..."
  title: string;                // 文章标题
  paragraphs: { tag: string; text: string }[]; // tag = 'A' | 'B' ... 或 ''
  groups: QuestionGroup[];
}

export interface WritingTask {
  part: string;                 // "Part 1"
  timing: string;               // Part 说明框原文
  promptLines: { text: string; style: 'italic' | 'bold' | 'plain' }[];
  hasChart: boolean;
  minWords: number;
  figureType?: string;          // table/bar/line/pie（有 figure_data 时渲染简图）
  figureData?: { columns?: string[]; rows?: (string | number)[][] } | null;
  figureImage?: string;          // 导入 ZIP 的图表 data URL（缺图形数据时展示）
}
