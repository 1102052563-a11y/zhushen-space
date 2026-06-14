# State Update 系统实现计划

参考：`fanren-remake-public-assets` 的 `<state>` / `<upstore>` 机制。  
目标：让 AI 在每次正文回复末尾输出结构化变量更新指令，前端自动解析并写入 Zustand store，无需安装 SillyTavern MVU 插件。

---

## 一、架构概览

```
AI 输出
  │
  ├─ 正文内容 ──────────────────────────────────→ 聊天窗口显示
  │
  └─ <state> 块（隐藏）
        │
        ▼
   parseStateBlock()         ← 提取 <state> 内容
        │
        ▼
   parseStateLines()         ← 按行解析成 Update[]
        │                       [{ key, op, value }, ...]
        ▼
   applyUpdates()            ← 写入 gameStore / variableStore
        │
        ▼
   UI 自动刷新（角色面板、状态栏等）
```

fanren-remake 的完整处理链：
- `ST()` 按标签分块 → `oT()` 主解析 → `TT()` 解析 `<state>` 体 → `oE()` 分行 → `ET()`/`CT()` 解析每行 → `WT()` 累积 `{ path, operator, value }[]` → 深路径写入 store

---

## 二、变量格式设计

### 2.1 `<state>` 标签

AI 在每轮回复的**末尾**（`</content>` 之后，或正文结束后）输出一个 `<state>` 块：

```
<state>
hp -= 15
san -= 5
gold += 30
stamina = 80
buff.poisoned = true
item.add = 符箓
item.remove = 草药×2
flag.foundSecret = true
</state>
```

- 标签内容不在聊天窗口显示（前端正则剥除）
- 支持注释行（`//` 或 `#` 开头）
- 每行一条指令，空行跳过

### 2.2 指令语法

| 语法 | 含义 | 示例 |
|------|------|------|
| `key = value` | 直接赋值 | `hp = 80` |
| `key += value` | 加法（数字）| `gold += 50` |
| `key -= value` | 减法（数字）| `hp -= 15` |
| `key = true/false` | 布尔值 | `flag.metKing = true` |
| `key = "string"` | 字符串 | `location = "王都"` |
| `item.add = 物品名` | 背包加物品 | `item.add = 解毒丹` |
| `item.remove = 物品名` | 背包移除 | `item.remove = 符箓` |

> **与 fanren-remake 的异同**：
> fanren-remake 使用有命名空间的长路径（`characters.B1.stats.hp.current`），本系统用扁平 key，适合轻量级 RPG，实现更简单。

### 2.3 内置变量（直接映射 gameStore.player）

| key | 类型 | 说明 | 约束 |
|-----|------|------|------|
| `hp` | number | 当前生命值 | [0, maxHp] |
| `maxHp` | number | 最大生命值 | [1, ∞) |
| `san` | number | 精神值 | [0, maxSan] |
| `maxSan` | number | 最大精神值 | [1, ∞) |
| `points` | number | 积分 | [0, ∞) |

### 2.4 自定义变量（variableStore）

用户可在"变量管理"面板自定义任意变量（存 localStorage）：

```typescript
interface GameVariable {
  key: string;           // 唯一标识，如 "gold", "rep_merchant"
  label: string;         // 显示名称，如 "金币", "商人声望"
  type: 'number' | 'boolean' | 'string';
  value: number | boolean | string;
  min?: number;          // 仅 number 类型
  max?: number;
  showInStatusBar: boolean;  // 是否显示在角色面板
  desc?: string;
}
```

---

## 三、需要新增/修改的文件

```
src/
├── store/
│   ├── gameStore.ts          ← 修改：扩展 player 字段，加 maxHp/maxSan
│   ├── settingsStore.ts      ← 已有，无需修改
│   └── variableStore.ts      ← 新增：自定义变量的 CRUD + persist
│
├── systems/
│   └── stateParser.ts        ← 新增：parseStateBlock / applyUpdates 核心逻辑
│
├── components/
│   ├── StatusBar.tsx         ← 修改：显示自定义变量
│   ├── SettingsPanel.tsx     ← 修改：加"变量管理"入口和面板
│   └── VariableManager.tsx   ← 新增：变量管理 UI（定义/编辑/重置）
│
└── App.tsx                   ← 修改：在 applyRegex 之后调用 applyStateUpdates
```

