import { useSettings } from '../store/settingsStore';

/* 接口路由选择：从「综合设置 → API 接口库」勾选多条接口，按优先级（上=先调用）轮流调用、
   失败自动 fallback。留空则回退到该功能下方的「单独配置 / 共用 API」。
   routeKey 为功能键（text/world/item/player/npc/faction/territory/team/misc/memory/nm）。 */
export default function ApiRoutePicker({ routeKey, className = '' }: { routeKey: string; className?: string }) {
  const library = useSettings((s) => s.apiLibrary);
  const routes = useSettings((s) => s.apiRoutes);
  const setApiRoute = useSettings((s) => s.setApiRoute);

  const lib = library ?? [];
  const route = routes?.[routeKey] ?? [];
  const inRoute = route.map((id) => lib.find((e) => e.id === id)).filter(Boolean) as typeof lib;
  const available = lib.filter((e) => !route.includes(e.id));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= route.length) return;
    const next = [...route];
    [next[i], next[j]] = [next[j], next[i]];
    setApiRoute(routeKey, next);
  };
  const remove = (id: string) => setApiRoute(routeKey, route.filter((x) => x !== id));
  const add = (id: string) => { if (id) setApiRoute(routeKey, [...route, id]); };

  if (lib.length === 0) {
    return <div className={`text-[12px] font-mono text-dim/40 ${className}`}>接口库为空 —— 在「综合设置 → API 接口库」添加后，可在此勾选多条接口轮流调用。</div>;
  }

  return (
    <div className={`rounded-lg border border-god/25 bg-god/5 p-2.5 space-y-2 ${className}`}>
      <div className="text-[12px] font-mono text-god/70">⚡ 接口路由（多选·按优先级轮流调用，上面的先调用，失败自动切下一条）</div>

      {inRoute.length === 0 ? (
        <div className="text-[12px] text-dim/45 font-mono">未选接口 —— 当前用下方「单独配置 / 共用 API」。从下拉添加可启用多接口轮流。</div>
      ) : (
        <div className="space-y-1">
          {inRoute.map((ep, i) => (
            <div key={ep.id} className="flex items-center gap-1.5 px-2 py-1 rounded border border-edge bg-void/60">
              <span className="text-[11px] font-mono text-amber-300/70 w-5 shrink-0">#{i + 1}</span>
              <span className="flex-1 min-w-0 truncate text-[12px] text-slate-200">{ep.name} <span className="text-dim/50">· {ep.modelId || '未设模型'}</span>{!ep.enabled && <span className="text-blood/70 ml-1">（已禁用）</span>}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-dim/50 hover:text-god disabled:opacity-20 px-0.5 shrink-0">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === inRoute.length - 1} className="text-dim/50 hover:text-god disabled:opacity-20 px-0.5 shrink-0">↓</button>
              <button onClick={() => remove(ep.id)} className="text-dim/40 hover:text-blood px-0.5 shrink-0">✕</button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <select value="" onChange={(e) => { add(e.target.value); e.target.value = ''; }}
          className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] font-mono text-slate-300 outline-none focus:border-god">
          <option value="">+ 添加接口到路由…</option>
          {available.map((ep) => <option key={ep.id} value={ep.id}>{ep.name} · {ep.modelId || '未设模型'}{ep.enabled ? '' : '（已禁用）'}</option>)}
        </select>
      )}
    </div>
  );
}
