import { useNpc, type NpcRecord } from '../store/npcStore';
import { isDmableTag } from '../store/dmStore';
import { lvFromRealm, tierFxClass } from '../systems/derivedStats';
import { useImageViewer } from '../store/imageViewerStore';
import { useHoloViewer } from '../store/holoViewerStore';

/* 临时队伍：本世界临时组队的同伴（主角是队长），与「冒险团」不同——世界结束即自动解散。
   - 来源：📡 公共频道·组队帖「＋加入」/「邀请入队」，或剧情中招募
   - 点击某人 → 跳转 NPC 详情面板
   - 「移出队伍」= 退队（仍保留为 NPC 档案，只是不再随队行动） */

function PartyCard({ npc, onOpen, onLeave, onKick, onDm }: { npc: NpcRecord; onOpen: () => void; onLeave: () => void; onKick: () => void; onDm?: () => void }) {
  const lv = lvFromRealm(npc.realm);
  const tier = (npc.realm || '').split(/[·|]/)[0] || '';
  const role = npc.partyRole || (npc.realm || '').split('|')[1]?.trim() || npc.profession || '队友';
  return (
    <div
      onClick={onOpen} role="button" tabIndex={0}
      className="group flex gap-2.5 p-2 rounded-xl border border-edge bg-panel/70 hover:border-sky-400/40 hover:bg-sky-400/5 transition-colors cursor-pointer"
    >
      <div className="relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-edge/60 bg-void/60">
        {npc.avatar ? (
          <img src={npc.avatar} alt={npc.name}
            onClick={(e) => { e.stopPropagation(); useHoloViewer.getState().showNpc(npc); }}
            title="点击查看大图" className="w-full h-full object-cover cursor-zoom-in" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xl text-dim/25">🧑</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-slate-100 truncate">{npc.name || npc.id}</span>
          <span className="text-[9px] font-mono px-1 py-0.5 rounded border border-sky-500/50 text-sky-300/80 bg-sky-900/20 shrink-0" title="临时队友">队</span>
          <span className={`text-[10px] font-mono px-1 py-0.5 rounded border shrink-0 ${npc.onScene ? 'border-emerald-600/40 text-emerald-300/70' : 'border-edge text-dim/40'}`}>{npc.onScene ? '在场' : '离场'}</span>
        </div>
        <div className="text-[11px] font-mono text-dim/60 truncate mt-0.5">
          {tier && <span className={`${tierFxClass(tier)} font-bold`}>{tier}</span>}
          {lv > 0 && <span className="text-dim/50"> Lv.{lv}</span>}
          {role && <span className="text-sky-300/55"> · {role}</span>}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono mt-0.5 text-dim/45 truncate">
          {npc.profession && <span className="text-violet-300/60">{npc.profession}</span>}
          {npc.bioStrength && <span className="text-amber-300/55">{npc.bioStrength}</span>}
          {npc.personality && <span className="truncate">{npc.personality}</span>}
        </div>
      </div>
      <div className="shrink-0 self-start flex flex-col items-end gap-1">
        {onDm && (
          <button onClick={(e) => { e.stopPropagation(); onDm(); }} title={`私信 ${npc.name || npc.id}`}
            className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-cyan-500/40 text-cyan-300/80 hover:bg-cyan-900/25 transition-colors">✉ 私信</button>
        )}
        <button onClick={(e) => { e.stopPropagation(); if (confirm(`让 ${npc.name || npc.id} 退出临时队伍？\n仅离队，仍保留其 NPC 档案。`)) onLeave(); }} title="退出队伍（保留 NPC 档案）"
          className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/45 hover:text-slate-200 hover:border-dim/40 transition-colors">移出</button>
        <button onClick={(e) => { e.stopPropagation(); if (confirm(`踢出并彻底删除「${npc.name || npc.id}」？\n将一并移除其 NPC 档案与技能数据，不可恢复。`)) onKick(); }} title="踢出并彻底删除该 NPC（不可恢复）"
          className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-blood/50 text-blood/80 hover:bg-blood/15 transition-colors">踢出</button>
      </div>
    </div>
  );
}

export default function PartyPanel({ onClose, onOpenNpc, onDm }: { onClose: () => void; onOpenNpc: (id: string) => void; onDm?: (id: string) => void }) {
  const npcs = useNpc((s) => s.npcs);
  const leaveParty = useNpc((s) => s.leaveParty);
  const hardRemoveNpc = useNpc((s) => s.hardRemoveNpc);

  const list = Object.values(npcs)
    .filter((r) => r.partyMember && !r.isDead)
    .sort((a, b) => (a.onScene === b.onScene ? (b.updatedAt ?? 0) - (a.updatedAt ?? 0) : a.onScene ? -1 : 1));

  const world = list.find((r) => r.partyWorld)?.partyWorld || '';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg h-[82dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-sky-300/70 text-lg">🤝</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">临时队伍 <span className="text-[12px] font-mono text-dim/50">{list.length}</span></div>
            <div className="text-[12px] font-mono text-dim/60 truncate">主角是队长·随队行动{world ? ` · 当前世界：${world}` : ''}</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="shrink-0 px-5 py-2 border-b border-edge bg-panel/50 text-[11px] font-mono text-dim/45 leading-relaxed">
          临时队友只在当前任务世界有效，<span className="text-amber-300/60">离开 / 回归乐园时会自动解散归档</span>（有冒险团则可选择「转正」长期留用）。
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {list.length === 0 ? (
            <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
              还没有临时队友
              <div className="mt-2 text-dim/30 leading-relaxed">在「📡 频道·组队」帖点「＋加入」或「邀请入队」<br />即可拉契约者组队（仅本世界有效）</div>
            </div>
          ) : (
            list.map((r) => (
              <PartyCard key={r.id} npc={r}
                onOpen={() => onOpenNpc(r.id)}
                onLeave={() => leaveParty(r.id)}
                onKick={() => hardRemoveNpc(r.id)}
                onDm={onDm && isDmableTag(r.npcTag) ? () => onDm(r.id) : undefined} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
