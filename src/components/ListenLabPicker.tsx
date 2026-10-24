/** 精听篇目三级选择弹层：剑桥册数 → Test → Part(Section)。
 *  数据源：listTests() 里带 listening 的题包；test.name 形如 "Cambridge IELTS 17 · Test 1"，按 book 分组。 */
import { useMemo, useState } from 'react';
import type { StoredTest } from '../lib/store';

interface Props {
  tests: StoredTest[];
  title?: string;
  onPick: (test: StoredTest, sectionIdx: number) => void;
  onClose: () => void;
}

interface BookGroup { book: string; tests: StoredTest[] }

/** "Cambridge IELTS 17 · Test 1" → book="Cambridge IELTS 17"；没有该形态时整名当 book */
function bookOf(t: StoredTest): string {
  const m = /^(.*?)\s*·\s*Test\s*\d+\s*$/i.exec(t.name);
  return m ? m[1] : t.name;
}

export default function ListenLabPicker({ tests, title = '选择篇目开始精听', onPick, onClose }: Props) {
  const groups = useMemo<BookGroup[]>(() => {
    const withListening = tests.filter(t => (t.listening?.sections?.length ?? 0) > 0);
    const map = new Map<string, StoredTest[]>();
    for (const t of withListening) {
      const b = bookOf(t);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(t);
    }
    return [...map.entries()].map(([book, ts]) => ({ book, tests: ts }));
  }, [tests]);

  const [book, setBook] = useState<string | null>(groups.length === 1 ? groups[0].book : null);
  const [test, setTest] = useState<StoredTest | null>(null);

  const curGroup = groups.find(g => g.book === book) ?? null;

  return (
    <div className="overlay" style={{ zIndex: 1250 }} onClick={onClose}>
      <div className="modal ll-picker" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        {groups.length === 0 && (
          <p className="home-empty">题库里还没有带听力的题包。先导入含听力的 .zip 题包，再开始精听。</p>
        )}

        {/* 第一级：剑桥册数 */}
        {!curGroup && groups.map(g => (
          <button key={g.book} className="iv-pick-row" onClick={() => { setBook(g.book); setTest(null); }}>
            <b>{g.book}</b>
            <span>{g.tests.length} 个 Test</span>
          </button>
        ))}

        {/* 第二级：Test */}
        {curGroup && !test && (
          <>
            <button className="ll-picker-back" onClick={() => setBook(null)}>← 全部册数</button>
            {curGroup.tests.map(t => (
              <button key={t.id} className="iv-pick-row" onClick={() => setTest(t)}>
                <b>{t.name}</b>
                <span>{t.listening!.sections.length} 个 Part</span>
              </button>
            ))}
          </>
        )}

        {/* 第三级：Part(Section) */}
        {curGroup && test && (
          <>
            <button className="ll-picker-back" onClick={() => setTest(null)}>← {curGroup.book}</button>
            {test.listening!.sections.map((s, i) => (
              <button key={s.section_number} className="iv-pick-row" onClick={() => onPick(test, i)}>
                <b>Part {s.section_number}</b>
                <span>{s.title || s.context || `Section ${s.section_number}`}</span>
              </button>
            ))}
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
          <button className="btn-ok" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
