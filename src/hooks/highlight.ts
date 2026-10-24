/**
 * 高亮/笔记引擎（数据驱动版）—— 对应规格 3.5
 * 选区 → 相对段落的字符偏移记录，由 React 渲染为 <span class="hl1|hl2|strike">，
 * 避免手工改 DOM 与 React 协调冲突，并支持跨 Part 持久化。
 */

export interface Segment {
  zone: 'p' | 'q';      // p=文章段落，q=题目文本
  para: number;         // zone=p 时：段落下标
  qblock?: string;      // zone=q 时：题目块标识（如 q12 / gQuestions 1-5）
  start: number;
  end: number;
}

/** 当前选区换算为各文本块内的字符区间（文章 .ptext + 题目 .qtext） */
export function selectionSegments(root: HTMLElement): Segment[] {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];
  const range = sel.getRangeAt(0);
  const out: Segment[] = [];
  root.querySelectorAll<HTMLElement>('.ptext, .qtext').forEach(pEl => {
    if (!range.intersectsNode(pEl)) return;
    const len = pEl.textContent?.length ?? 0;
    let start = 0;
    let end = len;
    if (pEl.contains(range.startContainer)) {
      const pre = document.createRange();
      pre.selectNodeContents(pEl);
      pre.setEnd(range.startContainer, range.startOffset);
      start = pre.toString().length;
    }
    if (pEl.contains(range.endContainer)) {
      const pre = document.createRange();
      pre.selectNodeContents(pEl);
      pre.setEnd(range.endContainer, range.endOffset);
      end = pre.toString().length;
    }
    start = Math.max(0, Math.min(start, len));
    end = Math.max(0, Math.min(end, len));
    if (end <= start) return;
    if (pEl.classList.contains('qtext')) {
      out.push({ zone: 'q', para: -1, qblock: pEl.dataset.qblock ?? '', start, end });
    } else {
      out.push({ zone: 'p', para: Number(pEl.dataset.para ?? 0), start, end });
    }
  });
  return out;
}

/** 选区是否落在可高亮文本内（决定 Highlight/Notes 菜单项是否可用） */
export function selectionInPassage(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode) return false;
  const el = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
  return !!el?.closest('.ptext, .qtext');
}

/** 右键/单击点在高亮/删除线上 → 返回带 data-hid 的元素（含旧版 hl1/hl2 存档兼容） */
const HL_SPAN_CLASSES = ['hl1', 'hl2', 'hl-y', 'hl-g', 'hl-p', 'strike'];
export function highlightElAt(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el) {
    if (
      el.tagName === 'SPAN' &&
      el.dataset.hid &&
      HL_SPAN_CLASSES.some(c => el!.classList.contains(c))
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

export function selectedText(): string {
  return window.getSelection()?.toString().trim() ?? '';
}

export function clearSelection() {
  window.getSelection()?.removeAllRanges();
}
