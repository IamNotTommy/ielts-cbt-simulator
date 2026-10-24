/** 界面设置持久化（字号 / 配色 / 亮度 / 分栏比例）。
 *  备份的 settings/ui.json 就写这个对象；不含模型配置与任何 API Key。 */
export interface UiSettings {
  fontSize: 'std' | 'lg' | 'xl';
  scheme: 'bow' | 'wob' | 'yob';
  brightness: number;   // 50–100
  split: number;        // 25–75
}

export const UI_SETTINGS_KEY = 'ielts15-ui-settings';
const LEGACY_SPLIT_KEY = 'ielts-cbt-split';

export const DEFAULT_UI_SETTINGS: UiSettings = { fontSize: 'std', scheme: 'bow', brightness: 100, split: 50 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export function normalizeUiSettings(raw: unknown): UiSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<UiSettings>;
  return {
    fontSize: o.fontSize === 'lg' || o.fontSize === 'xl' ? o.fontSize : 'std',
    scheme: o.scheme === 'wob' || o.scheme === 'yob' ? o.scheme : 'bow',
    brightness: Number.isFinite(Number(o.brightness)) ? clamp(Number(o.brightness), 50, 100) : 100,
    split: Number.isFinite(Number(o.split)) ? clamp(Number(o.split), 25, 75) : 50,
  };
}

export function loadUiSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_KEY);
    if (raw) return normalizeUiSettings(JSON.parse(raw));
  } catch {
    /* 损坏则回退默认 */
  }
  // 首次升级：沿用旧的分栏记忆
  let split = DEFAULT_UI_SETTINGS.split;
  try {
    const s = Number(localStorage.getItem(LEGACY_SPLIT_KEY));
    if (Number.isFinite(s) && s >= 25 && s <= 75) split = Math.round(s);
  } catch {
    /* 忽略 */
  }
  return { ...DEFAULT_UI_SETTINGS, split };
}

export function saveUiSettings(s: UiSettings): void {
  const next = normalizeUiSettings(s);
  try {
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(next));
    localStorage.setItem(LEGACY_SPLIT_KEY, String(next.split));
  } catch {
    /* 忽略 */
  }
}
