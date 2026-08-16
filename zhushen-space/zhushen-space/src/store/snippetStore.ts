import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ── 🧩 片段库（drpg-snippets）───────────────────────────────────────────────
   可复用提示词片段：任意正文预设 / 世界书 / 玩家自定义提示词里写 {{include::片段名}}，
   发送时由 systems/promptExpand.expandIncludes 展开（深度上限 3 防循环引用）。
   配置类玩家资产：**不进 saveManager STORES**（与 drpg-prompt-override 同精神——换档/新游戏/读老档都不动它），
   已进 systems/configExport 随全局配置一键备份迁移。 */

export interface PromptSnippet { id: string; name: string; content: string; }

interface SnippetState {
  items: PromptSnippet[];
  upsert: (s: PromptSnippet) => void;
  remove: (id: string) => void;
}

export const useSnippets = create<SnippetState>()(
  persist(
    (set): SnippetState => ({
      items: [],
      upsert: (s) => set((st) => {
        const i = st.items.findIndex((x) => x.id === s.id);
        const items = [...st.items];
        if (i === -1) items.push(s); else items[i] = s;
        return { items };
      }),
      remove: (id) => set((st) => ({ items: st.items.filter((x) => x.id !== id) })),
    }),
    { name: 'drpg-snippets' },
  ),
);

/** 名字→内容映射（展开用·名字 trim·同名后定义覆盖先定义）。 */
export function snippetMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of useSnippets.getState().items) {
    const n = (s.name || '').trim();
    if (n) out[n] = s.content || '';
  }
  return out;
}

/** 新片段工厂（面板「＋添加」用）。 */
export function newSnippet(): PromptSnippet {
  return { id: 'sn_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: '', content: '' };
}
