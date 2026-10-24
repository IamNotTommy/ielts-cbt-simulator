/** zip 题包导入/导出（提示词 D 第 1 节）
 *  结构：manifest.json + reading/passageN.json + reading/answers.json + writing/taskN.json
 *  答案按科存放；旧格式（根目录全局 answers.json）导入时自动迁移为阅读答案。
 *  导出不含用户音频（体积大且属用户材料），在 manifest.missing 标注。
 */
import JSZip from 'jszip';
import type { ExtractedListeningSection, ExtractedPassage, ExtractedTest, ExtractedWritingTask } from '../types/extracted';
import type { StoredTest } from './store';
import { hydrateTest } from './store';
import { loadAudio } from './media';

export const PACK_VERSION = '1.0';

export interface PackManifest {
  format_version: string;
  book: string;
  test_number: number;
  module: string;
  files: string[];      // 题包应包含的文件清单
  missing?: string[];   // 导出时故意不含的文件（如音频）
}

const PASSAGE_RE = /^reading\/passage\d+\.json$/;

/** Windows 记事本 / PowerShell 5.1 常给 JSON 加 UTF-8 BOM；JSON.parse 会把 BOM 当非法字符 */
const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export interface ImportedPack {
  extracted: ExtractedTest;
  warnings: string[];
  listening: { sections: ExtractedListeningSection[]; answers: Record<number, string> | null } | null;
  audio: Record<number, Blob>; // section_number → 音频 Blob
  figureImage?: string; // Task 1 figure data URL for direct render
}

