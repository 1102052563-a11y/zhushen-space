import { useRef, useState } from 'react';
import { useNpc, hasRealNpcName, type NpcRecord } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import { lvFromRealm, tierFxClass, effectiveResource, fullMaxHp, fullMaxEp, ratioOf, npcBaseAttrs } from '../systems/derivedStats';
import { useImageViewer } from '../store/imageViewerStore';
import { PortraitPicker } from './PortraitPicker';

/* 右上角「在场人物」浮窗：
   - 每个在场 NPC 一张卡（头像位 + 基础信息），点击进 NPC 详情
   - 头像可上传自定义图片（dataURL 存 npcStore.avatar），留作未来生图位
   - 最多显示约 3 张，超出则内部上下滚动
   - 可折叠（标题栏点一下收起，省地方） */
const CARD_H = 96;   // 单卡高度(px)
const MAX_VISIBLE = 3;

export default function OnScenePanel({ onOpenNpc }: { onOpenNpc: (id: string) => void }) {
  const npcs = useNpc((s) => s.npcs);
  const [collapsed, setCollapsed] = useState(false);

  const list = Object.values(npcs)
    .filter((r) => r.onScene && !r.isDead && hasRealNpcName(r))   // 杜绝无名编号空壳(C11/C22…)出现在在场浮窗
    .sort((a, b) => (b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0) || (b.favor ?? 0) - (a.favor ?? 0));

  if (list.length === 0) return null;

  return (
    <div className="absolute top-3 right-3 z-30 w-[208px] select-none">
      <div className="rounded-xl border border-edge/70 bg-void/85 backdrop-blur-sm shadow-[0_4px_24px_rgba(0,0,0,0.5)] overflow-hidden">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 border-b border-edge/60 bg-panel/80 hover:bg-panel transition-colors"
        >
          <span className="text-[12px]">🎭</span>
          <span className="text-[12px] font-mono text-dim/80 flex-1 text-left">在场人物</span>
          <span className="text-[11px] font-mono text-amber-300/70">{list.length}</span>
          <span className="text-[10px] text-dim/50">{collapsed ? '▸' : '▾'}</span>
        </button>
        {!collapsed && (
          <div
            className="overflow-y-auto p-1.5 space-y-1.5 onscene-scroll"
            style={{ maxHeight: MAX_VISIBLE * (CARD_H + 6) + 6 }}
          >
            {list.map((r) => (
              <OnSceneCard key={r.id} npc={r} onOpen={() => onOpenNpc(r.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OnSceneCard({ npc, onOpen }: { npc: NpcRecord; onOpen: () => void }) {
  const upsert = useNpc((s) => s.upsertNpc);
  const cdata = useCharacters((s) => s.characters[npc.id]);   // 技能/天赋（HP/EP 上限加成）→ 与详情页同口径
  const fileRef = useRef<HTMLInputElement>(null);

  const lv = lvFromRealm(npc.realm);
  const tier = (npc.realm || '').split(/[·|]/)[0] || '';
  const identity = (npc.realm || '').split('|')[1]?.trim() || npc.title || npc.profession || '';
  const favorTone = npc.favor >= 30 ? 'text-emerald-300/80' : npc.favor <= -30 ? 'text-blood/80' : 'text-amber-300/70';
  // 状态只取「首个状态的名称」（去掉 :emoji(效果|…) 那串），避免在窄卡里挤成一坨
  const statusName = (npc.status && npc.status !== '一切正常')
    ? npc.status.split(/[；;]/)[0].split(/[:：]/)[0].trim()
    : '';

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('图片请小于 3MB'); return; }
    const reader = new FileReader();
    reader.onload = () => upsert(npc.id, { avatar: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <div
      onClick={onOpen}
      className="group flex gap-2 p-1.5 rounded-lg border border-edge/60 bg-panel/70 hover:border-god/40 hover:bg-god/5 transition-colors cursor-pointer"
      style={{ height: 96 }}
      title="点击查看详情"
    >
      {/* 头像位 */}
      <div className="relative shrink-0 w-[68px] h-full rounded-md overflow-hidden border border-edge/60 bg-void/60">
        {npc.avatar ? (
          <img src={npc.avatar} alt={npc.name}
            onClick={(e) => { e.stopPropagation(); useImageViewer.getState().open(npc.avatar!, npc.name); }}
            title="点击查看大图"
            className="w-full h-full object-cover cursor-zoom-in" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl text-dim/25">👤</div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        <div className="absolute bottom-0 inset-x-0 flex opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
            className="flex-1 py-0.5 text-[9px] font-mono bg-black/60 text-dim/70 hover:text-god"
            title="上传头像"
          >{npc.avatar ? '换图' : '上传'}</button>
          <PortraitPicker onPick={(url) => upsert(npc.id, { avatar: url })} label="库"
            className="flex-1 py-0.5 text-[9px] font-mono bg-black/60 text-dim/70 hover:text-god border-l border-white/10" />
        </div>
      </div>
      {/* 基础信息 */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 pr-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[13px] font-semibold text-slate-100 truncate">{npc.name || npc.id}</span>
          {npc.partyMember && <span className="shrink-0 text-[9px] font-mono px-1 rounded border border-sky-500/50 text-sky-300/80 bg-sky-900/20" title="临时队友">队</span>}
        </div>
        <div className="text-[11px] font-mono text-dim/60 truncate">
          {tier && <span className={`${tierFxClass(tier)} font-bold`}>{tier}</span>}
          {lv > 0 && <span className="text-dim/50"> Lv.{lv}</span>}
        </div>
        {identity && <div className="text-[11px] text-dim/55 truncate">{identity}</div>}
        {(npc.attrs != null || npc.hp != null || npc.mp != null) && (() => {
          // 最大HP/EP = 基础六维换算 + 装备"增加HP/EP上限"平值 + 百分比加成
          const eqp = (npc.items ?? []).filter((it) => it.equipped);
          const maxHp = fullMaxHp(npcBaseAttrs(npc), eqp, cdata?.skills, cdata?.traits, 1, ratioOf(npc));   // npcBaseAttrs=attrs+真实属性点直加(realAttrs)
          const maxEp = fullMaxEp(npcBaseAttrs(npc), eqp, cdata?.skills, cdata?.traits, 1, ratioOf(npc));
          return (
            <div className="flex items-center gap-2 text-[10px] font-mono whitespace-nowrap">
              <span className="text-rose-400/80">❤{effectiveResource(npc.hp, npc.maxHp, maxHp)}/{maxHp}</span>
              <span className="text-sky-400/80">💧{effectiveResource(npc.mp, npc.maxMp, maxEp)}/{maxEp}</span>
            </div>
          );
        })()}
        <div className="flex items-center gap-1.5 text-[10px] font-mono min-w-0">
          <span className={`${favorTone} shrink-0 whitespace-nowrap`}>好感{npc.favor}</span>
          {statusName && <span className="text-dim/45 truncate min-w-0">· {statusName}</span>}
        </div>
      </div>
    </div>
  );
}
