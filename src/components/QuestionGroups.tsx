import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Question, QuestionGroup } from '../types';
import { TFNG_OPTIONS, YNNG_OPTIONS } from '../data/sampleTest';

export type QtFn = (block: string, text: string) => ReactNode;

interface Props {
  groups: QuestionGroup[];
  answers: Record<number, any>;
  onAnswer: (no: number, value: any) => void;
  onActivate?: (no: number) => void; // 点进输入框即视为当前题（驱动 ⚑ Flag 跟随）
  qt: QtFn; // 可高亮文本块包装（阅读/听力各自注入自己的高亮查询）
}

function wordsOf(v: any): number {
  return String(v ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/** 是否已作答（用于 D3 真机反馈：题号上方黄色短条 + 已答题干浅灰底） */
function hasAns(v: any): boolean {
  return !(v == null || v === '' || (Array.isArray(v) && v.length === 0));
}

/** 提示词 G：填空输入框宽度随词数上限自适应（1 词窄、多词宽） */
function gapWidth(wl?: number): number {
  if (wl == null) return 170;
  if (wl <= 1) return 130;
  if (wl === 2) return 170;
  return 215;
}

/** 去掉题干里占位用的长省略号/下划线：输入框直接落在原位置，不再显示 "......" */
const stripTailDots = (s: string) => s.replace(/\s*[.…_‥]{3,}\s*$/, '');
const stripHeadDots = (s: string) => s.replace(/^\s*[.…_‥]{3,}\s*/, '');
/** 句子填空：题干中间残留的省略号串也一并清掉（旧抽取数据常见问题） */
const stripAllDots = (s: string) => s.replace(/\s*[.…_‥]{3,}\s*/g, ' ');
const PLACEHOLDER_RE = /^\[Q(\d+)\]$/;

/* ---------- 正文分块：把原卷表格（`|` 分隔行）与普通文字分开渲染 ---------- */

export interface BodyBlock {
  kind: 'text' | 'table';
  text?: string;
  header?: string[];
  rows?: string[][];
}

/** 一行拆成单元格：只有"两端都有 `|`"（Markdown 风格边框）才剥掉首尾竖线，
 *  否则保留空单元格 —— 这样 ` | A | B | C` 的空白左上格不会被吃掉，列数才能对齐。 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|') && s.endsWith('|') && s.length > 2) s = s.slice(1, -1);
  return s.split('|').map(x => x.trim());
}

/** 一行是否"含有表格竖线"（用于找出表格块；连续含竖线的行整体当表格处理） */
function hasPipe(line: string): boolean {
  return line.includes('|');
}

/** 看起来像新段落的标题（用于判断表格块该结束）：NB/Note/Example/Questions 开头，或短句以冒号结尾 */
function looksLikeHeading(s: string): boolean {
  const t = s.trim();
  return /^(NB|Note|Notes|Example|Examples|Question|Questions)\b/i.test(t) || (t.length < 40 && t.endsWith(':'));
}

/** 把续行并进该行**最后一个非空单元格**（多行单元格常被写成独立行，不折叠表格就会被切碎） */
function appendToLastCell(row: string[], text: string): void {
  let k = row.length - 1;
  while (k >= 0 && row[k] === '') k--;
  if (k < 0) k = 0;
  row[k] = row[k] ? `${row[k]}\n${text}` : text;
}

function nextNonBlank(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) if (lines[i].trim() !== '') return i;
  return -1;
}
/** Markdown 分隔行（|---|---|） */
function isTableSep(line: string): boolean {
  return /\|/.test(line) && /^[\s|:-]+$/.test(line) && /-/.test(line);
}

/**
 * 把题组正文切成"文字块 / 表格块"。
 * 表格判定：连续的 `|` 分隔行；首行若不含 [Qn] 占位符则作为表头
 * （这样 "Route | Period" 这种表头行不会被当成数据行，而 "Name | [Q1]" 不会误当表头）。
 */
export function buildBodyBlocks(body: string): BodyBlock[] {
  const lines = body.split('\n');
  const out: BodyBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    // 连续含 `|` 的行 = 一个表格块（这样"只有一个非空格"的续行也会留在表内，不会被甩到表外）
    if (hasPipe(lines[i])) {
      const rows: string[][] = [];
      let header: string[] | undefined;
      let sawSep = false;
      while (i < lines.length) {
        const line = lines[i];
        if (isTableSep(line)) {
          sawSep = true;
          if (rows.length && !header) header = rows.shift();
          i++;
          continue;
        }
        if (hasPipe(line)) { rows.push(splitRow(line)); i++; continue; }
        if (rows.length === 0) break;                     // 表格还没开始，交回文本块
        const t = line.trim();
        if (t === '') {
          // 空行：后面还有表格行/续行就继续（单元格内换行），否则表格到此结束
          const j = nextNonBlank(lines, i + 1);
          if (j >= 0 && hasPipe(lines[j])) { i = j; continue; }
          if (j >= 0 && !looksLikeHeading(lines[j])) { appendToLastCell(rows[rows.length - 1], lines[j]); i = j + 1; continue; }
          i++;
          break;
        }
        if (looksLikeHeading(t)) break;                   // 像新段落的标题 → 表格结束
        appendToLastCell(rows[rows.length - 1], t); i++;   // 续行 → 并进上一行的单元格
      }
      if (!sawSep && rows.length > 1 && !/\[Q\d+\]/.test(rows[0].join(' '))) header = rows.shift();
      /* 列数兜底：抽取数据偶尔会"表头少一列 / 续行只有一格"，直接渲染就会串列。
         这里统一按本块最大列数补空格，保证每一行格子数一致（表格永远不会错位）。 */
      const width = Math.max((header ?? []).length, ...rows.map(r => r.length), 1);
      if (width > 1) {
        if (header && header.length < width) header = [...header, ...Array(width - header.length).fill('')];
        for (const r of rows) {
          while (r.length < width) r.push('');
          if (r.length > width) r.length = width;
        }
      }
      out.push({ kind: 'table', header, rows });
    } else {
      const buf: string[] = [];
      while (i < lines.length && !hasPipe(lines[i])) { buf.push(lines[i]); i++; }
      out.push({ kind: 'text', text: buf.join('\n') });
    }
  }
  return out;
}