export async function importZip(file: File | Blob): Promise<ImportedPack> {
  const zip = await JSZip.loadAsync(file);
  const warnings: string[] = [];

  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('缺 manifest.json（不是有效题包）');
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(stripBom(await mf.async('string')));
  } catch {
    throw new Error('manifest.json 不是合法 JSON');
  }
  if (manifest.format_version !== PACK_VERSION) {
    throw new Error(`题包 format_version=${manifest.format_version ?? '缺失'}，与本工具支持的 ${PACK_VERSION} 不匹配`);
  }
  // 按 manifest.files 清单校验完整性：JSON 缺失报错；用户自备的音频/图片缺失降级为警告
  const USER_SUPPLIED = /\.(mp3|wav|m4a|ogg|png|jpg|jpeg)$/i;
  for (const f of manifest.files ?? []) {
    if (!zip.file(f)) {
      if (USER_SUPPLIED.test(f)) warnings.push(`缺用户自备文件 ${f}（请自行放入后重新打包，或在题库中修正）`);
      else throw new Error(`题包不完整：缺 ${f}`);
    }
  }

  // 阅读 passageN.json
  const passageFiles = Object.keys(zip.files).filter(n => PASSAGE_RE.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!passageFiles.length) throw new Error('缺 reading/passageN.json（至少需要 passage1.json）');
  const passages: ExtractedPassage[] = [];
  for (const n of passageFiles) {
    try {
      const passage: ExtractedPassage = JSON.parse(stripBom(await zip.file(n)!.async('string')));
      // 阅读题组的题图（地图/示意图）同样要把 zip 内路径换成 data URL ——
      // 之前只对听力做了这一步，导致阅读的图被静默丢弃（Test 3 阅读 P2 的地图就踩过）。
      for (const g of passage.question_groups ?? []) {
        if (g.figure_image && /^(?:listening|reading)\/[\w.-]+\.png$/i.test(g.figure_image)) {
          const image = zip.file(g.figure_image);
          if (image) g.figure_image = `data:image/png;base64,${await image.async('base64')}`;
          else warnings.push(`缺题组原图 ${g.figure_image}`);
        }
      }
      passages.push(passage);
    } catch {
      throw new Error(`${n} 不是合法 JSON`);
    }
  }

  // 写作
  let task1: ExtractedWritingTask | undefined;
  let task2: ExtractedWritingTask | undefined;
  for (const [n, setter] of [
    ['writing/task1.json', (v: ExtractedWritingTask) => (task1 = v)],
    ['writing/task2.json', (v: ExtractedWritingTask) => (task2 = v)],
  ] as const) {
    const f = zip.file(n);
    if (f) {
      try {
        setter(JSON.parse(stripBom(await f.async('string'))));
      } catch {
        throw new Error(`${n} 不是合法 JSON`);
      }
    }
  }
  if (!task1 || !task2) warnings.push('写作题目不完整（缺 writing/task1.json 或 task2.json）');
  // Figure bytes are imported separately by Home; manifest entries alone are not displayed.
  const figureFile = zip.file('writing/task1_figure.png');
  const figureImage = figureFile ? `data:image/png;base64,${await figureFile.async('base64')}` : undefined;

  // 答案按科存放 + 旧格式迁移
  const readAnswers = (raw: string): Record<string, string> => {
    const o = JSON.parse(stripBom(raw));
    return o && typeof o === 'object' && o.items && typeof o.items === 'object' ? o.items : o; // 统一版 items / 旧版平铺
  };
  let answers: Record<string, string> | null = null;
  const ra = zip.file('reading/answers.json');
  if (ra) {
    answers = readAnswers(await ra.async('string'));
  } else {
    const legacy = zip.file('answers.json');
    if (legacy) {
      answers = readAnswers(await legacy.async('string'));
      warnings.push('检测到旧格式全局 answers.json，已自动迁移为阅读答案');
    }
  }

  // 听力：sectionN.json + 分科答案 + 音频（任意格式）
  let listening: ImportedPack['listening'] = null;
  const audio: Record<number, Blob> = {};
  const secFiles = Object.keys(zip.files).filter(n => /^listening\/section\d+\.json$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (secFiles.length) {
    const sections: ExtractedListeningSection[] = [];
    for (const n of secFiles) {
      try {
        const section: ExtractedListeningSection = JSON.parse(stripBom(await zip.file(n)!.async('string')));
        for (const g of section.question_groups) {
          if (g.figure_image && /^(?:listening|reading)\/[\w.-]+\.png$/i.test(g.figure_image)) {
            const image = zip.file(g.figure_image);
            if (image) g.figure_image = `data:image/png;base64,${await image.async('base64')}`;
            else warnings.push(`缺题组原图 ${g.figure_image}`);
          }
        }
        sections.push(section);
      } catch {
        throw new Error(`${n} 不是合法 JSON`);
      }
    }
    let la: Record<number, string> | null = null;
    const laFile = zip.file('listening/answers.json');
    if (laFile) {
      const o = JSON.parse(stripBom(await laFile.async('string')));
      la = o && typeof o === 'object' && o.items ? o.items : o;
    }
    listening = { sections, answers: la };
    // 音频文件（mp3/wav/m4a/ogg 等任意格式）
    for (const n of Object.keys(zip.files)) {
      const m = n.match(/^listening\/section(\d+)\.[a-z0-9]+$/i);
      if (m && !n.endsWith('.json')) {
        audio[Number(m[1])] = await zip.file(n)!.async('blob');
      }
    }
    for (const s of sections) {
      if (!audio[s.section_number]) warnings.push(`缺 listening/section${s.section_number} 音频文件（用户自备）`);
      if (!s.title && s.context) s.title = s.context; // 统一版 context → 场景标题
    }
  }

  const extracted: ExtractedTest = {
    book: manifest.book ?? '题包',
    test_number: manifest.test_number ?? 1,
    module: manifest.module ?? 'academic',
    reading: { passages },
    writing: {
      task1: task1 ?? { prompt: '', min_words: 150, suggested_minutes: 20 },
      task2: task2 ?? { prompt: '', min_words: 250, suggested_minutes: 40 },
    },
    answers,
    uncertain: [],
    warnings,
  };
  return { extracted, warnings, listening, audio, figureImage };
}

/** 导出完整题包：阅读 + 听力 + 写作 + 分科答案 + 音频 + 全部题图（应有尽有，不缺任何东西）
 *  - 结构化数据取自 extracted（原样结构，重新导入可 1:1 还原）
 *  - 题图：把 IndexedDB 里的图落成 zip 内的 PNG，并让 JSON 里的 figure_image 指向该路径
 *  - 音频：从 IndexedDB 读出 Blob 写回 listening/sectionN.<ext>
 */
