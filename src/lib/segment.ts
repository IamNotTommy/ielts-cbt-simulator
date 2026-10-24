/** 精听三段基础算法（全部纯函数 + 一个解码入口，可脱离界面测试）：
 *  1. segmentAudio      mp3 → 句子时间轴（短时能量/RMS 静音检测自动切段）
 *  2. splitTranscript   粘贴的听力原文 → 句子数组（. ? ! + 引号规则）
 *  3. alignTranscript   句子按字符数比例对齐到"剔除静音后的纯语音时间轴"
 *  4. diffWords         听写提交 → 词级 LCS diff（忽略大小写与标点差异） */

export interface Seg { start: number; end: number }

/* ================= 1. 自动切段 ================= */

/** 把过长的段在最深停顿处再切一刀（递归，直到 ≤ maxLen 或找不到可切点） */
function splitLong(segs: Seg[], rms: number[], hop: number, maxLen: number): Seg[] {
  const out: Seg[] = [];
  const rec = (s: Seg, depth: number) => {
    if (s.end - s.start <= maxLen || depth > 6) { out.push(s); return; }
    // 段内 RMS 最低点（避开首尾各 15%，不切在边缘）
    const i0 = Math.floor(s.start / hop), i1 = Math.ceil(s.end / hop);
    const span = i1 - i0;
    if (span < 8) { out.push(s); return; }
    let best = -1;
    let bestV = Infinity;
    const lo = i0 + Math.floor(span * 0.15), hi = i0 + Math.ceil(span * 0.85);
    for (let i = lo; i < hi; i++) {
      if (rms[i] < bestV) { bestV = rms[i]; best = i; }
    }
    if (best < 0) { out.push(s); return; }
    const cut = best * hop;
    if (cut - s.start < 0.4 || s.end - cut < 0.4) { out.push(s); return; }
    rec({ start: s.start, end: cut }, depth + 1);
    rec({ start: cut, end: s.end }, depth + 1);
  };
  for (const s of segs) rec(s, 0);
  return out.sort((a, b) => a.start - b.start);
}

/**
 * mp3 Blob → 句子段数组（秒）。
 * 参数：20ms 窗 / 10ms 步进；自适应阈值（RMS 的 20 分位 × 2.2 为语音下限）；
 * 静音间隙 ≥250ms 断句；<0.6s 的段并入相邻段；>12s 的段在最深停顿处再切。
 */
export async function segmentAudio(blob: Blob): Promise<Seg[]> {
  const buf = await blob.arrayBuffer();
  const AC: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  // 长度先按 8kHz 占位，decodeAudioData 只用它建上下文，实际解码保持原采样率
  const ctx = new AC(1, 8000, 8000);
  const audio = await ctx.decodeAudioData(buf);
  const data = audio.getChannelData(0);
  const sr = audio.sampleRate;
  const win = Math.round(sr * 0.02);
  const hopS = 0.01;
  const hop = Math.round(sr * hopS);
  const nFrames = Math.max(0, Math.floor((data.length - win) / hop));
  if (nFrames < 10) throw new Error('音频太短，无法切段');

  const rms = new Array<number>(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let acc = 0;
    const base = i * hop;
    for (let j = 0; j < win; j++) { const v = data[base + j]; acc += v * v; }
    rms[i] = Math.sqrt(acc / win);
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(nFrames * 0.2)] ?? 0;
  const peak = sorted[Math.floor(nFrames * 0.98)] ?? 1;
  const thr = Math.max(floor * 2.2, peak * 0.02, 1e-4);

  // 语音帧 → 区域；静音间隙 ≥250ms 处断开
  const GAP = 0.25;
  const raw: Seg[] = [];
  let cur: Seg | null = null;
  let lastVoiceEnd = 0;
  for (let i = 0; i < nFrames; i++) {
    if (rms[i] > thr) {
      const t = i * hopS;
      if (!cur) cur = { start: t, end: t + hopS };
      else if (t - lastVoiceEnd >= GAP) { raw.push(cur); cur = { start: t, end: t + hopS }; }
      else cur.end = t + hopS;
      lastVoiceEnd = t + hopS;
    }
  }
  if (cur) raw.push(cur);
  if (!raw.length) throw new Error('没有检测到语音（音频可能是静音）');

  // >12s 的段在最深停顿处再切
  let segs = splitLong(raw, rms, hopS, 12);

  // <0.6s 的段并入相邻段（优先并入间隙更小的一侧）
  const MIN_LEN = 0.6;
  let changed = true;
  while (changed && segs.length > 1) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].end - segs[i].start >= MIN_LEN) continue;
      const gapPrev = i > 0 ? segs[i].start - segs[i - 1].end : Infinity;
      const gapNext = i < segs.length - 1 ? segs[i + 1].start - segs[i].end : Infinity;
      if (gapPrev <= gapNext && i > 0) {
        segs[i - 1].end = segs[i].end;
        segs.splice(i, 1);
      } else if (i < segs.length - 1) {
        segs[i + 1].start = segs[i].start;
        segs.splice(i, 1);
      } else break;
      changed = true;
      break;
    }
  }
  // 段首尾各向内收 30ms，避免吃到邻段尾音/邻段起音
  return segs.map(s => ({ start: Math.max(0, s.start + 0.03), end: Math.max(s.start + 0.1, s.end - 0.03) }));
}

/* ================= 2. 原文断句 ================= */

