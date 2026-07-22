// 崩溃自动上报（作者黑匣子）：线上玩家的渲染崩溃/未捕获异常自动 POST 到同源
// Pages Function `/crash-report`（functions/crash-report.js → R2 桶 crash-reports/ 前缀），
// 作者 GET 同一地址即可看最近记录——不再依赖玩家手动「复制报错发给作者」。
// 纪律：本模块自身绝不允许抛错/阻塞游戏；上报失败静默吞掉。
import { APP_VERSION } from '../version';

const ENDPOINT = '/crash-report';
const SIG_KEY = 'zs-crash-sig';            // localStorage：{ 签名: 上次上报 ts }，跨刷新去重
const DEDUP_MS = 10 * 60 * 1000;           // 同一错误 10 分钟内只报一次
const SESSION_CAP = 8;                     // 每次会话最多上报条数（防崩溃风暴刷爆）
let sessionCount = 0;

// 本地开发不上报（没有同源 Function，且 dev 崩溃在控制台可见）
const isLocalDev = (): boolean => /^(localhost|127\.|192\.168\.|0\.0\.0\.0)/.test(location.hostname);

// 陈旧部署的 chunk 404 有专门的静默刷新自愈（main.tsx / ErrorBoundary），不是 bug，不上报
const isStaleChunk = (msg: string): boolean =>
  /dynamically imported module|module script failed|Loading chunk|Importing a module script/i.test(msg);

function dedup(sig: string): boolean {
  try {
    const now = Date.now();
    const map: Record<string, number> = JSON.parse(localStorage.getItem(SIG_KEY) || '{}');
    for (const k in map) if (now - map[k] > DEDUP_MS) delete map[k];   // 顺手清过期
    if (map[sig] && now - map[sig] < DEDUP_MS) return true;
    map[sig] = now;
    localStorage.setItem(SIG_KEY, JSON.stringify(map));
  } catch { /* localStorage 满/禁用：放行（宁多报勿漏报） */ }
  return false;
}

export function reportCrash(kind: string, error: unknown, extra?: { componentStack?: string }): void {
  try {
    const err = error as { message?: string; stack?: string } | null | undefined;
    const msg = String(err?.message || error || '').slice(0, 600);
    if (!msg || isStaleChunk(msg)) return;
    if (sessionCount >= SESSION_CAP) return;
    if (dedup(`${kind}|${msg.slice(0, 160)}`)) return;
    sessionCount++;
    const payload = {
      kind,
      msg,
      stack: String(err?.stack || '').slice(0, 5000),
      componentStack: String(extra?.componentStack || '').slice(0, 4000),
      path: location.pathname + location.hash,   // 不带 query（避免把无关参数带上去）
      ua: navigator.userAgent.slice(0, 220),
      version: APP_VERSION,
      lang: navigator.language,
      ts: new Date().toISOString(),
    };
    if (isLocalDev()) { console.warn('[crashReport] dev 环境不上报，仅打印：', payload); return; }
    // keepalive：页面即将卸载也尽量把报文送出去；失败静默
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* 静默 */ });
  } catch { /* 上报自身绝不抛错 */ }
}

// 全局兜网：ErrorBoundary 只接得住「渲染期」异常；事件回调/Promise 里的异常走这两个钩子。
export function installGlobalCrashReporter(): void {
  window.addEventListener('error', (e: ErrorEvent) => {
    if (!e?.error && !e?.message) return;                       // 资源加载错等无信息事件
    if (String(e.message || '').includes('Script error')) return; // 跨域脚本无堆栈，纯噪音
    reportCrash('window.onerror', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    reportCrash('unhandledrejection', e?.reason);
  });
}