---

## 四、具体实现步骤

### Step 1：新建 `variableStore.ts`

```typescript
// src/store/variableStore.ts
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

interface VariableState {
  variables: GameVariable[];
  setVariable: (key: string, value: GameVariable['value']) => void;
  upsertDefinition: (v: GameVariable) => void;
  removeVariable: (key: string) => void;
  resetAll: () => void;
  getAll: () => Record<string, GameVariable['value']>;
}

export const useVariables = create<VariableState>()(
  persist(
    (set, get) => ({
      variables: [],

      setVariable: (key, value) =>
        set((s) => ({
          variables: s.variables.map((v) =>
            v.key !== key ? v : {
              ...v,
              value: clampValue(v, value),
            }
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

      getAll: () => {
        const map: Record<string, GameVariable['value']> = {};
        get().variables.forEach((v) => { map[v.key] = v.value; });
        return map;
      },
    }),
    { name: 'drpg-variables' }
  )
);

function clampValue(def: GameVariable, value: GameVariable['value']): GameVariable['value'] {
  if (def.type !== 'number' || typeof value !== 'number') return value;
  let v = value;
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  return v;
}
```

### Step 2：新建 `stateParser.ts`

**这是核心，参考 fanren-remake 的 `oE()` + `CT()` + `TT()` 逻辑简化版：**

```typescript
// src/systems/stateParser.ts

export interface StateUpdate {
  key: string;
  op: '=' | '+=' | '-=';
  value: string | number | boolean;
  raw: string;   // 原始行，方便调试
}

// ── 1. 从完整文本中提取 <state> 块内容 ──
const STATE_BLOCK_RE = /<state\b[^>]*>([\s\S]*?)<\/state>/gi;
const STATE_BLOCK_INCOMPLETE_RE = /<state\b[^>]*>[\s\S]*$/i;  // 流式截断兜底

export function extractStateBlocks(text: string): string[] {
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  STATE_BLOCK_RE.lastIndex = 0;
  while ((m = STATE_BLOCK_RE.exec(text)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

// ── 2. 把 <state> 块从显示文本中剥除（由 applyRegex 后处理，或直接在这里做）──
export function stripStateBlocks(text: string): string {
  return text
    .replace(STATE_BLOCK_RE, '')
    .replace(STATE_BLOCK_INCOMPLETE_RE, '')
    .trimEnd();
}

// ── 3. 解析单行指令 ──
function parseLine(line: string): StateUpdate | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return null;

  // item.add / item.remove 特殊处理
  const itemMatch = trimmed.match(/^item\.(add|remove)\s*=\s*(.+)$/i);
  if (itemMatch) {
    return { key: `item.${itemMatch[1]}`, op: '=', value: itemMatch[2].trim(), raw: line };
  }

  // 标准 key (op) value
  const match = trimmed.match(/^([\w.]+)\s*([-+]?=)\s*([\s\S]*)$/);
  if (!match) return null;

  const [, key, op, rawVal] = match;
  const value = parseValue(rawVal.trim());
  if (value === undefined) return null;

  return {
    key,
    op: op as StateUpdate['op'],
    value,
    raw: line,
  };
}

function parseValue(s: string): StateUpdate['value'] | undefined {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '') return undefined;
  // 带引号的字符串
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  // 数字
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  // 裸字符串（不带引号）
  return s;
}

// ── 4. 解析完整 <state> 块体 ──
export function parseStateBlock(blockContent: string): StateUpdate[] {
  const lines = blockContent.split('\n');
  const updates: StateUpdate[] = [];
  for (const line of lines) {
    const update = parseLine(line);
    if (update) updates.push(update);
  }
  return updates;
}

// ── 5. 从完整 AI 输出中提取所有 updates ──
export function parseAllStateUpdates(text: string): StateUpdate[] {
  const blocks = extractStateBlocks(text);
  return blocks.flatMap(parseStateBlock);
}
```

