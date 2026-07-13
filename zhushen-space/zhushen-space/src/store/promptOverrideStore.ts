import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 主提示词覆盖（drpg-prompt-override）：玩家在「预设中心」自定义的各功能主提示词。
   key = 注册表（systems/promptRegistry.ts）里的稳定键（多为 promptRules 常量名，如 'ITEM_COT_RULE'）；
   value = 玩家自定义文本。**空 / 缺省 = 用内置默认常量**（不覆盖）。
   `getPrompt(key, 默认)` 在各功能提示词拼接处调用：有非空 override 就用 override，否则用传入的内置默认。
   底层护栏类规则不进本机制（不登记进注册表、拼接处也不包 getPrompt），玩家改不到，防止改坏游戏逻辑。 */
interface PromptOverrideState {
  overrides: Record<string, string>;
  setOverride: (key: string, text: string) => void;
  clearOverride: (key: string) => void;                                   // 恢复默认（删除该 key）
  clearAll: () => void;                                                    // 全部恢复默认
  importOverrides: (map: Record<string, string>, mode: 'merge' | 'replace') => void;
}

export const usePromptOverride = create<PromptOverrideState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (key, text) => set((s) => ({ overrides: { ...s.overrides, [key]: text } })),
      clearOverride: (key) => set((s) => { const o = { ...s.overrides }; delete o[key]; return { overrides: o }; }),
      clearAll: () => set({ overrides: {} }),
      importOverrides: (map, mode) =>
        set((s) => ({ overrides: mode === 'replace' ? { ...map } : { ...s.overrides, ...map } })),
    }),
    { name: 'drpg-prompt-override' },
  ),
);

/** 读某主提示词的生效文本：有非空 override 用 override，否则用传入默认（内置常量）。
    非响应式（在提示词拼接时用 getState 即可）；接入点写法：`getPrompt('KEY', KEY)`。 */
export function getPrompt(key: string, fallback: string): string {
  try {
    const o = usePromptOverride.getState().overrides[key];
    return o && o.trim() ? o : fallback;
  } catch { return fallback; }
}
