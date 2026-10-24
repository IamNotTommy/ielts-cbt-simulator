/** 汇总所有镜像写队列：恢复备份 / 完整替换后必须先 await 这里，
 *  否则紧接着的「服务器优先」启动同步会用旧数据把刚恢复的内容盖回去。 */
import { flushServerSync } from './serverSync';
import { flushIntensive } from './intensive';
import { flushListenLab } from './listenLab';

export async function flushLocalMirrors(): Promise<{ ok: boolean; error?: string }> {
  try {
    await flushServerSync();
    await flushIntensive();
    await flushListenLab();
    // 队列里可能又排入新的镜像（例如 flush 期间触发的写入），再收一次尾
    await flushServerSync();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? '未知错误' };
  }
}
