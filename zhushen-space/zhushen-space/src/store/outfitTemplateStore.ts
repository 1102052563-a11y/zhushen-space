import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   👗📚 穿搭模板库（跨存档）——衣柜(outfitStore)是进度类随存档走；好看的穿搭想带去新档/别的档，
   在衣柜里「⭐存为模板」进这里，任何存档的衣柜都能「⤵导入」。
   ⚠ 铁则：**不进 saveManager STORES**（monument 同款）——既不随新游戏清、也不被读档回滚覆盖，
   是真正的账号级模板库。模板参考图也因此不能放 imageDb（那个随存档清/快照），
   放独立 IndexedDB `drpg-outfit-templates`（systems/outfitTemplateDb.ts）。
════════════════════════════════════════════ */

export interface OutfitTemplate {
  id: string;
  name: string;        // 模板名（=穿搭名；同名保存=覆盖更新）
  desc: string;
  tags: string;
  imageTags: string;
  hasImage?: boolean;  // 有参考图（本体在 outfitTemplateDb key=模板id）
  createdAt: number;
}

const MAX_TEMPLATES = 60;   // 防 localStorage 膨胀（元数据不大，主要防无界增长）

interface OutfitTplState {
  templates: OutfitTemplate[];
  /** 保存模板；同名覆盖更新并返回原 id（参考图由调用方按返回 id 拷贝）。库满抛错。 */
  saveTemplate: (t: Omit<OutfitTemplate, 'id' | 'createdAt'>) => string;
  patchTemplate: (id: string, patch: Partial<Omit<OutfitTemplate, 'id' | 'createdAt'>>) => void;
  removeTemplate: (id: string) => void;
}

export const useOutfitTemplates = create<OutfitTplState>()(
  persist(
    (set, get): OutfitTplState => ({
      templates: [],
      saveTemplate: (t) => {
        const name = (t.name || '').trim() || '未命名穿搭';
        const cur = get().templates;
        const exist = cur.find((x) => x.name === name);
        if (exist) {
          set({ templates: cur.map((x) => (x.id === exist.id ? { ...x, ...t, name } : x)) });
          return exist.id;
        }
        if (cur.length >= MAX_TEMPLATES) throw new Error(`模板库已满（${MAX_TEMPLATES} 套）——先删几套再存`);
        const id = 'ot_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        set({ templates: [{ ...t, name, id, createdAt: Date.now() }, ...cur] });
        return id;
      },
      patchTemplate: (id, patch) => set((s) => ({ templates: s.templates.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeTemplate: (id) => set((s) => ({ templates: s.templates.filter((x) => x.id !== id) })),
    }),
    { name: 'drpg-outfit-tpl' },
  ),
);
