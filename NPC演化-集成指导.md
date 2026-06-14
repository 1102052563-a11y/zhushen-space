# NPC 演化功能 —— zhushen-space 集成指导

> 本文档面向"下一个开发窗口"。目标：把 `fanren-remake-public-assets` 中的 **NPC 演化（npc evolution）** 玩法，移植/适配到本仓库前端 `zhushen-space`，并保持轮回乐园世界观。
>
> 读完本文你应当能在不重新调研整个代码库的情况下直接落地。涉及到的所有现有代码位置、可复用模式、需要新建的文件、AI 指令协议、预设来源都已列出。

---

## 0. 一句话概括

主角演化（player evolution）已经在前端跑通了。**NPC 演化就是"主角演化"的多角色版本**：它不再只维护 B1（玩家），而是为正文中出现的每一个 NPC（`C1/C2/G1…`）维护一张更丰富的角色档案（境界、状态、性格、关系、好感度、动机、外貌等 0~34 列），并通过 `add()/de()/addSkill()/addTrait()` 指令增量更新。

因此**实现路径 = 克隆主角演化的全套结构 + 新增一个 NPC 数据仓库 + 扩展指令解析器支持 `add()/de()`**。

> **本项目已确定采用「策略 B：逐 NPC 并发，忠实原版」**（不是单次多 NPC 的简化版）。其完整管线是三段：
> **① 登场判断（entry-judgment）**：一次调用，扫描正文 → 输出 entries/exits/deeds JSON，决定谁登场/退场、给新 NPC 分配 id、写轻量骨架。
> **② NPC 调度（scheduling）**：纯前端逻辑，决定本轮"重点演化列表"——B1 固定参与；在场/刚登场/手动目标无视频率；离场 NPC 受**逐目标频率**和**离场活跃名额**限制；外加**长期不出场清理提醒**。
> **③ 逐 NPC 重点演化（concurrent evolution）**：对调度选出的每个 NPC **各发一次并发调用**（`${character_id}` 为单个 id），结果汇总落库。
>
> 你给出的两张截图就是第 ② 段「NPC 调度」的 UI，见 **§6**。

---

## 1. 先理解现有的"主角演化"是怎么跑的（可复用蓝本）

这是最重要的一节。NPC 演化的所有骨架都照抄它。

### 1.1 三阶段 AI 流程（`zhushen-space/zhushen-space/src/App.tsx`）

正文生成完成后，**并发**触发两个独立阶段（不 await，互不阻塞）：

- 物品管理阶段：`runItemPhase()`
- 主角演化阶段：`runPlayerEvolutionPhase()` → 见 `App.tsx:643`，内部调 `runPlayerEvolutionPhaseCore()`（`App.tsx:542`）

触发点在 `App.tsx:779` 和 `App.tsx:796`（流式 / 非流式两条路径都要挂）。

`runPlayerEvolutionPhaseCore(narrative)` 的逻辑（**NPC 版几乎照抄**）：
1. 取 store：`usePlayer.getState()`，拿 `settings`（enabled / frequency / entries）。
2. 选 API：`playerUseSharedApi ? 共享API : 独立playerApi`。
3. 过滤 `entries.filter(e => e.enabled)`，为空则跳过。
4. `buildPlayerSystemPrompt(enabledEntries)` 拼 system prompt（`playerStore.ts:284`，就是把 enabled 条目的 content 用 `\n\n` 拼接）。
5. user prompt = 本轮正文（截断到 2000 字）+ 指令要求。
6. 调 `/chat/completions`，温度/maxTokens/topP 取自当前文本预设或 API 配置。
7. 解析回复：`applyAllUpdates(reply)`（解析 `<state>`）+ `parseAllCharCommands(reply)` → `applyCharacterCommands()`（解析 `<upstore>` 里的 addSkill/addTrait 等）。
8. 频率门控在 `runPlayerEvolutionPhase()`：`turnCountRef.current % freq !== 0` 则跳过。

### 1.2 主角演化 Store（`src/store/playerStore.ts`）—— 直接照抄成 npcEvoStore

`usePlayer`（persist key `drpg-player-evo`）字段：
- `settings: { enabled, frequency, entries: PlayerPresetEntry[], presetName, presetVersion }`
- `playerApi: ApiConfig` / `playerUseSharedApi` / 模型列表相关
- actions：`setSettings / setPresetEntries / togglePresetEntry / updatePresetEntry / clearPreset / deleteDisabledEntries / smartFilterEntries / setPlayerApi / setPlayerUseSharedApi / fetchPlayerModels`
- `PLAYER_KEEP_NAMES`：智能筛选白名单（54 个条目名 Set），`smartFilterEntries()` 据此 enable/disable。
- 工具函数：`extractPlayerPresetFromJson(raw)`（兼容 `entrySharedRules` / `prompts.*.rules` / `sharedRules` / `itemSharedRules`）和 `buildPlayerSystemPrompt(entries)`。

> ⚠️ `extractPlayerPresetFromJson` 已经能解析 `data.prompts.npc.rules` 这种结构（`playerStore.ts:263`）。所以 NPC 预设 JSON 可以直接用 `prompts: { npc: { rules: [...] } }` 形态，也可以拍平成 `entrySharedRules`（推荐拍平，和现有两个预设一致）。

### 1.3 角色技能/词条 Store（`src/store/characterStore.ts`）—— NPC 直接复用！

