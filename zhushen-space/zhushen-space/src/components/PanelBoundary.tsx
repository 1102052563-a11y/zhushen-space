import React from 'react';
import { reportCrash } from '../systems/crashReport';
import { setResumeFlag } from '../systems/resumeFlag';

/* 面板级错误边界：包住弹窗/面板层（App.tsx 底部大 <Suspense> 块与设置面板）。
   某个面板渲染崩（多为 AI 生成的脏数据）时只塌弹窗层——正文/输入/游戏主体照常，
   玩家点「关闭弹窗继续游戏」（onReset=App 的 closeAllPanels）即可接着玩，
   不必像顶层 ErrorBoundary 那样整页重载。崩溃自动上报（crashReport）。
   ⚠ 模块级组件：勿在 App 内内联定义包装组件（每键重挂，见 IME 断字坑）。 */

const PENDING_STARTED = 'drpg-pending-started';   // 与 ErrorBoundary/saveManager 一致：刷新后直接回到游戏
const CHUNK_TS = 'zs-chunk-reload-ts';            // 与 ErrorBoundary/main.tsx 共用的陈旧 chunk 刷新守卫

interface Props { label?: string; onReset?: () => void; children: React.ReactNode }
interface State { error: Error | null; copied: boolean }

export default class PanelBoundary extends React.Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    // 陈旧部署：懒加载面板的旧 chunk 已 404 → 沿用顶层 ErrorBoundary 的静默刷新自愈（20s 守卫防循环），
    // 否则这里会把本该自愈的情况拦成错误卡片。
    const emsg = String((error as { message?: string })?.message || error || '');
    if (/dynamically imported module|module script failed/i.test(emsg)) {
      try {
        const last = Number(localStorage.getItem(CHUNK_TS) || 0);
        if (Date.now() - last > 20000) {
          localStorage.setItem(CHUNK_TS, String(Date.now()));
          setResumeFlag(PENDING_STARTED);
          location.reload();
          return { error: null };
        }
      } catch { /* */ }
    }
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[PanelBoundary:${this.props.label || '面板'}] 渲染崩溃：`, error, info?.componentStack);
    reportCrash(`panel:${this.props.label || '?'}`, error, { componentStack: String(info?.componentStack || '') });
  }

  closeAndContinue = () => {
    try { this.props.onReset?.(); } catch { /* 关面板自身不允许再抛 */ }
    this.setState({ error: null, copied: false });
  };
  hardReload = () => { setResumeFlag(PENDING_STARTED); location.reload(); };
  copyErr = () => {
    const t = String(this.state.error?.stack || this.state.error?.message || this.state.error || '');
    const done = () => this.setState({ copied: true });
    try { navigator.clipboard?.writeText(t).then(done, done); } catch { done(); }
  };

  render() {
    if (!this.state.error) return this.props.children as React.ReactElement;
    const msg = String(this.state.error?.message || this.state.error || '未知错误');
    return (
      <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-blood/40 bg-void p-5 shadow-[0_0_60px_rgba(0,0,0,0.85)]">
          <div className="text-sm font-bold text-blood mb-1">⚠ {this.props.label || '面板'}出错了（游戏没受影响）</div>
          <div className="text-xs text-dim leading-relaxed mb-3">
            某个面板渲染时抛了异常（多见于 AI 生成的数据缺字段）。<b className="text-slate-200">正文与存档都没事</b>——关掉弹窗就能继续玩；报错已自动上报给作者，反复出现可再「📋 复制」补发。
          </div>
          <div className="text-[11px] font-mono text-dim/70 bg-panel border border-edge rounded-lg p-2 mb-3 max-h-28 overflow-auto whitespace-pre-wrap break-all">{msg}</div>
          <div className="flex gap-2">
            <button onClick={this.closeAndContinue} className="flex-1 px-3 py-2 rounded-lg border border-god/40 text-god text-sm hover:bg-god/10 transition-colors">↩ 关闭弹窗继续游戏</button>
            <button onClick={this.hardReload} className="px-3 py-2 rounded-lg border border-edge text-dim text-sm hover:text-slate-200 transition-colors">⟳ 刷新</button>
            <button onClick={this.copyErr} className="px-3 py-2 rounded-lg border border-edge text-dim text-sm hover:text-slate-200 transition-colors">{this.state.copied ? '✓' : '📋'}</button>
          </div>
        </div>
      </div>
    );
  }
}
