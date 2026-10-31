/** 未完成练习中心（active session）数据层。
 *  每套题最多一个进行中的会话；进度本身不重复存，首页从 answers/lanswers/essays 动态算。
 *  localStorage key 仍由 tk(testId, what) 生成，what 的实际大小写必须与考试存档保持一致。 */
import type { SessionConfig, StoredTest } from './store';
import { tk } from './store';

export type SessionMode = 'reading' | 'listening' | 'writing';
export type FullPhase = 'listening' | 'reading' | 'writing';

export interface ActiveSessionMeta {
  version: 1;
  testId: string;
  startedAt: number;
  updatedAt: number;
  config: SessionConfig;
  mode: SessionMode;
  fullPhase: FullPhase;
  current: number;
  partIdx: number;
  wPart: number;
  untimed: boolean;
  elapsedMs?: number;
  reviewed?: Record<number, boolean>;
  listeningSection?: number;
}

/** 放弃进度时要清理的存档键（不含题库、历史、写作历史、精读/精听、词汇、复盘） */
export const SESSION_STORAGE_KEYS = [
  'answers',
  'lanswers',
  'essays',
  'notes',
  'highlights',
  'times',
  'ltimes',
  'timer',
  'active-session',
] as const;

export const sessionKey = (testId: string) => tk(testId, 'active-session');

const asMode = (v: unknown): SessionMode =>
  v === 'listening' || v === 'writing' ? v : 'reading';

const asPhase = (v: unknown): FullPhase =>
  v === 'listening' || v === 'writing' ? v : 'reading';

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function loadActiveSession(testId: string): ActiveSessionMeta | null {
  try {
    const raw = localStorage.getItem(sessionKey(testId));
    if (!raw) return null;
    const m = JSON.parse(raw) as ActiveSessionMeta;
    if (!m || m.version !== 1 || m.testId !== testId) return null;
    const cfg = m.config as SessionConfig | undefined;
    if (!cfg || typeof cfg.scope !== 'string') return null;
    const updatedAt = num(m.updatedAt, 0);
    return {
      version: 1,
      testId,
      startedAt: num(m.startedAt, updatedAt || Date.now()),
      updatedAt,
      config: {
        scope: cfg.scope,
        passageIdx: num(cfg.passageIdx, 0),
        minutes: num(cfg.minutes, 60),
        writingMinutes: num(cfg.writingMinutes, 60),
        ...(cfg.gradeWriting != null ? { gradeWriting: !!cfg.gradeWriting } : {}),
        ...(cfg.listeningMode === 'real' || cfg.listeningMode === 'practice' ? { listeningMode: cfg.listeningMode } : {}),
      },
      mode: asMode(m.mode),
      fullPhase: asPhase(m.fullPhase),
      current: Math.max(1, num(m.current, 1)),
      partIdx: Math.max(0, num(m.partIdx, 0)),
      wPart: Math.max(0, num(m.wPart, 0)),
      untimed: !!m.untimed,
      elapsedMs: Math.max(0, num(m.elapsedMs, 0)),
      reviewed: m.reviewed && typeof m.reviewed === 'object'
        ? Object.fromEntries(Object.entries(m.reviewed).filter(([, v]) => !!v))
        : {},
      listeningSection: Math.max(0, num(m.listeningSection, 0)),
    };
  } catch {
    return null;
  }
}

export function saveActiveSession(meta: ActiveSessionMeta): void {
  try {
    localStorage.setItem(sessionKey(meta.testId), JSON.stringify(meta));
  } catch {
    /* 配额满时忽略：进度不阻断作答 */
  }
}

export function clearActiveSession(testId: string): void {
  try {
    localStorage.removeItem(sessionKey(testId));
  } catch {
    /* 忽略 */
  }
}

/** 只删除该题当前的作答与计时存档；历史成绩、写作答卷、精读/精听、词汇、复盘都不动 */
export function discardSession(testId: string): void {
  for (const what of SESSION_STORAGE_KEYS) {
    try {
      localStorage.removeItem(tk(testId, what));
    } catch {
      /* 忽略 */
    }
  }
  try {
    localStorage.removeItem(tk(testId, 'session-ended'));
  } catch {
    /* 忽略 */
  }
}

/** 交卷后标记：该套题里现存的作答属于"已交卷"，下次开始练习时不应再被当成未完成进度 */
export const sessionEndedKey = (testId: string) => tk(testId, 'session-ended');
export function markSessionEnded(testId: string): void {
  try {
    localStorage.setItem(sessionEndedKey(testId), '1');
  } catch {
    /* 忽略 */
  }
}
export function clearSessionEnded(testId: string): void {
  try {
    localStorage.removeItem(sessionEndedKey(testId));
  } catch {
    /* 忽略 */
  }
}
export function isSessionEnded(testId: string): boolean {
  try {
    return localStorage.getItem(sessionEndedKey(testId)) === '1';
  } catch {
    return false;
  }
}

export function listActiveSessions(tests: StoredTest[]): ActiveSessionMeta[] {
  const out: ActiveSessionMeta[] = [];
  for (const t of tests) {
    const m = loadActiveSession(t.id);
    if (m) out.push(m);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 旧版本遗留的计时存档：只有它能被可靠地自动识别为"可恢复" */
export interface LegacyTimer {
  scope: string;
  mode: SessionMode;
  fullPhase: FullPhase;
  secondsLeft: number;
  savedAt?: number;
}

export function loadLegacyTimer(testId: string): LegacyTimer | null {
  try {
    const raw = localStorage.getItem(tk(testId, 'timer'));
    if (!raw) return null;
    const t = JSON.parse(raw) as LegacyTimer;
    if (!t || typeof t.scope !== 'string' || !(Number(t.secondsLeft) > 0)) return null;
    return {
      scope: t.scope,
      mode: asMode(t.mode),
      fullPhase: asPhase(t.fullPhase),
      secondsLeft: Number(t.secondsLeft),
      ...(t.savedAt != null ? { savedAt: Number(t.savedAt) } : {}),
    };
  } catch {
    return null;
  }
}

/** 没有任何 active-session / timer，但存档里有非空作答：只能提示用户"发现已有作答" */
export function hasLooseAnswers(testId: string): boolean {
  try {
    for (const what of ['answers', 'lanswers', 'essays'] as const) {
      const raw = localStorage.getItem(tk(testId, what));
      if (!raw) continue;
      const v = JSON.parse(raw);
      if (what === 'essays') {
        if (Array.isArray(v) && v.some((x: unknown) => String(x ?? '').trim())) return true;
      } else if (v && typeof v === 'object' &&
        Object.values(v as Record<string, unknown>).some(x => String(x ?? '').trim() !== '')) {
        return true;
      }
    }
  } catch {
    /* 损坏数据当作没有 */
  }
  return false;
}

/** 从旧 timer 还原出一份 v1 active-session（不做猜测，scope 直接沿用 timer） */
export function adoptLegacyTimer(testId: string, t: LegacyTimer, config: SessionConfig): ActiveSessionMeta {
  const meta: ActiveSessionMeta = {
    version: 1,
    testId,
    startedAt: Date.now() - t.secondsLeft * 1000,
    updatedAt: Date.now(),
    config,
    mode: t.mode,
    fullPhase: t.fullPhase,
    current: 1,
    partIdx: 0,
    wPart: 0,
    untimed: false,
  };
  saveActiveSession(meta);
  return meta;
}
