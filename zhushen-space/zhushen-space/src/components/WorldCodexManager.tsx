import { useWorldCodex } from '../store/worldCodexStore';
import { CODEX_MODULES } from '../worldCodexModules';
import ApiRoutePicker from './ApiRoutePicker';

/* 世界百科设置：启用开关 + 专用 API 路由（建议路由到支持联网/Google 搜索的接口）。
   提示词模块定义在 src/worldCodexModules.ts（改即生效），此处只读展示。 */
export default function WorldCodexManager() {
  const enabled = useWorldCodex((s) => s.enabled);
  const setEnabled = useWorldCodex((s) => s.setEnabled);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-100">📖 世界百科</h2>
        <p className="text-sm text-dim/70 mt-1.5 leading-relaxed">
          为玩家进入的「同人任务世界」联网考据原著情报：世界设定、主线剧情（含结局）、隐藏伏笔、世界至宝、人物生平。
          纯参考阅读，<b className="text-slate-300">不会注入正文</b>。入口在右侧导航「📖 世界百科」，仅任务世界可用（乐园本体置灰）。
        </p>
      </div>

      {/* 启用 */}
      <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-edge bg-panel/40 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-indigo-400 w-4 h-4" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-200">启用世界百科</div>
          <div className="text-[12px] text-dim/55">关闭后面板入口提示去开启，不影响已生成的缓存。</div>
        </div>
      </label>

      {/* API 路由 */}
      <div className="space-y-2">
        <div className="text-sm font-semibold text-slate-200">检索接口</div>
        <div className="text-[12px] text-dim/55 leading-relaxed">
          强烈建议为本功能单独路由到「支持联网 / Google 搜索」的接口（百科靠搜索锁定原著正史）。
          未配置则回退到正文 API。
        </div>
        <ApiRoutePicker routeKey="codex" />
      </div>

      {/* 模块清单（只读） */}
      <div className="space-y-2">
        <div className="text-sm font-semibold text-slate-200">情报条目</div>
        <div className="text-[12px] text-dim/55">提示词在 <code className="text-dim/80">src/worldCodexModules.ts</code>，改即生效。</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CODEX_MODULES.map((m) => (
            <div key={m.key} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-edge bg-panel/30">
              <span className="text-base">{m.icon}</span>
              <span className="text-sm text-slate-200">{m.title}</span>
              <span className="text-[10px] font-mono text-dim/40 ml-auto">{m.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