`useCharacters`（persist key `drpg-characters`）是**多角色**容器：
```ts
characters: Record<string, CharacterData>   // key 可以是 "B1" / "C1" / "C2" …
CharacterData { id, skills: Skill[], traits: Trait[] }
```
actions：`addSkill(charId, skill)` / `removeSkill(charId, idOrName)` / `addTrait(charId, trait)` / `removeTrait(charId, name)` —— **全部已经支持任意 charId**。

✅ **结论：NPC 的技能与词条无需新建仓库，直接写进 `characterStore` 的 `C1/C2…` 即可。** 现有的 `addSkill("C2", {...})` / `addTrait("C2", {...})` / `deSkill` / `deTrait` 指令解析（见 1.5）已经能落库。

### 1.4 现有指令解析器（`src/systems/stateParser.ts`）

- `<state>` 块：`parseAllStateUpdates` / `applyAllUpdates`（在 App.tsx 内）—— 逐行 `key = value`。
- `<upstore>` 块：
  - 物品指令：`parseAllItemCommands` / `applyItemCommands`
  - **角色指令**：`parseAllCharCommands` / `applyCharacterCommands`（`stateParser.ts:327-427`）
    - 正则 `CHAR_CMD_RE`（`stateParser.ts:337`）只认 `addSkill|deSkill|addTrait|deTrait`，双参数格式 `func("charId", payload)`。
    - **这里就是要扩展 `add` 和 `de` 的地方**（见第 4 节）。

### 1.5 UI 三件套

- `PlayerManager.tsx`：两个 Tab（预设设置 / API 设置）。预设 Tab 有：导入 JSON、条目列表（搜索/仅看启用/分页/启用开关/编辑）、⚡智能筛选、删除未开启、导出。
- `CharacterPanel.tsx`：右侧导航"✨ 技能"打开（`charPanelOpen`，`App.tsx:295`/`1166`），顶部角色选择器 + 技能/词条 tab 卡片网格。**已经是多角色 UI**，NPC 可直接复用它看技能/词条。
- 设置路由：`SettingsPanel.tsx` 用 `page` 状态切页（`'variables'` → `'item-manager'` / `'player-manager'`），`VariableManager` 里有入口按钮。

---

## 2. NPC 演化的源内容在哪里

**不要去解析 `fanren-remake-public-assets/assets/*.js`（已压缩混淆，没价值）。** 真正的 NPC 演化提示词在：

```
完整版-主角演化（轮回乐园适配）.json  →  prompts.npc
```
- 结构：`prompts.npc = { enabled, rules: PromptRule[], assistantPrefill }`
- `rules` 共 **62 条**，每条 `{ id, name, content, enabled, role }`，role ∈ `system` / `user`。
- `assistantPrefill` = `<thinking>\n\n`（思维链前缀）。

### 2.1 62 条规则的分组（已实地读取）

**角色上下文注入（system）**：身份定义、角色档案、角色当前装备槽位、角色物品详情、共享技能字段与层级规则、角色功法详情、角色传记、角色ID列表、关系一致性与好感度锚点、全地图坐标参考、世界背景、世界因子、本轮正文、用户行为、主模型思维链、本轮物品管理结果、快速交谈记录、时间粒度法则、防全知协议。

**NPC 列模型定义（system）**：NPC状态字段认知边界、NPC基础信息列、NPC隐秘列定义(女性NPC)、NPC隐秘列定义(男性NPC)、NPC心理与社交列、NPC经济与目标列、性相关列定义、备注列详解、JSON语法铁则、品阶显示规则。

**指令与规则（system）**：可用指令、推演法则、死亡逻辑、绝对禁令、并发演化输出约束、输出格式、NPC新建规则、NPC重新上场规则、加强的NPC生成原则、NPC情景指令示例集、任务与推演逻辑、通用物品装备技能补充规则、最终审查协议、人际关系参考、danbooru客观头像设计。

**推理步骤（user，COT）**：COT开始、第一步：扫描与状态、第二步：行为演化、第三步：资源流转、第四步：反差纠错、第四点五步：第16列动作审查、第五步：最终审查。

**Standalone 规范（system）**：Standalone NPC 世界因子 COT 审视、Standalone NPC Target Scope、Standalone 最终属性写入边界、Standalone 词条属性格式、Standalone 角色短指令格式、Standalone 境界字段规范、Standalone 修仙百艺熟练度规范、Standalone 角色坐标归属、Standalone 肖像刷新标记。

**其他（user）**：物价和金融系统、修炼公式与炼制公式。

### 2.2 NPC 列模型（核心数据结构，来自"NPC基础信息列"规则）

NPC 适用 ID 为 `C...` 或 `G...`。可操作列：`0,1,2,3,4,5,6,7,8,9,10,12,13,15,16,17,18,19,20,21,22,23,24,27,28,29,30,31,34`。

| 列 | 含义 | 说明（落地时建议字段名） |
|---|---|---|
| 0 | ID | `id`，`C1`/`C2`/`G1` |
| 1 | 名字\|性别 | `name` + `gender`（单字"男"/"女"） |
| 2 | 境界\|身份 | `realm` + `identityRole`；轮回乐园改用**阶位**（见 §6 映射） |
| 3 | 性格 | `personality`（三维格式，可简化） |
| 4 | 当前状态/Buffs | `status`，无则"一切正常" |
| 5 | 灵根 → **天赋/血统** | `talent`（修仙词需替换） |
| 6 | 特殊体质 | `constitution` |
| 7 | 对玩家称呼 | `callPlayer` |
| 8 | 性经验 | `sexExperience`（成人向，可按需保留/隐藏） |
| 9 | 备注列(JSON) | `notes`：额外寿元/外貌年龄/驻颜理由等；skills/traits/inventory **不在此改** |
| 10 | 背景/简介 | `background`，开头含 `[出生：XX年]` |
| 12 | 内心想法/动机 | `innerThought` |
| 13 | 人际关系 | `relations`，`"B1:师徒;C2:仇人"` |
| 15 | 好感度 | `favor`，-100~100 |
| 16 | 动作\|穿着\|位置\|身段\|样貌 | `appearance5`，5 段用 `|` 分隔，位置含坐标 `地点 X,Y` |
| 26 | 当前货币 | 只读 |
| 27/28/29 | 当前动机/短期目标/长期目标 | `motiveNow` / `shortGoal` / `longGoal` |
| 30 | 专属宠物/召唤物列表 | `pets`（JSON 数组；轮回乐园：灵兽→宠物/召唤物） |
| 31 | 战斗状态 | `inCombat` bool |
| 34 | 容貌与身姿 | `appearanceDetail` |

