/** LLM 抽取输出的 JSON Schema（对应 题目PDF抽取_提示词.md 的输出格式） */

export type ExtractedQType =
  | 'matching_paragraph_info'
  | 'matching_headings'
  | 'true_false_not_given'
  | 'yes_no_not_given'
  | 'multiple_choice_single'
  | 'multiple_choice_multi'
  | 'sentence_completion'
  | 'summary_completion'
  | 'notes_completion'
  | 'table_completion'
  | 'flow_chart_completion'
  | 'diagram_labelling'
  | 'matching_features'
  | 'matching_sentence_endings'
  | 'list_selection';

export interface ExtractedQuestion {
  number: number;
  text: string | null;
  choices: string[] | null;
  word_limit: number | null;
}

export interface ExtractedGroup {
  range: string;                    // "1-5"
  type: ExtractedQType;
  instruction: string;              // 指令原文（逐字）
  max_words: number | null;
  options: string[] | null;         // 词库 / List of Headings / 多选选项
  body?: string | null;             // 摘要/表格填空正文（含 [Q12] 占位）
  content?: string | null;          // 统一版：考生可见完整题干（含 [Qn] 占位），渲染以它为准
  blank_numbers?: number[];         // 统一版：空位题号清单
  figure_image?: string;            // ZIP 内地图图片路径（题干原图）
  example?: { paragraph: string; answer: string } | null; // matching_headings 示例
  examples?: { paragraph: string; answer: string }[]; // 可包含 A/D 两个示例（不计分）
  questions: ExtractedQuestion[];
  source_pages?: number[];
}

export interface ExtractedPassage {
  passage_number: number;
  title: string;
  paragraphs: { label: string; text: string }[];
  source_pages?: number[];
  question_groups: ExtractedGroup[];
}

export interface ExtractedWritingTask {
  prompt: string;
  figure?: boolean;
  figure_type?: 'table' | 'bar' | 'line' | 'pie' | string;
  figure_data?: { columns?: string[]; rows?: (string | number)[][] } | null;
  min_words: number;
  suggested_minutes: number;
  source_pages?: number[];
}

export interface ExtractedTest {
  book: string;
  test_number: number;
  module: string;
  reading: { passages: ExtractedPassage[] };
  writing: { task1: ExtractedWritingTask; task2: ExtractedWritingTask };
  answers: Record<string, string> | null;
  ai_answers?: Record<string, { answer: string; evidence: string; confidence: string; source: string }> | null;
  uncertain: string[];
  warnings: string[];
}

/** 听力 section（zip 题包 listening/sectionN.json） */
export interface ExtractedListeningSection {
  section_number: number;
  title?: string;
  context?: string;                 // 统一版：场景一句话
  question_groups: ExtractedGroup[];
  source_pages?: number[];
}