export async function exportZip(test: StoredTest): Promise<Blob> {
  if (!test.extracted) throw new Error('该题没有结构化原始数据（如内置演示题），无法导出题包');
  const hydrated = await hydrateTest(test);          // 题图从 IndexedDB 取回为 data URL
  const ex = JSON.parse(JSON.stringify(hydrated.extracted)) as ExtractedTest;
  const zip = new JSZip();
  const files: string[] = [];
  const add = (path: string, data: string | Blob, opts?: { base64?: boolean }) => {
    zip.file(path, data as never, opts as never);
    if (!files.includes(path)) files.push(path);
  };
  const b64 = (u: string): string | null => {
    const m = /^data:[^;]+;base64,([\s\S]*)$/.exec(u);
    return m ? m[1] : null;
  };
  /** data URL → zip 内 PNG；返回 zip 内路径 */
  const putFigure = (dataUrl: unknown, path: string): string | null => {
    if (typeof dataUrl !== 'string') return null;
    if (dataUrl.startsWith('data:')) {
      const b = b64(dataUrl);
      if (!b) return null;
      add(path, b, { base64: true });
      return path;
    }
    return dataUrl && /\.(png|jpe?g)$/i.test(dataUrl) ? dataUrl : null;  // 本来就是 zip 内路径
  };

  /* ---- 阅读：passageN.json（题图引用指向 zip 内路径；图片本体一并写入）---- */
  (ex.reading?.passages ?? []).forEach((p, i) => {
    const adapted = hydrated.passages?.[i];
    (p.question_groups ?? []).forEach((g, gi) => {
      const fromAdapted = (adapted?.groups?.[gi] as { figureImage?: string } | undefined)?.figureImage;
      const path = putFigure(fromAdapted ?? (g as { figure_image?: string }).figure_image,
        `reading/fig_p${i + 1}_${gi + 1}.png`);
      if (path) (g as { figure_image?: string }).figure_image = path;
      else delete (g as { figure_image?: string }).figure_image;
    });
    add(`reading/passage${i + 1}.json`, JSON.stringify(p, null, 2));
  });
  if (ex.answers) add('reading/answers.json', JSON.stringify({ source: 'book', items: ex.answers }, null, 2));

  /* ---- 听力：sectionN.json + 答案 + 音频 + 题图 ---- */
  const secs = hydrated.listening?.sections ?? [];
  secs.forEach((s, si) => {
    (s.question_groups ?? []).forEach((g, gi) => {
      const path = putFigure((g as { figure_image?: string }).figure_image, `listening/fig_s${si + 1}_${gi + 1}.png`);
      if (path) (g as { figure_image?: string }).figure_image = path;
      else delete (g as { figure_image?: string }).figure_image;
    });
    add(`listening/section${s.section_number ?? si + 1}.json`, JSON.stringify(s, null, 2));
  });
  if (hydrated.listening?.answers) {
    add('listening/answers.json', JSON.stringify({ source: 'book', items: hydrated.listening.answers }, null, 2));
  }
  const EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/aac': 'aac' };
  for (const s of secs) {
    const no = s.section_number ?? 0;
    const blob = await loadAudio(`${test.id}/s${no}`).catch(() => null);
    if (blob) add(`listening/section${no}.${EXT[blob.type] ?? 'mp3'}`, blob);
  }

  /* ---- 写作：task1/task2 + Task 1 图表 ---- */
  if (ex.writing?.task1) add('writing/task1.json', JSON.stringify(ex.writing.task1, null, 2));
  if (ex.writing?.task2) add('writing/task2.json', JSON.stringify(ex.writing.task2, null, 2));
  const wFig = putFigure(hydrated.writingTasks?.[0]?.figureImage, 'writing/task1_figure.png');
  if (wFig && ex.writing?.task1) (ex.writing.task1 as { figure?: boolean }).figure = true;

  const manifest: PackManifest = {
    format_version: PACK_VERSION,
    book: ex.book ?? test.name,
    test_number: ex.test_number ?? 1,
    module: ex.module ?? 'academic',
    files: ['manifest.json', ...files].sort(),
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });   // 音频/PNG 已压缩，再压没意义
}