> 落地不必实现全部 34 列。**MVP 建议保留**：0,1,2,3,4,7,10,12,13,15,16,27 + skills/traits（走 characterStore）。其余作为 `extra: Record<string,string>` 兜底存储，UI 折叠展示。

### 2.3 指令协议（来自"可用指令""输出格式"规则）

```
<state>
// cr./hp./mp./pr. 与 character(s).* 逐行赋值；NPC 短指令也写这里
cr.C1 = 三阶·Lv.25/37        // 境界+进度（轮回乐园阶位）
hp.C1 -= 20                   // 当前 HP
character.C1.identity.title = "青炎老魔"
character.C1.stats.favor = 60
</state>

<upstore>
add("C1", {"4":"一切正常", "12":"此人出手阔绰", "27":"寻找机会接近"})   // 列覆盖式增量更新
addSkill("C2", {"0":"S_C2_01","1":"烈焰斩","2":"入门·Lv.15","numeric":{"kind":"skill",...}})
addTrait("C2", {"name":"冷静","desc":"...","rarity":"稀有","numeric":{"kind":"trait",...}})
deSkill("C2", "S_C2_01")
deTrait("C2", "冷静")
de("C2")                      // NPC 退场/死亡归档
</upstore>
```

关键点：
- `add("ID", {列号: 值, ...})` —— **双参数、列号为字符串键**的覆盖式更新。只改有变化的列。
- `de("ID")` —— 单参数，退场/死亡时归档该 NPC。
- 技能/词条**不写进第 9 列**，必须用 `addSkill/deSkill/addTrait/deTrait`（已支持）。
- `<state>` 与 `<upstore>` 标签分工固定，禁止混写。

---

## 3. 需要新建/修改的文件清单

### 新建
| 文件 | 作用 | 蓝本 |
|---|---|---|
| `src/store/npcStore.ts` | NPC 档案数据仓库（列模型 + 场景/调度字段） | 全新，见 §3.1 |
| `src/store/npcEvoStore.ts` | NPC 演化预设 + API + **调度设置**（频率/名额/清理） | 照抄 `playerStore.ts`，persist key=`drpg-npc-evo`，加 `scheduling` + `NPC_KEEP_NAMES`/`ENTRY_KEEP_NAMES` |
| `src/components/NpcManager.tsx` | NPC 设置页（**预设 / API / 调度** 三 Tab；调度 Tab = 你的两张截图） | 照抄 `PlayerManager.tsx` + 新写调度面板 |
| `src/components/NpcPanel.tsx`（可选） | NPC 图鉴/档案查看弹窗 | 参考 `CharacterPanel.tsx`（也可直接用它看 NPC 技能/词条） |
| `预设/NPC演化.json` | 重点演化 + 登场判断两份规则 | `prompts.npc`(62) + `entrySharedRules`(22) 派生 + 轮回乐园适配，见 §7 |

### 修改
| 文件 | 改动 |
|---|---|
| `src/systems/stateParser.ts` | 新增 `add()` / `de()` 指令解析（带 charId 过滤）+ 应用到 `npcStore`；`<state>` 的 `.Cx` 路由，见 §4 |
| `src/App.tsx` | 新增 `runNpcPipeline()`（登场判断→调度→逐 NPC 并发）：`runEntryJudgment`/`applyEntryResult`(§5.4)、`computeFocusList`(§6.3)、`runNpcEvolutionForTarget`(§5.2)、`buildNpcPhaseSystemPrompt`(§5.3)、`maybeAskCleanup`(§6.2)；在正文完成处触发；状态栏日志 |
| `src/components/SettingsPanel.tsx` | 新增 `page === 'npc-manager'` 路由，渲染 `<NpcManager/>` |
| `src/components/VariableManager.tsx` | 新增"🧑‍🤝‍🧑 NPC 演化"入口按钮，回调切到 `npc-manager` |
| `src/components/CharacterPanel.tsx`（可选） | 角色选择器自动纳入 `npcStore` 里的 NPC id |

---

