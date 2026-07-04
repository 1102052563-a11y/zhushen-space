import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 角色创建·自定义内容库（乐园 / 种族 / 天赋）。
 *
 * 玩家自定义或从创意工坊安装的「乐园 / 种族 / 天赋」存这里；
 * 角色创建界面读它，显示为可选项（乐园/种族多一个按钮、天赋多一个可选条目）。
 * 工坊「角色创建模式」安装即写入这里，上传则从这里打包。
 * 纯配置/偏好层，刷新不清（同 settingsStore），不进存档。
 */

export interface CustomParadise { id: string; name: string; desc?: string }
export interface CustomRace { id: string; name: string; detail?: string }
/* 自定义/工坊天赋：与角色创建页天赋编辑器的字段一一对应（name 之外的全部固定格式字段都要存，
   否则「存为自定义天赋 → 上传 → 下载」只剩 name+effect、简描/评级/类型/等级/来源/属性加成全丢）。 */
export interface CustomTalent {
  id: string; name: string;
  effect?: string; desc?: string; rarity?: string; category?: string; level?: string; source?: string; attrBonus?: string;
}
type CustomTalentInput = Omit<CustomTalent, 'id'>;

interface CreationContentState {
  paradises: CustomParadise[];
  races: CustomRace[];
  talents: CustomTalent[];

  addParadise: (p: { name: string; desc?: string }) => void;   // 同名覆盖
  addRace: (r: { name: string; detail?: string }) => void;
  addTalent: (t: CustomTalentInput) => void;
  removeParadise: (id: string) => void;
  removeRace: (id: string) => void;
  removeTalent: (id: string) => void;
}

const rid = (pfx: string) => `${pfx}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const useCreationContent = create<CreationContentState>()(
  persist(
    (set): CreationContentState => ({
      paradises: [],
      races: [],
      talents: [],

      addParadise: ({ name, desc }) => set((s) => {
        const nm = name.trim(); if (!nm) return s;
        const rest = s.paradises.filter((x) => x.name !== nm);
        return { paradises: [{ id: rid('par'), name: nm, desc: desc?.trim() || undefined }, ...rest] };
      }),
      addRace: ({ name, detail }) => set((s) => {
        const nm = name.trim(); if (!nm) return s;
        const rest = s.races.filter((x) => x.name !== nm);
        return { races: [{ id: rid('race'), name: nm, detail: detail?.trim() || undefined }, ...rest] };
      }),
      addTalent: (t) => set((s) => {
        const nm = t.name.trim(); if (!nm) return s;
        const rest = s.talents.filter((x) => x.name !== nm);
        const c = (v?: string) => v?.trim() || undefined;   // 空串→undefined，不落空字段
        return { talents: [{
          id: rid('tal'), name: nm,
          effect: c(t.effect), desc: c(t.desc), rarity: c(t.rarity), category: c(t.category),
          level: c(t.level), source: c(t.source), attrBonus: c(t.attrBonus),
        }, ...rest] };
      }),
      removeParadise: (id) => set((s) => ({ paradises: s.paradises.filter((x) => x.id !== id) })),
      removeRace: (id) => set((s) => ({ races: s.races.filter((x) => x.id !== id) })),
      removeTalent: (id) => set((s) => ({ talents: s.talents.filter((x) => x.id !== id) })),
    }),
    {
      name: 'drpg-creation-content',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CreationContentState>;
        return { ...current, ...p, paradises: p.paradises ?? [], races: p.races ?? [], talents: p.talents ?? [] };
      },
    }
  )
);
