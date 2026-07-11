import { useNpc, type NpcRecord } from '../store/npcStore';
import { useNpcEvo } from '../store/npcEvoStore';
import { lvFromRealm, tierFxClass } from '../systems/derivedStats';
import { useImageViewer } from '../store/imageViewerStore';
import { useHoloViewer } from '../store/holoViewerStore';

/* 好友栏：手动收藏的契约者/随从/宠物。
   - 点击某人 → 跳转 NPC 详情面板
   - 好友每回合参与 NPC 演化（数量可设；按"最久未演化"轮换）
   - 公共频道里的人加好友会先生成档案再进入离场状态 */

function favorTone(v: number) {
  if (v >= 30) return 'text-emerald-300/80';
  if (v <= -30) return 'text-blood/80';
  return 'text-amber-300/70';
}

function FriendCard({ npc, turn, onOpen, onRemove, onDm }: { npc: NpcRecord; turn: number; onOpen: () => void; onRemove: () => void; onDm?: () => void }) {
  const lv = lvFromRealm(npc.realm);
  const tier = (npc.realm || '').split(/[·|]/)[0] || '';
  const identity = (npc.realm || '').split('|')[1]?.trim() || npc.profession || npc.title || '';
  const evolved = npc.lastEvolvedTurn != null ? (turn - npc.lastEvolvedTurn) : null;
  return (
    <div
      onClick={onOpen} role="button" tabIndex={0}
      className="group flex gap-2.5 p-2 rounded-xl border border-edge bg-panel/70 hover:border-god/40 hover:bg-god/5 transition-colors cursor-pointer"
    >
      <div className="relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-edge/60 bg-void/60">
        {npc.avatar ? (
          <img src={npc.avatar} alt={npc.name}
            onClick={(e) => { e.stopPropagation(); useHoloViewer.getState().showNpc(npc); }}
            title="点击查看大图" className="w-full h-full object-cover cursor-zoom-in" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xl text-dim/25">👤</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-slate-100 truncate">{npc.name || npc.id}</span>
          {npc.npcTag && <span className="text-[10px] font-mono px-1 py-0.5 rounded border border-cyan-700/50 text-cyan-300/70 shrink-0">{npc.npcTag}</span>}
          <span className={`text-[10px] font-mono px-1 py-0.5 rounded border shrink-0 ${npc.onScene ? 'border-emerald-600/40 text-emerald-300/70' : 'border-edge text-dim/40'}`}>{npc.onScene ? '在场' : '离场'}</span>
        </div>
        <div className="text-[11px] font-mono text-dim/60 truncate mt-0.5">
          {tier && <span className={`${tierFxClass(tier)} font-bold`}>{tier}</span>}
          {lv > 0 && <span className="text-dim/50"> Lv.{lv}</span>}
          {identity && <span className="text-dim/55"> · {identity}</span>}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono mt-0.5">
          <span className={favorTone(npc.favor)}>好感{npc.favor}</span>
          <span className="text-dim/40">{evolved == null ? '未演化' : evolved === 0 ? '本回合已演化' : `${evolved}回合前演化`}</span>
        </div>
      </div>
      <div className="shrink-0 self-start flex flex-col items-end gap-1">
        {onDm && (
          <button onClick={(e) => { e.stopPropagation(); onDm(); }} title={`私信 ${npc.name || npc.id}`}
            className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-cyan-500/40 text-cyan-300/80 hover:bg-cyan-900/25 transition-colors">✉ 私信</button>
        )}
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="移出好友栏"
          className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/45 hover:text-blood hover:border-blood/40 transition-colors">移出</button>
      </div>
    </div>
  );
}

export default function FriendsPanel({ onClose, onOpenNpc, onDm, turn }: { onClose: () => void; onOpenNpc: (id: string) => void; onDm?: (id: string) => void; turn: number }) {
  const npcs = useNpc((s) => s.npcs);
  const setFriend = useNpc((s) => s.setFriend);
  const enabled = useNpcEvo((s) => s.settings.enabled);
  const strategy = useNpcEvo((s) => s.settings.strategy);
  const friendsPerTurn = useNpcEvo((s) => s.settings.scheduling.friendsPerTurn ?? 3);
  const setScheduling = useNpcEvo((s) => s.setScheduling);

  const list = Object.values(npcs)
    .filter((r) => r.isFriend && !r.isDead)
    .sort((a, b) => (a.onScene === b.onScene ? (b.favor ?? 0) - (a.favor ?? 0) : a.onScene ? -1 : 1));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg h-[82dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">👥</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">好友 <span className="text-[12px] font-mono text-dim/50">{list.length}</span></div>
            <div className="text-[12px] font-mono text-dim/60 truncate">好友会每回合参与 NPC 演化·点击跳转档案</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {/* 每回合演化人数设置 */}
        <div className="shrink-0 px-5 py-2.5 border-b border-edge bg-panel/50 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-mono text-dim/70">每回合演化好友数</span>
          <input type="number" min={0} max={20} value={friendsPerTurn}
            onChange={(e) => setScheduling({ friendsPerTurn: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
            className="w-16 bg-void border border-edge rounded px-2 py-1 text-[13px] font-mono text-slate-200 focus:outline-none focus:border-god/50" />
          <span className="text-[11px] font-mono text-dim/40">（按"最久未演化"轮换；0=不演化）</span>
          {(!enabled || strategy !== 'B') && (
            <span className="w-full text-[11px] font-mono text-amber-300/70 mt-1">
              ⚠ {!enabled ? 'NPC 演化已关闭，好友暂不会自动演化。' : '当前为策略 A（单次合并），好友栏轮换演化仅在策略 B 生效。'}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {list.length === 0 ? (
            <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
              还没有好友
              <div className="mt-2 text-dim/30 leading-relaxed">在「📇 NPC」「📡 频道」「✉ 私信」里点对方的<br />「⭐ 加好友」即可收藏（仅契约者/随从/宠物）</div>
            </div>
          ) : (
            list.map((r) => <FriendCard key={r.id} npc={r} turn={turn} onOpen={() => onOpenNpc(r.id)} onRemove={() => setFriend(r.id, false)} onDm={onDm ? () => onDm(r.id) : undefined} />)
          )}
        </div>
      </div>
    </div>
  );
}
