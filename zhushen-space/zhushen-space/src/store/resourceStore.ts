import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlayerAttrs } from './playerStore';

/* 自定义能量条（MVP·仅主角·纯展示+剧情资源）：HP/EP 之外玩家自设的资源条，
   如 怒气值 / 堕落值 / 灵力 / 饱食度…。每条有机器键 id（ASCII，供 <state> 的 `res.B1.<id>` 指令）+ 显示名 name。
   - 上限 max：固定数值，或 maxFormula 六维系数表（复用 derivedStats 的加权和；见 playerVitals.playerResourceMax）。
   - 当前值 cur：只由正文 `res.B1.<id>` 指令驱动并钳到 [0,max]，前端不自动回满/回血（忠于正文）。
   - 仅玩家在面板定义；AI 不能自创（解析器对未定义 id 的指令直接忽略）。
   名称「只出不进」：机器通道永远用 id，name 只用于渲染 + 喂 AI 行文。 */
export interface CustomResource {
  id: string;            // 机器键（ASCII，唯一）：rage / corruption …
  name: string;          // 显示名：怒气值 / 堕落值
  cur: number;           // 当前值
  max?: number;          // 固定上限（与 maxFormula 二选一；都没有→默认 100）
  maxFormula?: Partial<Record<keyof PlayerAttrs, number>>;   // 六维公式上限 {属性:每点系数}，如 {int:30,con:5}=智×30+体×5
  color?: string;        // 进度条颜色（tailwind bg-* 类名；空=默认翠绿）
  desc?: string;         // 给 AI 的语义说明（这值代表什么、何时涨何时落——AI 据此驱动）
  inject?: boolean;      // 是否注入正文给 AI（默认 true）
  combat?: {             // 战斗内累积（可选）：战斗中按事件自动增减，钳到 [0,上限]；不配=战斗中不自动变（仅技能消耗/剧情驱动）
    onAttack?: number;       // B1 攻击/施放技能时 +N
    onHitTaken?: number;     // B1 受到伤害时 +N
    onKill?: number;         // B1 击杀敌人时 +N（每击杀一名）
    onTurn?: number;         // B1 每回合 +N（出手即触发一次）
    resetEachBattle?: boolean;  // 每场战斗开始归零（如怒气从 0 攒起）
  };
}

interface ResourceState {
  resources: CustomResource[];
  addResource: (r?: Partial<CustomResource>) => string;            // 返回新建 id
  updateResource: (id: string, patch: Partial<CustomResource>) => void;
  removeResource: (id: string) => void;
  setCur: (id: string, cur: number) => void;                       // 解析器写当前值（已钳制）
  clearResources: () => void;                                      // 新游戏清空
}

/* 规范化机器键：只留 ASCII 词字符，避免和 `res.B1.<id>` 指令解析（key 正则 [\w.]+）冲突。 */
function normId(raw?: string, fallback = ''): string {
  const s = String(raw ?? '').trim().replace(/[^A-Za-z0-9_]/g, '');
  return s || fallback;
}

export const useResource = create<ResourceState>()(
  persist(
    (set): ResourceState => ({
      resources: [],
      addResource: (r) => {
        const id = normId(r?.id, `res${Date.now().toString(36)}`);
        set((s) => {
          if (s.resources.some((x) => x.id === id)) return s;   // id 撞车不重复加
          return { resources: [...s.resources, { id, name: r?.name || '新能量', cur: Math.max(0, r?.cur ?? 0), max: r?.max ?? 100, color: r?.color, desc: r?.desc, maxFormula: r?.maxFormula, inject: r?.inject ?? true, combat: r?.combat }] };
        });
        return id;
      },
      updateResource: (id, patch) =>
        set((s) => ({ resources: s.resources.map((x) => (x.id === id ? { ...x, ...patch, id: patch.id ? normId(patch.id, x.id) : x.id } : x)) })),
      removeResource: (id) => set((s) => ({ resources: s.resources.filter((x) => x.id !== id) })),
      setCur: (id, cur) => set((s) => ({ resources: s.resources.map((x) => (x.id === id ? { ...x, cur } : x)) })),
      clearResources: () => set({ resources: [] }),
    }),
    { name: 'drpg-resource' },
  ),
);
