import { useMemo, useState } from 'react';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';

/* 外置发起战斗：从当前在场 NPC 里挑选编入战斗（敌方/我方），主角 B1 自动入我方。
   确认后回调 onStart，由 App 的 startCombatWithSelection 直接建战。 */

type Pick = 'none' | 'enemy' | 'ally';

export default function CombatSetup({ onClose, onStart }: {
  onClose: () => void;
  onStart: (picks: { enemyIds: string[]; allyIds: string[] }) => void;
}) {
  const npcs = useNpc((s) => s.npcs);
  const playerName = usePlayer((s) => s.profile.name);
  const onScene = useMemo(() => Object.values(npcs).filter((n) => n.onScene && !n.isDead), [npcs]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});

  const enemyIds = Object.entries(picks).filter(([, v]) => v === 'enemy').map(([k]) => k);
  const allyIds = Object.entries(picks).filter(([, v]) => v === 'ally').map(([k]) => k);
  const set = (id: string, v: Pick) => setPicks((p) => ({ ...p, [id]: p[id] === v ? 'none' : v }));

  return (
    <div className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-cyan-500/30 bg-slate-900/95 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/60 bg-slate-950/60">
          <span className="text-sm font-semibold text-slate-100">⚔️ 发起战斗</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg leading-none">✕</button>
        </div>
        <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-800">
          选择当前在场的 NPC 编入战斗——设为敌方或我方队友。{playerName || '主角'} 自动加入我方。
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {onScene.length === 0 && <div className="text-slate-500 text-sm text-center py-6">当前没有在场的 NPC（先在正文中让角色登场）。</div>}
          {onScene.map((n) => {
            const v = picks[n.id] ?? 'none';
            return (
              <div key={n.id} className="flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/40 p-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-100 truncate">{n.name || n.id}</div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {n.realm || ''}{n.bioStrength ? ` · ${n.bioStrength}` : ''}{typeof n.favor === 'number' ? ` · 好感${n.favor}` : ''}
                  </div>
                </div>
                <button onClick={() => set(n.id, 'enemy')}
                  className={`px-2.5 py-1 rounded text-xs border ${v === 'enemy' ? 'bg-rose-600 border-rose-400 text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-700'}`}>敌方</button>
                <button onClick={() => set(n.id, 'ally')}
                  className={`px-2.5 py-1 rounded text-xs border ${v === 'ally' ? 'bg-cyan-600 border-cyan-400 text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-700'}`}>我方</button>
              </div>
            );
          })}
        </div>
        <div className="border-t border-slate-700/60 bg-slate-950/60 p-3 flex items-center justify-between">
          <div className="text-xs text-slate-400">敌方 {enemyIds.length} · 我方 {allyIds.length + 1}（含主角）</div>
          <button
            disabled={enemyIds.length === 0}
            onClick={() => onStart({ enemyIds, allyIds })}
            className="px-5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium">
            开始战斗
          </button>
        </div>
      </div>
    </div>
  );
}
