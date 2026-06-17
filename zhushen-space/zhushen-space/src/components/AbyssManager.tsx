import { useAbyss } from '../store/abyssStore';
import { ABYSS_TUNING } from '../systems/abyssEngine';
import ApiRoutePicker from './ApiRoutePicker';

/* 深渊地牢设置页（变量管理 → 🕳深渊）：API 路由（加成卡/原罪物/觉醒/裁判剧情局的 AI 配文）+ 调参（门票/死亡保留）+ 重置。
   进度总览在玩法面板（右导航 🕳深渊）顶部展示，不在此页。
   提示词为代码注入（systems/abyssPrompts.ts 的 ABYSS_*_RULE），改即生效，无需在此配置；数值绝大多数在 systems/abyssEngine.ts 的 ABYSS_TUNING。 */
export default function AbyssManager() {
  const config = useAbyss((s) => s.config);
  const setConfig = useAbyss((s) => s.setConfig);
  const clearAbyss = useAbyss((s) => s.clearAbyss);

  const card = 'rounded-lg border border-edge bg-panel/60 p-4';

  return (
    <div className="space-y-4 max-w-2xl mx-auto text-slate-300">
      <div className={card}>
        <div className="text-xs leading-relaxed">
          入口在右侧导航「🕳深渊」。<b className="text-god/80">仅主神空间（轮回乐园）内开启</b>。多层地牢 roguelike：下探五险地（黑渊→界之底）、用腐蚀换力、夺取原罪物。
          <br />掉落/腐蚀/战斗/觉醒全前端确定性（副本沙盒，<b className="text-god/80">加成/腐蚀绝不外泄</b>，仅战利品/称号/结晶经结算带出）；需 AI 的环节（加成卡组合·原罪物文案·觉醒词缀·裁判剧情）走下方集成路由。提示词为代码注入（<span className="font-mono text-dim">abyssPrompts.ts</span>），改即生效。
        </div>
      </div>

      {/* API 路由 */}
      <div className={card}>
        <div className="text-sm font-bold text-slate-200 mb-2">🕳 深渊 AI 接口（集成路由）</div>
        <ApiRoutePicker routeKey="abyss" />
        <div className="mt-2 text-[11px] text-dim/70 leading-relaxed">
          从「综合设置 → API 接口库」勾选接口走<b className="text-god/70">集成路由</b>（多选按优先级轮流、失败自动 fallback）。<b className="text-god/70">不配置则默认复用正文 API</b>。用于：战后加成卡生成、随机原罪物/原罪武器配文、觉醒词缀、深渊裁判剧情局。
          <br /><b className="text-god/70">铁则</b>：AI 只挑效果原语 + 写文案，<b className="text-god/70">真实数值全前端确定</b>；无 key 时全部走前端种子兜底，功能不锁死。
        </div>
      </div>

      {/* 调参 */}
      <div className={`${card} space-y-3`}>
        <div className="text-sm font-bold text-slate-200">调参</div>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-dim">门票（乐园币）</span>
          <input type="number" min={0} max={100000} value={config.ticketCost}
            onChange={(e) => setConfig({ ticketCost: Math.max(0, +e.target.value || 0) })}
            className="w-28 px-2 py-1 rounded-lg bg-void border border-edge text-amber-200 font-mono text-right" />
          <span className="flex-1 text-[11px] text-dim/60">开一局深渊消耗的乐园币</span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-dim">死亡保留</span>
          <input type="range" min={0} max={1} step={0.05} value={config.deathRetain}
            onChange={(e) => setConfig({ deathRetain: +e.target.value })} className="flex-1" />
          <span className="w-12 text-right font-mono text-amber-300">{Math.round(config.deathRetain * 100)}%</span>
          <span className="w-40 shrink-0 text-[11px] text-dim/60">队伍全灭时未带出战利品的保留比例（撤退/通关恒全额）</span>
        </label>
        <div className="text-[11px] text-dim/60 leading-relaxed pt-1 border-t border-edge/50">
          其余数值（腐蚀阈值 {ABYSS_TUNING.corruptThresholds.join('/')}、失控率、每 {ABYSS_TUNING.awakenEveryClears} 通关 1 觉醒、层数 {ABYSS_TUNING.floorsPerZone}/险地…）在 <span className="font-mono">systems/abyssEngine.ts · ABYSS_TUNING</span> 调整。
        </div>
      </div>

      {/* 危险操作 */}
      <div className={card}>
        <div className="text-sm font-bold text-rose-300 mb-2">⚠ 重置</div>
        <button
          onClick={() => { if (confirm('确定重置深渊？将清空进行中的局 + 全部 meta（结晶/通关/觉醒充能/卡牌库/图鉴/星图/险地解锁）。门票/死亡保留等设置保留。此操作不可撤销。')) clearAbyss(); }}
          className="px-4 py-1.5 rounded-lg bg-rose-900/40 border border-rose-700/50 text-rose-200 text-sm hover:bg-rose-900/60"
        >
          重置深渊（清进度 + meta）
        </button>
        <div className="mt-2 text-[11px] text-dim/60">仅清深渊自身进度；不影响主线背包里已带出的原罪物/装备/称号。</div>
      </div>
    </div>
  );
}
