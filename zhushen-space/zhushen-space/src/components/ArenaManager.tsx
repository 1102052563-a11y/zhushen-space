import { useArena } from '../store/arenaStore';
import ApiRoutePicker from './ApiRoutePicker';

/* 竞技场设置页（变量管理 → 🏟竞技场）：开关 + 独立 API（集成路由）。
   榜单/对手/奖励提示词是代码注入（promptRules.ts 的 ARENA_*），改即生效，无需在此配置。 */

export default function ArenaManager() {
  const config = useArena((s) => s.config);
  const setConfig = useArena((s) => s.setConfig);
  const useShared = useArena((s) => s.arenaUseSharedApi);
  const setUseShared = useArena((s) => s.setArenaUseSharedApi);
  const ladders = useArena((s) => s.ladders);
  const defeated = useArena((s) => s.defeated);

  const card = 'rounded-lg border border-edge bg-panel/60 p-4';

  return (
    <div className="space-y-4 max-w-2xl mx-auto text-slate-300">
      {/* 说明 */}
      <div className={card}>
        <div className="text-xs text-slate-300 leading-relaxed">
          入口在右侧导航「🏟竞技场」。<b className="text-god/80">仅在乐园（枢纽）内可用</b>，任务世界中不可进入。<b className="text-god/80">一阶起</b>即有「本阶竞技场」；五阶起开「强者争霸战」（六阶需竞技场前50名资格）；七阶+ 进「树之竞技场」。
          挑战会先生成对手面板（装备≥6/技能·天赋各≥4）再进入战斗，胜利取代被挑战者名次、前100名发放奖励入背包。
          <br />榜单/对手/奖励的提示词为代码注入（<span className="font-mono text-dim">promptRules.ts</span> 的 <span className="font-mono text-dim">ARENA_*</span>），改即生效，无需在此配置。
        </div>
        <div className="mt-2 text-[11px] text-dim">已缓存榜单 {Object.keys(ladders).length} 个 · 击败记录 {defeated.length} 条</div>
      </div>

      {/* 开关 */}
      <div className={`${card} flex items-center gap-2`}>
        <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ enabled: e.target.checked })} />
        <span className="text-sm">启用竞技场（关闭后面板提示「已停用」，导航按钮仍在）</span>
      </div>

      {/* API（集成路由） */}
      <div className={card}>
        <ApiRoutePicker routeKey="arena" />
        <div className="mt-2 text-[11px] text-dim">
          从「综合设置 → API 接口库」勾选接口走<b className="text-god/70">集成路由</b>（多选按优先级轮流、失败自动 fallback）。留空则回退正文 API。
        </div>
      </div>
    </div>
  );
}
