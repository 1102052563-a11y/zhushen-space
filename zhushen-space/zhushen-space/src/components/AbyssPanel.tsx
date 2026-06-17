import { useMemo } from 'react';
import { useAbyss } from '../store/abyssStore';
import { useItems } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { ABYSS_TUNING } from '../systems/abyssEngine';
import type { RoomType } from '../systems/abyssEngine';

/* 深渊地牢面板（M1）——仅主神空间。线性多层地牢 + 自动战斗 + 战后三选一。
   设计见 指导/深渊地牢-堕落流-设计.md。 */

const ROOM_ICON: Record<RoomType, string> = {
  entry: '🚪', battle: '⚔', elite: '💀', boss: '👑', event: '❓',
  rest: '🔥', treasure: '💎', beacon: '🌀', sin: '🩸',
};

function isHome(name?: string): boolean {
  return /轮回乐园|专属房间|主神空间/.test(name ?? '');
}

export default function AbyssPanel({ onClose }: { onClose: () => void }) {
  const run = useAbyss((s) => s.run);
  const meta = useAbyss((s) => s.meta);
  const lastSettle = useAbyss((s) => s.lastSettle);
  const start = useAbyss((s) => s.start);
  const enter = useAbyss((s) => s.enter);
  const chooseBoon = useAbyss((s) => s.chooseBoon);
  const retreat = useAbyss((s) => s.retreat);
  const ackDeath = useAbyss((s) => s.ackDeath);
  const ackClear = useAbyss((s) => s.ackClear);
  const clearLastSettle = useAbyss((s) => s.clearLastSettle);

  const coins = useItems((s) => s.currency.乐园币);
  const worldName = useMisc((s) => s.worldName);
  const home = isHome(worldName);

  const hero = run?.party[0];
  const fallPct = useMemo(() => {
    if (!run) return 0;
    const th = ABYSS_TUNING.corruptThresholds;
    const lv = run.fallLevel;
    const lo = th[lv] ?? 0;
    const hi = th[lv + 1] ?? lo + 50;
    return Math.max(0, Math.min(100, ((run.corruption - lo) / Math.max(1, hi - lo)) * 100));
  }, [run]);

  const room = run ? run.map.rooms[run.posIdx] : null;
  const atLast = run ? run.posIdx >= run.map.rooms.length - 1 : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl border border-violet-700/40 bg-[#0d0a14] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-violet-800/40 bg-[#0d0a14]/95 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-lg">🕳</span>
            <h2 className="text-base font-semibold text-violet-200">深渊地牢 · 堕落流</h2>
            <span className="text-[10px] text-violet-400/60">M1 · 黑渊</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-sm px-2">✕</button>
        </div>

        {/* meta 条 */}
        <div className="grid grid-cols-4 gap-px bg-violet-900/20 text-center text-[11px]">
          <Stat label="堕落结晶" value={meta.crystals} accent="text-fuchsia-300" />
          <Stat label="最深" value={`${meta.deepestFloor} 层`} accent="text-violet-300" />
          <Stat label="通关" value={meta.clearsCount} accent="text-amber-300" />
          <Stat label="觉醒充能" value={meta.awakenCharges} accent="text-rose-300" />
        </div>

        <div className="p-4 space-y-4">
          {!home && (
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 p-3 text-xs text-amber-200">
              ⚠ 深渊入口只在<strong>主神空间/轮回乐园</strong>开启。请先回归乐园再来。
            </div>
          )}

          {/* 结算回执 */}
          {lastSettle && !run && (
            <div className="rounded-lg border border-violet-700/40 bg-violet-950/30 p-3 text-xs text-violet-100 flex items-start justify-between gap-3">
              <div>
                <div className={lastSettle.cleared ? 'text-amber-300 font-semibold' : 'text-violet-200 font-semibold'}>
                  {lastSettle.cleared ? '🏁 通关结算' : '📜 上局结算'}
                </div>
                <div className="text-violet-300/80 mt-1">{lastSettle.note}</div>
                <div className="mt-1">带出 <b className="text-emerald-300">{lastSettle.carry}</b> 件 · 堕落结晶 <b className="text-fuchsia-300">+{lastSettle.crystals}</b></div>
              </div>
              <button onClick={clearLastSettle} className="text-violet-400 hover:text-violet-100">收起</button>
            </div>
          )}

          {/* 无进行局：入口 */}
          {!run && (
            <div className="text-center space-y-3 py-4">
              <p className="text-sm text-violet-200/90">深入黑渊，夺取原罪物。越深越凶，腐蚀换力——见好就收，量力而退。</p>
              <p className="text-xs text-slate-400">门票 <b className="text-amber-300">{ABYSS_TUNING.ticketCost}</b> 乐园币 · 当前持有 <b className={coins >= ABYSS_TUNING.ticketCost ? 'text-emerald-300' : 'text-rose-300'}>{coins}</b></p>
              <button
                disabled={!home || coins < ABYSS_TUNING.ticketCost}
                onClick={() => { if (!start()) alert('乐园币不足，无法购买门票'); }}
                className="px-5 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white"
              >
                🕳 踏入深渊（第 1 层）
              </button>
            </div>
          )}

          {/* 进行中 */}
          {run && hero && (
            <>
              {/* HUD */}
              <div className="rounded-lg border border-violet-800/40 bg-black/30 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-violet-200">
                  <span>黑渊 · 第 <b className="text-violet-100">{run.floor}</b>/{ABYSS_TUNING.floorsPerZone} 层</span>
                  <span>房间 {run.posIdx + 1}/{run.map.rooms.length}</span>
                </div>
                {/* HP */}
                <Meter label="HP" pct={(hero.hp / Math.max(1, hero.maxHp)) * 100} text={`${hero.hp}/${hero.maxHp}`} color="bg-emerald-500" />
                {/* 腐蚀 / 堕落 */}
                <Meter label={`腐蚀·堕落Lv${run.fallLevel}`} pct={fallPct} text={`${run.corruption}`} color="bg-fuchsia-600" />
                <div className="flex gap-3 text-[11px] text-slate-400">
                  <span>攻 <b className="text-rose-300">{hero.atk}</b></span>
                  <span>防 <b className="text-sky-300">{hero.def}</b></span>
                  <span>战利品 <b className="text-amber-300">{run.loot.length}</b></span>
                  <span>加成 <b className="text-violet-300">{run.boons.length}</b></span>
                </div>
              </div>

              {/* 当前房间 / 操作 */}
              {run.status === 'exploring' && room && (
                <div className="rounded-lg border border-violet-800/40 bg-black/20 p-3 text-center space-y-3">
                  <div className="text-sm text-violet-100">
                    {ROOM_ICON[room.type]} 当前：{room.name}
                  </div>
                  {atLast ? (
                    <div className="text-xs text-amber-300">已抵达本层尽头。</div>
                  ) : (
                    <button onClick={enter} className="px-5 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-sm font-semibold text-white">
                      前进 ▶（进入下一房间）
                    </button>
                  )}
                  <div>
                    <button onClick={retreat} className="text-xs text-amber-300/80 hover:text-amber-200 underline underline-offset-2">
                      🌀 从此撤退（全额带出战利品）
                    </button>
                  </div>
                </div>
              )}

              {/* 战后三选一 */}
              {run.status === 'choosingBoon' && run.pendingBoons && (
                <div className="space-y-2">
                  <div className="text-center text-sm text-fuchsia-200">深渊馈赠 · 三选一</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {run.pendingBoons.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => chooseBoon(b)}
                        className={`text-left rounded-lg border p-3 transition hover:brightness-125 ${BOON_BORDER[b.quality]}`}
                      >
                        <div className="text-sm font-semibold text-slate-100">{b.name}</div>
                        <div className="text-[10px] text-violet-300/70 mt-0.5">{SCHOOL_LABEL[b.school]} · {QUALITY_LABEL[b.quality]}</div>
                        <div className="text-xs text-slate-300 mt-1">{b.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 死亡 */}
              {run.status === 'dead' && (
                <div className="rounded-lg border border-rose-800/50 bg-rose-950/30 p-4 text-center space-y-3">
                  <div className="text-rose-300 font-semibold">💀 队伍全灭——深渊放逐</div>
                  <div className="text-xs text-rose-200/80">未带出战利品将损失一半，堕落结晶按深度结算。</div>
                  <button onClick={ackDeath} className="px-5 py-2 rounded-lg bg-rose-800 hover:bg-rose-700 text-sm font-semibold text-white">接受放逐 · 结算</button>
                </div>
              )}

              {/* 通关 */}
              {run.status === 'cleared' && (
                <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-center space-y-3">
                  <div className="text-amber-300 font-semibold">🏁 击破区主——通关黑渊！</div>
                  <div className="text-xs text-amber-200/80">全额带出战利品 + 通关结晶。</div>
                  <button onClick={ackClear} className="px-5 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-sm font-semibold text-white">领取奖励 · 结算</button>
                </div>
              )}

              {/* 日志 */}
              <div className="rounded-lg border border-violet-900/40 bg-black/30 p-3 max-h-40 overflow-y-auto text-[11px] text-slate-400 space-y-1">
                {run.log.slice(-12).reverse().map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent: string }) {
  return (
    <div className="bg-[#0d0a14] py-2">
      <div className={`text-sm font-semibold ${accent}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}

function Meter({ label, pct, text, color }: { label: string; pct: number; text: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-400 w-24 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="text-[10px] text-slate-300 tabular-nums w-20 text-right">{text}</span>
    </div>
  );
}

const SCHOOL_LABEL: Record<string, string> = {
  corruption: '🩸腐蚀', martial: '⚔武道', guard: '🛡守护', undead: '💀亡灵', domain: '🔥领域', gambler: '🎲赌徒',
};
const QUALITY_LABEL: Record<string, string> = { common: '普通', fine: '精良', epic: '史诗' };
const BOON_BORDER: Record<string, string> = {
  common: 'border-slate-600/50 bg-slate-900/40',
  fine: 'border-sky-600/50 bg-sky-950/30',
  epic: 'border-fuchsia-600/50 bg-fuchsia-950/30',
};
