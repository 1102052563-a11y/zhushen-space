import { useState } from 'react';
import { useNpc, type NpcRecord, type NpcOwnedItem } from '../store/npcStore';
import { gradeBadgeClass, gradeNameClass, splitAffixEntries } from '../store/itemStore';
import { enhanceFxClass } from '../systems/enhanceEngine';
import { useSettings } from '../store/settingsStore';
import { SLOT_DEFS, type SlotDef } from './EquipmentPanel';
import { CAT_CFG, CAT_ICON } from './BackpackModal';
import { useImageViewer } from '../store/imageViewerStore';

const GROUPS: { key: SlotDef['group']; title: string; cols: number }[] = [
  { key: 'weapon',    title: '武器',   cols: 4 },
  { key: 'armor',     title: '防具',   cols: 4 },
  { key: 'accessory', title: '饰品',   cols: 3 },
  { key: 'treasure',  title: '特殊装备', cols: 5 },
];

/* AI 的槽位名 → 规范槽位 key */
function normalizeSlot(raw: string, category: string): string | null {
  const s = (raw || '').toLowerCase();
  const [grp, partRaw = ''] = s.split(':');
  const part = partRaw.replace('#', '');
  if (grp === 'weapon') {
    if (['off1', 'off', 'left', '2', 'secondary'].includes(part)) return 'weapon:off1';
    if (['off2', '3'].includes(part)) return 'weapon:off2';
    if (['off3', '4'].includes(part)) return 'weapon:off3';
    return 'weapon:main';
  }
  if (grp === 'armor') {
    const m: Record<string, string> = {
      head: 'armor:head', helmet: 'armor:head',
      upper: 'armor:upper', outer: 'armor:upper', armor: 'armor:upper', body: 'armor:upper', chest: 'armor:upper', torso: 'armor:upper', robe: 'armor:upper', jacket: 'armor:upper', coat: 'armor:upper',
      inner: 'armor:inner', lining: 'armor:inner', undershirt: 'armor:inner', undergarment: 'armor:inner', baselayer: 'armor:inner',
      lower: 'armor:lower', legs: 'armor:lower', leg: 'armor:lower', pants: 'armor:lower',
      feet: 'armor:feet', foot: 'armor:feet', boots: 'armor:feet', shoes: 'armor:feet',
      hands: 'armor:hands', hand: 'armor:hands', gloves: 'armor:hands',
      arms: 'armor:arms', arm: 'armor:arms', bracer: 'armor:arms', vambrace: 'armor:arms', sleeve: 'armor:arms', wrist: 'armor:arms',
      shoulder: 'armor:shoulder', pauldron: 'armor:shoulder',
      belt: 'armor:belt', waist: 'armor:belt',
    };
    return m[part] ?? null; // inner/underwear 等无对应槽 → overflow
  }
  if (grp === 'accessory') { const n = parseInt(part); return n >= 1 && n <= 6 ? `accessory:#${n}` : 'accessory:#1'; }
  if (grp === 'treasure')  { const n = parseInt(part); return n >= 1 && n <= 5 ? `treasure:#${n}` : 'treasure:#1'; }
  // 没有规范槽位前缀 → 按分类兜底
  if (category === '武器') return 'weapon:main';
  if (category === '防具') return 'armor:upper';
  if (category === '饰品') return 'accessory:#1';
  if (['特殊物品', '法宝', '工具', '其他物品'].includes(category)) return 'treasure:#1';
  return null;
}

const slotGroup = (key: string): SlotDef['group'] | null => SLOT_DEFS.find((s) => s.key === key)?.group ?? null;