## 3.1 npcStore.ts 设计（建议）

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface NpcRecord {
  id: string;                 // "C1" / "G1"
  name: string;
  gender: '男' | '女' | '';
  realm: string;              // 阶位·Lv.X|身份  (列2)
  status: string;             // 列4，默认 "一切正常"
  personality: string;        // 列3
  callPlayer: string;         // 列7
  background: string;         // 列10
  innerThought: string;       // 列12
  relations: string;          // 列13
  favor: number;              // 列15
  appearance5: string;        // 列16
  motiveNow: string;          // 列27
  shortGoal?: string;         // 列28
  longGoal?: string;          // 列29
  inCombat?: boolean;         // 列31
  appearanceDetail?: string;  // 列34
  title?: string;             // identity.title
  extra: Record<string, string>; // 其余列兜底（"5","6","8","30"…）

  // ── 场景 / 生命周期 ──
  onScene: boolean;           // 在场(A区) / 离场(B区)
  isDead?: boolean;           // 列4含"已死亡"
  isBond?: boolean;           // 羁绊/开局角色，自带"长期保留"标记，不进清理名单
  keepForever?: boolean;      // 用户在归档里手动标记长期保留

  // ── 调度（§6）──
  freqMode?: 'turn' | 'date'; // 逐目标频率模式：按回合计数 / 按日期变化
  freqInterval?: number;      // 间隔（≥1）；缺省回落到全局默认
  lastEvolvedTurn?: number;   // 上次重点演化的回合号（turn 模式判定用）
  lastEvolvedDate?: string;   // 上次重点演化的游戏内日期（date 模式判定用）
  lastSeenTurn?: number;      // 上次在场的回合号（清理提醒用）

  deeds?: string;             // 本轮/最近事迹（登场判断 deedsUpdates 落点，B区传记累积）
  updatedAt: number;
}

interface NpcState {
  npcs: Record<string, NpcRecord>;
  upsertNpc: (id: string, patch: Partial<NpcRecord>) => void;   // add() / 骨架 落点
  applyColumns: (id: string, cols: Record<string, unknown>) => void; // 列号→字段映射
  applySkeleton: (id: string, short: Record<string, unknown>) => void; // npc.<id>={n,r,p,t,lg,bg,act…} 短键骨架
  setScene: (id: string, onScene: boolean) => void;             // 登场=true / 退场de()=false
  setSchedule: (id: string, patch: { freqMode?: 'turn'|'date'; freqInterval?: number }) => void; // 批量改频率落点
  markEvolved: (id: string, turn: number, date?: string) => void; // 重点演化后更新 lastEvolved*
  appendDeed: (id: string, deed: string) => void;
  removeNpc: (id: string) => void;                              // 物理删除（仅清理路人时用）
}
```
- `applyColumns` 内部维护一张**列号 → 字段**映射表（参考 §2.2），未知列号丢进 `extra`。
- `applySkeleton` 解析登场判断输出的短键骨架 `npc.<id> = {n,r,p,t,lg,extraSy,apAge,yrr,bg,act}`（见 §5.4），映射为 `name+gender / realm+identityRole / personality / title / talent / background / appearance5`。
- `de("Cx")` / `setScene(id,false)` 是**软删除**（`onScene=false` 归档到 B 区），不物理删除，以便"重新上场"复用档案——原 preset"NPC重新上场规则""身份定义"的 B 区机制。**物理 `removeNpc` 只在 §6 清理提醒里用户确认删除路人时调用。**

---

## 4. stateParser.ts 扩展（add / de）

在 `parseAllCharCommands` / `applyCharacterCommands` 旁边新增（保持同风格）：

```ts
export type NpcCommandType = 'add' | 'de';
export interface NpcCommand { type: NpcCommandType; id: string; payload?: any; raw: string; }

