import { useCasino } from '../store/casinoStore';
import ApiRoutePicker from './ApiRoutePicker';

/* 赌坊设置页（变量管理 → 🎰赌场）：API 路由（角斗场/福袋奖励/荷官吐槽/魂赌等需 AI 的环节）+ 调参（限红/抽水/胜率/福袋花费）。
   各玩法提示词为代码注入（promptRules.ts 的 GLADIATOR_* / GACHA_REWARD_RULE / CASINO_BANTER_RULE 等），改即生效，无需在此配置。 */
export default function CasinoManager() {
  const config = useCasino((s) => s.config);
  const setConfig = useCasino((s) => s.setConfig);
  const stats = useCasino((s) => s.stats);

  const card = 'rounded-lg border border-edge bg-panel/60 p-4';
  const num = (v: number) => (Number.isFinite(v) ? v : 0);
  const pctRow = (label: string, key: 'exchangeFeePct' | 'cashoutFeePct' | 'ladderWinChance', hint: string) => (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-dim">{label}</span>
      <input type="range" min={key === 'ladderWinChance' ? 0.3 : 0} max={key === 'ladderWinChance' ? 0.5 : 0.2} step={0.01}
        value={num((config as any)[key])} onChange={(e) => setConfig({ [key]: +e.target.value } as any)} className="flex-1" />
      <span className="w-12 text-right font-mono text-amber-300">{Math.round(num((config as any)[key]) * 100)}%</span>
      <span className="w-40 shrink-0 text-[11px] text-dim/60">{hint}</span>
    </label>
  );
  const intRow = (label: string, key: 'vipMinTier' | 'gachaCostSoul' | 'bankruptcyGrant', min: number, max: number, hint: string) => (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-dim">{label}</span>
      <input type="number" min={min} max={max} value={num((config as any)[key])}
        onChange={(e) => setConfig({ [key]: Math.max(min, Math.min(max, +e.target.value || 0)) } as any)}
        className="w-24 px-2 py-1 rounded-lg bg-void border border-edge text-amber-200 font-mono text-right" />
      <span className="flex-1 text-[11px] text-dim/60">{hint}</span>
    </label>
  );

  return (
    <div className="space-y-4 max-w-2xl mx-auto text-slate-300">
      <div className={card}>
        <div className="text-xs leading-relaxed">
          入口在右侧导航「🎰赌场」。<b className="text-god/80">仅主神空间（轮回乐园）内营业</b>。5 速战/策略玩法（猜大小·转盘·21点·翻倍梯子·角斗场）+ 命运福袋扭蛋；普通厅用乐园币、<b className="text-god/80">五阶起</b>开魂币贵宾厅。
          <br />赔率/摇率/保底全前端确定性；需 AI 的环节（角斗场两角斗士与战斗、福袋物品、荷官吐槽）走下方 API 路由。提示词为代码注入（<span className="font-mono text-dim">promptRules.ts</span>），改即生效。
        </div>
        <div className="mt-2 text-[11px] text-dim">总局数 {stats.hands} · 累计赢 {stats.won} / 输 {stats.lost} · 最大单局 {stats.biggestWin}</div>
      </div>

      {/* API 路由 */}
      <div className={card}>
        <div className="text-sm font-bold text-slate-200 mb-2">🎰 赌坊 AI 接口（集成路由）</div>
        <ApiRoutePicker routeKey="casino" />
        <div className="mt-2 text-[11px] text-dim/70 leading-relaxed">
          从「综合设置 → API 接口库」勾选接口走<b className="text-god/70">集成路由</b>（多选按优先级轮流、失败自动 fallback）。<b className="text-god/70">不配置则默认复用正文 API</b>。用于：角斗场角斗士/战斗生成、命运福袋物品生成、荷官吐槽（及后续魂赌剧情局）。
        </div>
      </div>

      {/* 调参 */}
      <div className={`${card} space-y-3`}>
        <div className="text-sm font-bold text-slate-200">调参</div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ enabled: e.target.checked })} />
          <span>启用赌坊</span>
        </label>
        {pctRow('买筹码抽水', 'exchangeFeePct', '乐园币→筹码的损耗')}
        {pctRow('兑现抽水', 'cashoutFeePct', '筹码→乐园币的损耗')}
        {pctRow('翻倍梯子胜率', 'ladderWinChance', '<50% 即庄家优势')}
        {intRow('贵宾厅阶位', 'vipMinTier', 1, 13, '魂币贵宾厅解锁阶位（默认 5=五阶）')}
        {intRow('福袋单抽花费', 'gachaCostSoul', 1, 100, '命运福袋单抽魂币数（十连 ×10）')}
        {intRow('破产补发', 'bankruptcyGrant', 0, 10000, '筹码归零时补发的普通筹码')}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <label className="flex items-center gap-2 text-[12px]"><span className="w-20 text-dim shrink-0">普通厅限红</span>
            <input type="number" value={config.limits.normalMin} onChange={(e) => setConfig({ limits: { ...config.limits, normalMin: Math.max(1, +e.target.value || 1) } })} className="w-16 px-1 py-0.5 rounded bg-void border border-edge font-mono text-right text-amber-200" />
            <span className="text-dim">~</span>
            <input type="number" value={config.limits.normalMax} onChange={(e) => setConfig({ limits: { ...config.limits, normalMax: Math.max(10, +e.target.value || 10) } })} className="w-20 px-1 py-0.5 rounded bg-void border border-edge font-mono text-right text-amber-200" />
          </label>
          <label className="flex items-center gap-2 text-[12px]"><span className="w-20 text-dim shrink-0">贵宾厅限红</span>
            <input type="number" value={config.limits.soulMin} onChange={(e) => setConfig({ limits: { ...config.limits, soulMin: Math.max(1, +e.target.value || 1) } })} className="w-16 px-1 py-0.5 rounded bg-void border border-edge font-mono text-right text-amber-200" />
            <span className="text-dim">~</span>
            <input type="number" value={config.limits.soulMax} onChange={(e) => setConfig({ limits: { ...config.limits, soulMax: Math.max(10, +e.target.value || 10) } })} className="w-20 px-1 py-0.5 rounded bg-void border border-edge font-mono text-right text-amber-200" />
          </label>
        </div>
      </div>
    </div>
  );
}
