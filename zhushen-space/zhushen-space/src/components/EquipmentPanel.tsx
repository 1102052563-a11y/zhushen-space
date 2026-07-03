import { useState, useMemo } from 'react';
import { useItems, gradeBadgeClass, gradeNameClass, isResourcePseudoItem, type InventoryItem } from '../store/itemStore';
import { useSettings } from '../store/settingsStore';
import { CAT_CFG, CAT_ICON, ItemDetailModal } from './BackpackModal';
import { useImageViewer } from '../store/imageViewerStore';
import { SLOT_DEFS, type SlotDef } from '../systems/equipSlots';
import { enhanceFxClass } from '../systems/enhanceEngine';

/* 槽位定义已移到 systems/equipSlots.ts（避免组件循环依赖）；此处再导出以兼容原有引用 */
export { SLOT_DEFS };
export type { SlotDef };

/* 分组信息（仅 武器 / 防具(头部·外衣·内衬·下装·鞋子·手部·手臂·肩部·腰带) / 饰品 / 特殊装备）*/
const GROUP_META: Record<SlotDef['group'], { title: string; cols: number }> = {
  weapon:    { title: '武器',   cols: 4 },
  armor:     { title: '防具',   cols: 4 },
  accessory: { title: '饰品',   cols: 3 },
  treasure:  { title: '特殊装备', cols: 5 },
};

/* ════════════════════════════════════════════
   子组件
════════════════════════════════════════════ */

/** 单个槽位卡片 */
function SlotCard({
  slotDef, item, onPick, onDetail,
}: {
  slotDef: SlotDef;
  item: InventoryItem | undefined;
  onPick: (key: string) => void;
  onDetail: (item: InventoryItem) => void;
}) {
  const cfg = item ? (CAT_CFG[item.category] ?? CAT_CFG['其他物品']) : null;

  if (!item) {
    return (
      <button
        onClick={() => onPick(slotDef.key)}
        className="flex flex-col items-center justify-center gap-1 p-2 rounded-xl
                   border border-dashed border-edge/30 bg-panel
                   hover:border-god/40 hover:bg-god/5 transition-all
                   min-h-[72px] w-full"
        title={`点击装备（${slotDef.label}）`}
      >
        <span className="text-xl opacity-25">{slotDef.icon}</span>
        <span className="text-[12px] font-mono text-dim/35 leading-tight text-center">{slotDef.label}</span>
      </button>
    );
  }

  const enh = item.enhanceLevel ?? 0;
  return (
    <button
      onClick={() => onDetail(item)}
      className={`relative flex flex-col items-center justify-center gap-1 p-2 rounded-xl border
                  transition-all hover:opacity-80 min-h-[72px] w-full ${cfg!.cls}`}
      title={`${item.name}${enh > 0 ? ` +${enh}` : ''}（点击查看详情）`}
    >
      {enh > 0 && (
        <span className={`absolute top-0.5 right-1 text-[12px] font-bold leading-none z-10 ${enhanceFxClass(enh)}`}>+{enh}</span>
      )}
      {item.image
        ? <img src={item.image} alt={item.name}
            onClick={(e) => { e.stopPropagation(); useImageViewer.getState().open(item.image!, item.name); }}
            title="点击查看大图"
            className="w-12 h-12 object-cover rounded-md cursor-zoom-in" />
        : <span className="text-xl">{CAT_ICON[item.category] ?? '◇'}</span>}
      <span className="text-[12px] font-semibold text-slate-100 truncate w-full text-center leading-tight px-1">
        {item.name}
      </span>
      <span className="text-[11px] font-mono text-dim/50 leading-tight">{slotDef.label}</span>
    </button>
  );
}

