import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import DomI18n from './i18n/DomI18n'
import { setResumeFlag } from './systems/resumeFlag'
import { migrateCompressLegacy, COMPRESSED_KEYS } from './systems/compressedStorage'
import './index.css'

// 启动即把旧·未压缩的大 store 就地压缩，立即释放 localStorage 配额（长档曾顶满 5MB 致写入失败）。
// 纯 localStorage 操作、静默容错，不阻塞、不影响已 hydrate 的内存态（见 compressedStorage / localstorage-compression-stores）。
migrateCompressLegacy(COMPRESSED_KEYS)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    {/* 运行时翻译层：只译界面 chrome（繁體 OpenCC / 英文人工词库），不动 AI 正文；简体时零开销 */}
    <DomI18n />
  </React.StrictMode>,
)

// 陈旧部署兜底：vite 预加载动态 chunk 失败（旧版页面遇到新部署、旧 chunk 已 404）→ 静默刷新一次取最新版。
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  try {
    // 循环守卫 + 续玩标志都用 localStorage：跨 location.reload() 稳定存活（手机/PWA 下 sessionStorage 会丢）
    const last = Number(localStorage.getItem('zs-chunk-reload-ts') || 0);
    if (Date.now() - last > 20000) {
      localStorage.setItem('zs-chunk-reload-ts', String(Date.now()));
      setResumeFlag('drpg-pending-started');
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
