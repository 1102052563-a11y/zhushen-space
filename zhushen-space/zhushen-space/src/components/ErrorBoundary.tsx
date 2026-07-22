import React from 'react';
import { setResumeFlag, clearResumeFlag } from '../systems/resumeFlag';
import { reportCrash } from '../systems/crashReport';

/* 顶层错误边界：任何组件渲染时抛出的异常都被这里兜住，显示一个可恢复的提示，
   而不是让 React 卸载整棵树导致【整页黑屏】。
   常见诱因：AI 生成的物品/角色数据有脏字段（如某物品 tags/attrs 缺失）→ 渲染时崩。
   **你的存档不会丢**（都在 localStorage / IndexedDB + 每回合自动存档），按钮即可恢复：
   - 「重新加载并回到游戏」：重载后所有弹窗都关着（崩溃多发生在某个弹窗渲染脏数据），通常就不再复现，且直接回到游戏；
   - 若一回到游戏就又崩（<10s）→ 判定为常驻数据死循环，自动切「安全模式·回主界面」，可用「读取存档 → ⏱自动存档」恢复。 */

const PENDING_STARTED = 'drpg-pending-started';   // 与 saveManager 一致：置位后 App 挂载即 setStarted(true)，重载回到游戏
const RESUME_TS = 'zs-crash-resume-ts';
const CHUNK_TS = 'zs-chunk-reload-ts';
// 循环守卫时间戳（防无限刷新/崩溃循环）同样必须跨 location.reload() 存活；沿用 localStorage
// 而非 sessionStorage（手机/PWA 下 sessionStorage 跨 reload 会丢，守卫失效可能导致刷新循环）。
const tsGet = (k: string): number => { try { return Number(localStorage.getItem(k) || 0); } catch { return 0; } };
const tsSet = (k: string): void => { try { localStorage.setItem(k, String(Date.now())); } catch { /* */ } };
const tsDel = (k: string): void => { try { localStorage.removeItem(k); } catch { /* */ } };

interface State { error: Error | null; loop: boolean; copied: boolean }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, loop: false, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    // 陈旧部署：打开的页面引用旧 chunk 哈希，新版上线后旧 chunk 404 →「Failed to fetch dynamically imported module」。
    // 静默刷新一次拿最新版（20s 内只刷一次防循环；置 PENDING_STARTED 使刷新后直接回到游戏）。
    const emsg = String((error as { message?: string })?.message || error || '');
    if (/dynamically imported module|module script failed/i.test(emsg)) {
      const last = tsGet(CHUNK_TS);
      if (Date.now() - last > 20000) {
        tsSet(CHUNK_TS);
        setResumeFlag(PENDING_STARTED);
        location.reload();
        return { error: null };   // 即将刷新，不显示错误屏
      }
    }
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 若刚「重载回游戏」就又崩（<10s）→ 常驻渲染崩溃的死循环，改走安全模式（回主界面）
    let loop = false;
    const ts = tsGet(RESUME_TS); if (ts && Date.now() - ts < 10000) loop = true;
    if (loop) this.setState({ loop: true });
    console.error('[ErrorBoundary] 渲染崩溃：', error, info?.componentStack);
    reportCrash('boundary', error, { componentStack: String(info?.componentStack || '') });
  }

  resumeReload = () => {
    setResumeFlag(PENDING_STARTED); tsSet(RESUME_TS);
    location.reload();
  };
  safeReload = () => {
    clearResumeFlag(PENDING_STARTED); tsDel(RESUME_TS);
    location.reload();
  };
  copyErr = () => {
    const t = String(this.state.error?.stack || this.state.error?.message || this.state.error || '');
    const done = () => this.setState({ copied: true });
    try { navigator.clipboard?.writeText(t).then(done, done); } catch { done(); }
  };

  render() {
    if (!this.state.error) return this.props.children as React.ReactElement;
    const msg = String(this.state.error?.message || this.state.error || '未知错误');
    const loop = this.state.loop;
    const btn = (bg: string, brd: string, fg: string): React.CSSProperties => ({ flex: 1, padding: '10px 14px', borderRadius: 10, border: `1px solid ${brd}`, color: fg, background: bg, cursor: 'pointer', fontFamily: 'monospace', fontSize: 14 });
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e14', color: '#cbd5e1', fontFamily: 'monospace', padding: 24 }}>
        <div style={{ maxWidth: 540, width: '100%', border: '1px solid #1f2937', borderRadius: 16, padding: 24, background: '#0d1117', boxShadow: '0 0 60px rgba(0,0,0,0.8)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>⚠ 界面出错了（已拦截，未黑屏）</div>
          <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, marginBottom: 12 }}>
            某个组件渲染时抛了异常（多见于 AI 生成的物品/技能/角色数据缺字段）。<b style={{ color: '#cbd5e1' }}>你的存档没丢</b>（在本地 + 每回合自动存档），按下面恢复即可。
          </div>
          <div style={{ fontSize: 12, color: '#64748b', background: '#080b10', border: '1px solid #1f2937', borderRadius: 8, padding: 10, marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto' }}>
            {msg}
          </div>
          <button onClick={this.copyErr} style={{ ...btn('transparent', '#33415566', '#94a3b8'), width: '100%', flex: 'none', marginBottom: 12, fontSize: 12 }}>
            {this.state.copied ? '✓ 已复制报错（发给作者排查）' : '📋 复制报错文字'}
          </button>
          {loop ? (
            <>
              <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.7, marginBottom: 12 }}>
                回到游戏后又立刻崩了——可能是某条常驻数据（某个技能/装备/NPC）有问题。建议「回主界面」后用<b>「读取存档 → ⏱ 自动存档」</b>回到最近正常的回合，或进背包/角色面板删掉刚出问题的脏条目。
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={this.safeReload} style={btn('transparent', '#2dd4bf66', '#5eead4')}>↩ 回主界面（安全模式）</button>
                <button onClick={() => this.setState({ error: null })} style={btn('transparent', '#33415566', '#cbd5e1')}>↺ 尝试继续</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={this.resumeReload} style={btn('transparent', '#2dd4bf66', '#5eead4')}>⟳ 重新加载并回到游戏</button>
              <button onClick={() => this.setState({ error: null })} style={btn('transparent', '#33415566', '#cbd5e1')}>↺ 尝试继续（不刷新）</button>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#475569', marginTop: 12, lineHeight: 1.6 }}>
            提示：重新加载会回到你的游戏（存档不丢、弹窗自动关闭）；若反复在同一处崩，请「复制报错文字」发给作者定位。
          </div>
        </div>
      </div>
    );
  }
}