### Step 3：修改 `gameStore.ts`

扩展 player 类型，增加 `maxHp`、`maxSan` 字段：

```typescript
// 现有 Player 接口扩展
interface Player {
  hp: number;
  maxHp: number;   // 新增
  san: number;
  maxSan: number;  // 新增
  points: number;
  cleared: string[];
  runs: number;
}

// 初始值
const INITIAL_PLAYER: Player = {
  hp: 100, maxHp: 100,
  san: 100, maxSan: 100,
  points: 0,
  cleared: [],
  runs: 0,
};
```

### Step 4：修改 `App.tsx` —— 在正文生成后应用变量更新

在 `applyRegex` 之后，流式结束后和非流式完成后，各加一次调用：

```typescript
// 引入
import { parseAllStateUpdates, stripStateBlocks } from './systems/stateParser';
import { useVariables } from './store/variableStore';
import { useGame } from './store/gameStore';

// 在 App() 组件内
const applyState = useVariables((s) => s.setVariable);
const setPlayer  = useGame((s) => s.setPlayerField);  // 需在 gameStore 里加该 action

function applyStateUpdates(text: string) {
  const updates = parseAllStateUpdates(text);
  if (updates.length === 0) return;

  console.log('[State] 解析到变量更新:', updates);

  for (const u of updates) {
    try {
      applyOneUpdate(u);
    } catch (e) {
      console.warn('[State] 应用更新失败:', u, e);
    }
  }
}

function applyOneUpdate(u: StateUpdate) {
  const { key, op, value } = u;

  // ── 内置变量：映射到 gameStore.player ──
  const builtins: Record<string, (v: number) => void> = {
    hp:     (v) => setPlayer('hp', v),
    maxHp:  (v) => setPlayer('maxHp', v),
    san:    (v) => setPlayer('san', v),
    maxSan: (v) => setPlayer('maxSan', v),
    points: (v) => setPlayer('points', v),
  };

  if (key in builtins && typeof value === 'number') {
    const current = getPlayerField(key);   // 从 gameStore 读当前值
    const next =
      op === '+=' ? current + value :
      op === '-=' ? current - value :
      value;
    builtins[key](next);
    return;
  }

  // ── 物品：背包操作 ──
  if (key === 'item.add' && typeof value === 'string') {
    addItem(value);   // gameStore 里的背包 action
    return;
  }
  if (key === 'item.remove' && typeof value === 'string') {
    removeItem(value);
    return;
  }

  // ── 自定义变量 ──
  const vars = useVariables.getState().variables;
  const def = vars.find((v) => v.key === key);
  if (!def) {
    console.warn(`[State] 未知变量 "${key}"，跳过`);
    return;
  }

  if (def.type === 'number' && typeof value === 'number') {
    const cur = typeof def.value === 'number' ? def.value : 0;
    const next = op === '+=' ? cur + value : op === '-=' ? cur - value : value;
    applyState(key, next);
  } else if (def.type === 'boolean') {
    applyState(key, Boolean(value));
  } else {
    applyState(key, String(value));
  }
}
```

**在流式结束后调用：**

```typescript
// 流结束后（已有的 applyRegex 调用之后）
const finalDisplayed = applyRegex(accumulated, preset);
applyStateUpdates(accumulated);   // ← 新增，用原始内容解析（正则可能已剥除 state 块）
const cleanedForDisplay = stripStateBlocks(finalDisplayed);  // ← 从显示内容中剥除 state 块

setMessages((prev) =>
  prev.map((m) => m.id === streamMsgId ? { ...m, content: cleanedForDisplay } : m)
);
```

> **注意**：`applyStateUpdates` 应在 `applyRegex` **之前**用原始 `accumulated` 调用，因为有些正则可能会破坏 `<state>` 结构。

### Step 5：新建 `VariableManager.tsx`

变量管理面板，包含：
1. **变量定义列表**：key、label、类型、当前值、min/max、是否显示在状态栏
2. **新建/编辑**：弹出表单
3. **一键重置**：把所有变量恢复到初始值
4. **手动修改**：直接在表格里修改当前值（调试用）

