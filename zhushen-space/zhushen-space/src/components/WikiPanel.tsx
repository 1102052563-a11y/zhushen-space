import { useState } from 'react';

/* 轮回WIKI：内置《轮回乐园》世界观百科（Material for MkDocs 静态站，构建到 public/wiki/）。
   全屏模态 + iframe 加载 /wiki/index.html —— 纯本地静态资源（含 jieba 搜索/侧栏/主题），离线可用，不发网络请求。
   与右栏「世界百科」（游戏内 AI 现生情报）区分：这是逐章考据的固定 wiki。 */
export default function WikiPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  return (
    <div className="fixed inset-0 z-[120] bg-void flex flex-col">
      {/* 顶栏：手机端缩短标题、放大点击区(min 40px)、避让刘海(safe-area) */}
      <div
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 border-b border-edge bg-panel"
        style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))', paddingBottom: '0.375rem' }}
      >
        <span className="text-god/80 text-base shrink-0 pl-1">📚</span>
        <span className="text-sm font-semibold text-slate-100 truncate">
          轮回WIKI<span className="hidden sm:inline text-dim font-normal"> · 世界观百科</span>
        </span>
        <a
          href="/wiki/index.html"
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 flex items-center justify-center min-w-[40px] h-9 px-2 rounded-lg text-dim hover:text-slate-200 hover:bg-panel2 transition-colors"
          title="在新标签页打开"
        >
          <span className="hidden sm:inline text-xs">↗ 新窗口</span>
          <span className="sm:hidden text-base leading-none">↗</span>
        </a>
        <button
          onClick={onClose}
          className="shrink-0 flex items-center justify-center min-w-[40px] h-9 px-2 rounded-lg text-lg leading-none text-dim hover:text-slate-200 hover:bg-panel2 transition-colors"
          title="关闭"
        >
          ✕
        </button>
      </div>
      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-dim text-sm">
            加载百科中…
          </div>
        )}
        <iframe
          src="/wiki/index.html"
          title="轮回WIKI"
          className="w-full h-full border-0"
          /* 深色底：切页瞬间的空白用深色兜底，杜绝「耀眼白屏」（与暗色 app + slate wiki 一致）。
             真正的无闪屏靠 MkDocs navigation.instant（线上 pages.dev 生效，见 mkdocs.yml）。 */
          style={{ WebkitOverflowScrolling: 'touch', backgroundColor: '#1b1c22' }}
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}