/** 槽位分组 */
function SlotGroup({
  groupKey, equippedMap, onPick, onDetail,
}: {
  groupKey: SlotDef['group'];
  equippedMap: Map<string, InventoryItem>;
  onPick: (key: string) => void;
  onDetail: (item: InventoryItem) => void;
}) {
  const slots = SLOT_DEFS.filter((s) => s.group === groupKey);
  const meta  = GROUP_META[groupKey];
  const filled = slots.filter((s) => equippedMap.has(s.key)).length;

  return (
    <div className="space-y-2">
      {/* 分组标题 */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-mono text-dim/60 uppercase tracking-wider">{meta.title}</span>
        <div className="flex-1 h-px bg-edge/30" />
        <span className="text-[12px] font-mono text-dim/30">{filled}/{slots.length}</span>
      </div>
      {/* 槽位网格 */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${meta.cols}, minmax(0, 1fr))` }}
      >
        {slots.map((s) => (
          <SlotCard
            key={s.key}
            slotDef={s}
            item={equippedMap.get(s.key)}
            onPick={onPick}
            onDetail={onDetail}
          />
        ))}
      </div>
    </div>
  );
}


/** 背包选择器（底部弹出） */
function SlotPicker({
  slotDef, candidates, onSelect, onClose,
}: {
  slotDef: SlotDef;
  candidates: InventoryItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-void border border-edge rounded-2xl max-h-[65dvh] overflow-hidden flex flex-col shadow-[0_0_40px_rgba(0,0,0,0.8)]">
        {/* 标题栏 */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-base">{slotDef.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">选择装备</div>
            <div className="text-[12px] font-mono text-dim/50">→ {slotDef.label} 槽</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </div>

        {/* 候选列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {candidates.length === 0 ? (
            <div className="py-10 text-center text-dim/30 text-sm font-mono">背包中无可用物品</div>
          ) : (
            candidates.map((it) => {
              const cfg = CAT_CFG[it.category] ?? CAT_CFG['其他物品'];
              return (
                <button
                  key={it.id}
                  onClick={() => onSelect(it.id)}
                  className="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-edge hover:border-god/40 bg-panel hover:bg-god/5 transition-colors"
                >
                  <span className="text-xl shrink-0">{CAT_ICON[it.category] ?? '◇'}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold truncate ${gradeNameClass(it.gradeDesc)}`}>{it.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[11px] font-mono px-1 py-0.5 rounded border ${cfg.cls}`}>{it.category}</span>
                      {it.gradeDesc && (
                        <span className={`text-[12px] font-mono truncate ${gradeBadgeClass(it.gradeDesc)}`}>{it.gradeDesc}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-[12px] font-mono text-god/50 shrink-0 border border-god/30 px-2 py-1 rounded">装备</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   主组件
════════════════════════════════════════════ */
export default function EquipmentPanel(_props: {
  onDetailOpen?: (id: string) => void;   // 调用方传入但当前未接线（点装备打开 NPC/详情的预留信号）；保留在 API、组件暂不消费
}) {
  const items     = useItems((s) => s.items);
  const equipItem = useItems((s) => s.equipItem);
  const allowAutoEquip = useSettings((s) => s.allowAutoEquip);
  const setAllowAutoEquip = useSettings((s) => s.setAllowAutoEquip);

  // slotKey → InventoryItem 映射（已装备物品）
  const equippedMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    items.filter((it) => it.equipped && it.equipSlot)
         .forEach((it) => map.set(it.equipSlot!, it));
    return map;
  }, [items]);

  const [pickingSlotDef, setPickingSlotDef] = useState<SlotDef | null>(null);
  const [detailItem,     setDetailItem]     = useState<InventoryItem | null>(null);

  const handlePick = (key: string) => {
    const def = SLOT_DEFS.find((s) => s.key === key);
    if (def) setPickingSlotDef(def);
  };

  const handleDetail = (item: InventoryItem) => setDetailItem(item);

  const candidates = pickingSlotDef
    ? items.filter((it) => !it.equipped && (pickingSlotDef.allowedCats as string[]).includes(it.category) && !isResourcePseudoItem(it))
    : [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">

      {/* 自动装备开关：关闭后 AI 不会自动给主角穿戴，需在此面板手动点槽位穿戴 */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2">
        <div>
          <div className="text-sm text-slate-200">允许自动装备物品</div>
          <div className="text-[12px] text-dim/60 mt-0.5">关闭后主角拾取的装备只入背包，需在下方点槽位手动穿戴</div>
        </div>
        <button onClick={() => setAllowAutoEquip(!allowAutoEquip)}
          className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${allowAutoEquip ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
          <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: allowAutoEquip ? 'translateX(16px)' : 'none' }} />
        </button>
      </div>

      {/* 固定槽位分组：武器 / 防具(头部·外衣·内衬·下装·鞋子·手部·手臂·肩部·腰带) / 饰品 / 特殊装备 */}
      {(['weapon', 'armor', 'accessory', 'treasure'] as const).map((g) => (
        <SlotGroup
          key={g}
          groupKey={g}
          equippedMap={equippedMap}
          onPick={handlePick}
          onDetail={handleDetail}
        />
      ))}

      {/* 拾取器 */}
      {pickingSlotDef && (
        <SlotPicker
          slotDef={pickingSlotDef}
          candidates={candidates}
          onSelect={(id) => { equipItem(id, pickingSlotDef.key); setPickingSlotDef(null); }}
          onClose={() => setPickingSlotDef(null)}
        />
      )}

      {/* 物品详情 */}
      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
        />
      )}
    </div>
  );
}
