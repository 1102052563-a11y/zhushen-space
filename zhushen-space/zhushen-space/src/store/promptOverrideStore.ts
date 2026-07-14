import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { processMacros, makeMacroCtx } from '../systems/stMacros';   // ST 宏引擎：让玩家自定义的主提示词也能用 {{user}}/{{getvar}}/${变量} 等变量标签
import { buildRuntimeVars } from '../systems/runtimeVars';           // 透明变量桥：核心态 + 自定义变量 → 宏可读
import { usePlayer } from './playerStore';

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

/** 对任意提示词文本跑一遍 ST 宏引擎（含变量标签才处理·否则零开销原样返回）。
    支持 {{user}}/{{char}}/{{getvar::名}}/${自定义变量}/{{roll 1d100}}/{{random}} 等，变量取自透明变量桥 buildRuntimeVars（与正文预设同一套宏）。
    ⚠ keepUnknown=true：**未定义变量一律原样保留**（保护默认文本里的 ${player_skills} / JSON 示例 / {{wordTarget}} 等占位符不被误清空）；stripLeftover=false 同理保留合法的 {{。
    **getPrompt（override 类）与各 field 类注入点（前置提示词/剧情指导/细纲/剧情选项/记忆·它们不走 getPrompt）共用本函数**——让「所有功能预设」都能用变量标签。 */
let _lastUserMsg = '';
/** 记录玩家本回合输入 → 供 {{lastUserMessage}}/${玩家输入} 在 renderPrompt/getPrompt 的变量标签里替换（App 主流程发送时 setLastUserMessage）。 */
export function setLastUserMessage(m: string): void { _lastUserMsg = (m || '').trim(); }

export function renderPrompt(text: string): string {
  if (!text || (!text.includes('{{') && !text.includes('${') && !text.includes('<user>'))) return text;
  try {
    const nm = usePlayer.getState().profile.name || '主角';
    return processMacros(text, makeMacroCtx({ user: nm, char: nm, lastUserMessage: _lastUserMsg, runtimeVars: buildRuntimeVars() }), false, true);
  } catch { return text; }
}

/** 读某主提示词的生效文本：有非空 override 用 override，否则用传入默认（内置常量）；再过一遍变量标签替换。
    非响应式（在提示词拼接时用 getState 即可）；接入点写法：`getPrompt('KEY', KEY)`。 */
export function getPrompt(key: string, fallback: string): string {
  const o = usePromptOverride.getState().overrides[key];
  return renderPrompt(o && o.trim() ? o : fallback);
}
