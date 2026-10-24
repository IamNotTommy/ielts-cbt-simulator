/** 数据管理：创建全量备份 / 预检并恢复。API Key 与模型配置永远不进备份。 */
import { useEffect, useRef, useState } from 'react';
import type { BackupPreview, PlanModule, RestoreMode, RestorePlan, RestoreSummary } from '../lib/backup';
import {
  downloadBlob, exportBackupDetailed, inspectBackup, planRestore, restoreBackup,
} from '../lib/backup';

interface Props {
  onClose: () => void;
  onRestored: () => void;
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const MODULES: { key: PlanModule; label: string }[] = [
  { key: 'tests', label: '题库' },
  { key: 'history', label: '练习记录' },
  { key: 'writing', label: '写作答卷' },
  { key: 'intensive', label: '精读' },
  { key: 'listen', label: '精听' },
  { key: 'sessions', label: '未完成练习' },
  { key: 'reviewItems', label: '错题复盘' },
  { key: 'vocabularyProgress', label: '词汇复习进度' },
  { key: 'wordbook', label: '词汇册' },
  { key: 'lwords', label: '生词本' },
  { key: 'media', label: '媒体' },
  { key: 'ui', label: '界面设置' },
];

export default function DataManager({ onClose, onRestored }: Props) {
  const [includeCore, setIncludeCore] = useState(true);
  const [includeSessions, setIncludeSessions] = useState(true);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [exportResult, setExportResult] = useState<{ name: string; size: number; counts: string } | null>(null);
  const [exportErr, setExportErr] = useState('');

  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [mode, setMode] = useState<RestoreMode>('merge-keep');
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [restoreErr, setRestoreErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async (media: boolean) => {
    const r = await exportBackupDetailed({ includeMedia: media, onProgress: setProgress });
    downloadBlob(r.blob, r.fileName);
    return r;
  };

  const createBackup = async () => {
    setBusy(true);
    setExportErr('');
    setExportResult(null);
    setProgress('准备备份…');
    try {
      const r = await doExport(includeMedia);
      setExportResult({
        name: r.fileName,
        size: r.blob.size,
        counts: `题库 ${r.manifest.files.tests} 套 · 练习记录 ${r.manifest.files.records} 场 · 写作答卷 ${r.manifest.files.writingAttempts} 份 · 精读 ${r.manifest.files.intensive} 篇 · 精听 ${r.manifest.files.listen} 篇 · 媒体 ${r.manifest.files.media} 个`,
      });
      setProgress('');
    } catch (e) {
      setExportErr(`创建备份失败：${(e as Error).message}`);
      setProgress('');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File) => {
    setRestoreErr('');
    setSummary(null);
    setProgress('检查备份文件…');
    try {
      const prev = await inspectBackup(file);
      if (prev.errors.length) {
        setPreview(null);
        setPlan(null);
        setRestoreErr(`备份文件有问题，未写入任何数据：\n${prev.errors.slice(0, 8).join('\n')}${prev.errors.length > 8 ? `\n…共 ${prev.errors.length} 条` : ''}`);
        setProgress('');
        return;
      }
      setPreview(prev);
      setProgress('');
    } catch (e) {
      setRestoreErr(`无法读取备份：${(e as Error).message}`);
      setProgress('');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!preview) { setPlan(null); return; }
    let alive = true;
    void planRestore(preview, mode).then(p => {
      if (alive) setPlan(p);
    }).catch(() => { if (alive) setPlan(null); });
    return () => { alive = false; };
  }, [preview, mode]);

  const restore = async () => {
    if (!preview) return;
    setRestoreErr('');
    setRestoreBusy(true);
    setSummary(null);
    try {
      if (mode === 'replace') {
        setProgress('完整替换前，先创建一份包含媒体的当前备份…');
        try {
          await doExport(true);
        } catch (e) {
          setRestoreErr(`完整替换已中止：无法创建可回滚的当前备份（${(e as Error).message}）。`);
          return;
        }
        const warn = preview.manifest.includesMedia
          ? ''
          : '\n\n⚠ 这个备份包不含媒体：替换后当前音频、题图与跟读录音会被移除，且无法从本包恢复。';
        if (!confirm(`完整替换当前数据？\n\n将清空：题库、练习记录、写作答卷、精读、精听、词汇、错题复盘与未完成练习，然后写入备份内容。\n模型配置（API Key）不受影响。${warn}\n\n已自动生成一份当前数据备份（含媒体）并开始下载，可用于回滚。`)) {
          return;
        }
      }
      setProgress('恢复中…');
      const res = await restoreBackup(preview, {
        mode,
        includeMedia: preview.manifest.includesMedia,
        ...(plan ? { plan } : {}),
        onProgress: setProgress,
      });
      setSummary(res);
      onRestored();
      setProgress('');
      if (!res.warnings.length && res.failed === 0) {
        setPreview(null);
        setPlan(null);
      }
    } catch (e) {
      setRestoreErr(`恢复失败：${(e as Error).message}`);
      setProgress('');
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <div className="dm-wrap">
      <header className="iv-top">
        <button className="iv-back" onClick={onClose}>← 返回</button>
        <div className="iv-title">
          <b>数据管理</b>
          <span>全量备份与恢复 · API Key 不会包含在备份中</span>
        </div>
      </header>

      {summary ? (
        <div className="dm-summary">
          <h3>恢复完成</h3>
          <div className="dm-counts">
            <div><b>{summary.added}</b><span>新增</span></div>
            <div><b>{summary.kept}</b><span>保留当前</span></div>
            <div><b>{summary.replaced}</b><span>使用备份</span></div>
            <div className={summary.failed ? 'bad' : ''}><b>{summary.failed}</b><span>失败</span></div>
          </div>
          <table className="dm-table">
            <thead><tr><th>模块</th><th>新增</th><th>保留</th><th>替换</th></tr></thead>
            <tbody>
              {MODULES.filter(m => summary.modules[m.key]).map(m => (
                <tr key={m.key}>
                  <td>{m.label}</td>
                  <td>{summary.modules[m.key].add}</td>
                  <td>{summary.modules[m.key].keep}</td>
                  <td>{summary.modules[m.key].replace}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.warnings.length > 0 && (
            <ul className="dm-warnings">
              {summary.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <p className="dm-note">
            {summary.flushed
              ? '已同步到本地文件夹。刷新页面后所有面板都会使用恢复后的数据。'
              : '本地数据已恢复，但同步到本地文件夹尚未完成：请稍后刷新重试，不要此时用旧文件夹数据覆盖。'}
          </p>
          <div className="dm-ops">
            <button className="as-primary" onClick={() => window.location.reload()}>刷新页面</button>
            <button className="as-secondary" onClick={() => { setSummary(null); onClose(); }}>关闭</button>
          </div>
        </div>
      ) : (
        <>
          <section className="dm-card">
            <h3>创建备份</h3>
            <label className="dm-check">
              <input type="checkbox" checked={includeCore} onChange={e => setIncludeCore(e.target.checked)} disabled />
              题库、成绩、写作和学习记录
            </label>
            <label className="dm-check">
              <input type="checkbox" checked={includeSessions} onChange={e => setIncludeSessions(e.target.checked)} disabled />
              未完成练习与界面设置
            </label>
            <label className="dm-check">
              <input type="checkbox" checked={includeMedia} onChange={e => setIncludeMedia(e.target.checked)} disabled={busy} />
              包含音频、题图和录音（文件可能较大）
            </label>
            <div className="dm-ops">
              <button className="as-primary" disabled={busy} onClick={() => void createBackup()}>
                {busy ? '正在创建…' : '创建备份'}
              </button>
              {progress && <span className="dm-progress" aria-live="polite">{progress}</span>}
            </div>
            {exportResult && (
              <div className="dm-result" role="status">
                <b>{exportResult.name}</b>
                <span>{fmtSize(exportResult.size)}</span>
                <p>{exportResult.counts}</p>
              </div>
            )}
            {exportErr && <div className="form-err-box">{exportErr}</div>}
            <p className="dm-note">导出的是用户数据，不含题包导入导出；模型配置与 API Key 永远不会写入备份。</p>
          </section>

          <section className="dm-card">
            <h3>恢复备份</h3>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              disabled={restoreBusy}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f);
              }}
            />
            <p className="dm-note">选择备份后先做预检，不会立即写入；预检通过后才显示恢复选项。</p>
            {restoreErr && <div className="form-err-box dm-pre">{restoreErr}</div>}

            {preview && (
              <div className="dm-preview">
                <h4>备份预检通过</h4>
                <p>
                  备份时间：{new Date(preview.manifest.createdAt).toLocaleString()}
                  {preview.manifest.includesMedia ? ' · 含媒体' : ' · 不含媒体'}
                </p>
                <p>
                  题库 {preview.tests.length} 套 · 历史 {preview.records.length} 场 · 写作 {preview.writing.length} 份 ·
                  精读 {preview.intensive.length} 篇 · 精听 {preview.listen.length} 篇 ·
                  媒体 {preview.manifest.media?.length ?? 0} 个
                </p>
                {plan && (
                  <p className="dm-plan">
                    预计：新增 {MODULES.reduce((n, m) => n + (plan.counts[m.key]?.add ?? 0), 0)} 项 ·
                    保留当前 {MODULES.reduce((n, m) => n + (plan.counts[m.key]?.keep ?? 0), 0)} 项 ·
                    使用备份 {MODULES.reduce((n, m) => n + (plan.counts[m.key]?.replace ?? 0), 0)} 项
                  </p>
                )}

                <div className="dm-modes">
                  <label>
                    <input type="radio" name="dm-mode" checked={mode === 'merge-keep'} onChange={() => setMode('merge-keep')} />
                    合并恢复：保留当前冲突
                  </label>
                  <label>
                    <input type="radio" name="dm-mode" checked={mode === 'merge-replace'} onChange={() => setMode('merge-replace')} />
                    合并恢复：冲突使用备份
                  </label>
                  <label className="dm-danger">
                    <input type="radio" name="dm-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                    完整替换当前数据
                  </label>
                </div>

                {mode === 'replace' && (
                  <p className="dm-warn">
                    完整替换会先自动创建一份含媒体的当前备份；如果备份包不含媒体，恢复后当前媒体会被移除。
                  </p>
                )}

                <div className="dm-ops">
                  <button className="as-primary" disabled={restoreBusy} onClick={() => void restore()}>
                    {restoreBusy ? '恢复中…' : '继续恢复'}
                  </button>
                  <button className="as-secondary" disabled={restoreBusy} onClick={() => { setPreview(null); setPlan(null); }}>
                    取消
                  </button>
                  {progress && <span className="dm-progress" aria-live="polite">{progress}</span>}
                </div>
              </div>
            )}
          </section>
        </>
      )}

      <p className="affil-note">
        数据默认保存在本机浏览器；启动器可用时题库、练习记录、写作答卷与学习数据会额外镜像到本地文件夹。
      </p>
    </div>
  );
}
