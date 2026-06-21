import { useState } from 'react';

/* 轮回WIKI：内置《轮回乐园》世界观百科（Material for MkDocs 静态站，构建到 public/wiki/）。
   全屏模态 + iframe 加载 /wiki/index.html —— 纯本地静态资源（含 jieba 搜索/侧栏/主题），离线可用，不发网络请求。
   与右栏「世界百科」（游戏内 AI 现生情报）区分：这是逐章考据的固定 wiki。 */
export default function WikiPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  return (
    <div className="fixed inset-0 z-[120] bg-void flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-edge bg-panel">
        <span className="text-god/80 text-base">📚</span>
        <span className="text-sm font-semibold text-slate-100">轮回WIKI · 世界观百科</span>
        <a
          href="/wiki/index.html"
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs text-dim hover:text-slate-200 transition-colors"
          title="在新标签页打开"
        >
          ↗ 新窗口
        </a>
        <button
          onClick={onClose}
          className="text-dim hover:text-slate-200 transition-colors text-lg leading-none px-1"
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
          className="w-full h-full border-0 bg-white"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}