// add("C1", {...})  |  de("C1")
// 注意：正则要避免吃到 addSkill/addTrait —— 用 \badd\s*\( 且后面紧跟 "ID" , {  的双参数；
// de\s*\(\s*"ID"\s*\) 单参数。建议先跑 addSkill/addTrait/deSkill/deTrait 的匹配并从文本中移除，再匹配 add/de，
// 或在正则用负向断言：/\badd(?!Skill|Trait)\s*\(/ 、 /\bde(?!Skill|Trait|Trait)\s*\(/
const NPC_ADD_RE = /\badd\s*\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
const NPC_DE_RE  = /\bde\s*\(\s*"([^"]+)"\s*\)/g;   // 单参数才是 de
```

⚠️ **解析顺序陷阱**：`addSkill`/`addTrait`/`deSkill`/`deTrait` 是 `add`/`de` 的前缀。务必：
1. 先用现有 `CHAR_CMD_RE` 解析并记录这些 token 的区间；
2. `add`/`de` 正则加负向断言 `add(?!Skill|Trait)` 、`de(?!Skill|Trait|[A-Za-z])`，或先把已匹配片段替换成占位符再扫 add/de。
3. `de` 必须是**单参数**（`de("C2","skills",...)` 这种是错误写法，原 preset 明确禁止）。

应用：
```ts
export function applyNpcCommands(cmds: NpcCommand[]) {
  const store = useNpc.getState();
  for (const c of cmds) {
    if (c.type === 'add') store.applyColumns(c.id, c.payload ?? {});
    else if (c.type === 'de') store.removeNpc(c.id);   // 软删除
  }
}
export function parseAllNpcCommands(text: string): NpcCommand[] { /* extractUpstoreBlocks(text).flatMap(...) */ }
```

`<state>` 里的 NPC 短指令（`cr.C1 = …`、`hp.C1 -= …`、`character.C1.stats.favor = …`、`character.C1.identity.title = …`）：
- 现有 `applyAllUpdates` 只认 B1 玩家的内置 key。需要在 state 行解析里**识别带 `.C数字` / `cr.C` / `hp.C` 前缀的 key**，路由到 `npcStore` 而非 `gameStore`。
- MVP 可只支持 `character.C1.stats.favor` / `.identity.title` / `cr.C1` / `hp.C1`，其余忽略并 `console.warn`。

---

## 5. App.tsx 编排（策略 B：登场判断 → 调度 → 逐 NPC 并发）

总管线（正文完成后触发一次 `runNpcPipeline(narrative)`，不 await）：

```ts
async function runNpcPipeline(narrative: string) {
  const evo = useNpcEvo.getState();
  if (!evo.settings.enabled) return;

  // ① 登场判断（一次调用）——决定 entries/exits/deeds，写骨架、归档退场
  const entry = await runEntryJudgment(narrative);   // §5.4
  applyEntryResult(entry);                            // 写 npcStore：new骨架/reentry置onScene/exits置离场/deedsUpdates

  // ② 调度（纯前端）——算出本轮"重点演化列表"
  const focusIds = computeFocusList(narrative, entry);  // §6.3 —— 返回去重后的 NPC id[]
  if (focusIds.length === 0) return;

  // ③ 逐 NPC 并发重点演化
  await Promise.allSettled(
    focusIds.map(id => runNpcEvolutionForTarget(id, narrative))  // §5.2
  );

  // ④（可选）到清理周期则请调度模型给"可删路人"建议（§6.2）
  maybeAskCleanup(narrative);
}
```

触发：在 `App.tsx:781` / `App.tsx:796` 主角演化旁边加 `runNpcPipeline(accumulated/reply);`（不 await，吞掉 reject）。
状态栏：新增 `npcPhaseRunning` / `npcPhaseLog`（仿 `App.tsx:291-292` 与 `1032-1041`），可显示"NPC 调度中 3/5…"。

### 5.2 单 NPC 重点演化（照抄 `runPlayerEvolutionPhaseCore`，关键差异：传入单个 id）

```ts
async function runNpcEvolutionForTarget(charId: string, narrative: string) {
  const st = useNpcEvo.getState();
  const ss = useSettings.getState();
  const api = st.npcUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : st.npcApi;
  if (!api.baseUrl || !api.apiKey) return;
  const enabled = (st.settings.entries ?? []).filter(e => e.enabled);
  if (!enabled.length) return;

  // ★ 单角色作用域：${character_id} = charId，Standalone/并发约束条目全开（忠实原版）
  const systemPrompt = buildNpcPhaseSystemPrompt(enabled, narrative, charId);  // §5.3
  const userContent  = `# 本轮正文\n${trimmed}\n\n---\n只为角色 ${charId} 输出 <state> 与 <upstore> 指令，无变化输出空标签，禁止输出其他角色指令。`;
  // 用 assistantPrefill（<thinking>）作为 assistant 角色起手，贴合原版思维链
  // ……fetch /chat/completions（温度/maxTokens 同 player）……
  if (reply) {
    applyAllUpdates(reply, charId);                          // <state> NPC 短指令，限定本角色（§4）
    applyNpcCommands(parseAllNpcCommands(reply), charId);    // add/de，过滤掉非本角色 id（双保险）
    applyCharacterCommands(parseAllCharCommands(reply));     // addSkill/addTrait → characterStore(charId)
    useNpc.getState().markEvolved(charId, turnCountRef.current, currentGameDate());
  }
}
```

> **忠实原版的并发约束**：因为每次只传单个 `charId`，预设里的 `Standalone NPC Target Scope`、`并发演化输出约束` 这两条**全部启用**（它们正是要求"只输出 `${character_id}` 一个角色"）。`applyNpcCommands` 再按 `charId` 过滤一次，防止模型越界写别人。

### 5.3 buildNpcPhaseSystemPrompt(entries, narrative, charId)

仿 `buildItemPhaseSystemPrompt`（`App.tsx:166-230`）。`${key}` 与 `{{key}}` 两种格式都替：

| 占位符 | 来源（策略 B，单角色） |
|---|---|
| `${character_id}` | **单个** charId |
| `${scene_type}` | `npcStore.npcs[charId].onScene ? 'onscene' : 'offscene'` |
| `${is_offscene}` | `!onScene` |
| `${is_entry_created_target}` | 本轮登场判断里 type=`new` 且 id==charId |
| `existing_character_ids` | `"B1（玩家）, " + Object.keys(npcStore.npcs)` + 下一个可用 id |
| `next_available_npc_id` | 扫 `C\d+` 取 max+1 → `C{n}`（仅登场判断会用，演化阶段一般不新建） |
| `onscreen_characters` | onScene=true 的 NPC 档案摘要（列 0/1/2/4/16…拼文本） |
| `offscreen_biographies` | onScene=false 的 NPC 传记（B 区，含 `deeds`） |
| `focus_list` / `重点演化列表` | §6.3 算出的 focusIds 摘要 |
| `story_text` / `本轮正文` | narrative |
| `character_snapshot` | 玩家快照（`App.tsx:193` 已有） |
| `current_time` / `current_location` / `world_factors` / `world_map_pois` | 接世界书或暂空 |

注意：`App.tsx:206-216` 已预留 `existing_character_ids` / `next_available_npc_id` / `onscreen_characters` / `offscreen_biographies` / `focus_list` 等空占位符——填上即可。

### 5.4 登场判断 runEntryJudgment(narrative)（策略 B 的第一段，原版 entrySharedRules）

这是策略 B 区别于"单次多 NPC"的核心。源在 `完整版-主角演化（轮回乐园适配）.json` 的 `entrySharedRules`（**22 条**），它**不输出 `<state>/<upstore>`，而是输出一个 JSON object**：

```jsonc
{
  "thinking": "1. 阅读正文…\n2. 判定退场…",
  "entries": [
    { "id":"C6", "name":"执法弟子甲", "type":"new", "reason":"登场",
      "stateCommands":"npc.C6 = {n:\"执法弟子甲|男\", r:\"二阶·Lv.15|执法殿弟子\", p:\"刻板严厉\", lg:\"金土火\", bg:\"[出生：-0023年]执法殿外门弟子\", act:\"巡视|黑袍|药园 500,520|身形挺拔|面容冷峻\"}" },
    { "id":"C5", "name":"林青川", "type":"reentry", "reason":"返场互动" },
    { "id":"C8", "name":"陈巧倩", "type":"reentry", "reason":"结尾仍同处", "stateCommands":"loc.C8 = 丹房|3287,1681" }
  ],
  "exits": [ { "id":"C2", "name":"…", "reason":"离去" } ],
  "globalCommands": [ "loc.B1 = 药园|500,520" ],
  "noEntry": false, "noExit": false,
  "deedsUpdates": { "C3":"[${currentTime}@坊市]闭关炼制", "C5":"[${currentTime}@坊市]与C3偶遇" }
}
```

要点（来自原版"输出格式""NPC登场骨架格式""全部角色索引"规则）：
- `type:"new"` 只输出一行**短键骨架** `npc.<id> = {n,r,p,t,lg,extraSy,apAge,yrr,bg,act}`（`t/extraSy/apAge/yrr` 无证据则省略），**不补技能/词条/关系/34列**——那些留给后续重点演化。
- `type:"reentry"` 已存在 NPC**禁止**用 `npc.<id>` 骨架；只可用 `loc.<id> = 地点|X,Y` 同步坐标。
- **标准 ID 铁则**：已在"全部角色索引"出现的 id 一律 reentry，禁止 new 重写；只有真正新建才用 `next_available_npc_id` 并顺延。
- `exits[]` → 把这些 id `setScene(id,false)` 归档到 B 区（软删除）。
- `deedsUpdates{}` → 逐 id `appendDeed`；时间用 `${currentTime}` 原样，不自行推进。
- 实现：单次 `/chat/completions`，system = enabled 的 entrySharedRules 拼接，user = 正文；**解析回复的 JSON**（不是 state 块）。建议 `JSON.parse` 容错 + 去 ```json 包裹。