```tsx
// src/components/VariableManager.tsx
// （完整 UI 组件，包含 CRUD 操作）

export default function VariableManager() {
  const variables = useVariables((s) => s.variables);
  const setVariable = useVariables((s) => s.setVariable);
  const upsert = useVariables((s) => s.upsertDefinition);
  const remove = useVariables((s) => s.removeVariable);
  const resetAll = useVariables((s) => s.resetAll);

  // ... 渲染变量列表、编辑表单
}
```

### Step 6：修改 `SettingsPanel.tsx`

在"综合设置"页（已有）中，加入**变量管理**入口，或在设置首页单独加一个"变量管理"按钮。

### Step 7：修改 `StatusBar.tsx`

读取 `variableStore` 中 `showInStatusBar = true` 的变量，追加在内置数值之后显示。

---

## 五、Prompt 注入方案

为了让 AI 知道要输出 `<state>` 块，需要在正文预设的 system prompt 里注入格式说明。

**注入方式**（在 `buildPresetMessages` 中自动附加，或让用户自己写进预设）：

```
## 状态更新协议
每轮回复结束时，在 </content> 之后输出一个 <state> 块，包含本轮发生的数值变化。
格式：每行一条，key += 数字 / key -= 数字 / key = 值。
可用变量：hp（生命值）、san（精神）、points（积分）、gold（金币）……以及用户自定义变量。
无变化时不输出 <state> 块。
示例：
<state>
hp -= 20
san -= 5
gold += 100
flag.meKingVisited = true
</state>
```

**或者**：在综合设置里提供一个"变量提示词模板"文本框，自动将其追加到每次请求的 system prompt 末尾。这样用户可以自定义哪些变量、约束规则。

---

## 六、注意事项 & 坑

| 问题 | 解决方案 |
|------|---------|
| 流式生成中 `<state>` 块还未闭合 | 只在流结束后解析，不在每个 delta 跑（已解决，当前架构已是流结束后统一处理） |
| 正则脚本可能会把 `<state>` 内容清掉 | `applyStateUpdates` 用**原始 `accumulated`** 调用，在 `applyRegex` 之前执行 |
| AI 不按格式输出 | 添加 console 日志提示，不强制（容错，解析失败直接跳过） |
| `+=` 对字符串类型无意义 | 类型检查，string 类型忽略 `+=`/`-=`，改为报 warning |
| 内置变量需要 clamp（hp 不能超 maxHp）| `applyOneUpdate` 写完后触发 `clampPlayer()`（gameStore 已有此逻辑） |
| 自定义变量未定义就出现在 state 块里 | 可选：自动创建为 string 类型（宽松模式），或跳过并 warning（严格模式）—— 做成可配置 |

---

## 七、开发顺序

```
Day 1  ─ Step 1: variableStore.ts（含 persist）
Day 1  ─ Step 2: stateParser.ts（parseStateBlock / stripStateBlocks）
Day 1  ─ Step 3: gameStore.ts 加 maxHp/maxSan 和 setPlayerField
Day 2  ─ Step 4: App.tsx 接入 applyStateUpdates + stripStateBlocks
Day 2  ─ Step 5: VariableManager.tsx 基础 CRUD UI
Day 3  ─ Step 6: SettingsPanel 加入口
Day 3  ─ Step 7: StatusBar 显示自定义变量
Day 3  ─ Prompt 模板：综合设置里加"变量提示词"文本框
```

---

## 八、最终效果预期

```
用户输入：探索山洞，遭遇山贼

AI 回复：
[正文内容：遭遇山贼，激战后击退，获得战利品……]

<state>
// 本轮战斗结算
hp -= 25
san -= 10
points += 80
gold += 150
item.add = 铁剑
flag.beatenBandits = true
</state>

↓ 前端处理

聊天窗口：只显示正文，<state> 块不可见
左侧角色面板：HP 100→75，SAN 100→90，积分 +80
背包：新增"铁剑"
自定义变量：gold 150，flag.beatenBandits true
```
