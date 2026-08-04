import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   👗 衣柜（穿搭预设）——产品概念借鉴 ST 插件 Outfit-Manager（无许可证·代码全自写）。
   痛点：角色穿着(appearance5 穿着段)是 AI 演化的动态字段会漂——衣柜=玩家钦定的权威穿搭库。
   激活的穿搭作为「单一权威源」注入三条生图线（立绘 ${attire} / 正文配图 roster / 漫画 roster）。
   进度类数据（穿搭绑定本存档的角色）：进 saveManager STORES 带 clear，随存档快照、新游戏清空。
   P0 纯文字（描述+场景标签+英文服装标签）；参考图/单品套装/正文注入切换 → P1/P2。
════════════════════════════════════════════ */

export interface OutfitRecord {
  id: string;
  name: string;        // 穿搭名（如 战斗服/常服/礼服）
  desc: string;        // 文字描述（正文/自然语言生图线用；中文即可）
  tags: string;        // 场景标签（逗号分隔·如 战斗,外出；AI 换装指令可按标签命中）
  imageTags: string;   // 英文 danbooru 服装标签（NAI/ComfyUI 标签线并入；可空）
  hasImage?: boolean;  // 有穿搭参考图（图本体在 imageDb key `outfit:<charId>:<id>`·chatimg 多模态线当参考图）
  createdAt: number;
}
interface CharWardrobe { outfits: OutfitRecord[]; activeId: string }   // activeId=''：不钦定（回退装备栏/外观）

interface OutfitState {
  byChar: Record<string, CharWardrobe>;   // charId：B1=主角、C×=NPC
  addOutfit: (charId: string, o: Omit<OutfitRecord, 'id' | 'createdAt'>) => string;
  updateOutfit: (charId: string, id: string, patch: Partial<Omit<OutfitRecord, 'id' | 'createdAt'>>) => void;
  removeOutfit: (charId: string, id: string) => void;
  setActive: (charId: string, id: string) => void;
  clearAll: () => void;
}

const emptyWardrobe = (): CharWardrobe => ({ outfits: [], activeId: '' });

export const useOutfits = create<OutfitState>()(
  persist(
    (set): OutfitState => ({
      byChar: {},
      addOutfit: (charId, o) => {
        const id = 'of_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        set((s) => {
          const w = s.byChar[charId] ?? emptyWardrobe();
          return { byChar: { ...s.byChar, [charId]: { ...w, outfits: [...w.outfits, { ...o, id, createdAt: Date.now() }] } } };
        });
        return id;
      },
      updateOutfit: (charId, id, patch) => set((s) => {
        const w = s.byChar[charId];
        if (!w) return {};
        return { byChar: { ...s.byChar, [charId]: { ...w, outfits: w.outfits.map((o) => (o.id === id ? { ...o, ...patch } : o)) } } };
      }),
      removeOutfit: (charId, id) => set((s) => {
        const w = s.byChar[charId];
        if (!w) return {};
        return { byChar: { ...s.byChar, [charId]: { activeId: w.activeId === id ? '' : w.activeId, outfits: w.outfits.filter((o) => o.id !== id) } } };
      }),
      setActive: (charId, id) => set((s) => {
        const w = s.byChar[charId] ?? emptyWardrobe();
        return { byChar: { ...s.byChar, [charId]: { ...w, activeId: id } } };
      }),
      clearAll: () => set({ byChar: {} }),
    }),
    { name: 'drpg-outfit' },
  ),
);