`applyEntryResult(entry)`：解析 entries → new 调 `applySkeleton`、reentry 调 `setScene(id,true)` + 可选 `loc`；exits → `setScene(id,false)`；deedsUpdates → `appendDeed`。

> entrySharedRules 也要做轮回乐园适配（境界→阶位、灵根→天赋等，同 §7）。并新增一个 `ENTRY_KEEP_NAMES` 智能筛选名单（22 条全保留即可）。

---

## 6. NPC 调度层（你截图里的两个面板）

这层是**纯前端逻辑 + 一组设置项**，决定每轮哪些 NPC 进入 §5.2 的逐 NPC 并发。设置存到 `npcEvoStore.settings`（持久化），UI 放在 `NpcManager.tsx` 的"调度"Tab。

### 6.1 触发频率（逐目标频率 · 截图一）

行为规则（严格照截图文案实现）：
- **B1（玩家）固定每回合参与**，不受频率限制（其实 B1 由"主角演化"阶段处理，这里只在列表里展示为"固定每回合"）。
- **在场 / 刚登场（本轮 entry）/ 手动触发目标** 一律无视频率，必参与。
- **离场 NPC** 才受频率限制：到点才进重点演化。
- 两种频率模式（全局默认 + 可逐目标覆盖）：
  - `按回合计数 (turn)`：`(currentTurn - lastEvolvedTurn) >= interval` 才触发。
  - `按日期变化 (date)`：游戏内日期相对 `lastEvolvedDate` 变化达到 interval 才触发（需要游戏时间源；无则回落 turn 模式）。
  - `间隔 interval` 合法范围 **≥1**。
- **批量改选中目标**：列表多选 NPC → 选一种频率模式+间隔 → "应用到选中目标"，写入各 `npcStore.npcs[id].{freqMode,freqInterval}`；未单独设置的回落全局默认。

数据落点：
- 全局默认：`npcEvoStore.settings.defaultFreqMode` / `defaultFreqInterval`。
- 逐目标覆盖：`npcStore.npcs[id].freqMode` / `freqInterval`（`setSchedule` 批量写）。
- 列表每行展示：名称、id、场景标签（在场/离场/已死亡）、"当前生效频率"（合成显示：在场→"固定每回合"，离场→该目标 mode/interval）。

UI 蓝本：列表/多选/批量按钮可参考 `PlayerManager.tsx` / `ItemManager.tsx` 的条目列表与两步确认交互。

### 6.2 NPC 调度预算 + 清理提醒（截图二）

**离场活跃名额 `offSceneQuota`（默认 5，范围 1–999）**
- 只限制每轮允许多少**离场** NPC 进入后台重点演化；**在场 / 返场 / 手动**目标不占名额、不受限。
- 当离场候选（已通过 §6.1 频率判定的）超过名额时，需**排序后截断**取前 N。排序建议：手动锚定 > 与 B1 关系近（好感/relations 含 B1）> 最近出场（`lastSeenTurn` 大）> 重要度。
- 截图备注的"NPC 总数 > 10 进入完整调度 / 每批 50 校准"是原版的规模化策略，**MVP 可不实现**，先做"名额截断"即可；规模大时再加分批。

**长期不出场 NPC 清理提醒**
- `cleanupEnabled` 开关 + `cleanupCycle`（默认 5，范围 1–999，按普通剧情回合计）。
- 每隔 `cleanupCycle` 个**命中周期**的回合，触发 `maybeAskCleanup`：让**调度模型**输出"可删除路人建议列表"；非命中周期不请求。
- **羁绊/开局角色**（`isBond=true`）和用户手动标记 `keepForever=true` 的，**自带保留标记，不进清理名单**（文案：标记长期保留后不再被建议删除，但也不因此获得调度优先级）。
- 建议列表给用户**二次确认**后才真正 `removeNpc(id)` 物理删除（区别于退场的软删除）。

