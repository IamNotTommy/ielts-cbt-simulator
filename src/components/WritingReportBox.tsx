import { useState } from 'react';

interface Props {
  md: string | null;
  loading: boolean;
  onDownload: () => void;
}

/** 写作判改报告（Markdown）：展开查看原文 / 下载 .md；没有 markdown 渲染库，用等宽 <pre> 展示 */
export default function WritingReportBox({ md, loading, onDownload }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ai-grade-box ai-report-box">
      <div className="ai-report-head">
        <b>写作判改报告（Markdown）</b>
        <span className="ai-report-actions">
          <button className="preset-btn" disabled={!md} onClick={() => setOpen(o => !o)}>
            {open ? '收起' : '展开查看'}
          </button>
          <button className="preset-btn" disabled={!md} onClick={onDownload}>下载 .md</button>
        </span>
      </div>
      {loading && <p className="ai-report-loading">报告生成中…</p>}
      {open && md && <pre className="ai-report-md">{md}</pre>}
    </div>
  );
}