function SlotCell({ slot, item, onClick }: { slot: SlotDef; item?: NpcOwnedItem; onClick: () => void }) {
  if (!item) {
    return (
      <button onClick={onClick} className="flex flex-col items-center justify-center gap-1 p-2 rounded-xl border border-dashed border-edge/30 bg-panel hover:border-god/40 hover:bg-god/5 transition-all min-h-[72px] w-full">
        <span className="text-xl opacity-25">{slot.icon}</span>
        <span className="text-[12px] font-mono text-dim/35 leading-tight text-center">{slot.label}</span>
      </button>
    );
  }
  const cfg = CAT_CFG[item.category as keyof typeof CAT_CFG] ?? CAT_CFG['其他物品'];
  const enh = item.enhanceLevel ?? 0;
  return (
    <button onClick={onClick} className={`relative flex flex-col items-center justify-center gap-1 p-2 rounded-xl border transition-all hover:opacity-80 min-h-[72px] w-full ${cfg.cls}`} title={`${item.name}${enh > 0 ? ` +${enh}` : ''}`}>
      {enh > 0 && <span className={`absolute top-0.5 right-1 text-[12px] font-bold leading-none z-10 ${enhanceFxClass(enh)}`}>+{enh}</span>}
      {item.image
        ? <img src={item.image} alt={item.name}
            onClick={(e) => { e.stopPropagation(); useImageViewer.getState().open(item.image!, item.name); }}
            title="点击查看大图"
            className="w-12 h-12 object-cover rounded-md cursor-zoom-in" />
        : <span className="text-xl">{CAT_ICON[item.category] ?? '◇'}</span>}
      <span className={`text-[12px] font-semibold truncate w-full text-center leading-tight px-1 ${gradeNameClass(item.gradeDesc)}`}>{item.name}</span>
      <span className="text-[11px] font-mono text-dim/50 leading-tight">{slot.label}</span>
    </button>
  );
}