数据落点（`npcEvoStore.settings`）：
```ts
scheduling: {
  defaultFreqMode: 'turn' | 'date';
  defaultFreqInterval: number;   // ≥1
  offSceneQuota: number;         // 默认 5
  cleanupEnabled: boolean;       // 默认 true
  cleanupCycle: number;          // 默认 5
}
```

### 6.3 computeFocusList(narrative, entryResult) —— 调度核心算法

```ts
function computeFocusList(narrative, entry): string[] {
  const { npcs } = useNpc.getState();
  const { scheduling } = useNpcEvo.getState().settings;
  const turn = turnCountRef.current;

  const mustInclude = new Set<string>();         // 无视频率/名额
  // 1) 本轮 entries（new + reentry）= 刚登场/返场
  entry.entries.forEach(e => mustInclude.add(e.id));
  // 2) 在场 NPC
  Object.values(npcs).filter(n => n.onScene && !n.isDead).forEach(n => mustInclude.add(n.id));
  // 3) 手动锚定目标（UI 勾选）——可选

  // 4) 离场候选：先过频率，再按名额截断
  const offCandidates = Object.values(npcs)
    .filter(n => !n.onScene && !n.isDead && !mustInclude.has(n.id))
    .filter(n => passFrequency(n, turn, scheduling))     // §6.1
    .sort(byPriority)                                    // §6.2 排序
    .slice(0, scheduling.offSceneQuota)
    .map(n => n.id);

  return [...mustInclude, ...offCandidates];
}
```

> 这一步把"逐目标频率 + 离场名额"两个面板的设置**合并**成本轮真正要演化的 id 列表，再交给 §5.1 的 `Promise.allSettled` 并发跑。

---

## 7. 预设文件 `预设/NPC演化.json` 的制作

> 策略 B 需要**两份预设**：① NPC 重点演化（`prompts.npc`，62 条）；② 登场判断（`entrySharedRules`，22 条）。可分两个文件，也可合到一个 JSON 的 `prompts.npc.rules` + `entrySharedRules` 里（`extractNpcPresetFromJson` 都能解析）。

### 7.1 来源与格式
- 从 `完整版-主角演化（轮回乐园适配）.json` 的 `prompts.npc.rules`（62 条）提取。
- 拍平成 `entrySharedRules[]` 格式（与 `预设/主角演化.json`、`预设/物品管理.json` 一致），顶层带 `name` / `version`。每条 `{ id, name, content, enabled, role }`。
- `extractPlayerPresetFromJson` / 新写的 `extractNpcPresetFromJson` 均可解析。

### 7.2 轮回乐园适配（沿用 CLAUDE.md 统一映射，禁止修仙词回流）
> 灵石→货币(乐园币/魂币)、功法→技能书、灵兽/妖兽→宠物/召唤物、御兽→召唤物指挥、炼丹→炼制、修炼速度→战斗速度、**境界→阶位**、修为→等阶、修仙世界→轮回乐园。

NPC 列 2「境界\|身份」要从"炼气X层/结丹后期"改成轮回乐园**阶位体系**（见 CLAUDE.md 世界书表）：
`一阶~九阶 / 绝强 / 至强 / 巅峰至强 / 无上之境`，格式 `阶位·Lv.当前等级|身份`，例 `三阶·Lv.25|调查员`。

技能层阶：`入门→精通→大师→宗师→极道`。

需重点重写或删除的条目：`Standalone 修仙百艺熟练度规范`、`Standalone 境界字段规范`、`修炼公式与炼制公式`、`化形机制`（妖兽→召唤物，或整段删）、`灵根`相关 → 改"天赋/血统"。`物价和金融系统` 直接复用 CLAUDE.md 的品质×评分定价表。

### 7.3 智能筛选白名单（两份）
在 `npcEvoStore.ts` 里建两个 Set。**策略 B（本项目选定）下两条单角色约束条目要全部保留**：`Standalone NPC Target Scope`、`并发演化输出约束`（它们正是要求只输出 `${character_id}` 单个角色，与逐 NPC 并发完全契合）。

`NPC_KEEP_NAMES`（重点演化，按 §2.1 分组挑选，可调）：
身份定义、NPC基础信息列、NPC心理与社交列、NPC经济与目标列、备注列详解、JSON语法铁则、品阶显示规则、可用指令、推演法则、死亡逻辑、绝对禁令、输出格式、NPC新建规则、NPC重新上场规则、加强的NPC生成原则、NPC情景指令示例集、最终审查协议、人际关系参考、关系一致性与好感度锚点、防全知协议、时间粒度法则、本轮正文、用户行为、角色ID列表、共享技能字段与层级规则、Standalone 角色短指令格式、Standalone 词条属性格式、**Standalone NPC Target Scope、并发演化输出约束**、物价和金融系统、COT开始、第一步~第五步、Standalone 最终属性写入边界。
（性相关/隐秘列条目按成人内容开关决定是否纳入。）

`ENTRY_KEEP_NAMES`（登场判断，22 条基本全保留）：
Standalone 状态命令契约（SSOT）、全部角色索引、全地图坐标参考、上一回合场景、本轮正文、用户行为、世界因子、在场人物、离场人物传记、重点演化列表、NPC登场骨架格式、数据列参考、性格与行为生成指南、JSON语法铁则、登场阶段时间地点边界、输出格式、身份-境界对应参考、人物称谓与境界规则、登场阶段原著角色身份锚定边界、Standalone 登场阶段 Beast 创建（轮回乐园下改"召唤物"或删）等。

