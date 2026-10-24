/** 通道 A：导入抽取 JSON 的 Schema 校验 + 完整性检查（失败报具体原因，不静默吞数据） */

export interface Validation {
  errors: string[];
  warnings: string[];
}

const KNOWN_TYPES = new Set([
  'matching_paragraph_info', 'matching_headings', 'true_false_not_given', 'yes_no_not_given',
  'multiple_choice_single', 'multiple_choice_multi', 'sentence_completion', 'summary_completion',
  'notes_completion', 'table_completion', 'flow_chart_completion', 'diagram_labelling',
  'matching_features', 'matching_sentence_endings', 'list_selection',
]);

export function validateExtracted(ex: any): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) {
    return { errors: ['顶层不是 JSON 对象'], warnings };
  }
  const passages = ex.reading?.passages;
  if (!Array.isArray(passages) || passages.length === 0) {
    errors.push('缺少 reading.passages（或为空数组）');
    return { errors, warnings };
  }

  const nums: number[] = [];
  passages.forEach((p: any, pi: number) => {
    const where = `Passage ${pi + 1}`;
    if (!Array.isArray(p.paragraphs) || p.paragraphs.length === 0) {
      errors.push(`${where}：paragraphs 缺失或为空`);
    }
    if (!Array.isArray(p.question_groups) || p.question_groups.length === 0) {
      errors.push(`${where}：question_groups 缺失或为空`);
    }
    (p.question_groups ?? []).forEach((g: any, gi: number) => {
      if (!g.type) errors.push(`${where} 第 ${gi + 1} 组：缺少 type`);
      else if (!KNOWN_TYPES.has(g.type)) warnings.push(`${where} 第 ${gi + 1} 组：未知题型 "${g.type}"，将按填空渲染`);
      if (!g.instruction) warnings.push(`${where} 第 ${gi + 1} 组：instruction 为空`);
      if (!Array.isArray(g.questions) || g.questions.length === 0) {
        errors.push(`${where} 第 ${gi + 1} 组：questions 缺失或为空`);
        return;
      }
      g.questions.forEach((q: any) => {
        if (!Number.isInteger(q?.number)) {
          errors.push(`${where} 第 ${gi + 1} 组：存在非整数题号 ${JSON.stringify(q?.number)}`);
        } else {
          nums.push(q.number);
        }
      });
      // 匹配题字母不能超出文章段落标签
      const labels = (p.paragraphs ?? []).map((x: any) => x?.label).filter(Boolean);
      if (g.type === 'matching_paragraph_info' && labels.length) {
        const m = String(g.instruction ?? '').match(/\b([A-Z])\s*-\s*([A-Z])\b/);
        if (m && !labels.includes(m[2])) {
          warnings.push(`${where} 第 ${gi + 1} 组：匹配区间到 ${m[2]}，但文章段落标签只到 ${labels[labels.length - 1]}`);
        }
      }
    });
  });

  // 题号从 1 连续、无重复
  nums.sort((a, b) => a - b);
  const seen = new Set<number>();
  for (const n of nums) {
    if (seen.has(n)) errors.push(`题号重复：${n}`);
    seen.add(n);
  }
  for (let i = 1; i <= nums.length; i++) {
    if (nums[i - 1] !== i) {
      errors.push(`题号不连续：第 ${i} 题缺失（实际为 ${nums[i - 1] ?? '末尾'}）`);
      break;
    }
  }
  if (nums.length > 0 && nums.length !== 40) {
    warnings.push(`共 ${nums.length} 题（整卷应为 40，单篇/截取可忽略此提示）`);
  }

  if (!ex.writing?.task1?.prompt) warnings.push('writing.task1.prompt 为空');
  if (!ex.writing?.task2?.prompt) warnings.push('writing.task2.prompt 为空');

  return { errors, warnings };
}
