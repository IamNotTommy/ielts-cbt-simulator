import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode; label?: string; }
interface State { err: string | null; }

/**
 * 轻量错误边界：弹窗渲染若抛错，React 会静默丢弃整棵子树（界面上什么都不发生），
 * 这里兜住并把错误显示出来，避免"点了没反应"这种查不出来的症状。
 */
export default class ErrorProbe extends Component<Props, State> {
  state: State = { err: null };
  static getDerivedStateFromError(e: unknown): State {
    return { err: (e as Error)?.message ?? String(e) };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[ui] ${this.props.label ?? 'component'} 渲染失败:`, e?.message, info?.componentStack);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 620 }}>
            <h2 style={{ color: '#c92a2a' }}>界面出错</h2>
            <div className="form-err-box">
              {this.props.label ? `${this.props.label}：` : ''}{this.state.err}
              {'\n'}可以关掉这个窗口继续使用；若反复出现请把这条信息反馈给开发者。
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
              <button className="btn-ok" onClick={() => this.setState({ err: null })}>关闭</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
