/** IndexedDB 媒体存储（音频与题图体积大，不进 localStorage）
 *  audio  : key = `${testId}/s${section}`  → Blob
 *  images : key = `${testId}/img${n}`      → data URL 字符串
 *  （DB 版本 2：新增 images；升级时对已存在的 store 做存在性判断，避免 createObjectStore 抛错） */
import { fetchMedia, mirrorMediaDelete, mirrorMediaPut } from './serverSync';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ielts15-media', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveAudio(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('audio', 'readwrite');
    tx.objectStore('audio').put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
  void mirrorMediaPut(key, blob);   // 镜像到服务器文件夹（不阻塞）
}

export async function loadAudio(key: string): Promise<Blob | null> {
  const db = await openDb();
  const out = await new Promise<Blob | null>((res, rej) => {
    const rq = db.transaction('audio').objectStore('audio').get(key);
    rq.onsuccess = () => res((rq.result as Blob) ?? null);
    rq.onerror = () => rej(rq.error);
  });
  db.close();
  if (out) return out;
  // IndexedDB 未命中（换机/重装后首次使用）：尝试从服务器文件夹取回并缓存
  const remote = await fetchMedia(key);
  if (remote) {
    try { await saveAudio(key, remote); } catch { /* 缓存失败忽略 */ }
  }
  return remote;
}

/* ---- 题图（地图 / 平面图 / 流程图 / 写作图表）：以 data URL 字符串存放 ---- */
export async function saveImage(key: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put(dataUrl, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
  void mirrorMediaPut(key, dataUrl);   // 镜像到服务器文件夹（不阻塞）
}

export async function loadImage(key: string): Promise<string | null> {
  const db = await openDb();
  const out = await new Promise<string | null>((res, rej) => {
    const rq = db.transaction('images').objectStore('images').get(key);
    rq.onsuccess = () => res((rq.result as string) ?? null);
    rq.onerror = () => rej(rq.error);
  });
  db.close();
  if (out) return out;
  // IndexedDB 未命中：尝试从服务器文件夹取回，转成 dataURL 并缓存
  const remote = await fetchMedia(key);
  if (!remote) return null;
  const dataUrl = await blobToDataUrl(remote);
  try { await saveImage(key, dataUrl); } catch { /* 缓存失败忽略 */ }
  return dataUrl;
}

/** 删除某套题在 IndexedDB 里的全部媒体（音频 + 图片），供"删除题包"时清理空间 */
export async function deleteTestMedia(testId: string): Promise<void> {
  const db = await openDb();
  for (const store of ['audio', 'images']) {
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const rq = os.openKeyCursor();
      rq.onsuccess = () => {
        const cur = rq.result;
        if (!cur) return;                                  // 游标走完，等待 tx.oncomplete
        if (String(cur.key).startsWith(`${testId}/`)) os.delete(cur.key);
        cur.continue();
      };
      rq.onerror = () => rej(rq.error);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  db.close();
  mirrorMediaDelete(testId);   // 同步删除服务器文件夹里的媒体
}

/* ============ 备份/恢复用的枚举与读取（不改 DB 版本、不重建 store） ============ */

export type MediaStore = 'audio' | 'images';

/** 列出某个 store 的全部 key（备份导出时枚举已知媒体） */
export async function listMediaKeys(store: MediaStore): Promise<string[]> {
  const db = await openDb();
  try {
    return await new Promise<string[]>((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const rq = tx.objectStore(store).getAllKeys();
      rq.onsuccess = () => res((rq.result ?? []).map(String));
      rq.onerror = () => rej(rq.error);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
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

/** 读一项媒体为 Blob（IndexedDB 未命中时沿用 loadAudio/loadImage 的远程回退） */
export async function readMediaBlob(store: MediaStore, key: string): Promise<{ blob: Blob; mime: string } | null> {
  if (store === 'audio') {
    const b = await loadAudio(key);
    return b ? { blob: b, mime: b.type || 'audio/mpeg' } : null;
  }
  const url = await loadImage(key);
  if (!url) return null;
  const blob = dataUrlToBlob(url);
  return { blob, mime: blob.type || 'image/png' };
}

/** 写回一项媒体（audio → saveAudio；images → data URL 后 saveImage，并镜像到服务器） */
export async function writeMediaBlob(store: MediaStore, key: string, blob: Blob): Promise<void> {
  if (store === 'audio') {
    await saveAudio(key, blob);
    return;
  }
  await saveImage(key, await dataUrlOf(blob));
}

/** 删除某个 store 里的全部媒体（完整替换备份时只清本应用拥有的数据） */
export async function clearAllMedia(): Promise<void> {
  const db = await openDb();
  for (const store of ['audio', 'images'] as MediaStore[]) {
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  db.close();
}

export async function dataUrlOf(blob: Blob): Promise<string> {
  return blobToDataUrl(blob);
}
