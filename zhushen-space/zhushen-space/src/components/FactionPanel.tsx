import { useState } from 'react';
import { useFaction, type FactionRecord } from '../store/factionStore';
import { useNpc, type NpcRecord } from '../store/npcStore';
import NpcDetail from './NpcDetail';

/* 文本里出现的 NPC id（C1/G1…）若存在对应 NPC，渲染成可点击跳转 */
function LinkedText({ text, npcs, onOpenNpc }: { text: string; npcs: Record<string, NpcRecord>; onOpenNpc: (id: string) => void }) {
  const parts = text.split(/([CG]\d+)/);
  return <>{parts.map((p, i) => (/^[CG]\d+$/.test(p) && npcs[p])
    ? <button key={i} onClick={(e) => { e.stopPropagation(); onOpenNpc(p); }} className="text-god underline decoration-dotted underline-offset-2 hover:text-god/70">{p}{npcs[p].name && npcs[p].name !== p ? `(${npcs[p].name})` : ''}</button>
    : <span key={i}>{p}</span>)}</>;
}

/* 势力看板：当前世界 / 非当前世界 两区，点击展开档案。 */
export default function FactionPanel({ onClose }: { onClose: () => void }) {
  const factions = useFaction((s) => s.factions);
  const setWorld = useFaction((s) => s.setWorld);
  const hardRemove = useFaction((s) => s.hardRemoveFaction);
  const npcs = useNpc((s) => s.npcs);
  const [npcDetailId, setNpcDetailId] = useState<string | null>(null);
  const list = Object.values(factions);
  const cur = list.filter((f) => f.inCurrentWorld && !f.isDestroyed);
  const off = list.filter((f) => !f.inCurrentWorld && !f.isDestroyed);
  const dead = list.filter((f) => f.isDestroyed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏛</span>
            <h2 className="text-base font-bold text-slate-100">势力</h2>
            <span className="text-[13px] font-mono text-dim/50">共 {list.length}</span>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {list.length === 0 && <div className="text-center text-dim/40 text-sm py-12">暂无势力。开启「设置→变量管理→🏛 势力演化」后，剧情中的势力会被自动建档。</div>}
          <FactionGroup title="当前世界" tone="text-emerald-300" list={cur} onMove={(id) => setWorld(id, false)} moveLabel="移出本世界" onDelete={hardRemove} npcs={npcs} onOpenNpc={setNpcDetailId} />
          <FactionGroup title="非当前世界" tone="text-dim/70" list={off} onMove={(id) => setWorld(id, true)} moveLabel="拉入本世界" onDelete={hardRemove} npcs={npcs} onOpenNpc={setNpcDetailId} />
          {dead.length > 0 && <FactionGroup title="已覆灭" tone="text-blood/70" list={dead} onDelete={hardRemove} npcs={npcs} onOpenNpc={setNpcDetailId} />}
        </div>
      </div>

      {npcDetailId && npcs[npcDetailId] && (
        <NpcDetail npc={npcs[npcDetailId]} list={Object.values(npcs)} onClose={() => setNpcDetailId(null)} onSelect={(id) => setNpcDetailId(id)} />
      )}
    </div>
  );
}

function FactionGroup({ title, tone, list, onMove, moveLabel, onDelete, npcs, onOpenNpc }: { title: string; tone: string; list: FactionRecord[]; onMove?: (id: string) => void; moveLabel?: string; onDelete: (id: string) => void; npcs: Record<string, NpcRecord>; onOpenNpc: (id: string) => void }) {
  if (list.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className={`text-xs font-mono ${tone}`}>{title}（{list.length}）</div>
      {list.map((f) => <FactionCard key={f.id} f={f} onMove={onMove} moveLabel={moveLabel} onDelete={() => onDelete(f.id)} npcs={npcs} onOpenNpc={onOpenNpc} />)}
    </div>
  );
}

function favorCls(v: number) { return v >= 30 ? 'text-emerald-400' : v <= -30 ? 'text-rose-400' : 'text-amber-400'; }

function FactionCard({ f, onMove, moveLabel, onDelete, npcs, onOpenNpc }: { f: FactionRecord; onMove?: (id: string) => void; moveLabel?: string; onDelete: () => void; npcs: Record<string, NpcRecord>; onOpenNpc: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-edge bg-panel px-3 py-2 space-y-1">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <span className="text-base">🏛</span>
        <span className="flex-1 text-sm font-semibold text-slate-100 truncate">{f.name}</span>
        {f.type && <span className="text-[11px] font-mono text-dim/50">{f.type}</span>}
        <span className={`text-[12px] font-mono ${favorCls(f.favorToPlayer)}`}>态度 {f.favorToPlayer}</span>
        <span className="text-[10px] text-dim/30 font-mono">{f.id}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/60">
        {f.scale && <span>规模:{f.scale}</span>}
        {f.powerLevel && <span>实力:{f.powerLevel}</span>}
        {f.status && <span className="text-amber-300/70">{f.status}</span>}
        {f.territory && <span>地盘:{f.territory}</span>}
      </div>
      {open && (
        <div className="pt-1.5 border-t border-edge/40 space-y-1 text-[13px] text-dim/80 leading-relaxed">
          {f.leader && <div><span className="text-dim/45">首领·</span><LinkedText text={f.leader} npcs={npcs} onOpenNpc={onOpenNpc} /></div>}
          {f.members && <div><span className="text-dim/45">核心成员·</span><LinkedText text={f.members} npcs={npcs} onOpenNpc={onOpenNpc} /></div>}
          {f.goal && <div><span className="text-dim/45">目标·</span>{f.goal}</div>}
          {f.resources && <div><span className="text-dim/45">资源·</span>{f.resources}</div>}
          {f.relations && <div><span className="text-dim/45">势力关系·</span>{f.relations}</div>}
          {f.assets && <div><span className="text-dim/45">产业·</span>{f.assets}</div>}
          {f.background && <div><span className="text-dim/45">背景·</span>{f.background}</div>}
          {f.worldName && <div className="text-dim/50">所属世界·{f.worldName}</div>}
          {(f.deeds?.length ?? 0) > 0 && (
            <div><span className="text-dim/45">大事记·</span>{f.deeds!.slice(-3).map((d) => d.description).join('；')}</div>
          )}
          <div className="flex justify-end gap-3 pt-0.5">
            {onMove && <button onClick={() => onMove(f.id)} className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors">{moveLabel}</button>}
            <button onClick={onDelete} className="text-[12px] font-mono text-blood/50 hover:text-blood transition-colors">删除</button>
          </div>
        </div>
      )}
    </div>
  );
}
