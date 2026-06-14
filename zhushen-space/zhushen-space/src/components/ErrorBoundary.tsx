import React from 'react';

/* 顶层错误边界：任何组件渲染时抛出的异常都被这里兜住，显示一个可恢复的提示，
   而不是让 React 卸载整棵树导致【整页黑屏】。
   常见诱因：AI 生成的物品/角色数据有脏字段（如某物品 tags/attrs 缺失）→ 渲染时崩。
   你的存档不会丢（都在 localStorage / IndexedDB），刷新即恢复。 */
interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 打到控制台，方便排查是哪条数据/哪个组件崩的
    console.error('[ErrorBoundary] 渲染崩溃：', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children as React.ReactElement;
    const msg = String(this.state.error?.message || this.state.error || '未知错误');
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e14', color: '#cbd5e1', fontFamily: 'monospace', padding: 24 }}>
        <div style={{ maxWidth: 540, width: '100%', border: '1px solid #1f2937', borderRadius: 16, padding: 24, background: '#0d1117', boxShadow: '0 0 60px rgba(0,0,0,0.8)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>⚠ 界面出错了（已拦截，未黑屏）</div>
          <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, marginBottom: 12 }}>
            某个组件渲染时抛了异常（多见于 AI 生成的物品/角色数据缺字段）。<b style={{ color: '#cbd5e1' }}>你的存档没丢</b>，点下面按钮即可恢复。
          </div>
          <div style={{ fontSize: 12, color: '#64748b', background: '#080b10', border: '1px solid #1f2937', borderRadius: 8, padding: 10, marginBottom: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto' }}>
            {msg}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => location.reload()}
              style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid #2dd4bf66', color: '#5eead4', background: 'transparent', cursor: 'pointer', fontFamily: 'monospace', fontSize: 14 }}>
              ⟳ 重新加载页面（推荐）
            </button>
            <button onClick={() => this.setState({ error: null })}
              style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid #33415566', color: '#cbd5e1', background: 'transparent', cursor: 'pointer', fontFamily: 'monospace', fontSize: 14 }}>
              ↺ 尝试继续（不刷新）
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 12, lineHeight: 1.6 }}>
            若“尝试继续”后又立刻报同样的错，说明触发它的弹窗/数据仍在，请用“重新加载页面”。
          </div>
        </div>
      </div>
    );
  }
}
