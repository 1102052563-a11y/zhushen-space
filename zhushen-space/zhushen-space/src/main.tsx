import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// 陈旧部署兜底：vite 预加载动态 chunk 失败（旧版页面遇到新部署、旧 chunk 已 404）→ 静默刷新一次取最新版。
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  try {
    const last = Number(sessionStorage.getItem('zs-chunk-reload-ts') || 0);
    if (Date.now() - last > 20000) {
      sessionStorage.setItem('zs-chunk-reload-ts', String(Date.now()));
      sessionStorage.setItem('drpg-pending-started', '1');
      location.reload();
    }
  } catch { /* */ }
});

// 注册 PWA service worker：让"添加到主屏幕"以独立 App 窗口（隐藏地址栏）启动。
// 注册失败绝不影响游戏本身（仅退化为普通网页）。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 忽略注册失败 */ })
  })
}
