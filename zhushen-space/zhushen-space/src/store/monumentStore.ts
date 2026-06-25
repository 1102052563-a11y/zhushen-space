import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlayerAttrs } from './playerStore';

/* ════════════════════════════════════════════════════════════════════════
   纪念丰碑 · 全局英灵殿（跨存档持久化）

   关键设计（务必理解，否则"在之后的存档里召唤"会失效）：
   本 store 用**独立** localStorage 键 `drpg-monument`，且**故意不**登记进
   systems/saveManager.ts 的 STORES 注册表 →
     · 不随存档快照保存/读取（loadSlot 只写 STORES 里的键）；
     · 不被「新游戏 / 开局建角」清空（clearProgress 只清 STORES 里带 clear 的）；
     · 仅靠自身 persist 落 localStorage，跨 reload / 跨存档 / 跨新局一直都在。
   → 立的碑是玩家账号级的「传承」，任何后续存档里都能召唤。

   被「召唤」出来的英灵是普通 npcStore 记录（随当前存档持久化、打 monumentId 标记），
   与本 store 解耦——同 systems/assistApply.ts materializeAssist 的范式。
════════════════════════════════════════════════════════════════════════ */

/** 一名入碑英灵的完整面板快照（主角的"所有信息"，召唤时还原成 NPC 面板）。
 *  与游戏内强类型解耦（用宽松结构），避免跨模块强耦合、便于向后兼容。 */
export interface MonumentSnapshot {
  // ── 身份 / 主角面板 ──
  name: string;
  gender?: string;
  tier?: string;            // 阶位（一阶/二阶…）
  level?: number;           // 等级
  title?: string;           // 当前装备的称号
  profession?: string;      // 职业
  identity?: string;        // 身份
  arenaRank?: string;       // 竞技场排名
  race?: string;
  raceDetail?: string;      // 种族详情
  homeParadise?: string;    // 所属乐园
  preParadiseJob?: string;  // 入园前职业（主角背景出身）
  brandLevel?: string;      // 烙印等级
  bioStrength?: string;     // 生物强度模板
  contractorId?: string;    // 契约者编号
  personality?: string;
  personalityDetail?: string;
  appearance?: string;
  // ── 六维 / 血蓝 ──
  attrs?: Record<string, number>;       // 有效六维（含技能树/团队/装备/技能天赋加成；召唤后直接当 NPC 六维，战力一致）
  baseAttrs?: Record<string, number>;   // 基础六维（仅展示用，留档完整）
  maxHp?: number;
  maxEp?: number;
  hpRatio?: Partial<Record<keyof PlayerAttrs, number>>;  // HP 系数表（召唤时套用）
  epRatio?: Partial<Record<keyof PlayerAttrs, number>>;  // EP 系数表
  line?: string;            // 「阶位·职业 力X 敏Y…」摘要行
  // ── 能力 ──
  skills?: any[];
  traits?: any[];
  titles?: any[];           // 称号库（全部，含未装备）
  subProfessions?: any[];   // 副职业（含名下配方）
  achievements?: any[];     // 成就
  // ── 物品 / 财富 ──
  equipment?: any[];        // 已装备（已剥图）
  items?: any[];            // 储存空间（已剥图）
  currencies?: { label: string; amount: number }[];  // 乐园币/灵魂钱币/技能点/黄金技能点/属性点…
  resources?: { name: string; cur: number; max: number }[];  // 自定义能量条
  // ── 生平 ──
  background?: string;      // 主角背景/出身
  deedLog?: any[];          // 经历时间线（生平总结的素材）
  avatar?: string;          // 立绘（已压缩 dataURL / http；可空）
}

export interface MonumentEntry {
  id: string;
  enshrinedAt: number;      // 入碑时间
  world?: string;           // 入碑时所在世界
  turn?: number;            // 入碑时累计回合数
  snapshot: MonumentSnapshot;
  summary?: string;         // AI 生平总结
  eulogy?: string;          // AI 结语（碑文）
  eulogyStatus?: 'pending' | 'done' | 'error';  // 生平/结语生成状态（pending=生成中；error=接口未配/失败，可重试）
}

interface MonumentState {
  entries: Record<string, MonumentEntry>;
  enshrine: (e: { snapshot: MonumentSnapshot; world?: string; turn?: number }) => string;  // 立碑，返回新条目 id
  updateEntry: (id: string, patch: Partial<MonumentEntry>) => void;
  removeEntry: (id: string) => void;
  clearAll: () => void;     // 清空全碑（仅供面板手动调用——绝不挂进 clearProgress）
}

export const useMonument = create<MonumentState>()(
  persist(
    (set): MonumentState => ({
      entries: {},
      enshrine: ({ snapshot, world, turn }) => {
        const id = `M${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        set((s) => ({
          entries: {
            ...s.entries,
            [id]: { id, enshrinedAt: Date.now(), world, turn, snapshot, eulogyStatus: 'pending' },
          },
        }));
        return id;
      },
      updateEntry: (id, patch) =>
        set((s) => (s.entries[id] ? { entries: { ...s.entries, [id]: { ...s.entries[id], ...patch } } } : s)),
      removeEntry: (id) =>
        set((s) => {
          if (!s.entries[id]) return s;
          const next = { ...s.entries };
          delete next[id];
          return { entries: next };
        }),
      clearAll: () => set({ entries: {} }),
    }),
    { name: 'drpg-monument' },   // 独立键，**不**纳入 saveManager STORES → 跨存档/跨新局常驻
  ),
);
