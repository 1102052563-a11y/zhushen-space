import { useMp } from '../store/multiplayerStore';

/* 巴卡尔攻坚战 · 通关「豪华」结算弹窗（奖励已在 App.onRelay 入账，本组件仅庆祝展示）。 */

const gradeColor = (g = '') => /红/.test(g) ? 'text-red-300 border-red-500/40 bg-red-950/30'
  : /橙|金/.test(g) ? 'text-amber-300 border-amber-500/40 bg-amber-950/30'
  : /紫/.test(g) ? 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-950/30'
  : /蓝/.test(g) ? 'text-sky-300 border-sky-500/40 bg-sky-950/30'
  : 'text-emerald-300 border-emerald-500/40 bg-emerald-950/30';
const catEmoji = (c = '') => /武器/.test(c) ? '⚔️' : /防具/.test(c) ? '🛡️' : /饰品/.test(c) ? '💍' : /宝石/.test(c) ? '💎' : /材料/.test(c) ? '🔩' : /宝箱/.test(c) ? '🎁' : '📦';
const fmt = (n: number) => Number(n || 0).toLocaleString();

export default function RaidDungeonReward() {
  const rw = useMp((s) => s.raidReward);
  if (!rw) return null;
  const close = () => useMp.getState()._set({ raidReward: null });
  const c = rw.currency || {};
  const coins = [
    { label: '乐园币', val: c['乐园币'], emoji: '🪙' },
    { label: '灵魂钱币', val: c['灵魂钱币'], emoji: '🔮' },
    { label: '技能点', val: c['技能点'], emoji: '📘' },
    { label: '黄金技能点', val: c['黄金技能点'], emoji: '📒' },
    { label: '潜能点', val: rw.potentialPoints, emoji: '🌟' },
  ];
  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-amber-500/40 bg-slate-950 shadow-2xl">
        <div className="text-center py-5 border-b border-amber-500/20 bg-gradient-to-b from-amber-950/30 to-transparent">
          <div className="text-amber-300/80 text-[13px]">{rw.emoji || '🐉'} {rw.themeName || '巴卡尔攻坚战'} · 通关结算{rw.difficultyLabel ? `（${rw.difficultyLabel}）` : ''}</div>
          <div className="text-6xl font-black text-amber-300 mt-1 leading-none" style={{ textShadow: '0 0 24px rgba(245,158,11,.55)' }}>{rw.rating}</div>
          <div className="text-[11px] text-amber-200/50 mt-1 tracking-[0.3em]">通关评级</div>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {coins.map((x) => (
              <div key={x.label} className="rounded-xl border border-amber-500/20 bg-amber-950/15 px-3 py-2">
                <div className="text-[11px] text-amber-200/60">{x.emoji} {x.label}</div>
                <div className="text-amber-200 font-bold text-lg tabular-nums">+{fmt(x.val)}</div>
              </div>
            ))}
          </div>
          {rw.title && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-950/25 px-3 py-2 flex items-center gap-2">
              <span className="text-2xl shrink-0">🏆</span>
              <div className="min-w-0">
                <div className="text-amber-200 font-bold text-[14px] truncate">称号「{rw.title.name}」</div>
                <div className="text-[11px] text-amber-200/60 truncate">{rw.title.effect}</div>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="text-[12px] text-slate-400">🎁 战利品（{(rw.items || []).length} 件 · 全员均得）</div>
            {(rw.items || []).map((it: any) => (
              <div key={it.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${gradeColor(it.gradeDesc)}`}>
                <span className="text-lg shrink-0">{catEmoji(it.category)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{it.name}{it.quantity > 1 ? ` ×${it.quantity}` : ''}</div>
                  <div className="text-[11px] opacity-70 truncate">{it.gradeDesc} · {it.effect}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-4 border-t border-amber-500/20">
          <button onClick={close} className="w-full py-2.5 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-100 font-bold hover:bg-amber-500/30 transition-colors">✨ 已收入囊中</button>
        </div>
      </div>
    </div>
  );
}
