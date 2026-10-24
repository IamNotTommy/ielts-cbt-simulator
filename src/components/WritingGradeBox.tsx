import type { WritingGrade, WritingGradeResult } from '../lib/llm';

interface Props {
  grade: WritingGradeResult;
  /** Task 1 是图表题但判改时没有真实图表数据 → 提示误差更大 */
  hasChart?: boolean;
}

type DimKey = 'ta' | 'cc' | 'lr' | 'gra';

const dims = (t: 'task1' | 'task2'): [DimKey, string][] => [
  ['ta', t === 'task1' ? 'Task Achievement' : 'Task Response'],
  ['cc', 'Coherence & Cohesion'],
  ['lr', 'Lexical Resource'],
  ['gra', 'Grammatical Range & Accuracy'],
];

const scoreOf = (g: WritingGrade, k: DimKey): number => g[k];

/** 写作四维判改结果展示（强制带"仅供参考"标注；成绩单与结束卡共用） */
export default function WritingGradeBox({ grade, hasChart }: Props) {
  return (
    <div className="ai-grade-box">
      <div className="ai-grade-banner">AI grading is for reference only — not an official score</div>
      {(['task1', 'task2'] as const).map(tk => {
        const g = grade[tk];
        if (!g) return null;
        return (
          <div key={tk} className="ai-grade-task">
            <b>Writing Task {tk === 'task1' ? 1 : 2} — Band {g.band.toFixed(1)}</b>
            <table className="ai-grade-table">
              <tbody>
                {dims(tk).map(([k, label]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    <td>{scoreOf(g, k).toFixed(1)}</td>
                    <td>
                      {g.reason[k]}
                      {g.evidence?.[k] && <div className="ai-grade-ev">Evidence: “{g.evidence[k]}”</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {hasChart && <p className="affil-note">Task 1 was graded without real chart data — expect a wider margin of error.</p>}
    </div>
  );
}
