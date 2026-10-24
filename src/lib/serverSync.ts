/** 本地文件夹同步：启动器提供的同源 HTTP API（/api/store/*、/api/media/*、/api/pack/*）。
 *  API 不存在时（如备用启动脚本起的服务）完全退化为仅存浏览器，不报错。 */

// 与 store.ts / history.ts 的 localStorage 键保持一致（此处不 import 它们，避免循环依赖）
const K_TESTS = 'ielts15-tests';
const K_HISTORY = 'ielts15-history';

/* ---- API 可用性探测：ping 一次并缓存结果，本次会话不再重复 ---- */
let pingCache: Promise<boolean> | null = null;

export function serverAvailable(): Promise<boolean> {
  if (!pingCache) {
    pingCache = (async () => {
      try {
        const r = await fetch('/api/store/ping');
        return r.ok && r.headers.get('X-CBT-Store') === '1';
      } catch {
        return false;
      }
    })();
  }
  return pingCache;
}

/* ---- 写操作串行化：避免并发 PUT 相互覆盖 ---- */
let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>): void {
  queue = queue.then(fn).catch(() => { /* 已在 fn 内部 warn，这里兜底 */ });
}

/** 供其他数据层复用同一条写队列（学习数据 / 写作答卷镜像） */
export function enqueueApi(fn: () => Promise<void>): void {
  enqueue(fn);
}

/** 等待当前队列里所有写操作结束（恢复备份后必须先 flush，避免旧服务器数据回覆盖） */
export async function flushServerSync(): Promise<void> {
  let cursor = queue;
  for (;;) {
    await cursor;
    if (cursor === queue) return;
    cursor = queue;
  }
}

async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn('同步到本地文件夹失败：', e);
  }
}

/* ---- 启动恢复：服务器有数据则覆盖浏览器；服务器空而浏览器有则反向播种 ---- */
export async function syncFromServer(): Promise<boolean> {
  if (!(await serverAvailable())) return false;
  try {
    const [rt, rh] = await Promise.all([fetch('/api/store/tests'), fetch('/api/store/history')]);
    if (!rt.ok || !rh.ok) return false;
    const serverTests: unknown = await rt.json();
    const serverHistory: unknown = await rh.json();
    const hasServerTests = Array.isArray(serverTests) && serverTests.length > 0;
    const hasServerHistory = Array.isArray(serverHistory) && serverHistory.length > 0;
    if (hasServerTests || hasServerHistory) {
      // 服务器文件夹为准，整量写入浏览器存储
      if (hasServerTests) localStorage.setItem(K_TESTS, JSON.stringify(serverTests));
      if (hasServerHistory) localStorage.setItem(K_HISTORY, JSON.stringify(serverHistory));
      return true;
    }
    // 老用户升级场景：服务器为空但浏览器有数据 → 播种到服务器
    const localTests = localStorage.getItem(K_TESTS);
    const localHistory = localStorage.getItem(K_HISTORY);
    const puts: Promise<Response>[] = [];
    if (localTests && JSON.parse(localTests)?.length) {
      puts.push(fetch('/api/store/tests', { method: 'PUT', body: localTests }));
    }
    if (localHistory && JSON.parse(localHistory)?.length) {
      puts.push(fetch('/api/store/history', { method: 'PUT', body: localHistory }));
    }
    if (puts.length) {
      await Promise.all(puts);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('从本地文件夹恢复数据失败：', e);
    return false;
  }
}

/* ---- 镜像写回：题库与练习记录整量覆盖 ---- */
export function mirrorTests(): void {
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch('/api/store/tests', {
      method: 'PUT',
      body: localStorage.getItem(K_TESTS) ?? '[]',
    });
  }));
}

export function mirrorHistory(): void {
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch('/api/store/history', {
      method: 'PUT',
      body: localStorage.getItem(K_HISTORY) ?? '[]',
    });
  }));
}

/* ---- 媒体镜像：音频 Blob 与题图 dataURL ---- */
function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  const mime = m?.[1] ?? 'application/octet-stream';
  const isB64 = !!m?.[2];
  const data = m?.[3] ?? '';
  if (isB64) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

export function mirrorMediaPut(key: string, data: Blob | string): Promise<void> {
  return new Promise(res => {
    enqueue(async () => {
      try {
        if (!(await serverAvailable())) { res(); return; }
        const blob = typeof data === 'string' ? dataUrlToBlob(data) : data;
        await fetch(`/api/media/${key}`, {
          method: 'PUT',
          headers: { 'X-Mime-Type': blob.type || 'application/octet-stream' },
          body: blob,
        });
      } catch (e) {
        console.warn('同步媒体到本地文件夹失败：', key, e);
      }
      res();
    });
  });
}

export function mirrorMediaDelete(testId: string): void {
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch(`/api/media/${testId}`, { method: 'DELETE' });
  }));
}

/** IndexedDB 未命中时从服务器取；404 / API 不可用 → null */
export async function fetchMedia(key: string): Promise<Blob | null> {
  try {
    if (!(await serverAvailable())) return null;
    const r = await fetch(`/api/media/${key}`);
    if (!r.ok) return null;
    return await r.blob();
  } catch {
    return null;
  }
}

/* ---- 导入的 zip 原文件备份到 导入题目/ ---- */
export function uploadPackCopy(fileName: string, file: File | Blob): void {
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch(`/api/pack/${encodeURIComponent(fileName)}`, {
      method: 'PUT',
      body: file,
    });
  }));
}

/* ================= 写作答卷（/api/writing） =================
 * 服务器是 做题记录\写作\<recordId>.json。规则：
 *  · 服务器有 → 更新 IndexedDB；
 *  · 本地独有 → 保留并镜像到服务器；
 *  · 服务器缺失**不**自动推导为删除本地。                                          */

export function mirrorWritingPut(attempt: { recordId: string }): void {
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch(`/api/writing/${encodeURIComponent(attempt.recordId)}`, {
      method: 'PUT',
      body: JSON.stringify(attempt),
    });
  }));
}

export function mirrorWritingDelete(recordId: string): void {
  enqueue(() => safe(async () => {
    if (!(await serverAvailable())) return;
    await fetch(`/api/writing/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
  }));
}

/** 启动恢复：服务器答卷并入本地。返回是否有变化。API 失败 → 保留本地并返回 false */
export async function syncWritingFromServer(): Promise<boolean> {
  if (!(await serverAvailable())) return false;
  try {
    const r = await fetch('/api/writing');
    if (!r.ok) return false;
    const ids: unknown = await r.json();
    if (!Array.isArray(ids)) return false;
    const mod = await import('./writingHistory');
    const local = await mod.listWritingAttempts();
    let changed = false;
    for (const raw of ids) {
      if (typeof raw !== 'string') continue;
      try {
        const one = await fetch(`/api/writing/${encodeURIComponent(raw)}`);
        if (!one.ok) continue;
        const attempt = await one.json() as { version?: number; recordId?: string };
        if (!attempt || attempt.version !== 1 || attempt.recordId !== raw) continue;
        await mod.putWritingAttempt(attempt as never, false);
        changed = true;
      } catch { /* 单条失败不影响其他 */ }
    }
    // 本地独有：服务器可用时补镜像（不删除任何本地数据）
    for (const a of local) {
      if (!ids.includes(a.recordId)) mirrorWritingPut(a);
    }
    return changed;
  } catch (e) {
    console.warn('从本地文件夹恢复写作答卷失败：', e);
    return false;
  }
}