/* 装备详情/卸下浮窗 */
function EquipDetail({ npcId, item, onClose }: { npcId: string; item: NpcOwnedItem; onClose: () => void }) {
  const unequip = useNpc((s) => s.unequipNpcItem);
  const removeItem = useNpc((s) => s.removeNpcItem);
  const updateItem = useNpc((s) => s.updateNpcItem);
  const [editAffix, setEditAffix] = useState<string | null>(null);   // 词缀编辑（null=不在编辑）
  const num = (item.numeric ?? {}) as Record<string, any>;
  const statLines: string[] = Array.isArray(num.statLines) ? num.statLines : [];
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm bg-void border border-edge rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-xl">{CAT_ICON[item.category] ?? '◇'}</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-bold truncate ${gradeNameClass(item.gradeDesc)}`}>{item.name}</div>
            <div className="text-[12px] font-mono text-dim/50">{item.category}{item.equipSlot ? ` · ${item.equipSlot}` : ''}{item.locked ? <span className="text-blue-400"> · 🔒锁定</span> : ''}</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </div>
        <div className="p-4 space-y-2 text-[14px]">
          {item.gradeDesc && <div className="font-mono leading-relaxed text-[13px]"><span className="text-dim/40">品级·</span><span className={gradeBadgeClass(item.gradeDesc)}>{item.gradeDesc}</span></div>}
          {/* 固定模板字段（产地/类型/攻防/耐久/评分/杀敌数）*/}
          {(item.origin || item.subType || item.combatStat || item.durability || item.score || item.killCount) && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/60">
              {item.origin && <span>产地:{item.origin}</span>}
              {item.subType && <span>类型:{item.subType}</span>}
              {item.combatStat && <span className="text-amber-300/80">攻防:{item.combatStat}</span>}
              {item.durability && <span>耐久:{item.durability}</span>}
              {item.score && <span className="text-emerald-300/80">评分:{item.score}</span>}
              {item.killCount && <span className="text-blood/80">杀敌:{item.killCount}</span>}
            </div>
          )}
          {item.requirement && <div className="text-[13px] text-sky-200/70 leading-relaxed"><span className="text-dim/40">需求·</span>{item.requirement}</div>}
          {/* 词缀（可改/可加）*/}
          {editAffix !== null ? (
            <div className="space-y-1">
              <textarea value={editAffix} onChange={(e) => setEditAffix(e.target.value)} rows={2}
                placeholder="如：[烈焰] 攻击附带 15% 火焰伤害"
                className="w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-fuchsia-300/80 focus:outline-none focus:border-god/50 resize-none" />
              <div className="flex gap-2">
                <button onClick={() => { updateItem(npcId, item.id, { affix: editAffix.trim() }); setEditAffix(null); }}
                  className="text-[11px] font-mono text-emerald-300 border border-emerald-600/40 rounded px-2 py-0.5 hover:bg-emerald-500/10">保存</button>
                <button onClick={() => setEditAffix(null)} className="text-[11px] font-mono text-dim/50 border border-edge rounded px-2 py-0.5">取消</button>
              </div>
            </div>
          ) : item.affix ? (
            <div className="text-[13px] text-fuchsia-300/70 flex items-start gap-2">
              <span className="min-w-0 leading-snug"><span className="text-dim/40">词缀·</span>{splitAffixEntries(item.affix).map((a, i) => <span key={i} className="block">{a}</span>)}</span>
              <button onClick={() => setEditAffix(item.affix ?? '')} className="text-[11px] text-dim/40 hover:text-fuchsia-300 shrink-0">✎ 改</button>
            </div>
          ) : (
            <button onClick={() => setEditAffix('')} className="text-[11px] font-mono text-dim/40 hover:text-fuchsia-300">＋ 添加词缀</button>
          )}
          {item.effect && <div className="text-slate-300/80 leading-snug"><span className="text-god/50">效果·</span>{splitAffixEntries(item.effect).map((a, i) => <span key={i} className="block">{a}</span>)}</div>}
          {statLines.length > 0 && <div className="font-mono text-sky-400/70 text-[13px]">属性词条：{statLines.join(' / ')}</div>}
          {item.intro && <div className="text-dim/60 leading-relaxed">{item.intro}</div>}
          <div className="italic border-l-2 border-edge/50 pl-2 text-[13px]">
            <span className="not-italic text-god/40">外观·</span>
            {item.appearance ? <span className="text-dim/60">{item.appearance}</span> : <span className="not-italic text-dim/30">（未填写——重新生成可补全，AI 生图需要它）</span>}
          </div>
          {item.acquisition && <div className="font-mono text-dim/40 text-[13px]">获得：{item.acquisition}</div>}
        </div>
        <div className="px-4 py-3 border-t border-edge flex justify-end gap-2">
          <button onClick={() => { unequip(npcId, item.id); onClose(); }} className="px-3 py-1.5 text-sm font-mono rounded-lg border border-edge text-dim hover:border-amber-600/50 hover:text-amber-400 transition-colors">卸下到储存空间</button>
          <button onClick={() => updateItem(npcId, item.id, { locked: !item.locked })}
            title={item.locked ? '解锁后 AI 可删除/消耗此物品' : '锁定后 AI 不会删除/消耗此物品（手动删除也隐藏）'}
            className={`px-3 py-1.5 text-sm font-mono rounded-lg border transition-colors ${item.locked ? 'border-blue-500/50 text-blue-400 bg-blue-900/20' : 'border-edge text-dim hover:border-blue-500/40 hover:text-blue-400'}`}>
            {item.locked ? '🔒 已锁定' : '🔓 锁定'}
          </button>
          {!item.locked && (
            <button onClick={() => { removeItem(npcId, item.id); onClose(); }} className="px-3 py-1.5 text-sm font-mono rounded-lg border border-blood/40 text-blood/80 hover:bg-blood/10 transition-colors">删除</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* 空槽 → 从 NPC 储物袋挑选 */
function SlotPicker({ npcId, slot, bag, onClose }: { npcId: string; slot: SlotDef; bag: NpcOwnedItem[]; onClose: () => void }) {
  const equip = useNpc((s) => s.equipNpcItem);
  const cands = bag.filter((it) => (slot.allowedCats as string[]).includes(it.category));
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-void border border-edge rounded-2xl max-h-[60vh] overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-edge bg-panel">
          <span>{slot.icon}</span>
          <div className="flex-1"><div className="text-sm font-bold text-slate-100">装备到 {slot.label}</div></div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cands.length === 0 ? <div className="py-8 text-center text-dim/30 text-sm font-mono">储存空间无可装备物品</div> :
            cands.map((it) => (
              <button key={it.id} onClick={() => { equip(npcId, it.id, slot.key); onClose(); }} className="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-edge hover:border-god/40 bg-panel hover:bg-god/5 transition-colors">
                <span className="text-xl">{CAT_ICON[it.category] ?? '◇'}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold truncate ${gradeNameClass(it.gradeDesc)}`}>{it.name}</div>
                  <div className="text-[12px] text-dim/50 truncate">{it.category}{it.gradeDesc ? ` · ${it.gradeDesc}` : ''}</div>
                </div>
                <span className="text-[12px] font-mono text-god/50 border border-god/30 px-2 py-1 rounded">装备</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

export default function NpcEquip({ npc }: { npc: NpcRecord }) {
  const [picking, setPicking] = useState<SlotDef | null>(null);
  const [detail, setDetail]   = useState<NpcOwnedItem | null>(null);
  const allowAutoEquipNpc = useSettings((s) => s.allowAutoEquipNpc);
  const setAllowAutoEquipNpc = useSettings((s) => s.setAllowAutoEquipNpc);

  // 订阅 store 里的实时记录：装备/卸下后立即重渲染（之前只读 npc prop 是静态的，点装备看不到变化）
  const liveNpc = useNpc((s) => s.npcs[npc.id]) ?? npc;
  const items = liveNpc.items ?? [];
  const equipped = items.filter((i) => i.equipped);
  const bag = items.filter((i) => !i.equipped);

  // 归一化放置：每件装备分配到规范槽位，冲突时找同组空位，否则进 overflow
  const slotMap = new Map<string, NpcOwnedItem>();
  const overflow: NpcOwnedItem[] = [];
  for (const it of equipped) {
    const raw = it.equipSlot ?? '';
    if (raw.toLowerCase().startsWith('technique')) { overflow.push(it); continue; }
    const pref = normalizeSlot(raw, it.category);
    if (!pref) { overflow.push(it); continue; }
    if (!slotMap.has(pref)) { slotMap.set(pref, it); continue; }
    // 冲突：同组找空位
    const grp = slotGroup(pref);
    const free = SLOT_DEFS.find((s) => s.group === grp && !slotMap.has(s.key));
    if (free) slotMap.set(free.key, it); else overflow.push(it);
  }

  return (
    <div className="space-y-5">
      {/* NPC 自动装备开关（全局，对所有 NPC 生效）：关闭后 NPC 拾取/初始装备只入储存空间，需手动穿戴 */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2">
        <div>
          <div className="text-sm text-slate-200">允许自动装备 NPC</div>
          <div className="text-[12px] text-dim/60 mt-0.5">关闭后 NPC 的初始/拾取装备只入储存空间，需在此手动穿戴（对所有 NPC 生效）</div>
        </div>
        <button onClick={() => setAllowAutoEquipNpc(!allowAutoEquipNpc)}
          className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${allowAutoEquipNpc ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
          <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: allowAutoEquipNpc ? 'translateX(16px)' : 'none' }} />
        </button>
      </div>
      {GROUPS.map((g) => {
        const slots = SLOT_DEFS.filter((s) => s.group === g.key);
        const filled = slots.filter((s) => slotMap.has(s.key)).length;
        return (
          <div key={g.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-mono text-dim/60 uppercase tracking-wider">{g.title}</span>
              <div className="flex-1 h-px bg-edge/30" />
              <span className="text-[12px] font-mono text-dim/30">{filled}/{slots.length}</span>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${g.cols}, minmax(0,1fr))` }}>
              {slots.map((s) => {
                const it = slotMap.get(s.key);
                return <SlotCell key={s.key} slot={s} item={it} onClick={() => it ? setDetail(it) : setPicking(s)} />;
              })}
            </div>
          </div>
        );
      })}

      {/* 其他已装备（无法归类的槽位） */}
      {overflow.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-mono text-dim/40 uppercase tracking-wider">其他已装备</span>
            <div className="flex-1 h-px bg-edge/20" />
            <span className="text-[12px] font-mono text-dim/30">{overflow.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {overflow.map((it) => {
              const cfg = CAT_CFG[it.category as keyof typeof CAT_CFG] ?? CAT_CFG['其他物品'];
              return (
                <button key={it.id} onClick={() => setDetail(it)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${cfg.cls}`}>
                  <span>{CAT_ICON[it.category] ?? '◇'}</span>
                  <span className={`font-semibold ${gradeNameClass(it.gradeDesc)}`}>{it.name}</span>
                  {it.locked && <span className="text-blue-400 text-[12px]">🔒</span>}
                  {it.equipSlot && <span className="text-dim/50 font-mono text-[12px]">{it.equipSlot}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {picking && <SlotPicker npcId={npc.id} slot={picking} bag={bag} onClose={() => setPicking(null)} />}
      {detail && <EquipDetail npcId={npc.id} item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