---

## 8. 落地顺序（建议的提交粒度）

1. **数据层**：`npcStore.ts`（列号映射 + 短键骨架 + 软删除/物理删 + 调度字段）。
2. **解析层**：`stateParser.ts` 加 `add/de` 解析（前缀负向断言）+ `<state>` 的 `.Cx` 路由（带 charId 过滤）。自测：`add("C1",{...}) de("C2")` 文本验证落库。
3. **设置层**：`npcEvoStore.ts`（克隆 playerStore，换 key=`drpg-npc-evo`，加 `scheduling` 子对象，加 `NPC_KEEP_NAMES` / `ENTRY_KEEP_NAMES`）。
4. **预设**：生成 `预设/NPC演化.json`（含 prompts.npc 62 条 + entrySharedRules 22 条；先原样跑通，再轮回乐园替换）。
5. **登场判断**：`runEntryJudgment` + `applyEntryResult`（§5.4），先把 entries/exits/deeds 写进 npcStore 跑通。
6. **调度**：`computeFocusList` + `passFrequency` + `byPriority`（§6.3），含离场名额截断。
7. **重点演化**：`runNpcEvolutionForTarget` + `buildNpcPhaseSystemPrompt`（§5.2/5.3），`Promise.allSettled` 并发；接到 `runNpcPipeline` 并在 `App.tsx:781/796` 触发。
8. **清理提醒**：`maybeAskCleanup`（§6.2，可最后做）。
9. **UI**：`NpcManager.tsx`（预设 / API / **调度** 三 Tab，克隆 PlayerManager + 新增调度面板对应两张截图）+ SettingsPanel 路由 + VariableManager 入口；`NpcPanel.tsx` 或复用 CharacterPanel 看 NPC。
10. 构建：**`npx vite build`**（不要 `npm run build`，会因预存 TS 错误失败——见 CLAUDE.md）。

## 9. 验证清单
- [ ] 设置→变量管理→NPC 演化 能进，能导入预设，条目可启用/智能筛选；调度 Tab 显示 NPC 列表、频率模式、名额、清理开关。
- [ ] 登场判断：一段含新角色的正文后，npcStore 出现 new 骨架（id 顺延），reentry 角色置在场，exits 角色置离场。
- [ ] 调度：在场/刚登场 NPC 必被演化；离场 NPC 受逐目标频率与 `offSceneQuota` 截断（控制台打印 focusIds）。
- [ ] 逐 NPC 并发：focusIds 有 N 个就发 N 次调用，`[NPC]` 日志各自标注 charId，互不串写（`add("C2")` 不会出现在 C1 的调用里）。
- [ ] `add("C1",{...})` 写进 `localStorage['drpg-npc']`，刷新后仍在；`addSkill("C1",...)` 进 `drpg-characters` 的 C1，CharacterPanel 能选到。
- [ ] `de("C1")` / exits → C1 软删除离场，仍可 reentry 复用档案；清理提醒确认后才物理删除。
- [ ] 逐目标"按回合计数 间隔 N"：离场 NPC 每 N 回合才触发一次。
- [ ] 羁绊角色（isBond）/ keepForever 不出现在清理建议名单。
- [ ] 预设无修仙词回流（无"灵石/炼气/结丹/灵根/功法"），境界为阶位。

---

## 10. 关键风险与提醒
1. **`add`/`de` 与 `addSkill`/`deSkill` 的正则冲突**——最容易出 bug，务必用负向断言或分阶段剥离匹配（§4）。
2. **`<state>` NPC 短指令路由**——现有 `applyAllUpdates` 默认把所有 key 当玩家/变量处理，需先按 `.C\d`/`cr.C`/`hp.C` 分流到 npcStore，否则会污染 variableStore。
3. **token / 并发成本（策略 B 的主要代价）**——调用次数 = focusIds 数量。**`offSceneQuota`（默认 5）就是成本闸门**，务必生效；离场 NPC 再加逐目标频率；正文沿用 2000 字截断。并发用 `Promise.allSettled` 避免一个失败拖垮整批；可加并发上限（如一次最多 5 个，分批）。
4. **登场判断输出的是 JSON 而非 `<state>`**——解析路径与重点演化完全不同（§5.4），别用 `parseAllStateUpdates`；要 `JSON.parse` 容错、去 ```json 包裹、`thinking` 字段里有转义换行。
5. **标准 ID 铁则**——登场判断里已存在 id 必须 reentry，禁止 new 重写；`next_available_npc_id` 只给真正新建用。`applyEntryResult` 落库前再校验一次，避免覆盖老档案。
6. **单角色越界**——每次重点演化只该写当前 charId；`applyNpcCommands(cmds, charId)` 与 `applyAllUpdates(reply, charId)` 都要按 charId 过滤，丢弃越界指令并 `console.warn`。
7. **软删除 vs 物理删除**——`de()`/exits 是软删除（onScene=false，留档 reentry）；只有 §6.2 清理提醒经用户确认才 `removeNpc` 物理删除。别把两者搞混，否则 reentry 会丢档。
8. **羁绊/保留标记**——`isBond` / `keepForever` 必须排除出清理名单；开局/创角羁绊角色入库时就要打 `isBond=true`。
9. **构建命令**——一律 `npx vite build`。
10. **成人向列（8/隐秘列）**——按项目内容尺度决定是否纳入白名单，本文不替你决定。
```