/** 超限提示文案：官方措辞是 "ONE WORD AND/OR A NUMBER" 时回显原话，不再硬写成 "1 WORD"，
 *  也不再出现 "1 WORDS" 这种单复数错误；句末补句点，避免和题干连读。 */
export function limitWarnText(q?: Question): string {
  if (!q || q.wordLimit == null) return '';
  if (q.numberOk) return `⚠ This answer may be ${q.limitLabel ?? 'ONE WORD AND/OR A NUMBER'}.`;
  const n = q.wordLimitBase ?? q.wordLimit;
  return `⚠ NO MORE THAN ${n} WORD${n === 1 ? '' : 'S'}.`;
}

/** 题型渲染器集合（策略模式）：阅读/听力共用 */
export default function QuestionGroups({ groups, answers, onAnswer, onActivate, qt }: Props) {
  const [openTfng, setOpenTfng] = useState<Record<number, boolean>>({});
  const [pickOpt, setPickOpt] = useState<string | null>(null);   // 点击模式：先点选项再点空位
  const [dragOver, setDragOver] = useState<number | null>(null); // 拖拽悬停的题号
  /* 刚落位的题号：给"拖拽成功"一个明确反馈（绿框脉冲 + ✓），约 0.9 秒后自动消失 */
  const [dropFlash, setDropFlash] = useState<number | null>(null);
  /* 正在拖动的选项（源高亮）：拖拽期间给被拖的那一枚变淡+缩小，落位后由 used/used-once 接管 */
  const [draggingChip, setDraggingChip] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => () => { if (flashTimer.current != null) window.clearTimeout(flashTimer.current); }, []);
  const flashDrop = (no: number) => {
    setDropFlash(no);
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setDropFlash(f => (f === no ? null : f)), 380);
  };

  const renderTfng = (q: Question, g: QuestionGroup) => {
    const opts = g.instruction.includes('YES') ? YNNG_OPTIONS : TFNG_OPTIONS;
    const open = openTfng[q.no] || answers[q.no] != null;
    return (
      <div className={'q-row' + (hasAns(answers[q.no]) ? ' answered' : '')} id={`q-${q.no}`} key={q.no}>
        <div
          style={{ cursor: 'pointer' }}
          title="Click to show options"
          onClick={() => {
            if (!window.getSelection()?.isCollapsed) return; // 拖选文本时不触发展开
            setOpenTfng(s => ({ ...s, [q.no]: !s[q.no] }));
          }}
        >
          <span className="q-no">{q.no}</span>
          <span className="q-stem">{qt(`q${q.no}`, q.stem ?? '')}</span>
        </div>
        {open && (
          <div className="tfng-options">
            {opts.map(o => (
              <button
                key={o}
                className={'tfng-opt' + (answers[q.no] === o ? ' sel' : '')}
                onClick={() => onAnswer(q.no, o)}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSingle = (q: Question) => (
    <div className={'q-row' + (hasAns(answers[q.no]) ? ' answered' : '')} id={`q-${q.no}`} key={q.no}>
      <div>
        <span className="q-no">{q.no}</span>
        <span className="q-stem">{qt(`q${q.no}`, q.stem ?? '')}</span>
      </div>
      {(q.options ?? []).map((o, i) => (
        <label
          className="opt-radio"
          key={i}
          onClick={e => { if (!window.getSelection()?.isCollapsed) e.preventDefault(); }} // 拖选时不改答案
        >
          <input
            type="radio"
            name={`q${q.no}`}
            checked={answers[q.no] === o}
            onChange={() => onAnswer(q.no, o)}
          />
          <span>{qt(`q${q.no}-o${i}`, o)}</span>
        </label>
      ))}
    </div>
  );

  const renderGapfill = (q: Question) => {
    const over = q.wordLimit != null && wordsOf(answers[q.no]) > q.wordLimit;
    return (
      <div className={'q-row gap-line' + (hasAns(answers[q.no]) ? ' answered' : '')} id={`q-${q.no}`} key={q.no}>
        {qt(`q${q.no}a`, stripAllDots(q.gapPrefix ?? ''))}
        <span className={'gap-input-wrap' + (hasAns(answers[q.no]) ? ' answered' : '')}>
          <input
            className="gap-input"
            style={{ width: gapWidth(q.wordLimitBase ?? q.wordLimit) }}
            value={answers[q.no] ?? ''}
            onChange={e => onAnswer(q.no, e.target.value)}
            onFocus={() => onActivate?.(q.no)}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="gap-ghost">{q.no}</span>
        </span>
        {qt(`q${q.no}b`, stripAllDots(q.gapSuffix ?? ''))}
        {over && <span className="gap-warn">{limitWarnText(q)}</span>}
      </div>
    );
  };

  /** 摘要/表格/流程图填空：正文 [Qn] 占位符 → 内嵌输入框；带词库（options）时按实考渲染为词库拖拽/点选 */
  const renderSummary = (g: QuestionGroup) => {
    const byNo = new Map(g.questions.map(q => [q.no, q]));
    const bank = g.options ?? [];
    const valueOf = (o: any) => String(o ?? "").trim().split(/\s+/)[0] ?? "";
    const used = new Set(g.questions.map(q => answers[q.no]).filter(v => v != null && v !== ''));
    const labelOf = (v: string) => bank.find(o => valueOf(o) === v) ?? v;
    const place = (no: number, v: string) => { onAnswer(no, v); setPickOpt(null); onActivate?.(no); };
    // 笔记/表格填空（listify）：原文是列表式结构，在列表标记（- / – / •）、分号、句号+大写、冒号+大写/占位符 前补换行，逐行展示
    // ⚠ 表格行（含 `|`）**不做**断行处理：那些规则会把一行表格拆成几行，表格就被切碎、视觉上"错位"
    // ⚠ 列表标记**已经在行首**时不再插换行，否则每个要点前面会多出一个空行（行距翻倍）
    const listifyLine = (line: string) =>
      line.includes('|') ? line : line
        .replace(/;\s+/g, '\n')
        .replace(/\s*([-–•])\s+/g, (_m, ch: string, off: number) => (off === 0 ? `${ch} ` : `\n${ch} `))
        .replace(/\.\s+(?=[A-Z[])/g, '.\n')
        .replace(/:\s+(?=[A-Z[])/g, ':\n');
    const body = g.listify
      ? (g.body ?? '').split('\n').map(listifyLine).join('\n').replace(/^\n/, '')
      : (g.body ?? '');
    /* 一个题号两个空（pairedBlanks）时，按**渲染顺序**给每个空分配出现序号 —— 比按字符串计数可靠 */
    const occMap = new Map<number, number>();
    const nextOcc = (no: number) => { const c = occMap.get(no) ?? 0; occMap.set(no, c + 1); return c; };

    /** 把一段文本按 [Qn] 切成 文本 / 空位 交替渲染（词库题渲染成拖放槽，其余渲染成输入框） */
    const renderInline = (text: string, keyPrefix: string) => {
      const segs = text.split(/(\[Q\d+\])/g);
      return segs.map((seg, i) => {
        const m = seg.match(PLACEHOLDER_RE);
        if (!m) {
          // 占位符前后的长省略号/下划线是"空白"记号，渲染时去掉，输入框直接落在原位置
          let t = seg;
          if (PLACEHOLDER_RE.test(segs[i + 1] ?? '')) t = stripTailDots(t);
          if (PLACEHOLDER_RE.test(segs[i - 1] ?? '')) t = stripHeadDots(t);
          return <span key={`${keyPrefix}-s${i}`}>{qt(`g${g.title}-${keyPrefix}-${i}`, t)}</span>;
        }
        const no = Number(m[1]);
        const q = byNo.get(no);
        /* 词库题：空位渲染为拖放槽（值=字母），点击已放入可撤回 */
        if (bank.length > 0) {
          const cur = answers[no];
          return (
            <span key={`${keyPrefix}-${i}`} id={`q-${no}`}>
              <span
                className={'drop-slot inline' + (dragOver === no ? ' over' : '') + (cur ? ' filled' : '') + (hasAns(cur) ? ' answered' : '') + (dropFlash === no ? ' just-dropped' : '')}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(no); }}
                onDragLeave={() => setDragOver(d => (d === no ? null : d))}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(null);
                  const v = e.dataTransfer.getData('text/plain');
                  if (v) { place(no, v); flashDrop(no); }
                }}
                onClick={() => {
                  if (cur) onAnswer(no, null);
                  else if (pickOpt) { place(no, pickOpt); flashDrop(no); }
                }}
                title={cur ? 'Click to take it back' : 'Drag or click an option into here'}
              >
                {cur ? labelOf(cur) : (dragOver === no ? '松开放入' : no)}
              </span>
            </span>
          );
        }
        const occurrence = nextOcc(no);
        const pair = q?.pairedBlanks;
        const pairValues = pair ? String(answers[no] ?? '').split(' | ') : [];
        const value = pair ? (pairValues[occurrence] ?? '') : (answers[no] ?? '');
        const over = q?.wordLimit != null && wordsOf(value) > q.wordLimit;
        return (
          /* 只有第一个空挂锚点 id（q-N），后续空不再重复 id —— 避免一个题号两个空时出现重复 DOM id，
             App 的"跳题/滚动到 q-N"仍然指向该题的第一个空。 */
          <span key={`${keyPrefix}-${i}`} id={occurrence === 0 ? `q-${no}` : undefined}>
            <span className={'gap-input-wrap' + (hasAns(value) ? ' answered' : '')}>
              <input
                className="gap-input"
                data-q={no}
                data-occ={occurrence}
                style={{ width: gapWidth(q?.wordLimitBase ?? q?.wordLimit) }}
                value={value}
                onChange={e => {
                  if (!pair) { onAnswer(no, e.target.value); return; }
                  const next = [pairValues[0] ?? '', pairValues[1] ?? ''];
                  next[occurrence] = e.target.value;
                  onAnswer(no, next.join(' | '));
                }}
                onFocus={() => onActivate?.(no)}
                autoComplete="off"
                spellCheck={false}
              />
              {/* 一个题号两个空时，题号只在第一个空上显示（卷面也只在句首印一次 26） */}
              {occurrence === 0 && <span className="gap-ghost">{no}</span>}
            </span>
            {over && <span className="gap-warn">{limitWarnText(q)}</span>}
          </span>
        );
      });
    };

    /* 正文里的 `|` 分隔行 = 原卷表格：渲染成真表格，避免"用空格硬排"导致的错位 */
    const blocks = buildBodyBlocks(body);
    return (
      <div className="q-row" key="summary">
        {/* 词库（带 A-K 字母选项的摘要/笔记题）：拖拽或点选-点放。
            ⚠ 官方答案允许同一个选项用两次（如 Test 4 阅读 Q30-34 的 B），所以这里**不锁死**已用选项：
            已用的只是变淡提示，仍然可点/可拖 —— 与 matchingFeatures 下拉框的"可重复"语义保持一致。 */}
        {bank.length > 0 && (
          <div className="drag-pool" style={{ marginBottom: 14 }}>
            {bank.map((o, i) => {
              const v = valueOf(o);
              const isUsed = used.has(v);
              return (
                <span
                  key={i}
                  className={'drag-chip bank-chip' + (isUsed ? ' used-once' : '') + (pickOpt === v ? ' on' : '') + (draggingChip === v ? ' dragging' : '')}
                  style={pickOpt === v ? { borderColor: 'var(--ok-blue)', boxShadow: '0 0 0 2px #bfe3f8' } : {}}
                  draggable={true}
                  onDragStart={e => { e.dataTransfer.setData('text/plain', v); e.dataTransfer.effectAllowed = 'move'; setDraggingChip(v); }}
                  onDragEnd={() => setDraggingChip(null)}
                  onClick={() => setPickOpt(pickOpt === v ? null : v)}
                  title={isUsed ? '可以重复使用：再点我一次，然后点空位' : 'Drag into a box, or click me then click a box'}
                >
                  {qt(`bank-${g.title}-${i}`, o)}
                </span>
              );
            })}
            <span style={{ color: '#868e96', fontSize: 13 }}>已用 {used.size} / {bank.length} 个选项 · 同一选项可重复使用</span>
          </div>
        )}
        <div className="group-body" style={{ lineHeight: 2.2, border: '1px solid var(--line)', borderRadius: 8, padding: '16px 20px' }}>
          {blocks.map((b, bi) =>
            b.kind === 'table' ? (
              <div className="md-table-wrap" key={`tb${bi}`}>
                <table className="md-table">
                  {(b.header ?? []).length > 0 && (
                    <thead>
                      <tr>{(b.header ?? []).map((c, ci) => <th key={ci}>{renderInline(c, `t${bi}h${ci}`)}</th>)}</tr>
                    </thead>
                  )}
                  <tbody>
                    {(b.rows ?? []).map((r, ri) => (
                      <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c, `t${bi}r${ri}c${ci}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="md-text" key={`tx${bi}`}>{renderInline(b.text ?? '', `x${bi}`)}</div>
            ),
          )}
        </div>
      </div>
    );
  };

  /** 多选：一组共享一组选项，限选 maxSelect */
  const renderMultipleGroup = (g: QuestionGroup) => {
    const src = g.questions.find(q => q.options && q.options.length);
    if (!src) return null;
    const sel: string[] = Array.isArray(answers[src.no]) ? answers[src.no] : [];
    const max = src.maxSelect ?? 2;
    const toggle = (letter: string) => {
      if (sel.includes(letter)) onAnswer(src.no, sel.filter(l => l !== letter));
      else if (sel.length < max) onAnswer(src.no, [...sel, letter]);
    };
    return (
      <div className={'q-row' + (g.questions.some(q => hasAns(answers[q.no])) ? ' answered' : '')} key="multi">
        {g.questions.map(q => (
          <span key={q.no} id={`q-${q.no}`} className="q-no" style={{ marginBottom: 6 }}>{q.no}</span>
        ))}
        <div style={{ margin: '6px 0 10px' }}>{qt(`q${src.no}`, src.stem ?? '')}</div>
        {(src.options ?? []).map((o, i) => {
          const letter = src.optionLetters?.[i] ?? String.fromCharCode(65 + i);
          const on = sel.includes(letter);
          const disabled = !on && sel.length >= max;
          return (
            <div
              key={letter}
              className={'opt-check' + (on ? ' on' : '') + (disabled ? ' disabled' : '')}
              onClick={() => { if (!disabled && window.getSelection()?.isCollapsed) toggle(letter); }} // 拖选时不改答案
            >
              <span className="cb">{on ? '✓' : ''}</span>
              <span className="letter">{letter}</span>
              <span>{qt(`q${src.no}-o${i}`, o)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  /** 匹配题（headings/特征/句尾）：实考拖拽作答——选项拖入题框，用掉的从池中消失；也支持点选-点放 */
  const renderHeadingsGroup = (g: QuestionGroup) => {
    const opts = g.questions[0]?.options ?? [];
    const valueOf = (o: any) => String(o ?? "").trim().split(/\s+/)[0] ?? "";
    const used = new Set(g.questions.map(q => answers[q.no]).filter(v => v != null && v !== ''));
    const labelOf = (v: string) => opts.find(o => valueOf(o) === v) ?? v;
    const place = (no: number, v: string) => { onAnswer(no, v); setPickOpt(null); };
    return (
      <div key="heads">
        <div className="drag-pool">
          {opts.map((o, i) => {
            const v = valueOf(o);
            const isUsed = !g.repeatOptions && used.has(v);
            return (
              <span
                key={i}
                className={'drag-chip' + (isUsed ? ' used' : '') + (pickOpt === v ? ' on' : '') + (draggingChip === v ? ' dragging' : '')}
                style={pickOpt === v ? { borderColor: 'var(--ok-blue)', boxShadow: '0 0 0 2px #bfe3f8' } : {}}
                draggable={!isUsed}
                onDragStart={e => { e.dataTransfer.setData('text/plain', v); e.dataTransfer.effectAllowed = 'copy'; setDraggingChip(v); }}
                onDragEnd={() => setDraggingChip(null)}
                onClick={() => { if (!isUsed) setPickOpt(pickOpt === v ? null : v); }}
                title={isUsed ? '已使用' : '拖到题目框，或点我后再点题框'}
              >
                {qt(`loh-${g.title}-${i}`, o)}
              </span>
            );
          })}
          {!g.repeatOptions && used.size === opts.length && <span style={{ color: '#868e96', fontSize: 13 }}>全部选项已用完</span>}
        </div>
        {g.questions.map(q => {
          const cur = answers[q.no];
          return (
            <div className={'q-row' + (hasAns(cur) ? ' answered' : '')} id={`q-${q.no}`} key={q.no}>
              <span className="q-no">{q.no}</span>
              <span className="q-stem">{qt(`q${q.no}`, q.stem ?? '')}</span>
              <span
                className={'drop-slot' + (dragOver === q.no ? ' over' : '') + (cur ? ' filled' : '') + (dropFlash === q.no ? ' just-dropped' : '')}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(q.no); }}
                onDragLeave={() => setDragOver(d => (d === q.no ? null : d))}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(null);
                  const v = e.dataTransfer.getData('text/plain');
                  if (v) { place(q.no, v); flashDrop(q.no); }
                }}
                onClick={() => {
                  if (cur) onAnswer(q.no, null);                        // 点已放置 → 撤回池
                  else if (pickOpt) { place(q.no, pickOpt); flashDrop(q.no); } // 点选模式放置
                }}
                title={cur ? '点击撤回该选项' : '拖拽或点选后放入'}
              >
                {cur ? labelOf(cur) : (dragOver === q.no ? '松开放入' : '…')}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  /** 特征匹配 / 句尾匹配（D4）：选项原文以纯文本列表展示（不可拖拽），
   *  每题右侧一个下拉框、只显示字母；同一字母可重复使用（与段落标题匹配相反）。 */
  const renderFeatureSelect = (g: QuestionGroup) => {
    const opts = g.questions[0]?.options ?? [];
    const letters = opts.map(o => String(o ?? "").trim().split(/\s+/)[0] ?? "");
    return (
      <div key="features">
        {opts.length > 0 && (
          <div className="feature-list">
            {opts.map((o, i) => (
              <div className="feature-item" key={i}>{qt(`lof-${g.title}-${i}`, o)}</div>
            ))}
          </div>
        )}
        {g.questions.map(q => {
          const raw = answers[q.no];
          const cur = raw == null ? '' : String(raw);
          const value = cur && !letters.includes(cur) ? (cur.trim().split(/\s+/)[0] ?? '') : cur; // 旧存档兜底
          return (
            <div className={'q-row' + (hasAns(raw) ? ' answered' : '')} id={`q-${q.no}`} key={q.no}>
              <span className="q-no">{q.no}</span>
              <span className="q-stem">{qt(`q${q.no}`, q.stem ?? '')}</span>
              <select
                className="head-select feature-select"
                value={value}
                onChange={e => onAnswer(q.no, e.target.value || null)}
                title="选择字母（可重复使用）"
              >
                <option value="">—</option>
                {letters.map((l, i) => <option key={i} value={l}>{l}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    );
  };

  /** 段落信息匹配：表格格点选（每行一题，点字母格选中/再点取消） */
  const renderMatchingInfo = (g: QuestionGroup) => {
    const letters = g.questions[0]?.paragraphs ?? [];
    return (
      <table className="match-table" key="match">
        <thead>
          <tr>
            <th></th>
            <th style={{ textAlign: 'left' }}></th>
            {letters.map(l => <th key={l}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {g.questions.map(q => (
            <tr key={q.no} id={`q-${q.no}`} className={hasAns(answers[q.no]) ? 'answered' : undefined}>
              <td><span className="q-no" style={{ marginRight: 0 }}>{q.no}</span></td>
              <td>{qt(`q${q.no}`, q.stem ?? '')}</td>
              {letters.map(l => (
                <td
                  key={l}
                  className={'match-cell' + (answers[q.no] === l ? ' on' : '')}
                  onClick={() => onAnswer(q.no, answers[q.no] === l ? null : l)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderGroup = (g: QuestionGroup) => {
    const t = g.questions[0]?.type;
    return (
      <div key={g.title}>
        <div className="group-title">{g.title}</div>
        <div className="group-instruction">
          {qt(`g${g.title}`, g.instruction)}
          {g.nb && !g.instruction.includes('NB') && (
            <span className="nb-inline"> NB You may use any letter more than once.</span>
          )}
        </div>
        {g.exampleText && (
          <div className="group-example" title="Example（原卷印刷，不计分）">
            <b>Example</b> {g.exampleText}
          </div>
        )}
        {g.figureImage && <img src={g.figureImage} alt="Original question diagram" style={{ maxWidth: '100%', maxHeight: 570, objectFit: 'contain', display: 'block', margin: '12px 0' }} />}
        {g.body ? renderSummary(g)
          : t === 'multiple' ? renderMultipleGroup(g)
          : t === 'matchingHeadings' ? renderHeadingsGroup(g)
          : t === 'matchingFeatures' ? renderFeatureSelect(g)
          : t === 'matchingInfo' ? renderMatchingInfo(g)
          : g.questions.map(q =>
              q.type === 'tfng' ? renderTfng(q, g)
              : q.type === 'single' ? renderSingle(q)
              : renderGapfill(q))}
      </div>
    );
  };

  return <>{groups.map(renderGroup)}</>;
}
