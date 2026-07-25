import { useState } from 'react';

/* 原著WIKI：内置的两部原著世界观百科（均为 Material for MkDocs 静态站，由 vite 插件 build-wiki 构建到 public/ 下）。
   点开先选书 → 全屏模态 + iframe 加载对应站 —— 纯本地静态资源（含 jieba 搜索/侧栏/主题），离线可用，不发网络请求。
   与右栏「世界百科」（游戏内 AI 现生情报）区分：这是逐章考据的固定 wiki。
   新增一本书：这里加一项 + vite.config.ts 的 WIKIS 加一项（两处的产物目录必须对得上）。 */

type WikiSite = {
  key: string;
  name: string;
  book: string;
  icon: string;
  url: string;
  desc: string;
  accent: string;   // 用内联样式而非 tailwind 动态类名——动态拼接的类名不会被 Tailwind 扫描到、会被裁掉
};

const SITES: WikiSite[] = [
  {
    key: 'lunhui',
    name: '轮回乐园百科',
    book: '《轮回乐园》',
    icon: '🌀',
    url: '/wiki/index.html',
    desc: '本游戏的世界观出处。阶位 · 天赋 · 技能体系 · 任务世界 · 契约者与随从',
    accent: '#22d3ee',
  },
  {
    key: 'shenmi',
    name: '神秘复苏百科',
    book: '《神秘复苏》',
    icon: '👁',
    url: '/wiki-shenmi/index.html',
    desc: '都市灵异。厉鬼分级 · 亡魂道路 · 驾驭者 · 鬼物与凶宅',
    accent: '#2dd4bf',
  },
];

export default function WikiPanel({ onClose }: { onClose: () => void }) {
  const [site, setSite] = useState<WikiSite | null>(null);
  const [loading, setLoading] = useState(true);

  const enter = (s: WikiSite) => { setLoading(true); setSite(s); };

  return (
    <div className="fixed inset-0 z-[120] bg-void flex flex-col">
      {/* 顶栏：手机端缩短标题、放大点击区(min 40px)、避让刘海(safe-area) */}
      <div
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 border-b border-edge bg-panel"
        style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))', paddingBottom: '0.375rem' }}
      >
        {site ? (
          <button
            onClick={() => setSite(null)}
            className="shrink-0 flex items-center justify-center min-w-[40px] h-9 px-2 rounded-lg text-dim hover:text-slate-200 hover:bg-panel2 transition-colors"
            title="返回选择百科"
          >
            <span className="hidden sm:inline text-xs">← 换一本</span>
            <span className="sm:hidden text-base leading-none">←</span>
          </button>
        ) : (
          <span className="text-god/80 text-base shrink-0 pl-1">📚</span>
        )}
        <span className="text-sm font-semibold text-slate-100 truncate">
          {site ? (
            <>
              {site.name}
              <span className="hidden sm:inline text-dim font-normal"> · {site.book}</span>
            </>
          ) : (
            <>
              原著WIKI<span className="hidden sm:inline text-dim font-normal"> · 选择百科</span>
            </>
          )}
        </span>
        {site && (
          <a
            href={site.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 flex items-center justify-center min-w-[40px] h-9 px-2 rounded-lg text-dim hover:text-slate-200 hover:bg-panel2 transition-colors"
            title="在新标签页打开"
          >
            <span className="hidden sm:inline text-xs">↗ 新窗口</span>
            <span className="sm:hidden text-base leading-none">↗</span>
          </a>
        )}
        <button
          onClick={onClose}
          className={`shrink-0 flex items-center justify-center min-w-[40px] h-9 px-2 rounded-lg text-lg leading-none text-dim hover:text-slate-200 hover:bg-panel2 transition-colors${site ? '' : ' ml-auto'}`}
          title="关闭"
        >
          ✕
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        {site ? (
          <>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-dim text-sm">
                加载百科中…
              </div>
            )}
            <iframe
              key={site.key}                 /* 换书时强制重建 iframe，避免残留上一站的历史栈 */
              src={site.url}
              title={site.name}
              className="w-full h-full border-0"
              /* 深色底：切页瞬间的空白用深色兜底，杜绝「耀眼白屏」（与暗色 app + slate wiki 一致）。
                 真正的无闪屏靠 MkDocs navigation.instant（线上 pages.dev 生效，见各 mkdocs.yml）。 */
              style={{ WebkitOverflowScrolling: 'touch', backgroundColor: '#1b1c22' }}
              onLoad={() => setLoading(false)}
            />
          </>
        ) : (
          <div className="absolute inset-0 overflow-y-auto px-4 py-8 sm:py-12">
            <div className="mx-auto w-full max-w-3xl">
              <div className="text-center mb-6 sm:mb-8">
                <div className="text-slate-100 text-lg sm:text-xl font-semibold">选择要查阅的原著百科</div>
                <div className="text-dim text-xs sm:text-sm mt-1.5">逐章考据 · 忠于原著 · 全部离线内置</div>
              </div>
              <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                {SITES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => enter(s)}
                    className="group text-left rounded-xl border border-edge bg-panel hover:bg-panel2 p-4 sm:p-5 transition-colors focus:outline-none focus-visible:ring-2"
                    style={{ ['--tw-ring-color' as string]: s.accent }}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg text-xl"
                        style={{ backgroundColor: `${s.accent}1f`, color: s.accent }}
                      >
                        {s.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="text-slate-100 font-semibold truncate">{s.name}</div>
                        <div className="text-dim text-[11px] truncate">{s.book}</div>
                      </div>
                    </div>
                    <div className="text-dim text-xs leading-relaxed mt-3">{s.desc}</div>
                    <div
                      className="text-[11px] mt-3 opacity-70 group-hover:opacity-100 transition-opacity"
                      style={{ color: s.accent }}
                    >
                      进入 →
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
