import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 角色创建模板：把开局设定（难度/乐园/基本信息/六维/天赋/契约者ID）存为可复用模板。 */
export interface CreationTemplateData {
  difficulty: string;
  paradise: string;
  paradiseCustom: string;
  name: string;
  gender?: string;       // 性别（选择项；'其他' 时取 genderCustom）
  genderCustom?: string;
  race?: string;         // 种族（选择项；'自定义' 时取 raceCustom）
  raceCustom?: string;
  raceDetail?: string;   // 种族详情（自由文本：特征/能力/弱点等）
  age: string;
  personality: string;
  personalityDetail?: string;   // 性格详细描述（自由文本，注入 AI 上下文 + 主角面板点击查看）
  prevProfession: string;
  appearance?: string;   // 基底外观（开局设定，生图基准）
  attrs: { str: number; agi: number; con: number; int: number; cha: number; luck: number };
  talentName: string;
  talentEffect: string;
  talentRarity?: string;     // 天赋评级 D~SSS（固定格式）
  talentCategory?: string;   // 天赋类型
  talentLevel?: string;      // 天赋等级
  talentSource?: string;     // 来源/觉醒方式
  talentAttrBonus?: string;  // 属性加成
  talentDesc?: string;       // 简描
  contractId: string;
  // 开局携带物品 / 随行人物（提示词 + 已生成的预览结果；生成走物品演化/NPC演化 API，确认开局带入/在场）
  startItemsPrompt?: string;   // 携带物品·生成提示词
  startItems?: any[];          // 已生成的携带物品（固定格式字段·预览+开局入库）
  companionsPrompt?: string;   // 随行人物·生成提示词
  companions?: any[];          // 已生成的随行随从（NPC 建档字段·预览+开局在场入队）
}
export interface SavedTemplate { id: string; name: string; createdAt: number; data: CreationTemplateData }

interface CreationTemplateState {
  templates: SavedTemplate[];
  addTemplate: (name: string, data: CreationTemplateData) => void;  // 同名覆盖
  removeTemplate: (id: string) => void;
}

export const useCreationTemplates = create<CreationTemplateState>()(
  persist(
    (set) => ({
      templates: [],
      addTemplate: (name, data) =>
        set((s) => {
          const nm = name.trim() || `模板 ${new Date().toLocaleString()}`;
          const idx = s.templates.findIndex((t) => t.name === nm);
          const entry: SavedTemplate = { id: idx >= 0 ? s.templates[idx].id : `tpl_${Date.now()}`, name: nm, createdAt: Date.now(), data };
          const next = [...s.templates];
          if (idx >= 0) next[idx] = entry; else next.unshift(entry);
          return { templates: next };
        }),
      removeTemplate: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),
    }),
    { name: 'drpg-creation-templates' }
  )
);
