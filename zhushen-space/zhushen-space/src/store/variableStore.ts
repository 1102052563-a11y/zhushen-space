import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GameVariable {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'string';
  value: number | boolean | string;
  min?: number;
  max?: number;
  showInStatusBar: boolean;
  desc?: string;
}

/* 内置「作者旋钮」变量（预设中心变量标签的 B 类驱动）：规则里 {{getvar::键}} 读它们，一处设定长期驱动对应功能的风格/尺度/节奏。
   玩家在「变量管理」改值即生效；**留空 = 默认行为**（各规则都写了兜底）；resetAll/新游戏会清值（=回默认）、定义保留。 */
export const DEFAULT_VARIABLES: GameVariable[] = [
  { key: '亲密尺度', label: '亲密尺度', type: 'string', value: '', showInStatusBar: false, desc: '私聊/亲密场景露骨程度（含蓄/适中/大胆/极致·留空=适中）——驱动 NSFW 写作' },
  { key: '剧情节奏', label: '剧情节奏', type: 'string', value: '', showInStatusBar: false, desc: '亲密/关系推进节奏（慢热/适中/直给·留空=适中）' },
  { key: '关系推进速度', label: '关系推进速度', type: 'string', value: '', showInStatusBar: false, desc: 'NPC 对主角态度四轴推进速度（慢热/正常/快·留空=正常）——慢热更防速堕' },
  { key: '欢愉偏好', label: '欢愉偏好', type: 'string', value: '', showInStatusBar: false, desc: '欢愉宫看板娘伺候基调（如 温柔体贴/强势主导/清纯青涩·留空=各按人设）' },
  { key: '世界观偏好', label: '世界观偏好', type: 'string', value: '', showInStatusBar: false, desc: '新世界世界观口味（如 黑暗残酷/热血王道/诡秘悬疑·留空=纯按世界卡）' },
  { key: '战斗血腥度', label: '战斗血腥度', type: 'string', value: '', showInStatusBar: false, desc: '战斗叙事血腥/残酷程度（克制/适中/血腥·留空=适中）' },
];

interface VariableState {
  variables: GameVariable[];
  setVariable: (key: string, value: GameVariable['value']) => void;
  upsertDefinition: (v: GameVariable) => void;
  removeVariable: (key: string) => void;
  resetAll: () => void;
}

function clampValue(def: GameVariable, value: GameVariable['value']): GameVariable['value'] {
  if (def.type !== 'number' || typeof value !== 'number') return value;
  let v = value;
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  return v;
}

export const useVariables = create<VariableState>()(
  persist(
    (set) => ({
      variables: [...DEFAULT_VARIABLES],

      setVariable: (key, value) =>
        set((s) => ({
          variables: s.variables.map((v) =>
            v.key !== key ? v : { ...v, value: clampValue(v, value) }
          ),
        })),

      upsertDefinition: (def) =>
        set((s) => {
          const exists = s.variables.find((v) => v.key === def.key);
          if (exists) {
            return { variables: s.variables.map((v) => v.key === def.key ? def : v) };
          }
          return { variables: [...s.variables, def] };
        }),

      removeVariable: (key) =>
        set((s) => ({ variables: s.variables.filter((v) => v.key !== key) })),

      resetAll: () =>
        set((s) => ({
          variables: s.variables.map((v) => ({
            ...v,
            value: v.type === 'number' ? (v.min ?? 0) : v.type === 'boolean' ? false : '',
          })),
        })),
    }),
    {
      name: 'drpg-variables',
      // 老存档合并：保留玩家已有变量（定义 + 值），补上内置旋钮里老存档还没有的键（新玩家走上面的初始值）
      merge: (persisted: any, current) => {
        const p: GameVariable[] = persisted?.variables ?? [];
        const has = new Set(p.map((v) => v.key));
        return { ...current, variables: [...p, ...DEFAULT_VARIABLES.filter((d) => !has.has(d.key))] };
      },
    }
  )
);
