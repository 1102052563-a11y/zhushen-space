import { useState } from 'react';
import { useMp } from '../store/multiplayerStore';
import { mpClient } from '../systems/mpClient';
import { myPlayerId } from '../systems/mpConfig';

/* 组队讨伐胜利 → 战利分配弹窗：货币全员均得；物品逐件 需求/贪婪/放弃 → ROLL d100，房主结算最高者得。 */
export default function RaidLootModal({ onClose }: { onClose: () => void }) {
  const lt = useMp((s) => s.raidLoot);
  const role = useMp((s) => s.role);
  const [picks, setPicks] = useState<Record<string, 'need' | 'greed' | 'pass'>>({});
  const [submitted, setSubmitted] = useState(false);
  if (!lt) return null;
  const items: any[] = lt.items || [];
  const results = lt.results;

  const submit = () => {
    const rollPicks: Record<string, { type: string; roll: number }> = {};
    for (const it of items) {
      const t = picks[it.id] || 'pass';
      rollPicks[it.id] = { type: t, roll: t === 'pass' ? 0 : 1 + Math.floor(Math.random() * 100) };
    }
    mpClient.relay('raid_roll', { lootId: lt.lootId, picks: rollPicks });
    setSubmitted(true);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[85dvh]">
        <header className="shrink-0 px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
          <span className="text-amber-300/80 text-lg">🏆</span>
          <div className="flex-1 text-base font-bold text-slate-100">讨伐胜利 · 战利分配 <span className="text-[12px] font-mono text-dim/50">{lt.bossName}</span></div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2.5">
          {lt.currency > 0 && <div className="text-[13px] text-amber-300/80">💰 全员获得 乐园币 ×{lt.currency.toLocaleString()}</div>}
          {items.length === 0 && <div className="text-[12px] text-dim/50 text-center py-3">本次无可分配物品。</div>}
          {items.map((it) => {
            const res = results?.[it.id];
            const mine = res && res.winnerId === myPlayerId();
            return (
              <div key={it.id} className="rounded-xl border border-edge bg-panel/60 p-2.5">
                <div className="text-[14px] text-slate-100">{it.name} <span className="text-[11px] text-amber-300/70">{it.gradeDesc}</span></div>
                {it.effect && <div className="text-[11px] text-dim/60 mt-0.5">{it.effect}</div>}
                {!results && !submitted && (
                  <div className="flex gap-1.5 mt-1.5">
                    {(['need', 'greed', 'pass'] as const).map((t) => (
                      <button key={t} onClick={() => setPicks((p) => ({ ...p, [it.id]: t }))}
                        className={`px-2.5 py-1 rounded-md text-[12px] border ${picks[it.id] === t ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>
                        {t === 'need' ? '需求' : t === 'greed' ? '贪婪' : '放弃'}
                      </button>
                    ))}
                  </div>
                )}
                {results && (
                  <div className={`text-[12px] mt-1 ${mine ? 'text-emerald-300 font-semibold' : 'text-dim/70'}`}>
                    {res?.winnerId ? `${res.winnerName} 获得（${res.type === 'need' ? '需求' : '贪婪'} ROLL ${res.roll}）${mine ? ' ← 你！' : ''}` : '无人需求'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="shrink-0 px-5 py-3 border-t border-edge bg-panel/50 flex gap-2">
          {!results ? (
            <>
              <button onClick={submit} disabled={submitted || items.length === 0}
                className="flex-1 px-4 py-2 rounded-lg bg-god/15 border border-god/40 text-god/90 text-sm hover:bg-god/25 disabled:opacity-40 transition-colors">{submitted ? '已投点 · 待房主结算' : '提交 ROLL'}</button>
              {role === 'host' && <button onClick={() => useMp.getState().handlers.onRaidTally?.()}
                className="px-4 py-2 rounded-lg bg-amber-600/20 border border-amber-500/50 text-amber-200 text-sm hover:bg-amber-600/30 transition-colors">结算分配</button>}
            </>
          ) : (
            <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-god/15 border border-god/40 text-god/90 text-sm hover:bg-god/25 transition-colors">完成</button>
          )}
        </div>
      </div>
    </div>
  );
}
