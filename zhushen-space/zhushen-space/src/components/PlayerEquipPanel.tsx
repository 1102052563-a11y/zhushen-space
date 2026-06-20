import { useRef, useState } from 'react';
import { useItems, gradeBadgeClass, gradeNameClass, asText, type InventoryItem } from '../store/itemStore';
import { ItemDetailModal, CAT_ICON } from './BackpackModal';
import { useImageViewer } from '../store/imageViewerStore';

/* 叙事区左上角「主角装备」浮窗，与右上角「在场人物」左右对称：
   - 每件已装备物品一张卡（图片位 + 基础信息），点击开 ItemDetailModal（可卸下/编辑/删除）
   - 图片位可上传自定义图片（dataURL 存 InventoryItem.image），留作未来生图位
   - 最多显约 3 张，超出内部上下滚动；标题栏可折叠 */
const CARD_H = 80;
const MAX_VISIBLE = 4;

export default function PlayerEquipPanel() {
  const items = useItems((s) => s.items);
  const [collapsed, setCollapsed] = useState(false);
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);

  const equipped = items.filter((it) => it.equipped);
  if (equipped.length === 0) return null;

  return (
    <div className="absolute top-3 left-3 z-30 w-[200px] select-none">
      <div className="rounded-xl border border-edge/70 bg-void/85 backdrop-blur-sm shadow-[0_4px_24px_rgba(0,0,0,0.5)] overflow-hidden">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 border-b border-edge/60 bg-panel/80 hover:bg-panel transition-colors"
        >
          <span className="text-[12px]">⚔</span>
          <span className="text-[12px] font-mono text-dim/80 flex-1 text-left">主角装备</span>
          <span className="text-[11px] font-mono text-amber-300/70">{equipped.length}</span>
          <span className="text-[10px] text-dim/50">{collapsed ? '▸' : '▾'}</span>
        </button>
        {!collapsed && (
          <div
            className="overflow-y-auto p-1.5 space-y-1.5 onscene-scroll"
            style={{ maxHeight: MAX_VISIBLE * (CARD_H + 6) + 6 }}
          >
            {equipped.map((it) => (
              <EquipCard key={it.id} item={it} onOpen={() => setDetailItem(it)} />
            ))}
          </div>
        )}
      </div>

      {detailItem && <ItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
    </div>
  );
}

function EquipCard({ item, onOpen }: { item: InventoryItem; onOpen: () => void }) {
  const updateItem = useItems((s) => s.updateItem);
  const fileRef = useRef<HTMLInputElement>(null);
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('图片请小于 3MB'); return; }
    const reader = new FileReader();
    reader.onload = () => updateItem(item.id, { image: String(reader.result) });
    reader.readAsDataURL(file);
  }
  const slotLabel = (item.equipSlot ?? '').split(':').slice(0, 2).join(':');
  return (
    <div
      onClick={onOpen}
      className="group flex gap-2 p-1.5 rounded-lg border border-edge/60 bg-panel/70 hover:border-god/40 hover:bg-god/5 transition-colors cursor-pointer"
      style={{ height: CARD_H }}
      title="点击查看/卸下"
    >
      <div className="relative shrink-0 w-12 h-full rounded-md overflow-hidden border border-edge/60 bg-void/60">
        {item.image
          ? <img src={item.image} alt={item.name}
              onClick={(e) => { e.stopPropagation(); useImageViewer.getState().open(item.image!, item.name); }}
              title="点击查看大图"
              className="w-full h-full object-cover cursor-zoom-in" />
          : <div className="w-full h-full flex items-center justify-center text-xl text-dim/30">{CAT_ICON[item.category] ?? '⚔'}</div>}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        <button
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
          className="absolute bottom-0 inset-x-0 py-px text-[9px] font-mono bg-black/60 text-dim/70 opacity-0 group-hover:opacity-100 hover:text-god transition-opacity"
          title="上传图片"
        >{item.image ? '换图' : '图'}</button>
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <div className={`text-[13px] font-semibold truncate ${gradeNameClass(item.gradeDesc)}`}>{item.name}</div>
        <div className="text-[11px] font-mono text-dim/55 truncate">
          {item.category}{item.gradeDesc ? <>·<span className={gradeBadgeClass(item.gradeDesc)}>{item.gradeDesc}</span></> : ''}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-dim/50 truncate">
          {item.combatStat && <span className="text-amber-300/70">{asText(item.combatStat)}</span>}
          {slotLabel && <span className="text-god/50">{slotLabel}</span>}
        </div>
        {item.affix && <div className="text-[10px] leading-tight text-amber-200/70 truncate" title={String(item.affix)}><span className="text-dim/40">缀·</span>{String(item.affix)}</div>}
        {item.effect && <div className="text-[10px] leading-tight text-slate-300/65 truncate" title={String(item.effect)}><span className="text-god/40">效·</span>{String(item.effect)}</div>}
      </div>
    </div>
  );
}
