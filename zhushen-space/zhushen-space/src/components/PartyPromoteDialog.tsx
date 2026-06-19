import { useState } from 'react';
import { useNpc } from '../store/npcStore';
import { useTeam } from '../store/adventureTeamStore';

/* 临时队伍解散 → "转正进冒险团" 询问弹窗（仅在有冒险团时弹出）*/
export default function PartyPromoteDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const npcs = useNpc((s) => s.npcs);
  const teamName = useTeam((s) => s.name);
  const upsertMember = useTeam((s) => s.upsertMember);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const list = ids.map((id) => npcs[id]).filter(Boolean);
  if (list.length === 0) return null;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doPromote = () => { sel.forEach((id) => upsertMember(id, { role: npcs[id]?.partyRole || npcs[id]?.profession || '团员' })); onClose(); };
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
        <div className="px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
          <span className="text-cyan-300/80 text-lg">🛡</span><span className="text-base font-bold text-slate-100">临时队伍解散</span>
        </div>
        <div className="px-5 py-3 text-[13px] text-slate-300 leading-relaxed">
          离开了这个世界，以下临时队友随之解散归档。要把谁<b className="text-cyan-300">转正</b>进你的冒险团{teamName ? `【${teamName}】` : ''}、长期留用吗？
        </div>
        <div className="max-h-64 overflow-y-auto px-3 pb-2 space-y-1">
          {list.map((r) => (
            <label key={r.id} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${sel.has(r.id) ? 'border-cyan-500/50 bg-cyan-900/15' : 'border-edge bg-panel/50 hover:border-cyan-500/30'}`}>
              <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="accent-cyan-500" />
              <span className="text-[11px] font-mono px-1 py-0.5 rounded border border-edge text-dim/50">{r.id}</span>
              <span className="text-sm text-slate-200">{r.name}</span>
              <span className="text-[11px] font-mono text-dim/50">{r.realm?.split('|')[0]}</span>
              {r.profession && <span className="text-[10px] font-mono px-1 rounded border border-violet-500/40 text-violet-300/70">{r.profession}</span>}
            </label>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-edge bg-panel/60 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-edge text-dim hover:text-slate-200 text-sm font-mono transition-colors">都不转（归档）</button>
          <button onClick={doPromote} disabled={sel.size === 0} className="px-3 py-1.5 rounded border border-cyan-600/50 text-cyan-300 hover:bg-cyan-900/30 disabled:opacity-40 text-sm font-mono transition-colors">转正选中（{sel.size}）</button>
        </div>
      </div>
    </div>
  );
}
