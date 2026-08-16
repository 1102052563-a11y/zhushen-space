import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { expandPromptText, makePromptExpandCtx } from '../systems/promptExpand';   // 统一展开：表格模板(<if var/cell/cond>) → ST 宏({{user}}/{{getvar}}/${变量})
import { hasTableTemplates } from '../systems/tableTemplate';                       // 快路径：含模板标记才进展开
import type { PromptInject } from '../systems/customInject';                        // 🎯 自定义注入条目类型（应用逻辑在 systems/customInject·App 发送前调用）
import { usePlayer } from './playerStore';

/* 主提示词覆盖（drpg-prompt-override）：玩家在「预设中心」自定义的各功能主提示词。
   key = 注册表（systems/promptRegistry.ts）里的稳定键（多为 promptRules 常量名，如 'ITEM_COT_RULE'）；
   value = 玩家自定义文本。**空 / 缺省 = 用内置默认常量**（不覆盖）。
   `getPrompt(key, 默认)` 在各功能提示词拼接处调用：有非空 override 就用 override，否则用传入的内置默认。
   底层护栏类规则不进本机制（不登记进注册表、拼接处也不包 getPrompt），玩家改不到，防止改坏游戏逻辑。 */
interface PromptOverrideState {
  overrides: Record<string, string>;
  /* 底稿签名（借鉴 SoulLink 的旧默认迁移思想·实现改为免快照的 hash 方案）：
     sigs[key] = **保存那一刻内置默认文本的短 hash**（promptRegistry.promptSig）。
     用途：内置默认后来更新时——若玩家存的文本 hash 仍等于 sigs[key]（=当年保存时根本没改），
     启动对账 reconcilePromptDefaults 会自动清掉冗余副本、让玩家吃到新版默认；真改过的只挂徽章提醒。
     field 类条目（预设中心里绑 store 字段的）也借这张表记 sig，key 同注册表键。 */
  sigs: Record<string, string>;
  injects: PromptInject[];   // 🎯 自定义注入条目（预设中心编辑·App 发送前 applyCustomInjects 作用于最终 messages）
  setOverride: (key: string, text: string, defSig?: string) => void;
  clearOverride: (key: string) => void;                                   // 恢复默认（删除该 key，连带 sig）
  clearAll: () => void;                                                    // 全部恢复默认
  importOverrides: (map: Record<string, string>, mode: 'merge' | 'replace') => void;
  setSig: (key: string, sig: string) => void;                              // field 类条目记/更新底稿签名
  clearSig: (key: string) => void;
  upsertInject: (j: PromptInject) => void;
  removeInject: (id: string) => void;
}

export const usePromptOverride = create<PromptOverrideState>()(
  persist(
    (set): PromptOverrideState => ({
      overrides: {},
      sigs: {},
      injects: [],
      setOverride: (key, text, defSig) => set((s) => ({
        overrides: { ...s.overrides, [key]: text },
        // 给了 defSig 就记录；没给（旧调用方/导入）则清掉旧 sig——旧 sig 对新文本已无意义
        sigs: defSig ? { ...s.sigs, [key]: defSig } : (() => { const g = { ...s.sigs }; delete g[key]; return g; })(),
      })),
      clearOverride: (key) => set((s) => {
        const o = { ...s.overrides }; delete o[key];
        const g = { ...s.sigs }; delete g[key];
        return { overrides: o, sigs: g };
      }),
      clearAll: () => set({ overrides: {}, sigs: {} }),
      importOverrides: (map, mode) =>
        set((s) => {
          // 导入的文本出处不明，一律清掉对应 key 的 sig（否则会把导入文本误判成"当年的默认"而被自动升级清掉）
          const g = mode === 'replace' ? {} : { ...s.sigs };
          if (mode === 'merge') for (const k of Object.keys(map)) delete g[k];
          return { overrides: mode === 'replace' ? { ...map } : { ...s.overrides, ...map }, sigs: g };
        }),
      setSig: (key, sig) => set((s) => ({ sigs: { ...s.sigs, [key]: sig } })),
      clearSig: (key) => set((s) => { const g = { ...s.sigs }; delete g[key]; return { sigs: g }; }),
      upsertInject: (j) => set((s) => {
        const list = Array.isArray(s.injects) ? [...s.injects] : [];
        const i = list.findIndex((x) => x.id === j.id);
        if (i === -1) list.push(j); else list[i] = j;
        return { injects: list };
      }),
      removeInject: (id) => set((s) => ({ injects: (Array.isArray(s.injects) ? s.injects : []).filter((x) => x.id !== id) })),
    }),
    { name: 'drpg-prompt-override' },
  ),
);

/** 对任意提示词文本跑一遍统一展开（含变量标签/模板标记才处理·否则零开销原样返回）。
    支持 {{user}}/{{char}}/{{getvar::名}}/${自定义变量}/{{roll 1d100}}/{{random}}，以及表格模板 <if var="主角.HP百分比 < 30">/<if cell/cond>/计算标签（与正文预设同一套引擎）。
    ⚠ keepUnknown=true：**未定义变量一律原样保留**（保护默认文本里的 ${player_skills} / JSON 示例 / {{wordTarget}} 等占位符不被误清空）；stripLeftover=false 同理保留合法的 {{。
    ⚠ 本通道拿不到最新正文 → <if seed> 恒判否（按正文关键词分支请写在正文预设/世界书里）。
    **getPrompt（override 类）与各 field 类注入点（前置提示词/剧情指导/细纲/剧情选项/记忆·它们不走 getPrompt）共用本函数**——让「所有功能预设」都能用变量标签。 */
let _lastUserMsg = '';
/** 记录玩家本回合输入 → 供 {{lastUserMessage}}/${玩家输入} 在 renderPrompt/getPrompt 的变量标签里替换（App 主流程发送时 setLastUserMessage）。 */
export function setLastUserMessage(m: string): void { _lastUserMsg = (m || '').trim(); }

export function renderPrompt(text: string): string {
  if (!text || (!text.includes('{{') && !text.includes('${') && !text.includes('<user>') && !hasTableTemplates(text))) return text;
  try {
    const nm = usePlayer.getState().profile.name || '主角';
    return expandPromptText(text, makePromptExpandCtx({ user: nm, char: nm, lastUserMessage: _lastUserMsg }), false, true);
  } catch { return text; }
}

/** 读某主提示词的生效文本：有非空 override 用 override，否则用传入默认（内置常量）；再过一遍变量标签替换。
    非响应式（在提示词拼接时用 getState 即可）；接入点写法：`getPrompt('KEY', KEY)`。 */
export function getPrompt(key: string, fallback: string): string {
  const o = usePromptOverride.getState().overrides[key];
  return renderPrompt(o && o.trim() ? o : fallback);
}
