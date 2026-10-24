/** 统一搜索：题库 / 练习记录 / 词汇与批注。纯函数，返回完整匹配；UI 决定每组展示几条。 */
import type { StoredTest } from './store';
import type { PracticeRecord } from './history';
import { scopeName } from './history';
import type { VocabularyItem } from './vocabulary';

export type SearchResult =
  | { kind: 'test'; id: string; title: string; subtitle: string; testId: string }
  | { kind: 'history'; id: string; title: string; subtitle: string; recordId: string }
  | { kind: 'vocabulary'; id: string; title: string; subtitle: string; vocabularyKey: string };

export interface SearchOutput {
  tests: SearchResult[];
  history: SearchResult[];
  vocabulary: SearchResult[];
}

export const MAX_QUERY = 100;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const termsOf = (q: string) => norm(q).split(' ').filter(Boolean);

/** 命中的字段越多越靠前；标题前缀 < 标题包含 < 副标题包含 */
function scoreOf(title: string, subtitle: string, terms: string[]): number | null {
  const t = norm(title);
  const s = norm(subtitle);
  let score = 0;
  for (const term of terms) {
    if (t.startsWith(term)) score += 0;
    else if (t.includes(term)) score += 1;
    else if (s.includes(term)) score += 2;
    else return null;
  }
  return score;
}

const byScore = <T extends SearchResult>(scored: { score: number; r: T }[]) =>
  scored.sort((a, b) => a.score - b.score).map(x => x.r);

function testTitles(t: StoredTest): string[] {
  const out = [t.name];
  for (const p of t.passages ?? []) {
    out.push(p.title ?? '', p.label ?? '');
  }
  for (const sec of t.listening?.sections ?? []) {
    out.push(`Section ${sec.section_number}`, sec.title ?? '', sec.context ?? '');
  }
  return out;
}

export function searchAll(input: {
  query: string;
  tests: StoredTest[];
  records: PracticeRecord[];
  vocabulary: VocabularyItem[];
}): SearchOutput {
  const q = input.query.slice(0, MAX_QUERY);
  const terms = termsOf(q);
  if (!terms.length) return { tests: [], history: [], vocabulary: [] };

  const tests: { score: number; r: SearchResult }[] = [];
  for (const t of input.tests) {
    const fields = testTitles(t);
    const title = t.name;
    const subtitle = fields.filter(x => x && x !== title).join(' · ');
    const score = scoreOf(title, subtitle, terms);
    if (score == null) continue;
    tests.push({ score, r: { kind: 'test', id: t.id, title: t.name, subtitle: subtitle.slice(0, 120), testId: t.id } });
  }

  const history: { score: number; r: SearchResult }[] = [];
  for (const r of input.records) {
    const skills = [
      r.listening ? '听力' : '',
      r.reading ? '阅读' : '',
      r.writing ? '写作' : '',
    ].filter(Boolean).join(' ');
    const title = r.testName;
    const subtitle = `${scopeName(r.scope, !!r.listening)} · ${new Date(r.at).toLocaleDateString()} ${skills}`;
    const score = scoreOf(title, subtitle, terms);
    if (score == null) continue;
    history.push({
      score,
      r: { kind: 'history', id: r.id, title: `${r.testName} · ${scopeName(r.scope, !!r.listening)}`, subtitle: `${new Date(r.at).toLocaleString()} ${skills}`, recordId: r.id },
    });
  }

  const vocabulary: { score: number; r: SearchResult }[] = [];
  for (const v of input.vocabulary) {
    const title = v.text;
    const src = [v.reading ? `精读：${v.reading.testName} · Passage ${v.reading.passageIdx + 1}` : '',
      v.listening ? `精听：${v.listening.testName} · Section ${v.listening.section}` : ''].filter(Boolean).join('；');
    const subtitle = [v.phonetic, v.gloss, v.note, v.sentence, v.context, src].filter(Boolean).join(' · ');
    const score = scoreOf(title, subtitle, terms);
    if (score == null) continue;
    vocabulary.push({
      score,
      r: { kind: 'vocabulary', id: v.key, title: v.text, subtitle: subtitle.slice(0, 120), vocabularyKey: v.key },
    });
  }

  return {
    tests: byScore(tests),
    history: byScore(history),
    vocabulary: byScore(vocabulary),
  };
}

export const emptySearch = (): SearchOutput => ({ tests: [], history: [], vocabulary: [] });
export const countSearch = (o: SearchOutput) => o.tests.length + o.history.length + o.vocabulary.length;
