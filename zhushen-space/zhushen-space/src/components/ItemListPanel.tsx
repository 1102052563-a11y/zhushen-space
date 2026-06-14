import { useMemo, useState } from 'react';
import { useItems, gradeNameClass, type InventoryItem } from '../store/itemStore';
import { ItemDetailModal, CAT_CFG } from './BackpackModal';

/* 叙事区右下角「物品栏」浮窗（在右上角「在场人物」下方）：
   - 简要列表，只显示物品名称（点击可看详情），不留图片位
   - 顶部筛选：按分类下拉 + 已装备/未装备
   - 可折叠；内部上下滚动 */
type EquipFilter = 'all' | 'equipped' | 'bag';

export default function ItemListPanel() {
  const items = useItems((s) => s.items);
  const [collapsed, setCollapsed] = useState(false);
  const [cat, setCat] = useState<string>('all');
  const [equip, setEquip] = useState<EquipFilter>('all');
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);

  // 出现过的分类（只列有物品的分类，省下拉长度）
  const cats = useMemo(() => Array.from(new Set(items.map((it) => it.category))), [items]);

  const filtered = items.filter((it) =>
    (cat === 'all' || it.category === cat) &&
    (equip === 'all' || (equip === 'equipped' ? it.equipped : !it.equipped)),
  );

  if (items.length === 0) return null;

  return (
    <div className="absolute bottom-3 right-3 z-30 w-[200px] select-none">
      <div className="rounded-xl border border-edge/70 bg-void/85 backdrop-blur-sm shadow-[0_4px_24px_rgba(0,0,0,0.5)] overflow-hidden">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 border-b border-edge/60 bg-panel/80 hover:bg-panel transition-colors"
        >
          <span className="text-[12px]">🎒</span>
          <span className="text-[12px] font-mono text-dim/80 flex-1 text-left">物品栏</span>
          <span className="text-[11px] font-mono text-amber-300/70">{filtered.length}</span>
          <span className="text-[10px] text-dim/50">{collapsed ? '▸' : '▾'}</span>
        </button>

        {!collapsed && (
          <>
            {/* 筛选 */}
            <div className="flex gap-1 px-1.5 py-1.5 border-b border-edge/50">
              <select
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className="flex-1 min-w-0 bg-void border border-edge/60 rounded px-1 py-0.5 text-[11px] font-mono text-slate-300 outline-none focus:border-god/50"
              >
                <option value="all">全部分类</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={equip}
                onChange={(e) => setEquip(e.target.value as EquipFilter)}
                className="w-[58px] shrink-0 bg-void border border-edge/60 rounded px-1 py-0.5 text-[11px] font-mono text-slate-300 outline-none focus:border-god/50"
              >
                <option value="all">全部</option>
                <option value="equipped">已装备</option>
                <option value="bag">背包</option>
              </select>
            </div>

            {/* 名称列表 */}
            <div className="overflow-y-auto py-1 onscene-scroll" style={{ maxHeight: 220 }}>
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-center text-[11px] font-mono text-dim/35">（无匹配物品）</div>
              ) : (
                filtered.map((it) => {
                  const dot = (CAT_CFG[it.category as keyof typeof CAT_CFG] ?? CAT_CFG['其他物品']).dot;
                  return (
                    <button
                      key={it.id}
                      onClick={() => setDetailItem(it)}
                      className="w-full flex items-center gap-2 px-2.5 py-1 text-left hover:bg-god/5 transition-colors"
                      title={it.name}
                    >
                      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dot}`} />
                      <span className={`flex-1 min-w-0 truncate text-[12px] ${gradeNameClass(it.gradeDesc)}`}>{it.name}</span>
                      {it.equipped && <span className="shrink-0 text-[9px] font-mono text-god/60">装</span>}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {detailItem && <ItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
    </div>
  );
}
