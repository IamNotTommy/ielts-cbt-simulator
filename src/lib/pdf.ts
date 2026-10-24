/** PDF 解析：文字层抽取 + 扫描页渲染成图（全部在浏览器本地完成） */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfPageText {
  page: number;
  text: string;
}

export interface PdfPageImage {
  page: number;
  dataUrl: string; // data:image/jpeg;base64,…
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 解析 "22-35" 形式的页码范围；空输入返回 null（全部页） */
export function parsePageRange(input: string): [number, number] | null {
  const m = input.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a >= 1 && b >= a ? [a, b] : null;
}

async function openDoc(buf: ArrayBuffer) {
  // pdfjs 会接管 buffer，调用方需自行保留副本（hash 在传入前算好）
  return pdfjs.getDocument({ data: buf.slice(0) }).promise;
}

export async function pageCount(buf: ArrayBuffer): Promise<number> {
  const doc = await openDoc(buf);
  const n = doc.numPages;
  await doc.cleanup();
  return n;
}

/** 逐页抽取文字层；返回总字符数供扫描版判定 */
export async function extractTextPages(
  buf: ArrayBuffer,
  range?: [number, number] | null,
): Promise<{ pages: PdfPageText[]; totalChars: number }> {
  const doc = await openDoc(buf);
  const [from, to] = range ?? [1, doc.numPages];
  const pages: PdfPageText[] = [];
  let totalChars = 0;
  for (let n = Math.max(1, from); n <= Math.min(doc.numPages, to); n++) {
    const pg = await doc.getPage(n);
    const tc = await pg.getTextContent();
    let text = '';
    let lastY: number | null = null;
    for (const raw of tc.items) {
      if (!('str' in raw)) continue;
      const item = raw as { str: string; transform: number[] };
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
      else if (text && !text.endsWith('\n') && !text.endsWith(' ')) text += ' ';
      text += item.str;
      lastY = y;
    }
    text = text.trim();
    totalChars += text.length;
    pages.push({ page: n, text });
  }
  await doc.cleanup();
  return { pages, totalChars };
}

/** 乱码/空页检测：内嵌字体损坏或扫描页时文字层不可用 */
export function isGarbled(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  if (t.length < 20) return true; // 空页 / 近空页
  if (/�/.test(t) || /[~§•¤]{3,}/.test(t)) return true;
  const good = (t.match(/[A-Za-z0-9一-鿿.,;:'"()%\-\[\]]/g) ?? []).length;
  return good / t.length < 0.6;
}

/** 把指定页渲染为 JPEG（扫描版/乱码页走多模态识别） */
export async function renderPages(
  buf: ArrayBuffer,
  pageNums: number[],
  scale = 1.4,
): Promise<PdfPageImage[]> {
  const doc = await openDoc(buf);
  const out: PdfPageImage[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  for (const n of pageNums) {
    if (n < 1 || n > doc.numPages) continue;
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale });
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await pg.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    out.push({ page: n, dataUrl: canvas.toDataURL('image/jpeg', 0.72) });
  }
  await doc.cleanup();
  return out;
}