/** 听力原文 → 句子数组。句末 . ? !（跳过小数点），允许紧跟引号/括号收尾。 */
export function splitTranscript(text: string): string[] {
  const CLOSERS = '"\'”’)]}';
  const out: string[] = [];
  let s = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const isDot = ch === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '');
    if ((ch === '.' || ch === '?' || ch === '!') && !isDot) {
      let j = i + 1;
      while (j < text.length && CLOSERS.includes(text[j])) j++;
      if (j >= text.length || /\s/.test(text[j])) {
        const sent = text.slice(s, j).trim();
        if (sent) out.push(sent);
        i = j;
        while (i < text.length && /\s/.test(text[i])) i++;
        s = i;
        continue;
      }
    }
    i++;
  }
  const rest = text.slice(s).trim();
  if (rest) out.push(rest);
  return out;
}

/* ================= 3. 文本 ↔ 时间轴对齐 ================= */

export interface AlignedSentence extends Seg { text: string }

/**
 * 把静音区间剔除后得到"纯语音时间轴"，句子按字符数比例在上面分配时长，再映射回真实时间。
 * 段数与句数恰好相等时直接一一对应（更准）；否则按比例。
 */
export function alignTranscript(segments: Seg[], sentences: string[]): AlignedSentence[] {
  if (!segments.length || !sentences.length) return [];
  if (segments.length === sentences.length) {
    return segments.map((s, i) => ({ start: s.start, end: s.end, text: sentences[i] }));
  }
  const speechTotal = segments.reduce((a, s) => a + (s.end - s.start), 0);
  if (speechTotal <= 0) return [];
  const charTotal = sentences.reduce((a, s) => a + Math.max(1, s.length), 0);

  /** 纯语音时间 → 真实时间 */
  const toReal = (st: number): number => {
    let acc = 0;
    for (const s of segments) {
      const len = s.end - s.start;
      if (st <= acc + len) return s.start + (st - acc);
      acc += len;
    }
    return segments[segments.length - 1].end;
  };

  const out: AlignedSentence[] = [];
  let acc = 0;
  let prevEnd = segments[0].start;
  for (const sent of sentences) {
    const dur = (Math.max(1, sent.length) / charTotal) * speechTotal;
    const start = Math.max(toReal(acc), prevEnd);
    const end = Math.max(toReal(acc + dur), start + 0.2);
    out.push({ start, end, text: sent });
    prevEnd = end;
    acc += dur;
  }
  return out;
}

/* ================= 4. 词级 diff（LCS，忽略大小写与标点） ================= */

export type DiffKind = 'ok' | 'wrong' | 'miss' | 'extra';
export interface DiffToken { kind: DiffKind; ref?: string; hyp?: string }

const normWord = (w: string) => w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, '');
const tokenize = (s: string) => s.match(/[A-Za-z0-9'’‘-]+/g) ?? [];

/**
 * 参考句 vs 听写句 → 词级对齐：
 * ok=对（灰）、wrong=错词（红）、miss=漏词（虚线空位，显示参考词）、extra=多写（删除线）。
 */
export function diffWords(refText: string, hypText: string): DiffToken[] {
  const ref = tokenize(refText);
  const hyp = tokenize(hypText);
  const rn = ref.map(normWord);
  const hn = hyp.map(normWord);
  const n = rn.length;
  const m = hn.length;
  // LCS DP
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = rn[i] === hn[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // 回溯成操作流：eq / del（漏）/ ins（多）
  type Op = { op: 'eq' | 'del' | 'ins'; i?: number; j?: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (rn[i] === hn[j]) { ops.push({ op: 'eq', i, j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: 'del', i }); i++; }
    else { ops.push({ op: 'ins', j }); j++; }
  }
  while (i < n) { ops.push({ op: 'del', i }); i++; }
  while (j < m) { ops.push({ op: 'ins', j }); j++; }

  // 相邻 del+ins 配成 wrong（错词替换）；落单 del=miss，落单 ins=extra
  const out: DiffToken[] = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.op === 'eq') { out.push({ kind: 'ok', ref: ref[o.i!], hyp: hyp[o.j!] }); continue; }
    if (o.op === 'del') {
      const dels: number[] = [o.i!];
      while (k + 1 < ops.length && ops[k + 1].op === 'del') { dels.push(ops[++k].i!); }
      const inss: number[] = [];
      while (k + 1 < ops.length && ops[k + 1].op === 'ins') { inss.push(ops[++k].j!); }
      const pair = Math.min(dels.length, inss.length);
      for (let p = 0; p < pair; p++) out.push({ kind: 'wrong', ref: ref[dels[p]], hyp: hyp[inss[p]] });
      for (let p = pair; p < dels.length; p++) out.push({ kind: 'miss', ref: ref[dels[p]] });
      for (let p = pair; p < inss.length; p++) out.push({ kind: 'extra', hyp: hyp[inss[p]] });
      continue;
    }
    // ins 行（前面没有 del 可配）
    const inss: number[] = [o.j!];
    while (k + 1 < ops.length && ops[k + 1].op === 'ins') { inss.push(ops[++k].j!); }
    for (const jj of inss) out.push({ kind: 'extra', hyp: hyp[jj] });
  }
  return out;
}

/** diff 里"出错"的词数（错 + 漏；多写不计入薄弱句判定） */
export function diffWrongCount(diff: DiffToken[]): number {
  return diff.filter(t => t.kind === 'wrong' || t.kind === 'miss').length;
}
