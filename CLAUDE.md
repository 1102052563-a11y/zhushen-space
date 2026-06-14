# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概览

本目录包含若干相互配合的部分：

1. **`zhushen-space/`** — 主神空间·无限流，一个 React/TS 前端应用（主要工作目录）
2. **`______.json`** — 轮回乐园世界书（127个条目），用于 AI 角色扮演世界观设定
3. **`完整版-主角演化（轮回乐园适配）.json`** — **原版完整预设（轮回乐园适配）**，含全部阶段提示词 `prompts.{player, npc, entry_all_focus, beast, item_management, misc_management, image_evolution}`。本项目各 `预设/*.json` 与移植功能多以它为蓝本（看原版怎么写）。
   （注：旧的 `concurrent-evo-preset-full-1781147723782.json` 已不在；根目录另有 `4234234.json` 为 ST entries 格式的另一份预设、`______.json` 为世界书。）
4. **`预设/主角演化.json`** — 供前端直接导入的主角演化预设（entrySharedRules 格式，已适配轮回乐园 + 阶位体系；已加 addDeed/addMemory + `character.B1.*` 身份/属性指令说明）
5. **`预设/物品管理.json`** — 供前端直接导入的物品管理预设
6. **`预设/NPC演化.json`** — 供前端导入的 NPC 演化预设（v2 双区 = 登场判断 + 重点演化，已适配轮回乐园；已加 addDeed/addMemory + `character.<id>.*` 身份/属性指令说明）
7. **`预设/杂项演化.json`** — 杂项演化预设（14条 = 双时间 + 原版13条 misc_management，轮回乐园适配；与 `src/data/miscDefaultPreset.json` 同源）
8. **`预设/势力演化.json`** — 势力演化预设（双区：当前世界判断 + 重点演化，仿 NPC演化结构）
9. **`预设/领地演化.json`** — 领地演化预设（8条 entrySharedRules，主神空间个人基地；与 `src/data/territoryDefaultPreset.json` 同源）
9b. **`预设/冒险团演化.json`** — 冒险团演化预设（6条 entrySharedRules，仅主角冒险团 + 考核试炼；与 `src/data/teamDefaultPreset.json` 同源）
10. **`fanren-remake-public-assets/`** — 另一个前端应用的静态资产（已预构建；本项目多数新功能从它移植）
11. **集成指导文档**（仓库根，均为"看原版怎么做→在 zhushen 落地"的指南）：`NPC演化-集成指导.md`、`经历功能-集成指导.md`、`杂项演化-集成指导.md`、`叙事记忆与总结-集成指导.md`、`存档功能-集成指导.md`、`生图功能-集成指导.md`（NAI/OpenAI/Gemini/ComfyUI 四服务 × 肖像/装备/正文配图）

---

## zhushen-space 开发命令

所有命令在 `zhushen-space/zhushen-space/` 目录下执行：

```bash
npm install        # 安装依赖
npm run dev        # 本地开发服务器（http://localhost:5173）
npx vite build     # 构建 dist/（跳过 tsc 类型检查，推荐用法）
npm run build      # tsc + vite build（有预存 TS 错误会失败）
npm run preview    # 预览 dist/
```

> **重要**：`npm run build` 因 `WorldSelector.tsx` 等文件有预存 TypeScript 错误会失败。**始终用 vite build 跳过 tsc**。
> ⚠️ **裸 `npx vite build` 有坑**：若不在内层项目目录、或 npx 缓存命中远程 rolldown-vite（vite 7），会报 `Cannot resolve entry module index.html`。**稳妥写法**：在 `zhushen-space/zhushen-space/` 下用本地二进制 `.\node_modules\.bin\vite build`（或 `npx --no-install vite build`，强制只用本地 vite 5.4.21）。
> 注意目录是**两层同名**：`zhushen-space/zhushen-space/` 才是真正的项目（含 `index.html`/`package.json`/`node_modules`）。
> PowerShell 校验构建：勿对原生命令用 `2>$null`（会把 chunk 警告当错误、误报 `$?=false`）；看到 `✓ built in …` 即成功。

---

## 代码架构

### 技术栈
- React 18 + TypeScript + Vite + Tailwind CSS
- 状态管理：Zustand（带 persist 中间件，持久化到 localStorage）
- 无测试框架

### 核心 Store（`src/store/`）

| Store | 持久化 key | 职责 |
|---|---|---|
| `gameStore.ts` | `drpg-save` | 游戏核心状态（玩家属性、副本进度、战斗状态）|
| `settingsStore.ts` | `drpg-settings` | API 配置、世界书、文本预设、正则脚本、**`apiLibrary`(中心 API 接口库)** |
| `itemStore.ts` | `drpg-items` | 背包物品、货币（乐园币/灵魂钱币）、物品管理 AI 预设 |
| `playerStore.ts` | `drpg-player-evo` | 主角演化 AI 预设、独立 API 配置 |
| `npcStore.ts` | `drpg-npc` | NPC 档案（0~34 列模型）、持有物品、场景/调度状态 |
| `npcEvoStore.ts` | `drpg-npc-evo` | NPC 演化 AI 预设、独立 API、策略(A/B)与调度设置 |
| `factionStore.ts` | `drpg-faction` | **势力**档案（`FactionRecord`：name/type/scale/powerLevel/territory/leader/members/relations/favorToPlayer/goal/resources/status/assets/deeds…）+ `inCurrentWorld`(当前世界=活跃/非当前世界=后台，类比NPC在场/离场)+ `isDestroyed` |
| `factionEvoStore.ts` | `drpg-faction-evo` | **势力演化** AI 预设、独立 API、策略(A/B)与调度（`offWorldQuota` 非当前世界活跃名额等）|
| `adventureTeamStore.ts` | `drpg-team` | **冒险团**（**仅主角自己的**单一冒险团）：established/name/rank(E→D→C→B→A→S→SS→SSS)/teamExp(0~100 晋级主轴)/activity(0~100 每回合衰减)/members(关联NPC的C-id,主角=团长)/perks(团队效果权限)/deeds/assessment(考核试炼状态) **+** 演化设置+独立 API 合一（仿 territoryStore）|
| `territoryStore.ts` | `drpg-territory` | **领地**（主神空间个人基地，**单一记录**）：unlocked/name/level(走阶位)/buildProgress(建设进度经验条)/effects/appearance/passiveOutput/members(关联NPC的C-id)/buildings(全自定义,≤5级)/storageItems(仓库) **+** 演化设置(enabled/frequency/entries)+独立 API 合一（仿 miscStore，数据+设置+API 同一 store）|
| `turnInsightStore.ts` | `drpg-turn-insight` | **回合洞察**快照（每回合精简快照，滚动保留最近14份，供本轮 vs 上轮 diff）|
| `creationTemplateStore.ts` | `drpg-creation-templates` | **角色创建模板**（开局设定可命名保存/导入复用，与进度无关）|
| `characterStore.ts` | `drpg-characters` | 多角色技能（`Skill[]`）、词条（`Trait[]`）、**称号**（`titles: Title[]`，最多1个 equipped）、**记忆**（`memory.shortTerm/longTerm`，生平压缩用）数据（B1 与各 NPC `Cx` 共用）；另导出 `Deed`/`MemoryEntry`/`Title` 类型 |
| `memoryStore.ts` | `drpg-memory` | **生平压缩**设置（开关/范围/阈值）+ 轮回乐园压缩提示词 + 独立 API |
| `miscStore.ts` | `drpg-misc` | **杂项演化**：任务/世界大事/大小总结/长期事实(narrativeFacts)/双时间(paradiseTime+worldTime)/天气 + 条目式预设(导入导出) + 独立 API |
| `imageGenStore.ts` | `drpg-image-gen` | **生图设置**（NAI/OpenAI/Gemini/ComfyUI/自定义 服务配置 + 肖像/装备/正文配图用途选择 + 画师串/负面词/模板 + `autoPortrait`/`autoEquipPlayer`/`autoEquipNpc`/`autoStory` 自动开关）。生成器 `systems/imageGen.ts`(`generateImage(service,opts)`：NAI含ZIP解码/OpenAI图片/Comfy提交轮询；`buildPortraitPrompt`/`buildEquipPrompt`)，UI `ImageGenManager`(设置→生图设置·四子页)。**三条生成线已全部落地**（见下「生图系统」）。详见 `生图功能-集成指导.md`|
| `variableStore.ts` | — | 自定义变量（用于 `<state>` 块解析）|

> **非 store 持久化系统（`src/systems/`）**：
> - `chatDb.ts`（IndexedDB `drpg-chat`）：对话**逐条增量**落库，流式只写变化的 1 条 → 跨刷新自动保留对话。
> - `saveDb.ts` + `saveManager.ts`（IndexedDB `drpg-archive`）：**多存档**（创建/读取/改名/删除/导出导入）+ `newGame()` 新游戏 + 读档 reload。
> - `narrativeMemory.ts`：叙事记忆关键词召回（`tokenize`/`recallFacts`/`buildNarrativeHistory`）+ 两步 LLM 提示词（`NM_COMPILE_PROMPT`/`NM_INGEST_PROMPT`）。
> - `miscParser.ts`：杂项演化指令解析（总结/双时间/天气/世界大事/`T_`任务）。
> - `playerStore.ts` 的 `profile` 含**主角身份档案**（姓名/等级/阶位/称号/职业/竞技场排名/身份/烙印/契约者ID/六维属性/外观/位置/背景/经历deedLog）。

### AI 多阶段流程（`App.tsx`）

应用有多个独立的 AI 调用阶段（除主叙事外都在正文完成后**并发**触发，不互相阻塞）：

1. **主叙事阶段**：用户输入 → 调用主 API → 生成正文 → 解析 `<state>` 和 `<upstore>` 块
   - **正文渲染** `toHtml`（App.tsx）：**始终走 HTML 感知的** `wrapSettlementBlocks`——含 HTML 标签的行/未闭合 HTML 块内**原样透传**（ST 正则输出的卡片照常渲染），同一条消息里的 `>` 模块块/`【…】`块仍打**琥珀边框格子**（修复"消息里只要有一处 HTML，整条就跳过结算格子、`>` 模块块退化成普通框"）。打包规则：① 连续 `>` 引用行（`ST_WI_Modular_Output` 要求每行带 `>` 橙线前缀：时间结算/动作日志/击杀结算/成长结算/判定/战斗/信息卡/登场离场/任务推进/资源等）整段打包；② 无 `>` 时以 `【…结算/日志/战报/登场/资源/判定…】` 标题兜底打包。首行 `【…】` 作格子标题。`renderSettleBlock` 会**拆出 `【标题】`**（AI 常把「【动作日志】+整段结算」写一行，标题后的内容自动并入正文）并把正文**按句末标点 `。；！？` 分行**（每句一个 `<div>` + `space-y-0.5`），避免结算文字挤成一坨。**字号**：正文 `text-[17px]`、结算格子正文 `text-[15px]`/标题 `text-[13px]`。渲染入口 `dangerouslySetInnerHTML={{__html: toHtml(msg.content)}}`。
   - **数据化风格**（轮回乐园，参考 `ST_WI_Modular_Output`）：技能/物品/装备/天赋的 effect/描述**必须写具体数值**（+X攻击、+X%暴击、减伤X%、恢复X点、持续/冷却X回合、消耗X 等）。三预设已把旧的「不写数值/数值走 numeric」禁令**翻转为要求**，并加「本要求优先于旧规则」override。⚠️ 因 zhushen 无 numeric 战斗引擎，数值只在文本里可见，故必须写进文本。
2. **物品管理阶段**（可选，按频率触发）：正文 → 调用物品管理 API（可独立配置）→ 生成物品指令 → 解析 `<upstore>` 块
3. **主角演化阶段**（可选，按频率触发）：正文 → 调用主角演化 API（可独立配置）→ 生成状态指令 → 解析 `<state>` 块（含主角身份/六维属性，见下）
4. **NPC 演化阶段**（可选）：正文 → 维护 NPC 档案。有两种策略（见下方"NPC 演化系统"）：策略 A 单次合并调用；策略 B 为"登场判断 + 逐 NPC 并发"两段式。
5. **生平压缩阶段**（可选，默认关）：角色 short/long 记忆达阈值 → 调用 AI 压缩整理（见下"生平压缩"）。
6. **杂项演化阶段**（可选，默认关）：正文 → 维护分段总结/双时间/天气/世界大事/主角任务（见下"杂项演化"）。
7. **领地演化阶段**（可选，默认关）：正文 → 维护主神空间个人基地（等级/建设进度/建筑/效果/成员/仓库，见下"领地演化系统"）。
8. **冒险团演化阶段**（可选，默认关）：正文 → 维护主角冒险团（阶位/经验/活跃度/成员/团队效果/考核试炼，见下"冒险团演化系统"）。
9. **叙事记忆·回复后写入**（可选，LLM 模式时）：正文 → LLM 抽取长期事实存库（见下"叙事记忆"）。
10. **叙事记忆·发送前整理**（可选，LLM 模式时）：发主请求**前** await 一次 LLM 改写检索关键词（见下"叙事记忆"）。

> **演化阶段「强制铁则」补丁（代码注入，`App.tsx` 顶部常量，独立于导入预设、始终生效，无需重新导入预设即对当前存档生效）**：各 `run*Phase` 在拼接完导入预设后**追加**一段硬编码规则——`NARRATIVE_FIRST_RULE`(所有演化优先逐条参照正文、不遗漏，正文没有才自行补全) 注入到 物品/主角/NPC/势力/领地 五个阶段；`BUFF_AS_STATUS_RULE`(BUFF/debuff/中毒等都按当前状态记录) 注入主角/NPC；`SUBPROF_RULE`(副职业名用中文、仅正文显式提及才生成) 注入主角；`NPC_AGE_RULE`(NPC 年龄，正文有照抄无则生成) 注入NPC；`FACTION_WORLD_RULE`(势力所处世界 worldName) 注入势力；`ITEM_FIXED_FORMAT_RULE`(物品固定格式 名称/ID/品质/类型/攻防/属性加成/评分/词缀/效果/描述/外观/获取途径，武器加 killCount 杀敌数；优先正文缺则补全) + 「勿对 equipped 物品 destroy/consume」注入物品阶段。
>
> **阶段编排（`runPostNarrativePhases`，App.tsx）**：正文完成后调用，**物品管理 / 主角演化 / NPC 演化 / 势力演化 / 生平压缩 / 杂项演化 / 领地演化 / 叙事记忆回写 全部并发、互不阻塞**。
> - ⚠️ **物品管理绝不等待 NPC**：早期版本曾 `await` 登场判断再跑物品阶段，导致慢/挂起的 NPC API 把物品管理拖死（"物品管理失效"）。现已解耦。
> - **NPC 物品 owner 解析器**（`stateParser.setNpcOwnerResolver`，App 在模块加载时注入）：物品阶段常给 NPC 物品编"幻觉 ID"（如 C66）与登场判断分配的真实 ID（C1）对不上。解析器把未知/空壳 owner 重定向到真实 NPC——优先本回合涉及的 `npcPreferredOwners`（登场判断完成时由 `refreshNpcPreferredOwners` 刷新），退化到最近更新的在场真实 NPC。登场判断（提示词小、快）通常先于体量巨大的物品阶段完成，所以并发下 ID 仍能映射正确。
> - **`applyAllUpdates` 顺序**：**先应用 `<upstore>` 创建物品，再应用 `<state>`**（含 `eq` 装备短指令），否则装备指令会在物品尚未创建时执行而失败。
> - 物品管理 system prompt 注入真实 NPC 注册表（`existing_character_ids`/`next_available_npc_id`/`onscreen_characters`），但模型常不遵守，最终靠上面的解析器兜底。

### 状态指令解析（`src/systems/stateParser.ts`）

AI 输出中的两种指令块：

- **`<state>` 块**：逐行 `key = value` / `key += value` 格式
  - 内置玩家 key：`hp`、`maxHp`、`mp`、`maxMp`、`san`、`maxSan`、`points`、`atk`、`def`
  - **角色资源短指令**（演化预设格式，`applyOneUpdate` 处理）：`hp.B1 -= 20`/`mp.B1 = 35`/`san.B1 = 80` 路由到玩家；`hp.C1 -= 15` 路由到对应 NPC；`cr./pr./ca./character.*/npc./loc./tm.` 等前缀当前未建模，静默跳过（不刷 warn）
  - 货币短指令：`乐园币 += 100`、`currency.灵魂钱币 -= 10`
  - 装备短指令：`eq.B1 = weapon:main:I_B1_01|主武器`、`eq.B1 = armor:upper:I_B1_02|上装`、`uneq.B1 = weapon:main:I_B1_01|卸下`。物品不在玩家背包时 `equipNpcItemFallback`/`unequipNpcItemFallback` 会在各 NPC 持有物里查找并就地装备/卸下（修复 AI 把 NPC 装备错挂到 B1 的问题）
  - 其他 key 从 `variableStore` 查找

- **`<upstore>` 块**：helper 函数调用，如 `createItem({...})`、`transferSpiritStones({...})`
  - **物品指令**：`createItem` / `consumeItem` / `destroyItem` / `transferSpiritStones` / `transferCurrency` / `equipItem` / `unequipItem` / `updateItem` / `updateItemQuantity` / `transferItem`
  - **角色指令**（主角演化阶段）：`addSkill("B1", {...})` / `deSkill("B1", "id")` / `addTalent("B1", {...})` / `deTalent("B1", "名")`（`addTrait`/`deTrait` 为兼容别名）
    - 角色指令由 `parseAllCharCommands()` 解析，`applyCharacterCommands()` 写入 `characterStore`
    - 格式：`funcName("charId", payload)` — 双参数，与物品指令的单对象格式不同

### 物品分类系统（`src/store/itemStore.ts`）

轮回乐园主分类（`ItemCategory`）：
- **装备**：武器 / 防具 / 饰品
- **消耗品/材料**：消耗品 / 材料 / 工具
- **特殊**：重要物品 / 特殊物品 / 凡物 / 其他物品
- **旧版兼容**（保留向后兼容）：功法 / 法宝 / 丹药 / 符箓 / 灵药 / 阵具

`CATEGORY_MAP`（在 `stateParser.ts`）将 AI 输出的各种别名归一化为合法分类。

### InventoryItem 结构

```typescript
{
  id: string;          // 格式: "I_B1_XX"
  name: string;
  category: ItemCategory;
  gradeDesc: string;   // 品质描述（第3列）
  effect: string;      // 效果（第4列）
  quantity: number;
  equipped: boolean;
  equipSlot?: string;  // 见下方装备槽位系统
  tags: string[];      // 用途标签
  appearance?: string; // 外观描述
  acquisition?: string;// 获得途径
  locked?: boolean;    // 锁定后禁止删除
  notes?: string;
  // 固定条目模板（生成卡格式，物品/装备生成必填；NpcOwnedItem 同步同字段）
  origin?: string;     // 产地    subType?: string;   // 类型细分
  combatStat?: string; // 攻击力/防御力（装备）  durability?: string; // 耐久度（装备）
  requirement?: string;// 装备需求（装备）       affix?: string;     // 词缀（装备）
  score?: string;      // 评分（含品质区间说明）  intro?: string;     // 简介 flavor
  killCount?: string;  // 杀敌数量（仅武器类，随战斗累计；NpcOwnedItem 同字段）
  addedAt: number;
}
```

> **固定条目模板**：物品/装备生成对齐生成卡固定格式——通用必填 名称/产地(origin)/品质(quality→gradeDesc)/类型(category+subType)/评分(score)/简介(intro)；**装备额外** 战斗数值(combatStat)/耐久度(durability)/装备需求(requirement)/词缀(affix)；**消耗品/材料额外** 效果(effect)。`createItem` 接受这些命名键（`stateParser.ts`，`quality`→gradeDesc、`attack/defense`→combatStat 别名兼容）；物品详情(`BackpackModal.ItemDetailModal`)与 NPC 物品卡(`NpcDetail.NpcItemCard`)分栏展示。预设 `物品管理.json` 的 `Standalone 物品装备固定条目模板`（高优先级，已入 KEEP_NAMES）强制 AI 按模板输出全部字段+数值化。

### 装备槽位系统（`src/components/EquipmentPanel.tsx`）

`item.equipSlot` 字符串格式及对应的 UI 槽位：

| 槽位 key | 显示名 | 分组 | 可装备分类 |
|---|---|---|---|
| `weapon:main` | 主武器 | 武器 | 武器 |
| `weapon:off1` ~ `weapon:off3` | 副武器1~3 | 武器 | 武器/饰品/特殊物品/法宝 |
| `armor:head` | 头部 | 防具 | 防具 |
| `armor:upper` | 上装（躯干） | 防具 | 防具 |
| `armor:lower` | 下装 | 防具 | 防具 |
| `armor:feet` | 鞋子 | 防具 | 防具 |
| `armor:hands` | 手部 | 防具 | 防具 |
| `armor:shoulder` | 肩部 | 防具 | 防具 |
| `armor:belt` | 腰带 | 防具 | 防具 |
| `accessory:#1` ~ `#6` | 饰品 1~6 | 饰品 | 饰品 |
| `treasure:#1` ~ `#5` | 特殊 1~5 | 特殊装备 | 特殊物品/法宝/其他 |
| `technique:0` ~ `technique:N` | 技能（动态） | 技能 | 特殊物品/功法（无槽位上限） |

> **注意**：技能槽为无限追加，`stateParser.ts` 中 `buildSlotString` 生成格式为 `technique:N`（无 `#`）。技能书消耗型直接用 `consumeItem` 销毁，不占槽位。

**AI `eq.*` 短指令**示例（与 App.tsx 解析器兼容）：
```
eq.B1 = weapon:main:I_B1_01|装备主武器
eq.B1 = armor:upper:I_B1_02|装备上装
eq.B1 = accessory:#1:I_B1_03|装备饰品
eq.B1 = armor:head:I_B1_04|装备头盔
```

**AI `equipItem` upstore 指令**示例：
```
equipItem({"owner":"B1","slot":"weapon","weaponHand":"main","itemId":"I_B1_01","reason":"装备主武器"})
equipItem({"owner":"B1","slot":"armor","armorPart":"upper","itemId":"I_B1_02","reason":"装备躯干上装"})
equipItem({"owner":"B1","slot":"accessory","slotIndex":1,"itemId":"I_B1_03","reason":"装备饰品"})
```

**界面入口**：右侧导航栏"⚔ 装备"按钮（`App.tsx` 中 `equipOpen` 状态控制）→ 独立弹窗 → `EquipmentPanel`。装备弹窗与背包弹窗相互独立，互不干扰。

- 点击**空槽** → 底部弹出背包选择器（按槽位分类筛选可装备物品）
- 点击**已装备槽** → 打开 `ItemDetailModal`（可卸下/编辑/锁定/删除）
- 旧格式槽名（`weapon:right` 等）自动归入"其他已装备"兼容区

**背包（`BackpackModal`）**：右侧导航"🎒 背包"按钮打开，纯物品管理视图，显示"已装备"和"背包"两区，支持搜索/排序/分类筛选，不含装备槽可视化。

---

## 预设文件

### 物品管理预设（`预设/物品管理.json`）

供前端"设置 → 物品管理 → 预设设置 → 导入"使用，控制 AI 物品阶段行为。

- 格式：`entrySharedRules[]`（36条，含少量重名条目）
- 已完全适配轮回乐园：去除修仙/灵石/功法/灵兽内容
- **智能筛选**：`itemStore.ts` 的 `smartFilterEntries()` 通过 `KEEP_NAMES` Set 过滤出物品管理所需条目
- **定价体系**（`物价和金融系统` 条目）：轮回乐园**颜色品质定价**（白→创世 + 9 项定价因素，乐园币/灵魂钱币），详见下方"物品评分与定价"；收入来源为**击杀敌人 / 完成系统任务 / 交易物品**

### 主角演化预设（`预设/主角演化.json`）

供前端"设置 → 主角演化 → 预设设置 → 导入"使用，控制 AI 主角演化阶段行为。

- 格式：`entrySharedRules[]`（66条）
- 已完全适配轮回乐园：去除修仙/炼气/灵根/功法内容，采用阶位体系
- **智能筛选**：`playerStore.ts` 的 `smartFilterEntries()` 通过 `PLAYER_KEEP_NAMES` Set（54个条目名）过滤

### NPC 演化预设（`预设/NPC演化.json`）

供前端"设置 → 变量管理 → NPC 演化 → 预设设置 → 导入"使用。详见上文"NPC 演化系统"。

- 格式：**双区** `entrySharedRules`(22条登场判断) + `prompts.npc.rules`(62条重点演化)，合计 84 条。导入时按区赋 `source`。
- 智能筛选：`npcEvoStore.ts` 的 `smartFilterEntries()` 按当前**策略(A/B)** 感知（B 额外启用登场判断与单角色约束条目）。

> **预设适配说明**：两个预设原本是 fanren-remake 修仙世界观，已通过批量替换 + 关键规则整段重写适配到轮回乐园。统一替换映射：灵石→货币(乐园币/魂币)、功法→技能书、灵兽/妖兽→宠物/召唤物、御兽→召唤物指挥、**词条→天赋(D-SSS)**、**百艺/炼丹炼器→副职业(非战斗技能)**、修炼速度→战斗速度、境界→阶位、修为→等阶、灵根→天赋、修仙世界→轮回乐园。再次编辑预设时若引入新条目，须沿用同一套映射避免修仙词回流。
>
> **天赋系统**（轮回乐园）：评级 D→C→B→A→S→SS→SSS，**数量不设上限**（旧的"每角色最多3个/同类型唯一"限制已解除，由代码注入的 `TALENT_NO_CAP_RULE` override，优先级高于任何预设里的"最多3个"文案，对当前存档即时生效）、仅需正文明确觉醒/获得证据、同名只更新不重复；指令 `addTalent`/`deTalent`（兼容 `addTrait`/`deTrait`）。见 characterStore `Talent`/CharacterPanel 天赋 tab。
>
> **副职业系统**（取代修仙百艺/炼丹，已**真实持久化**，含名下配方）：非战斗类生活/制造/社交手艺，**名称全自定义**（机械师/药剂师/拾荒者…）。两层熟练度——副职业**总熟练度**(五档 新手→熟练→专家→大师→宗师 +0~100进度，满100晋级，gate 配方阶位) + 每个**配方熟练度**(0~100)。配方名 + 配方称谓(图纸/药方/食谱)也自定义。
>   - **仅主角(B*)**：NPC 不建模副职业（parser/短指令均 `^B\d+$` 守卫，NpcDetail 无副职业栏，NPC 演化预设/快照/召回均不含）。数据结构层面 `subProfessions` 仍在 `characterStore`（与 skills/titles 并列），但只对 B* 写入。
>   - **数据**：`characterStore.SubProfession`(含 `recipes: Recipe[]`)，存 `CharacterData.subProfessions`。`SUBPROF_TIERS` + `promoteTier` 满100晋级。
>   - **AI 指令**（`stateParser` `CHAR_CMD_RE`，仅 B*）：`addSubProfession("B1",{name,tier,progress,category,recipeLabel,effect,desc})` / `deSubProfession` / `addRecipe("B1",{prof,name,tier,progress,materials,output,desc})` / `deRecipe("B1",{prof,name})`。轻量短指令（`App.applyOneUpdate` 真正解析，不再静默跳过）：`ca.B1.<副职业> = 档位/进度` 或 `+= N`（总熟练度）、`rc.B1.<副职业>::<配方> += N`（配方熟练度）。
>   - **UI**：右侧导航 **🛠 副职业** → `SubProfessionPanel`（主角，双层进度条 + 配方展开）。已注入主角演化快照 + 结构化召回主角卡（"勿重复add，按需累加进度"）。**主角演化**预设加 `副职业系统(配方)` 规则（已入 PLAYER_KEEP_NAMES）。
>   - **物品衔接**：制作=物品管理阶段用配方 output/materials 走 createItem/consumeItem，本阶段 `rc.*`/`ca.*` 累加熟练度，两阶段松耦合。
> **聚灵阵/灵脉/修炼宝典闭关公式/万物炼制 DC 已删除**。**双修保留**。

### 原始完整预设（`concurrent-evo-preset-full-1781147723782.json`）

fanren-remake 原始格式，结构：
```
{
  entrySharedRules[],    // 登场判断阶段规则
  itemSharedRules[],     // 物品管理专用规则
  sharedRules[],         // 跨阶段共享规则
  prompts: {
    player,              // 玩家演化阶段（55条）
    npc,                 // NPC演化阶段（62条）
    item_management,     // 物品管理阶段（23条）
    beast,               // 灵兽阶段（24条）
    ...
  }
}
```

每条规则有 `id`、`name`、`content`、`enabled`、`role` 字段。

`完整版-主角演化（轮回乐园适配）.json` 是从此文件派生的适配版本，修改了 `prompts.player` 区段。

---

## 主角演化系统

### 入口与 Store

入口：设置 → 变量管理 → 🧬 主角演化 → `PlayerManager.tsx`（两个 Tab：预设设置 / API 设置）

`playerStore.ts`（持久化 key `drpg-player-evo`）：
```typescript
PlayerPresetSettings {
  enabled: boolean;
  frequency: number;      // 1=每回合，N=每N回合
  entries: PlayerPresetEntry[];
  presetName: string;
  presetVersion?: number;
}
```

Actions：`setSettings` / `setPresetEntries` / `togglePresetEntry` / `updatePresetEntry` / `clearPreset` / `deleteDisabledEntries` / **`smartFilterEntries`**（54条名单）/ `setPlayerApi` / `setPlayerUseSharedApi` / `fetchPlayerModels`

### 技能/词条 Store（`src/store/characterStore.ts`）

持久化 key `drpg-characters`，多角色数据容器：

```typescript
CharacterData { id: string; skills: Skill[]; traits: Trait[] }
```

**Skill 结构**（对齐 fanren-remake addSkill schema）：
- `id`、`name`、`level`（入门·Lv.15）、`cooldown`、`desc`、`effect`、`layers`、`layerEffects`
- `numeric.kind = "skill"`、`rarityTier`（ren/xuan/di/tian）、`element`、`activeProfile`

**Trait/天赋 结构**（`Trait` 已重定位为轮回乐园**天赋(Talent)**，`export type Trait = Talent`）：
- `name`（唯一标识）、`desc`、`source`（觉醒/激活方式）、`effect`、`rarity`（**天赋评级 D/C/B/A/S/SS/SSS**，诅咒类写「负面」）、`category`（天赋类型：技巧类/属性类/能量类/特殊异能类，用于「不可重复类型」约束）
- `numeric.kind = "talent"`、`rarity`（d/c/b/a/s/ss/sss）、`profile`
- **天赋系统规则**（轮回乐园）：**数量不设上限**（旧的"最多 3 个 / 同 category 类型唯一"限制已解除，见 `TALENT_NO_CAP_RULE`），激活仍需明确证据（宿主首次绑定免费激活 / 启蒙之石 / 突破卷轴 / 融合精华 / 试炼 / 顿悟 / 血脉传承），提升困难、每次为质变、同名只更新不重复。`RARITY_CLS`/`RARITY_DOT` 同时保留旧中文键(平庸~神话)兼容历史存档。

Actions：`addSkill`（upsert，同 id 替换）/ `removeSkill` / `addTrait`（=天赋 upsert，同 name 替换）/ `removeTrait`

### 角色指令解析（`src/systems/stateParser.ts`）

主角演化阶段输出的 `<upstore>` 块支持四条角色指令：

```
addSkill("B1", {"0":"S_B1_01","1":"烈焰斩","2":"入门·Lv.15",...,"numeric":{...}})
deSkill("B1", "S_B1_01")
addTalent("B1", {"name":"剑术天赋","category":"技巧类","rarity":"B","source":"宿主初始激活","numeric":{"kind":"talent","rarity":"b",...}})
deTalent("B1", "剑术天赋")
```
> 天赋指令首选 `addTalent`/`deTalent`（评级 D-SSS、最多3个、不可重复类型）；`addTrait`/`deTrait` 为向后兼容别名，二者同走 `characterStore.addTrait/removeTrait`。`CHAR_CMD_RE` 同时匹配两组，`NPC_ADD_RE` 负向断言 `add(?!Skill|Trait|Talent)` 防误吞。

解析函数：`parseAllCharCommands(text)` / `applyCharacterCommands(commands)`

### 技能/词条 UI（`src/components/CharacterPanel.tsx`）

入口：右侧导航"✨ 技能"按钮（`charPanelOpen` 状态）

- 顶部角色选择器（B1/B2/C1 等，根据 characterStore 动态生成）
- **技能 tab**：2列网格，卡片显示名称/等级/元素/层级色；点击展开冷却/消耗/层效果/删除
- **天赋 tab**（旧称词条）：2列网格，天赋评级(D-SSS)彩色边框 + 类型标签，点击展开觉醒方式/类型/删除

### 预设条目管理功能（物品管理和主角演化共有）

以下功能在 `ItemManager.tsx` 和 `PlayerManager.tsx` 中均已实现：

| 功能 | 说明 |
|---|---|
| **条目搜索** | 列表顶部搜索框，按名称或内容模糊匹配，切换时自动回第1页 |
| **仅看已启用** | 搜索框旁"全部/✓仅启用"切换按钮 |
| **导出预设 JSON** | 导出为 `entrySharedRules` 格式，可直接重新导入 |
| **删除未开启** | 两步确认（变红 → 执行），失焦自动取消 |

物品管理额外保留：**⚡ 智能筛选**（36条物品名单）和 **🔍 诊断**。主角演化有：**⚡ 智能筛选**（54条主角演化名单）。

### 技能槽（`src/components/EquipmentPanel.tsx`）

技能槽为**无限动态槽位**，不设上限：
- `equipSlot` 格式：`technique:0`、`technique:1`…（无 `#`，与 weapon/armor 风格一致）
- 装备面板中"技能"分组显示全部已装备技能卡片 + 永久"✦ 装备技能"追加按钮
- 追加时取当前最大槽号 +1 作为新槽号

---

## NPC 演化系统

为正文中出现的 NPC（ID 形如 `C1`/`C2`/`G1`）维护一张丰富的角色档案。**NPC 的技能/词条复用 `characterStore`**（`addSkill("C1",…)`/`addTrait` 等指令已支持任意 charId），档案本体存在 `npcStore`。

### 入口与 UI
- 设置 → 变量管理 → 🧑‍🤝‍🧑 NPC 演化 → `NpcManager.tsx`（三 Tab：**预设设置 / 调度 / API 设置**）。
- 右侧导航"📇 NPC"按钮（`npcPanelOpen`）→ `NpcPanel.tsx` 档案列表（**死亡角色 `isDead` 不在列表显示**，仍保留在 store；`records` 已 `filter(!isDead)`，在场/离场 tab 与计数均不含死者）；点击某 NPC → `NpcDetail.tsx` 单角色完整档案（**11 栏目**：基本信息/肖像绘卷/隐秘/自定义列/属性/储物袋/装备/技能/特质/关系/经历，含上一个/下拉/下一个导航，轮回乐园术语：阶位/天赋/战斗属性/等阶进度）。
- **在场人物浮窗**（`OnScenePanel.tsx`，挂在叙事滚动区的 `relative` 容器内 `absolute top-3 right-3`）：右上角浮窗，列出 `onScene && !isDead` 的 NPC，每张卡含**头像位 + 基础信息(姓名/阶位Lv/身份/好感/状态)**，点击进 `NpcDetail`（App 内 `onSceneDetailId` 状态直接渲染）。最多显 3 张、超出内部上下滚动；标题栏可折叠。**头像**存 `NpcRecord.avatar`(上传的图片 dataURL，未来生图位)——浮窗卡 hover 出「上传/换图」按钮，`NpcDetail` 肖像绘卷 tab 顶部 `AvatarBlock` 也可上传/替换/移除；随 `drpg-npc` 入存档。
- **装备栏**用独立组件 `NpcEquip.tsx`，复用玩家 `EquipmentPanel` 的 `SLOT_DEFS` 槽位网格（武器/防具/饰品/特殊装备；**无技能槽、无副职业栏**）。AI 给的槽位名（`armor:armor`/`armor:inner`/`armor:legs`/`weapon:right`…）由 `normalizeSlot()` 归一化到规范槽位，无法归类的进"其他已装备"。空槽点开从 NPC 储物袋装备，已装备槽点开可查看详情/卸下。
- NPC 持有物品结构 `NpcOwnedItem`（在 `npcStore`）已扩展：除名称/分类/品阶/效果/数量外，保留 `appearance/acquisition/notes/tags/numeric`（statLines 等），详情完整展示。**注意：旧版生成的 NPC 物品没有这些字段，需重新生成才完整。**
- 顶部有 **策略 A/B 切换卡片**。

### 数据 Store（`src/store/npcStore.ts`，key `drpg-npc`）
`NpcRecord` 关键字段（对应世界书 0~34 列）：`name`/`gender`(列1)、`realm`(列2 阶位·Lv.X\|身份)、`personality`(列3)、`status`(列4)、`callPlayer`(列7)、`background`(列10)、`innerThought`(列12)、`relations`(列13)、`favor`(列15)、`appearance5`(列16)、`motiveNow`(列27)、`appearanceDetail`(列34)、`title`、`items`（NPC 持有物品，**不占玩家背包**）、`extra`（其余列兜底）。
- 场景/生命周期：`onScene`(true=在场A区/false=离场B区)、`isDead`(列4含"已死亡"自动置)、`isBond`(羁绊/开局角色)、`keepForever`(手动保留)、`deeds`(事迹)。
- 调度：`freqMode`/`freqInterval`(逐目标频率)、`lastEvolvedTurn`/`lastEvolvedDate`、`lastSeenTurn`。
- 动作：`applyColumns`(列号→字段)、`applySkeleton`(登场骨架 `npc.<id>={n,r,p,t,lg,bg,act…}`)、`setScene`/`setSchedule`/`markEvolved`/`appendDeed`、`removeNpc`(**软删除**=归档离场)、`hardRemoveNpc`(**物理删除**，仅清理路人用)、`clearNpcBag`(清空某 NPC 未装备物品)、`absorbOrphans`(把"只有物品没档案"的空壳并入真实在场 NPC)、`clearAll`。
- **跨 store 清理**：NPC 的技能/词条存在 `characterStore`（`drpg-characters`）。`hardRemoveNpc`/`clearAll` 会**同步**调 `characterStore.removeCharacter(id)` / `purgeNpcCharacters()`（保留玩家 B*），避免孤儿数据。NpcManager 档案库有「整理空壳档案」按钮调 `absorbOrphans`。
- **持久化**：三个 store（`drpg-npc`/`drpg-items`/`drpg-characters`）均 `persist` 到 localStorage，**刷新不清空是存档机制**（非 bug）。彻底重置：清 `drpg-` 开头的 localStorage 键。

### 设置 Store（`src/store/npcEvoStore.ts`，key `drpg-npc-evo`）
`settings`：`enabled`、`strategy: 'A'|'B'`(默认 B)、`frequency`(策略A全局频率)、`scheduling`、`entries`、`presetName`。
- `scheduling`：`defaultFreqMode`/`defaultFreqInterval`、`offSceneQuota`(离场活跃名额，默认5)、`cleanupEnabled`/`cleanupCycle`(清理提醒，默认5)。
- 智能筛选名单：`NPC_KEEP_NAMES`(重点演化) / `ENTRY_KEEP_NAMES`(登场判断22条) / `B_CONSTRAINT_NAMES`(单角色约束，仅B启用)。`smartFilterEntries()` **按策略感知**。
- Prompt 构建按 `source` 拆分：`buildNpcSystemPrompt`(取 `source !== 'entrySharedRules'`) / `buildEntrySystemPrompt`(取 `source === 'entrySharedRules'`)。

### 两种运行策略（`App.tsx` 内 `runNpcEvolutionPhase` 分支）
- **策略 A**（单次合并）：每回合一次调用，扫正文输出任意多个 NPC 的 `add()/de()`，受全局 `frequency` 门控。省 token。
- **策略 B**（逐 NPC 并发，忠实原版，默认）：三段管线 `runNpcPipelineB`
  1. **登场判断** `runEntryJudgment`：1 次调用，用 22 条 `entrySharedRules` 提示词，**输出 JSON object**（非 `<state>`）含 `entries/exits/deedsUpdates/globalCommands`；`applyEntryResult` 据此建档(new 写骨架)/归档(exits 软删除)/记事迹。
  2. **调度** `computeFocusList`：在场/刚登场 NPC 必演化；离场 NPC 受逐目标频率(`passFrequency`)与 `offSceneQuota` 截断排序。
  3. **逐 NPC 重点演化** `runNpcEvolutionForTarget`：对 focus 列表每个 NPC **各发 1 次调用**（`${character_id}`=单个 id，限并发 5/批），输出按 charId 过滤防越界；`markEvolved` 记录回合。
  - `maybeAskCleanup`：到周期时本地启发式找出长期离场可清理 NPC（不含 `isBond`/`keepForever`），**弹出清理提示框**（`cleanupNpcs` 状态 → App.tsx 内联 dialog，可逐个「归档」或「全部归档/保留全部」，归档=`removeNpc` 软删除）。
  - 策略 B **每回合都进管线**（频率由调度层逐目标控制），不走全局 `frequency`。
  - **死亡角色不演化**：`scheduling.skipDead`(默认 true) 让 `computeFocusList` 过滤死亡；且 `createdIds`(本轮新建) 也过 `alive` 过滤——避免"本轮登场即被打死的杂兵/哥布林群"被强塞焦点。提示词侧 `NPC_DEAD_EXCLUDE_RULE`(代码注入登场判断+重点演化)：不为一击毙命的临时敌人建档，已建档者死亡只 de 归档、不再演化。

### NPC 指令解析（`src/systems/stateParser.ts`）
- `<upstore>` 块：`add("C1", {"列号": 值,…})`(覆盖式更新档案列) / `de("C1")`(软删除归档)。正则用**负向断言** `add(?!Skill|Trait|Talent)`、`de(?![A-Za-z])` 避免吞掉 `addSkill/addTalent/deTrait`。解析 `parseAllNpcCommands` → `applyNpcCommands`。
- `<state>` 块 NPC 短指令（`App.tsx` 内 `applyNpcShortCommands`，可按 charId 过滤）：`character.C1.stats.favor=N`、`character.C1.identity.title="…"`、`cr.C1=阶位/进度`(取阶位部分)、`hp.C1 = / -= / += N`。
- NPC 技能/天赋仍走 `addSkill/deSkill/addTalent/deTalent`（`addTrait/deTrait` 兼容别名，`characterStore`）。

### 预设文件（`预设/NPC演化.json`，v2，**84 条**）
**双区结构**，一次导入：`entrySharedRules`(22 条登场判断) + `prompts.npc.rules`(62 条重点演化)。`extractNpcPresetFromJson` 读取时按区赋 `source`，运行时各走各的 system prompt。
- **84 = 62 + 22**：原 fanren-remake 把登场判断(`entrySharedRules`，跨多演化类型共享)与 NPC 重点演化(`prompts.npc`)分成两个预设；本项目合并为一个文件、用 `source` 区分，运行时仍是两阶段，行为一致。
- 切到**策略 A** 时智能筛选会自动禁用那 22 条登场判断。
- 改预设须沿用统一的轮回乐园映射（境界→阶位、灵根→天赋、灵兽/妖兽→召唤物等），勿让修仙词回流。
- ⚠️ **从旧版单区预设升级到策略 B 必须重新导入 v2 双区预设**（旧版条目全是 `source='entrySharedRules'`，会导致两阶段错乱）。

---

## 回合洞察 / 自动存档 / 创建模板 / 属性代码生成（近期）

- **回合洞察**（`turnInsightStore`(drpg-turn-insight) + `TurnInsightPanel.tsx`）：每回合结束抓一份精简快照（主角六维/状态效果/技能/称号 + 所有 NPC 好感/状态/动机/状态效果 + 势力好感/状态/目标/地盘/资源/规模/实力/关系/首领），滚动保留最近 14 份。`App.captureTurnSnapshot()` 在自动存档同一时点（回合结束 20 秒后）调用。面板把**最新 vs 上一份**做结构化 diff，分 主角变化/关系变化/NPC动态/势力动态，用 新增/变更/移除/维持 标签 + `旧→新` 展示（纯 store diff，不调 LLM）。右侧导航 **🔍 回合洞察**。已纳入存档+clearProgress。
- **自动存档**（`saveManager.autoSaveSlot` + 固定槽 `AUTOSAVE_ID='autosave'`）：每回合生成完成后，`App` 里防抖 effect **延时 20 秒**（等 NPC/物品/势力等并发演化写完 store）`captureTurnSnapshot()` + 覆盖式存到「⏱ 自动存档」槽。和手动存档（`slot_时间戳`）互不干扰，只保留一个、反复覆盖。
- **角色创建模板**（`creationTemplateStore`(drpg-creation-templates)）：角色创建页顶部「💾 存为模板 / 📥 导入模板」——把开局设定（难度/乐园/基本信息/六维/天赋/契约者ID）存成命名模板（同名覆盖）复用，与游戏进度存档无关。
- **NPC 六维代码层生成**（`App.tsx`，解决"属性与正文不一致/平均默认"）：
  - `applyNarrativeAttrs(narrative)`：正则扫正文「人物信息卡」（容忍 姓名/名称、六维属性：、全角｜），把卡上六维**逐项照抄**到对应角色（按名匹配主角/NPC）。在 NPC 登场判断后 + 重点演化后调用。
  - `genVariedAttrs(realm, profession, bioStrength)` + `autoGenMissingAttrs()`：**无卡时**对缺六维或恰好默认 5/5/5/5/5 的在场 NPC，按 阶位(预算/区间) + 职业(主副属性排序) + 生物强度模板(T0~T9 特化度) 生成**有起伏**的六维（非平均）。仅在 applyNarrativeAttrs 之后兜底，不覆盖卡/演化已设好的值。
  - 预设侧：两预设加「逐项照抄正文六维」铁则 + `NPC属性更新与正文一致`(支持 `character.<id>.attrs.X = / += / -=`，含 C/G)。
- **演化阶段发全文**：物品管理 / 主角演化 / 记忆抽取(narrative ingest) 已去掉"最后2000字"截断，发送全部正文（NPC/势力演化仍用 `trimNarrative` 控 token）。
- **同人作品联网检索**：NPC演化/势力演化预设各加一条——遇同人/二创世界优先 Google Search 原作设定（需模型支持联网工具）。
- **新开档历史泄漏修复**（`messagesRef`）：`callApi` 改读 `messagesRef.current`（不再读渲染闭包里的 `messages`）；`confirmCreation`/`enterWorld` 发请求前 `messagesRef.current=[]`，避免"对话已清空但 API 仍读到上一局历史"。

## 势力演化系统（仿 NPC 演化）

为世界中的**势力/组织**（帮派/政府/企业/教会/军团/部落/星际势力…）维护档案。架构一一对照 NPC 演化：
- **数据** `factionStore`(drpg-faction)：`FactionRecord`，`inCurrentWorld`（当前世界=活跃，类比在场 / 非当前世界=后台推演，类比离场）。`applyColumns`(命名键覆盖)、`setWorld`(进/出当前世界)、`removeFaction`(软删除=移出当前世界)、`hardRemoveFaction`、`appendDeed`。
- **设置** `factionEvoStore`(drpg-faction-evo)：`enabled`/`strategy:'A'|'B'`/`frequency`/`scheduling`(`offWorldQuota`/`concurrency`/`modelPerTurnLimit`…)/`entries`，**独立 API**。`extractFactionPresetFromJson`/`buildFactionSystemPrompt`/`buildFactionEntryPrompt`。
- **AI 指令**（`stateParser`）：`<upstore>` `addFaction("F1",{命名键…})` / `deFaction("F1")`(归档=移出当前世界)；`<state>` 短指令 `faction.F1.favorToPlayer += N`/`faction.F1.status="…"`/`faction.F1.inCurrentWorld=true`；`addDeed("F1",{…})` 路由到 factionStore。
- **两策略**（`App.runFactionEvolutionPhase`，独立并发）：A=单次合并；B(默认)=`runFactionWorldJudgment`(当前世界判断，输出 JSON entries/exits) + `runFactionFocusEvolution`(逐势力并发，注 `serializeFactionSnapshot`，`computeFactionFocus`=当前世界全演化+非当前世界按 `offWorldQuota`)。在 `runPostNarrativePhases` 触发。
- **UI**：右侧导航 **🏛 势力** → `FactionPanel`（当前世界/非当前世界/已覆灭分区）；**设置→变量管理→🏛 势力演化** → `FactionManager`（启用+A/B策略选择+预设导入导出+调度+API 三Tab）。状态栏有 `factionPhaseLog`。
- **预设** `预设/势力演化.json`（双区：3条 entrySharedRules 当前世界判断 + 3条 prompts.faction.rules 重点演化，仿 NPC演化结构，可在 FactionManager 导入）。
- **存档**：`drpg-faction`/`drpg-faction-evo` 已纳入 saveManager 快照 + `clearProgress` 清空。
- **全量格式 + 换世界清理（修"势力换世界还在"）**：`FACTION_FULL_FORMAT_RULE`（代码注入两个势力阶段）强制**每次** addFaction/`faction.<id>` 都把全字段填全、尤其 **worldName 必填**（缺失 worldName 是"换世界后旧势力还挂当前世界出不去"的根因）。`enterWorld` 另做代码兜底：进新世界时把"worldName 已知且明显不属于新世界"的势力 `setWorld(false)` 移出当前世界。配合既有 `FACTION_HOME_EXIT_RULE`/`reconcileHomeWorld`（回归乐园时移出任务世界势力）。

## 领地演化系统（主神空间个人基地·单一记录）

为主角维护**唯一**的主神空间私人基地【领地】（参考 fanren-remake「洞府」家园系统，但已大改适配轮回乐园：去灵气/聚灵阵/灵田/丹房等修仙词）。**单目标**演化，仿杂项演化/生平压缩（**不是** NPC/势力的 A/B 策略与焦点调度）。

- **定位**：领地属主神空间个人区，**跨任务世界保留**（`enterWorld` 不碰它），是绝对安全区——**无防御、不会被攻打**。纳入 saveManager 快照 + `clearProgress`（`clearTerritory()` 只清记录、保留预设/API 配置）。
- **数据** `territoryStore`(drpg-territory，**数据+演化设置+独立API 合一**，仿 miscStore，最终未拆两个 store)：
  - 记录：`unlocked`/`name`(**读正文中基地称呼/玩家自定义，不硬编通用默认名**；`unlock` 未给名则留空，`TerritoryPanel` 头部 ✎ 可手动重命名)/`level`(走人物阶位，`realmFromLevel(lv)`→一阶…无上之境)/`buildProgress`(0~100 建设进度经验条，满100升一级)/`effects`(领地效果[])/`appearance`(外观描写)/`passiveOutput`(被动产出说明)/`members`(`TerritoryMember{id,role,note}`，id=关联 NPC 的 C-id)/`buildings`(`Building{name,level:1~5,effect,appearance,description}`，**全自定义**)/`storageItems`(仓库，与主背包分离)。
  - **建筑数量上限** `buildingCap(level) = level + 2`（Lv.1→3栋，**每升一级 +1**）；单栋 `BUILDING_MAX_LEVEL = 5`。
  - 设置：`settings{enabled,frequency,entries,presetName}` + `territoryApi`/`territoryUseSharedApi`。actions 含 unlock/setTerritory/addProgress(满自动升级)/upsertBuilding(受上限)/setBuildingLevel/upsertEffect/addMember/storeItem/takeItem/clearTerritory + 预设/API 套件。
- **建设进度三来源**（预设写明，AI 给 `territory.progress += N`）：① 建造/升级建筑 ② 领地成员的数量与质量（关联 NPC 阶位越高越快）③ 投入货币/资源。
- **AI 指令**（`stateParser.applyTerritoryCommands(text)`，一站式解析+应用）：
  - `<upstore>`：`unlockTerritory({name,appearance})` / `setTerritory({...})` / `addBuilding({name,level,effect,appearance})` / `upgradeBuilding({name,level})` / `deBuilding("名")` / `addTerritoryEffect({name,desc,source})` / `deTerritoryEffect("名")` / `addMember("C1",{role})` / `removeMember("C1")` / `storeItem({name,quantity,...})` / `takeItem("名",N)`。
  - `<state>`：`territory.progress += N`(满自动升级) / `territory.level = N` / `territory.appearance="…"` / `territory.name="…"` / `territory.passiveOutput="…"`。
  - 被动产出落仓库走 `storeItem`，货币走已有 `transferSpiritStones`(from:null,to:B1)——故领地演化阶段同时跑 `applyItemCommands` 让货币产出生效。
- **运行**（`App.runTerritoryEvolutionPhase`，仿 `runMiscEvolutionPhase`）：`enabled` + `frequency` 门控；system prompt 注入 `${territory_snapshot}`(serializeTerritorySnapshot)/`${onscreen_npcs}`/`${story_text}`/`${player_name}`；在 `runPostNarrativePhases` 并发触发。`buildStructuredRecall` 已注入【领地】概况到正文（已开辟才注）。状态栏 `territoryPhaseLog`。
- **UI**：右侧导航 **🏯 领地** → `TerritoryPanel`（概况+建设进度条 / 领地效果 / 建筑卡 / 成员（关联NPC，点击跳 NpcDetail）/ 仓库）；**设置→变量管理→🏯 领地演化** → `TerritoryManager`（演化设置+API 两 Tab）。
- **预设** `src/data/territoryDefaultPreset.json`(8条 entrySharedRules) + 复制到 `预设/领地演化.json`（可在 TerritoryManager 导入）。

## 冒险团演化系统（仅主角·单一冒险团）

为主角维护**唯一一支自己的冒险团**（不处理世界里其他冒险团/公会——那些归势力演化）。单目标演化，仿领地（单记录 + 独立演化阶段 + 独立 API + 预设）。

- **数据** `adventureTeamStore`(drpg-team，数据+设置+独立API 合一)：`established`/`disbanded`/`name`/`rank`(E D C B A S SS SSS)/`teamExp`(0~100 晋级主轴)/`activity`(0~100 每回合 `decayActivity` -2 衰减)/`members`(`TeamMember{id:C-id,role}`，主角B1=团长不单列)/`perks`(`TeamPerk` 团队效果权限)/`deeds`/`assessment`(`{pending,targetRank,isEstablish,status}` 考核试炼)。`TEAM_RANKS`/`memberCap(rank)=3+idx`(E3人每升阶+1)/`ACTIVITY_GATE=60`。
- **双计量晋级**（`addExp` 内处理）：经验满 100 时——小阶位 E→A 且 `activity≥60` 自动晋级；大阶位 →S/→SS/→SSS 触发 `assessment.required`（不自动晋级）；建团考核未过(`pending`)也不晋级。
- **考核试炼**（建团 + 大阶位）：`establish` 建团即置建团考核；进考核世界 `startAssessment(targetRank)`；出结果 `resolveAssessment('pass'|'fail'|'disband')`——pass 晋阶/确立、fail 减员(回退经验+扣活跃，成员由 AI `removeTeamMember`)、disband 解散。考核**纯剧情驱动**，系统只记状态。
- **仅正文明确建团才运作**：未 `established` 时演化阶段只在正文明确"建立永久冒险团"时 `establishTeam`，否则输出空、不创建。
- **AI 指令**（`stateParser.applyTeamCommands`）：`<upstore>` `establishTeam({name})`/`addTeamMember("C1",{role})`/`removeTeamMember`/`addTeamPerk({name,desc,source})`/`deTeamPerk`/`startAssessment({targetRank})`/`resolveAssessment({result})`/`addTeamDeed`/`setTeam`；`<state>` `team.exp +=N`/`team.activity +=/-=N`/`team.rank="S"`/`team.name="…"`/`team.assessment="passed|failed|disband"`。
- **运行**（`App.runTeamEvolutionPhase`，仿领地）：`enabled`+`frequency` 门控，独立 API；注入 `${team_snapshot}`/`${onscreen_npcs}`/`${story_text}`/`${player_name}`；在 `runPostNarrativePhases` 并发触发；`callApi` 开头 `decayActivity()`。状态栏 `teamPhaseLog`。**叙事召回**（`buildStructuredRecall`）已建立时**只注入 等级/成员/团队效果**（不注入经验/活跃度/考核细节）。
- **UI**：右侧导航 **🛡 冒险团** → `AdventureTeamPanel`（阶位徽章 + 经验/活跃度双进度条 + 考核横幅 + 成员(跳NpcDetail，团长B1单列) + 团队效果 + 大事记）；设置→变量管理→🛡 冒险团演化 → `AdventureTeamManager`（演化设置+API 两 Tab）。
- **存档**：`drpg-team` 纳入 saveManager + `clearProgress`(`clearTeam()`)；跨任务世界保留。
- **预设** `src/data/teamDefaultPreset.json`(6条 entrySharedRules) + 复制到 `预设/冒险团演化.json`。

## 中心 API 接口库 + 多接口路由（轮流调用 + 失败 fallback）

- **接口库** `settingsStore.apiLibrary: ApiEndpoint[]`（`ApiEndpoint extends ApiConfig {id,name,enabled}`）+ actions `addApiEndpoint/updateApiEndpoint/removeApiEndpoint/moveApiEndpoint(↑↓)`。`endpointToConfig(e)` 取纯 `ApiConfig`。维护入口：**综合设置 → 「API 接口库」**(`SettingsPanel.ApiLibrarySection`)：增/删/改/启停/排序多条接口，Key 仅存本地。
- **接口路由（多选·优先级·轮流+fallback）** `settingsStore.apiRoutes: Record<featureKey, string[]>`（有序 endpoint id 列表，上=先调用）+ `setApiRoute`。`resolveApiChain(key, legacy): ApiConfig[]` —— 路由有启用接口则返回该链，否则回退到 legacy 单配置（功能自己的「共用/单独」设置）。
- **调用器** `systems/apiChat.ts` `apiChatFallback(chain, messages, {timeoutMs, extra})`：按链逐个尝试，失败/超时自动切下一条；每接口用各自 model/temperature/maxTokens（`extra` 如预设温度覆盖优先）。**主正文 callApi 内置同款 fallback 循环**（流式，逐接口 fetch，首个 OK 即用）。
- **featureKey**：`text`(正文)/`world`(世界选择)/`item`/`player`/`npc`/`faction`/`territory`/`team`/`misc`/`memory`/`nm`/**`image_story_llm`**(正文配图的锚点抽取 LLM)。各功能 ApiSection 用组件 `ApiRoutePicker`（多选+↑↓排序+删除）配置；留空则用该功能下方「单独配置/共用 API」。
- **接入点**：所有阶段调用处已切到 `resolveApiChain(key, legacy)` + `apiChatFallback`（npc/faction 用其 `npcChatCompletion`/`factionChatCompletion`，nm 用 `nmChatCompletion`，item/player/misc/memory/territory/team 各 run*Phase，正文 callApi 自带循环）。⚠️ **世界选择(`world`)曾漏接**：`WorldSelector.generate()` 早期直接用 `useSettings.api` 裸 fetch、无视 `world` 路由；已改为 `resolveApiChain('world', api)` + `apiChatFallback`（多接口轮流+fallback）。
- 旧 `ApiQuickPick.tsx`（单选一键填入）已被 `ApiRoutePicker` 取代（选 1 条=单接口，选多条=轮流），文件保留未引用。

## 生图系统（三条生成线，`imageGenStore` + `systems/imageGen.ts`）

多服务（NAI/OpenAI/Gemini/ComfyUI/自定义）生图，三条相互独立的线，各选服务商、各有模板与自动开关。入口：**综合设置 → 🖼 生图设置**（`ImageGenManager`，4 子页：生图API配置 / 肖像生成 / 装备生图 / 正文生图）。详见 `生图功能-集成指导.md`。

- **生成器** `systems/imageGen.ts`：`generateImage(service, {prompt,negative,size,signal}) → dataURL`。`genNai`（NAI 返回 **ZIP**，`extractImageFromZip` 解 stored/deflate-raw + PNG 兜底扫描；v4 模型用 `v4_prompt/v4_negative_prompt`，旧模型 `negative_prompt`，画师串 `artistTags` 追加到正向末尾）/ `genOpenAI`（`/images/generations`，b64_json/url→dataURL，OpenAI/Gemini/自定义共用）/ `genComfy`（注入工作流 seed→`POST /prompt`→轮询 `/history/{id}`→`/view` 取图）。提示词构建：`buildPortraitPrompt({gender,age,appearance,profession,tier,npcTag})`、`buildEquipPrompt(item)`（替换 `equipTemplate` 的 `${item_*}`/`${owner_gender}`）。
- **三个预留图像框 + 手动「✨AI 生成」**（生成后写字段即显示）：
  - **NPC 肖像** → `NpcRecord.avatar`：`NpcDetail` 的 `AvatarBlock`（上传/替换/移除/✨生成）。
  - **主角立绘** → `PlayerProfile.avatar`：`PlayerSidebar` 头部 `PlayerAvatar` 组件。
  - **装备图** → `InventoryItem.image`（`BackpackModal.ItemImageBlock`）/ `NpcOwnedItem.image`（`NpcDetail.NpcItemCard`，每张物品卡左侧 14px 缩略图 + ✨/⬆/✕）。NPC 物品图通过 `npcStore.updateNpcItem(ownerId,itemId,patch)` 写入。
- **自动阶段**（`App.runPostNarrativePhases` 末尾触发，均受各自开关门控；肖像/装备延后 6 秒等演化写档，串行生成避免打爆 NAI）：
  - `runPortraitPhase`（`autoPortrait`）：在场存活、无 avatar、有外观线索的 NPC + 无立绘主角 → 补肖像。**外观变化自动重绘**（`refreshOnLook` 默认 **true**）：主角除 imageTags(列19)变化外，**`appearance` 外观文字变化也触发重绘**——记 `PlayerProfile.avatarAppearance`(出图时的外观文本) 对比，文字变了但 imageTags 没跟着变时 `forceRetag` 重新翻译标签让新图真的不同。(NPC 仍只按 imageTags 变化刷新，避免演化频繁改 appearance5 导致出图churn。)
  - `runEquipImagePhase`（`autoEquipPlayer`/`autoEquipNpc`）：有 `appearance` 无 `image` 的装备（主角背包 + NPC 持有物）→ 补设定图，服务用 `effectiveEquipService`（沿用肖像或独立）。**装备无专用生成提示词**（仿 fanren）：`buildEquipPrompt` 用**可编辑的 `equipTemplate`** + 物品字段（`${item_name}/${item_category}/${item_grade}/${owner_gender}/${item_appearance}/${item_effect}`）拼成提示词，世界风格自适应。
  - `runStoryImagePhase(narrative, msgId)`（`autoStory`）：**正文配图**。独立 LLM（`resolveApiChain('image_story_llm', textApi)`）跑 `storyTemplate` → 输出 `${image_count}` 个 `<image>` 块（`<anchor>` 正文短片段 / `<nsfw_rating>` sfw~explicit / `<prompt>` 英文 NAI tags）→ 逐张 `generateImage(storyService)` → 存入 `ChatMessage.images[]`(`{anchor,url,prompt,nsfw,ts}`)。渲染 `toHtmlWithImages(content, images)`：在 anchor 命中处插占位符 `@@ZSIMG<i>@@`（穿过 escapeHtml/wrap）→ 替换为 `<a><img class="story-illust"></a>`（点击新标签放大），无命中追加末尾。`images[]` 随 `chatDb` 增量持久化。
- **肖像生图提示词(imageTags / 第19列)·演化生成**（**仅角色，仿 fanren col19**；装备不走此机制）：主角/NPC 各维护一份**英文 Danbooru/NAI tags**（演化阶段生成，存 `PlayerProfile.imageTags`/`NpcRecord.imageTags`，列19, COLUMN_MAP `'19'→'imageTags'`），用于同角色多次出图一致。`buildPortraitPrompt` **优先用 imageTags**，无则回退到外观字段拼。
  - **AI 指令**：主角 `add("B1",{"19":"1girl, ..."})` 或 `character.B1.imageTags="..."`；NPC `add("<id>",{"19":"..."})`。
  - **代码注入铁则**（始终生效、轮回乐园-clean）：`IMAGE_TAGS_RULE`(主角演化+NPC重点演化)——英文 NAI tags、性别开头、仅长期外观变化才更新、勿用修仙词、**同人/二次创作角色须输出准确 danbooru 角色名+作品+经典外观 tags**。演化快照已注入「当前生图提示词(列19)…有则沿用」。
  - **同人角色准确性**：`IMAGE_TAGS_RULE`、`storyTemplate`、`equipTemplate` 均要求遇到已知动漫/游戏同人角色/装备时按原作设定准确还原（角色名 tag + 作品 tag + 经典外观），不泛化、不张冠李戴。
  - **预设**：主角演化「主角变量列定义」列19=画像提示(已 clean)；主角/NPC演化的「肖像刷新标记/danbooru…」生图条目已做修仙→轮回乐园 vocab 清理。
  - **可编辑提示词**（设置→生图设置）：肖像额外正向/负面、装备模板(`equipTemplate`)+负面+恢复默认、正文模板(`storyTemplate`)+恢复默认，均可在 `ImageGenManager` 编辑。
- **状态栏**：生图阶段进度走 `imagePhaseLog`（粉色，`0/N` 计数）。
- **图片存 IndexedDB（`drpg-images`，非 localStorage）**：头像/装备图体积大，存 localStorage 会爆 5MB 配额。`systems/imageDb.ts`(key→dataURL：`player`/`npc:<id>`/`item:<itemId>`/`npcitem:<owner>:<itemId>`) + `systems/imageSync.ts`(订阅各 store 防抖镜像到 IndexedDB；启动 `hydrateImages()` 回填 + 迁移旧 localStorage 图；`snapshotImages()` 供存档取最新)。各 store(`drpg-player-evo`/`drpg-npc`/`drpg-items`) 用 `partialize` 把 avatar/image **排除出 localStorage**。`shrinkDataUrl` 现存近原图(1024px q0.9/装备768)。存档：saveManager 把 `snapshotImages()` 打包进 `slot.data.images`，读档 `clearAllImg`+`bulkPutImg`，clearProgress `clearAllImg`。`imageTags`(列19) 仍随 `drpg-*`(小文本)。`ChatMessage.images` 随 chatDb。
- **后续可选**（未做）：OpenAI 参考图、NAI 全局串行队列/RPM、画风工坊、顶部在场头像条。

## 关键设计决策

### 构建产物
- `dist/` 下会保留多个历史构建版本（不同 hash 文件名），`index.html` 始终指向最新版本。旧文件不会自动清理。
- 修改 `src/` 后必须重新运行 `npx vite build` 才能更新 `dist/`，前端加载的是 `dist/` 下的文件。

### 货币系统（`itemStore.CurrencyWallet`，4 项）
- **乐园币**（日常）、**灵魂钱币/魂币**（高阶）、**技能点**、**黄金技能点**（技能升级资源，固定显示在「储存空间」的货币栏）。
- 换算参考：1 魂币 ≈ 150,000 乐园币（无固定官方汇率）
- AI 指令用 `transferSpiritStones({...,"grade":"乐园币|魂币|技能点|黄金技能点",...})`（或 `transferCurrency` 用 `type`）；`grade/type` 省略默认乐园币。获得写 `from:null,to:B1`，支出写 `from:B1,to:null`。
- ⚠️ **曾有 bug（已修）**：`transferSpiritStones` 在 [stateParser.ts](zhushen-space/zhushen-space/src/systems/stateParser.ts) 中曾被当废弃指令**整个忽略** → 乐园币/灵魂钱币永不更新。现已与 `transferCurrency` 合并处理，`normalizeCurrencyType()` 按 grade/type（含旧灵石别名）归一化到钱包键。
- UI：右侧「🎒 背包」→ `BackpackModal`（标题已由「储物袋」改为「**储存空间**」），`CurrencyBar` 展示全部 4 种货币。NPC 的「储物袋」标签同步改为「储存空间」。

### rarityTier 映射（品质色阶）
| 代码值 | 含义 | 品质色阶 |
|---|---|---|
| `ren` | 普通/优秀 | 白色/绿色（grade 0-2）|
| `xuan` | 精良/史诗 | 蓝色/紫色（grade 3-4）|
| `di` | 传说 | 淡金/金色（grade 5-6）|
| `tian` | 暗金及以上 | 暗金/永恒/起源（grade 7+）|

### 物品评分与定价（`物价和金融系统` 预设条目 = 轮回乐园颜色品质定价）

> ⚠️ 已由修仙「一品~二十二品装备价格锚定表 + 宗门俸禄」**整体替换**为轮回乐园**颜色品质定价**（物品管理/主角/NPC 三预设的 `物价和金融系统` 条目同步，名为「物品定价核心机制」）。**俸禄已删**（轮回乐园无门派俸禄，收入只靠任务/掉落/交易）。

价格由 **品质颜色 + 9 项定价因素**（权重高→低：基础品质 / 稀有度获取难度 / 核心效果强度 / 潜力成长性 / 制造获取代价 / 需求限制 / 世界观文化 / 供需波动 / 耐久状态）综合估算：

| 品质 | 参考价 | 交易方式 |
|---|---|---|
| 白色 | 约 300-800 乐园币 | 乐园币常规 |
| 绿色 | 约 1,500-2,500 乐园币 | 乐园币常规 |
| 蓝色 | 约 3,500-5,500 乐园币 | 乐园币常规 |
| 紫色 | 约 8,000-35,000 乐园币 | 乐园币常规 |
| 淡金 | 约 100,000-250,000 乐园币 / 50-100 魂币 | 开始出现魂币计价 |
| 金色 | 数百~数万 魂币 | 魂币 / 同级物品互换 |
| 暗金 | 无法用常规货币衡量（战略级） | 以物换物为主，可契约公证 |
| 永恒 / 起源 / 创世 | 超越理解 / 法则级 / 无法估价 | 不流通 |

- **暗金级及以上**：倾向 ①灵魂钱币直购 ②以物换物（同级珍稀互换+契约公证）③特殊贡献/世界级任务兑换。
- **供需波动**：淡金及以下乐园币交易品短期 ±5%~±30%，靠刷新率/回收价宏观调控；对魂币顶级品影响极小。

**收入来源**：击杀敌人（掉落随阶位/强度）、完成系统任务（主神空间结算）、交易物品（售价约参考价 50%-80%）。
**物品消耗/容器**：`im-operation-rules` 加了「容器/宝箱开启」（destroyItem 容器 + createItem 内容物）与「一次性消耗品使用自检」（用完/开启/服用即 consumeItem，itemId 找不到时用全名兜底）——修复"用完/开宝箱后物品不消失"。`consumeItem` 数量归零会自动从 store 移除（itemStore），代码侧本无 bug，是预设漏输出指令。

> **已装备物品防误删（`stateParser` 守卫）**：`destroyItem`/`consumeItem` 对 `equipped===true` 的物品（主角背包 + NPC 持有物两路）**一律拒绝执行**并打 warn——修复"穿戴中的装备被 AI 无理由 destroy/consume 掉"。要处理穿戴装备必须先 `uneq` 卸下。物品阶段 system prompt 也注入了同款「勿对 equipped 物品 destroy/consume」铁则。

**特殊物品**：成长装备（吞噬素材升级）、套装（集齐触发套装效果）、恢复品（药剂/食物，有冷却与抗性递增）、爆炸物（高杀伤一次性道具）。

### 技能书/知识物品（取代旧"功法"概念）
- `numeric.kind: "skillBook"` — 学习技能（消耗后 `consumeItem` 销毁，技能通过 `addSkill` 写入 characterStore）
- `numeric.kind: "knowledge"` — 获得知识
- `numeric.kind: "schematic"` — 图纸/配方
- `numeric.kind: "talentFragment"` — 天赋碎片
- technique 槽为**无限动态槽**，`technique:0`、`technique:1`…（无数量上限）

---

## 世界书（`______.json`）

轮回乐园世界设定，127个条目（uid 0–146）。关键体系：

### 角色阶位体系（第2列 `阶位|身份`）

| 阶位 | 等级范围 | 战力参考 |
|---|---|---|
| 一阶 | Lv.1-10 | 新人/炮灰 |
| 二阶 | Lv.11-20 | 正式战力 |
| 三阶 | Lv.21-30 | 中坚战力 |
| 四阶 | Lv.31-40 | 摧毁小型据点 |
| 五阶 | Lv.41-50 | 城市级威胁 |
| 六阶 | Lv.51-60 | 地区级灾难 |
| 七阶 | Lv.61-70 | 人形战略武器 |
| 八阶 | Lv.71-80 | 横渡星空 |
| 九阶 | Lv.81-90 | 文明级毁灭者 |
| 绝强 | Lv.91-100 | — |
| 至强 | Lv.101-120 | — |
| 巅峰至强 | Lv.121-140 | — |
| 无上之境 | Lv.140+ | — |

第2列格式：`阶位·Lv.当前等级|当前世界身份`（例：`三阶·Lv.25|调查员`）

### 技能层阶（个人技能成长，与阶位独立）

入门（Lv.1-30）→ 精通（Lv.1-50）→ 大师（Lv.1-80）→ 宗师（Lv.1-100）→ 极道（无上限）

### 其他体系

- **物品品质**：白色 → 绿色 → 蓝色 → 紫色 → 淡金 → 金色 → 暗金 → 永恒 → 起源 → 创世
- **货币**：乐园币（日常）+ 灵魂钱币/魂币（高阶）+ 灵魂结晶（技能升级消耗）
- **天赋评级**：D → C → B → A → S → SS → SSS（数量不设上限，旧"最多3个"已解除）

修改世界书只需直接编辑 JSON 文件并在应用界面重新导入。

---

## 主角 / NPC 身份档案与 AI 更新

主角和 NPC 都有一套身份档案字段：姓名、等级、阶位、称号、职业、竞技场排名、身份、烙印等级、契约者ID、**生物强度模板**、**六维基础属性**（力str/敏agi/体con/智int/魅cha/幸luck）、外观、所处位置、HP/EP。

- **生物强度模板**（`profile.bioStrength` / `NpcRecord.bioStrength`，存如 `T3·勇士`）：强度档位 T0杂鱼~T9源初。主角侧栏「生物强度」行、NpcDetail 基本信息「生物强度」字段展示。AI 短指令 `character.<id>.bioStrength = "T3·勇士"`（主角 `applyPlayerProfileCommands`、NPC `applyNpcShortCommands`）。
- **生物强度生成框架**（属性预算系统）：两预设各加了一条 `生物强度生成框架(T0-T9属性预算)` 规则（NPC在 `prompts.npc.rules`、主角在 `entrySharedRules`，已入各自 KEEP_NAMES）——按阶位Tier预算(Budget/Flex)+模板T0~T9+身份层(原生/精英/契约者/违规者/猎杀者/首领)+流派(Specialist/Dual_Focus/…)分配六维，宁低勿高、禁五项全满。**非人生物（阴影潜伏者/魔物/召唤物/Boss等）同样必须生成六维**（NPC 全量追溯补全的「六维属性」行已放宽到"任意有威胁/可战斗的角色含非人生物"）。六维仍是纯 AI 生成、前端只算衍生ATK/DEF。
- **容器/一次性物品消失**：物品管理预设加了高优先级 `Standalone 容器开启与一次性消耗强制自检`（已入 KEEP_NAMES）——开宝箱/用消耗品的"已完成"动作必须 `destroyItem`/`consumeItem`，itemId 找不到时用全名兜底（parser 本就支持 `findItemById ?? findItemByName`，根因是 AI 漏输出指令）。

- **主角**：存 `playerStore.profile`。左侧栏 `PlayerSidebar.tsx`（取代旧的天赋/装备栏）展示并**点击即编辑**；HP/EP 取自 `gameStore`（hp/mp）。`profile.status`（**当前状态/Buff**：受伤/疲惫/中毒/增益）由主角演化维护（列4），侧栏「❖ 当前状态」用 `StatusChips` 胶囊显示、✎ 可编辑。
- **叙事区左右对称浮窗**（挂在叙事滚动区 `relative` 容器内，浮在居中正文两侧的空白处）：左上角 `PlayerEquipPanel.tsx`(`absolute top-3 left-3`，**主角装备**) ←→ 右上角 `OnScenePanel.tsx`(`absolute top-3 right-3`，**在场人物**)，同款卡片。`PlayerEquipPanel` 列主角已装备物品，每卡含**图片位 + 基础信息(名称/分类·品质/攻防/槽位)**，hover 出「上传/换图」，点击开 `ItemDetailModal`（卸下/编辑/锁定/删除）；最多约 4 张超出内部滚动、标题栏可折叠。**物品图片**存 `InventoryItem.image`(dataURL，未来生图位)——`ItemDetailModal` 顶部 `ItemImageBlock` 也可上传/替换/移除；随 `drpg-items` 入存档。
- **右下角「🎒 物品栏」浮窗**（`ItemListPanel.tsx`，`absolute bottom-3 right-3`，在「在场人物」下方）：物品**简要列表只显示名称**（分类色点 + 已装备「装」标，点击开 `ItemDetailModal`），**不留图片位**；顶部**筛选**=分类下拉(仅列有物品的分类) + 已装备/背包/全部；可折叠、内部滚动。
- **主角侧栏新增字段**：`profile.advancePoints`（进阶点数，身份栏 + 储存空间货币栏都显示）、`profile.worldSource`（**世界之源**：当前任务世界累计获取，`character.B1.worldSource += N` 增加，**回归主神空间时 `=0` 归零**；身份栏显示）。
- **衍生属性**（共享 `systems/derivedStats.ts` 的 `computeDerived`，**主角侧栏 + NPC 详情属性栏共用**）：物理ATK/DEF、法术ATK/DEF 由六维+等级+已装备物品（按 category/grade）实时换算——物理ATK=max(力,敏)主导+武器；物理DEF=体质+防具；法术ATK=智力+装备；法术DEF=智力(感知)+魅力+装备法抗。换装/升级/加点自动重算，公式可调。NPC 的等级由 `lvFromRealm(realm)` 从 `一阶·Lv.8` 提取。**纯前端计算，AI 不写**（预设已注明）——只需 AI 生成合理六维(attrs)即可。
- **储存空间**（原「背包」）：右侧导航按钮与 `BackpackModal` 标题均为「储存空间」；`CurrencyBar` 显示 4 货币 + 固定「进阶点数」行。
- **叙事记忆回溯提示**：`callApi` 召回时 `nmRecalling` 显示「正在进行记忆回溯…」，`runNarrativeIngestPhase` 显示「记忆整理中」；素材库为空时提示「需先经总结/LLM抽取积累事实」——便于排查"开启了但没触发"（多为 facts 库空或未开 LLM 模式）。
- **主角状态/外观/位置/背景的列写法兼容**（重要）：主角侧栏读 `profile.status/appearance/location/background`，但预设用旧列写法 `add("B1",{"4":状态,"16":动作\|穿着\|位置\|身段\|样貌,"10":背景})` 输出 → 不映射就不更新。`applyPlayerProfileCommands` 解析 `add("B1",{...})` 把 列4→status、列16→appearance(+位置→location)、列10→background 同步进 profile；另有直写短指令 `character.B1.status/appearance/location = "..."`。
- **分段显示组件 `SegmentedText`**（导出自 `NpcDetail.tsx`）：把结构化文本按 `；;` / 空格包围的竖线 ` | ` / 换行切分为多行，识别 `[标签]`/`【标签】` 前缀做左侧小标签（buff 内部 `(效果|激活|…)` 无空格竖线不受影响）。用于 NPC 的**性格 / 内心想法 / 私密信息(性经验)**——解决"一整块挤在一起"。
- **状态胶囊 `StatusChips`**（导出自 `NpcDetail.tsx`，参考 fanren-remake 状态栏）：把 列4 `当前状态/Buff`（格式 `状态名:Emoji(效果\|激活\|结束\|来源)`，**多个用 ；分隔**）解析成胶囊 chip——胶囊名取冒号前状态名，颜色按关键词分 buff(绿)/debuff(红/含 毒伤虚弱寒冻…)/中性(琥珀)，点击展开效果/激活/结束/来源。用于**主角侧栏「当前状态」与 NPC 详情「当前状态」**。两预设的 列4 格式已注明多状态用 ；分隔。
- **限时状态（引擎自动过期，`StatusEffect`）**：与上面的自由文本 `status`（长期/无时限）**并存**——有明确时限的 buff/debuff 走结构化 `profile.statusEffects` / `NpcRecord.statusEffects`（`{name,emoji,tone,effect,source,startTurn,durationTurns?,durationDesc,startGameMin,expireAtMin,...}`）。
  - **AI 指令**：`addStatus("B1"/"C1",{name,emoji,tone,effect,source,duration})` / `deStatus("id","名")`（`App.applyTimedStatusCommands`，在主角/NPC 演化阶段解析；按 charId 路由到 `playerStore`/`npcStore`）。`duration` "3回合"→回合制；"5分钟/2小时/3天"→游戏时间制（`systems/gameClock.ts` 解析）。
  - **自动过期** `App.expireStatuses()`：每回合 `callApi` 开头调用，按 `turnCount - startTurn >= durationTurns` 或 `当前游戏分钟 >= expireAtMin`（游戏时间取 miscStore `worldTime||paradiseTime`，`parseGameMinutes`）移除已过期项——无需 AI 输出移除指令。
  - **展示** `StatusEffectChips.tsx`：主角侧栏「当前状态」+ NPC 详情「当前状态」的「⏳ 限时状态」区，tone 着色 + ⏳时效 + 可手动✕移除。已注入主角/NPC 演化快照与结构化召回（"勿重复添加同名"）。两预设加 `限时状态系统` 规则（已入各 KEEP_NAMES）。**胶囊只显示"数字+单位"短时长**（`durShort`，3回合/5分钟…）+ `whitespace-nowrap` 防断词；AI 把长"解除条件"（如"重新接战后解除"）写进 `durationDesc` 时胶囊只显 `· ⏳…`，完整条件在展开区按 `时效·/解除·` 显示（修"胶囊文字挤成一团"）。
- **NPC**：`NpcRecord` 加了 `profession/arenaRank/brandLevel/contractorId/attrs/mp/maxMp/**age**`，在 `NpcDetail.tsx` 的基本信息/属性栏展示。阶位/等级/身份仍走第2列 realm。**年龄(`age`)**：`NpcDetail` 战斗属性栏「年龄」字段（取代旧的 特殊体质/外貌年龄/寿元 三字段）；短指令 `character.<id>.age = "约25岁"`；注入 NPC 快照 + 结构化召回；正文有照抄、无则按设定生成（见 `NPC_AGE_RULE`）。
- **AI 更新路径**（`<state>` 短指令）：`character.<id>.identity.profession="…"`、`character.<id>.attrs.str=N`、`character.<id>.appearance/location="…"`、`mp.<id>=N`、主角另有 `character.B1.level=N` / `identity.tier|title|role|brandLevel|contractorId`。主角在 `applyPlayerProfileCommands`（主角演化阶段）处理；NPC 在 `applyNpcShortCommands`（NPC 演化阶段）处理。预设已写入这些指令说明。
- **经历(deeds)**：主角 `profile.deedLog`、NPC `NpcRecord.deedLog`，结构化 `{time,location,description}`；AI 指令 `addDeed("B1"/"C1",{...})`（`stateParser`，与 addSkill 同体系）。在「经历」tab 时间线展示。

## 技能 / 天赋 / 称号 固定格式（`characterStore`）

三者都走 `characterStore`（B1 与 NPC `Cx` 共用），AI 指令在 `stateParser` 的 `parseAllCharCommands`/`applyCharacterCommands`：
- **技能** `Skill`（固定格式 名称|等级|类型|品级|消耗|目标|效果|伤害|层级|属性加成|描述|标签）：除原有 id/name/level/cooldown/desc/effect/layers/layerProgress/cost/layerEffects 外，加 `skillType/rarity/target/damage/attrBonus/tags`。`addSkill("B1",{命名键…})`，CharacterPanel/NpcDetail 技能卡展开显示全部字段。
- **天赋** `Talent`（名称|等级|品级|效果|属性加成|描述）：加 `level/attrBonus`。`addTalent`/`addTrait`（别名）。
- **称号** `Title`（名称|获得时间|品级|来源|效果|描述|是否装备）= `{name,obtainedTime,rarity,source,effect,desc,equipped,addedAt}`。**每角色最多 1 个 `equipped`**。
  - AI 指令：`addTitle("B1",{...})`(upsert)、`deTitle("B1","名")`、`equipTitle("B1","名")`（只佩戴此一个）；store 动作 `addTitle/removeTitle/equipTitle/unequipTitle`。`CHAR_CMD_RE` 与 `NPC_ADD_RE` 的 `add(?!…|Title)` 负向断言已含 Title。
  - **NPC 生成自带 1 个称号**（NPC演化预设要求 `addTitle equipped:true`）；称号靠正文更新。
  - **UI**：主角右侧导航 **🎖 称号** → `TitlePanel`（称号库，点击佩戴/卸下/删除，至多1个佩戴）；NPC 在 `NpcDetail` 基本信息「称号库」区。
  - **叙事记忆注入**：`structuredRecall` 的主角/NPC 卡**只注入 equipped 的那一个称号**（`equippedTitleLine`），未佩戴的不进正文。
- 预设：两预设各加 `技能天赋称号固定格式` 规则（已入各自 KEEP_NAMES），强制数值化输出全部字段。

## 成就系统（仅主角，`playerStore.achievements`）

固定格式 `Achievement` = `{id,name,desc,category,type,rarity,hidden,condition,unlockTime,addedAt}`（id|名称|说明|分类|类型|稀有度|是否隐藏|解锁条件|解锁时间）。
- 存 `playerStore.achievements`（独立于 profile，持久化 `drpg-player-evo`，merge 已补默认 `[]`）。actions `addAchievement`(upsert by id)/`removeAchievement`。
- **AI 指令** `addAchievement("B1",{...})` / `deAchievement("B1","id")`（`stateParser` CHAR_CMD_RE，**仅 B\* 生效，NPC 不建模成就**；`NPC_ADD_RE` 负向断言含 `Achievement`）。
- **UI**：右侧导航 **🏆 成就** → `AchievementPanel`（按分类筛选，隐藏成就带 🔒 标记，可删除）。
- **不计入叙事记忆注入**（`structuredRecall` 不含成就，刻意）。
- 预设：主角演化加 `成就系统固定格式` 规则（已入 PLAYER_KEEP_NAMES）。

## HP/EP 上限非固定（可成长）

主角/NPC 的 `maxHp/maxMp` **不再固定**：升级/阶位提升/体质(con)成长或剧情强化时可抬高。代码本就支持——主角 `maxHp.B1 = N`/`maxMp.B1 = N`（`applyOneUpdate`）、NPC `hp.C1 = 当前/新上限`/`mp.C1 = 当前/新上限`（`applyNpcShortCommands` 的 `= 当前/上限` 语法同时设 max）。两预设原本「不反复刷上限/禁止写HP/MP max」的限制已放宽为「上限随成长增长，不要无理由每轮刷高」。

> **HP/EP 由六维换算·显示与兜底（重要）**：主角 HP/EP 上限**始终按六维实时换算**——`computeMaxHp=体质×20`、`computeMaxEp=智力×15`（`systems/derivedStats.ts`），PlayerSidebar/结构化召回都用 `effectiveResource(cur, _, 六维上限)`（当前值 null/未动过→显示满）。NPC hp/mp 默认 undefined→本就按属性算满；**只有主角** gameStore 有硬编码默认 `hp:100/mp:50`，会让显示卡在 100/50 不随属性变。三处兜底（App.tsx）：① `confirmCreation` 开局按六维把 hp/mp 拉满；② `reconcilePlayerVitals`（每回合 callApi 开头）——仍是 `100/100&50/50` 旧默认时按六维重算为满，任一值被正文动过即不插手；③ `applyNarrativeVitals`（runPostNarrativePhases）——扫正文「当前HP/EP：X/Y」直接照抄到 gameStore（AI 漏写 `hp.B1` 时兜底，解决"正文回血了但侧栏没变"）。

## 名称模糊匹配 + 引用照抄铁则（防"简写/标点差异导致匹配失败"）

AI 指令引用已有条目时名字常有细微出入（简写、漏品级前缀、多空格/标点），会**消耗/删除找不到、或被当新条目重复堆叠**。两层防护：
- **代码·归一化匹配 `nameEq`**（去空白/标点/大小写后**相等**；不做子串包含以免误并 `烈焰斩` vs `烈焰斩·改`）：`characterStore`(技能/天赋/称号/副职业/配方)、`territoryStore`(建筑/效果/仓库物品)、`adventureTeamStore`(团队效果) 的"同名→更新、按名删除"全改用它。
- **物品·子串包含** `stateParser.fuzzyFindItem`：新增**反向包含**（物品名含 query，如"止血喷雾"→"次级止血喷雾"，取最短匹配名）；消耗/销毁经 `pickTargetItem`（name 优先于幻觉 itemId）。
- **提示词·照抄铁则**（App.tsx 代码注入常量，始终生效）：`ITEM_EXACT_REF_RULE`（消耗/销毁/装备物品照抄储存空间完整名+真实ID，注入物品阶段）、`EVO_EXACT_REF_RULE`（删除/升级 技能·天赋·称号·副职业·配方 照抄快照完整名，注入主角+NPC演化）。

## 生平压缩（记忆整理，`memoryStore` + characterStore.memory）

逐角色的工作记忆 `memory.shortTerm/longTerm`（`MemoryEntry{time,location,content}`）。AI 指令 `addMemory("B1"/"C1",{...})` 追加 shortTerm；达阈值（短期25→5、长期50→20，可调）由 `App.runMemoryCompressionPhase` 调 AI 压缩（轮回乐园档案官提示词，含不可逆事实自检、防过度压缩）。入口：设置 → 变量管理 → **「📜 生平压缩」**(`MemoryManager`，独立 API)。

## 杂项演化（`miscStore` + `miscParser` + `App.runMiscEvolutionPhase`）

第4个并发阶段，维护世界级杂项（只读正文、只写变量）：
- **分段总结** `addSmallSummary/addLargeSummary`；**世界大事** `addWorldEvent/update/delete`；**主角任务**（仅 `T_<数字>`）`set/add("T_x")/de`；**天气** `timeLocation.weather`。
- **轮回乐园双时间**：`timeLocation.paradiseTime`（轮回历X年X月X日，主神空间日历）+ `timeLocation.worldTime`（当前任务世界的具体时间，如二战1943…）+ `worldName`。顶部状态栏读这两个时间+天气。
- **回归乐园一致性兜底**（`App.isHomeWorld`/`reconcileHomeWorld`，每回合 `callApi` 开头跑）：`worldName` 命中 `主神空间/专属房间/轮回乐园` 视为家园态——① `worldTime` 同步成 `paradiseTime`（顶/底时间一致，状态栏也即时显示同步值）；② 把 `worldName` 属于任务世界(非家园)的势力 `inCurrentWorld=false`（移出当前世界，修复"回归后旧任务世界势力仍挂当前世界"）。预设侧 `MISC_HOME_TIME_RULE`(注入杂项演化) + `FACTION_HOME_EXIT_RULE`(注入势力当前世界判断)：home 时世界时间必须=轮回历、旧任务世界势力全进 exits；势力按 `worldName` 是否等于当前世界判定进出（known 列表已带各势力 worldName 供比对）。**这些规则已写入预设文件**：`预设/势力演化.json`(加 `fac-entry-world`/`fac-entry-home-exit` 两条 entrySharedRules) + `src/data/miscDefaultPreset.json` & `预设/杂项演化.json`(双时间条目追加"回归乐园·时间一致")——代码注入 + 预设双保险。
- **预设条目化**：`miscStore.settings.entries`（默认 = `src/data/miscDefaultPreset.json` 14条），有**导入/导出/恢复默认**，与主角/NPC 演化同构（`extractMiscPresetFromJson`/`buildMiscSystemPrompt`）。
- 入口：设置 → 变量管理 → **「🧩 杂项演化」**(`MiscManager`，独立 API)。右侧导航 **📋 任务** → `MiscPanel`（任务/世界大事）。**小地图(SCENE_MAP)暂未实现**（预设条目保留可关闭）。

## 叙事记忆（关键词召回，`settingsStore.narrativeMemory` + `narrativeMemory.ts`）

把旧楼层按相关性召回注入正文（不用 embedding）：
- **关键词召回**：当前输入+上一条正文 → `tokenize`(中文2-gram) → 在 facts（miscStore 的长期事实/小总结/大总结/世界大事）里按命中度取 Top-K → 拼 `<相关记忆>` system 块；`callApi` 启用时替换 `historyLimit` 切片。
- **可选 LLM 两步法**：发送前 `narrativeCompile`（LLM 改写检索关键词，让召回找"相关"而非"最新"）+ 回复后 `runNarrativeIngestPhase`（LLM 抽取长期事实存 `miscStore.narrativeFacts`）。独立 `settingsStore.nmApi`，可分别选 compile/ingest 模型。
- **结构化档案召回**（`systems/structuredRecall.ts` + `App.buildStructuredRecall`）：解决"主正文 API 读不到结构化主角/NPC 数据"——主正文提示词本来只有预设+世界书+历史+facts召回，**不注入** playerStore/npcStore/characterStore。本功能把**主角(必含)** + **预测/在场 NPC** 的完整档案（身份/六维/状态/技能/天赋/装备，排除 addedAt/numeric 等 UI/内部字段）序列化成 `<在场与相关档案>` system 块注入正文。
  - NPC 选择：开 LLM 两步法时 `narrativeSelectChars`（`NM_STRUCT_SELECT_PROMPT` 预测下回合最可能登场的 NPC id）→ 否则 `rankNpcsLocal`（在场优先+好感）兜底。NPC 卡含**年龄**(`age`)。
  - **当前世界势力召回**（`serializeFactionsSection`）注入**全量信息**：所处世界(worldName)/规模/实力/状态/对主角态度/目标/首领/核心成员/地盘/资源/资产/关系/背景（限量 `structMaxFactions` 默认4）。
  - 限量（`settingsStore.narrativeMemory`，叙事记忆设置页可调）：`structEnabled`(默认开)、`structMaxNpcs`(默认2)、`structMaxSkills`(**仅主角**默认3，按品阶/新近)、`structMaxItems`(**仅主角**默认2，已装备优先)。**被选中的 NPC 给全量信息（所有技能/天赋/装备，不截断）**；技能/装备上限只作用于主角。注入块自带"参考资料而非剧情指令"说明，无需改主预设。
  - **主角装备精简注入**：`serializePlayerCard` 用 `playerItemLine`（区别于 NPC/通用的全量 `itemLine`）——主角装备**只注入 名称/类型/品级/杀敌数(killCount)/词缀(affix)/效果(effect)**，其余（数量/槽位/外观/获得/标签/备注）不注入，省 token。
- 入口：**设置主页 →「🧠 叙事记忆」**（独立页，不在变量管理里；含结构化档案召回开关与三个上限）。右侧导航 **🧠 记忆** → `SummaryPanel`（长期事实/小总结/大总结）。默认关（结构化召回随叙事记忆总开关生效）。

## 公共频道（契约者公共广场，`channelStore`/`channelTrade`/`ChannelPanel`）

轮回乐园契约者公共广场（单机=AI 模拟一群虚拟契约者）。七频道（综合/交易/组队/战斗/世界/情报/系统）。数据+设置+独立API+预设合一 `channelStore`(drpg-channel)，懒刷新（打开面板过期才刷 + 🔄 手动），走 `resolveApiChain('channel', textApi)`。右侧导航 **📡 频道**；设置→变量管理→📡 公共频道（`ChannelManager`）。**详细沿革见记忆 `public-channel-feature.md`**。要点：
- **交易**：NPC 出售帖一键购买；玩家求购/出售挂单 → `solicitQuotes` AI 报价 → `acceptQuote` 确定性成交（`channelTrade.ts`，AI 出帖/报价、代码确定性扣钱给物）；**成交后自动删帖**。
- **系统商店**（`SystemShop.tsx`，频道「🏪 系统商店」按钮，买/卖双 tab）：买=AI 生成 20 件(价偏高)批量购买（`genShopItems`）；卖=背包可卖物 AI 报价批量出售（`genSellQuotes`）。都走频道 API。
- **主角发言**（非系统频道底部输入框）：`addPlayerSpeak` 先把发言**立即上墙**（返回 postId）→ AI 生成回复 → `addOneSpeakReply` **逐条错峰**(450~1150ms)插到发言**上方**（增真实感）。Prompt 注入该频道**近 20 条**做上下文（对话延续感）。每条非己消息有「↩ 回复」→ **定向回复**：被回复者**第一条**回应（代码兜底 `replies[0]` 必为其本人），随后 2~4 个其他人插嘴；`ChannelMessage.replyToName` 记录回复对象。speak 消息单独限 10 条。

## 存档系统（IndexedDB 多存档，`saveDb`/`saveManager`/`SaveLoadPanel`）

- 一个存档 = 全部 9 个 `drpg-*` 的快照 + 对话历史 + 预览。`saveSlot/listSlots/loadSlot/renameSlot/deleteSlot/exportSlot/importSlot`。
- **读档用 reload**：写回 localStorage → 整页 reload（因 `gameStore` 是手写持久化、无 `persist.rehydrate()`，reload 才能让它+zustand 各 store 一起恢复）；对话经 `chatDb` 恢复，`sessionStorage(PENDING_STARTED_KEY)` 决定是否自动进游戏。
- **对话跨刷新自动保留**：`chatDb`（IndexedDB）逐条增量写（diff，流式只写变化的1条）；App 挂载 `chatDb.loadAll()` 回填 `messages`（仍是 useState，DB 是镜像）。
- **新游戏** `saveManager.newGame()`：清空**进度**（玩家/NPC/物品/角色技能词条记忆/主角档案/杂项数据/对话），**保留配置**（API/世界书/各预设/调度/提示词），reload 回封面。存档面板「🆕 新游戏」按钮（二次确认）。
- 入口：右侧导航 **💾 存档**；开始界面 **读取存档** 热区。

## 封面开始界面（`StartScreen.tsx`）

全屏封面图 `public/cover.jpg`（按原始比例居中、不裁剪），图上画好的三个按钮位置盖**透明点击热区**（开始游戏=onStart / 读取存档=打开存档面板 / 系统设置=onSettings）。换封面：覆盖 `public/cover.jpg` 再 build。

## 角色创建（开局，`CharacterCreation.tsx`）

「开始游戏」→ `setCreating(true)` 进入角色创建页（不直接 setStarted）。表单两阶段（form→confirm 确认表）：
1. **游戏难度**→可分配属性点：简单50/普通40/困难30/绝望20/无用之人10。
2. **选择乐园**：轮回乐园/圣光/死亡/天启/守望/自定义（自定义带文本输入）。
3. **基本信息**：姓名/年龄/性格/入园前职业。
4. **六维分配**：每项≤10，总和≤难度点数（实时剩余计数，超额禁用确认）。
5. **天赋**：名称+效果（自填）。
- `confirmCreation(d)`（App.tsx）：写 `playerStore`（name/homeParadise/profession/attrs/background 组合串）+ `addTrait('B1',天赋)` → `setStarted(true)` → 构建开场白 `buildOpening(d)` 作为首条 user 消息**自动发送** `callApi`。
- **开场白** `buildOpening`：默认模板结合姓名/年龄/性格/职业/乐园/天赋/六维，并要求「先给主角约一小时熟悉环境再展开」；`settingsStore.customOpening` 非空时改用自定义模板（占位符 `${name}/${age}/${personality}/${prevProfession}/${paradise}/${difficulty}/${talentName}/${talentEffect}/${attrs}`）。**设置→综合设置「自定义开场白」**可编辑。
- **所属乐园** `profile.homeParadise`（开局选定、基本不变）：主角侧栏「所属乐园」行 + 注入玩家快照/结构化召回；短指令 `character.B1.homeParadise="..."`（仅转移阵营等重大事件才改）；主角演化预设有 `所属乐园说明` 规则。

> 时间显示：`paradiseTime` 的纪元名是「**轮回历**」（曾误作「轮回力」，已全改：状态栏标签改 🕒 前缀、MiscManager/MiscPanel 标签、miscDefaultPreset/杂项演化预设值格式）。

## NPC 演化关键修复（避免覆盖/重复）

- **ID 防撞**（`applyEntryResult`）：`new` 角色若复用了已存在"真实角色"的 id，自动改分配下一个空闲 `C<n>`（本批次也跟踪），避免新角色覆盖旧角色。
- **同名去重**（`applyEntryResult` 的 `nameToId` map）：登场判断里 `new` 角色若与**已有真实角色**或**本批次刚建**的角色**同名**（trim 后精确匹配），不再新建，而是复用其 id 当作"重新登场"（setScene）。修复"一次生成两个同名 NPC"（一批两个同名 new、或 new 名字撞上已存在角色）。
- **防改名**（`applyColumns` 列1）：NPC 已有真实姓名时，后续阶段不能再用 `add` 列1把名字改掉（仅在无真名时填入）。
- **补全不重造**（`character_snapshot` 注入）：重点演化对齐原版"全量追溯补全协议"——`buildNpcPhaseSystemPrompt` 注入目标当前档案（`serializeNpcSnapshot`），指令明确"已建档只补全+增量更新，姓名/阶位/性格/背景/外观沿用，物品不在本阶段生成"。**根因**：预设引用 `${character_snapshot}` 但运行时曾未提供 → AI 当空角色重造（现已修）。
- **技能/天赋反累积**（重要）：`serializeNpcSnapshot` 现把该角色**已有技能（id/name/层级）与天赋（名/类型/评级）**一并注入快照，并加"反累积铁则"——技能≥6/天赋≥3 时不再新增，只有正文明确"学会/觉醒"清单外的新条目才加 1 个且复用原ID更新。预设 rule-45「战术三角」改为**仅技能清单为空时**一次性生成≤3核心技能；`npc-cot-step1` 全量追溯补全的 Skills/天赋 行加同款封顶。**根因**：旧快照不含技能/天赋 → AI 每轮以为是空角色用新ID重建 → 几轮后堆到十几个。
- **NPC 建档生成 HP/MP/六维/契约者身份**：`npc-cot-step1` 全量追溯补全新增「六维属性/HP-MP(EP)/契约者身份」行，rule-45 §1 与 rule-50 加「建档初始化例外」放宽"禁止补默认数值"——契约者/有阶位 NPC **首次建档**可一次性写 `attrs.*`、`hp.<id> = 当前/上限`、`mp.<id> = 当前/上限`、`arenaRank/brandLevel/contractorId`，之后不反复刷上限。代码 `applyNpcShortCommands` 的 hp/mp 短指令新增 `= 当前/上限` 语法同时设 maxHp/maxMp；NpcDetail 已有对应展示栏。
- **阶位/等级分离**（`一阶·Lv.8`）：NPC 列2/登场骨架/`身份-阶位参考`/`境界字段规范` 由修仙"阶位X层(进度%)/初期-中期-后期"全部改为轮回乐园 `阶位·Lv.当前等级|身份`（阶位一阶~无上之境，Lv 连续 1-140+）；`cr.<id> = 一阶/8` 解析器（App.tsx `crRe`）现输出 `一阶·Lv.8|（保留原身份）`。
- **进阶点数系统**（`advancePoints`，取代修仙进度%）：升级(Lv+1)所需资源，初始 0；**正文获取则增加、升级消耗则减少**。短指令 `ap.<id> += N`/`ap.<id> -= N`/`ap.<id> = N`（主角 `applyPlayerProfileCommands`、NPC `applyNpcShortCommands`）。每级所需按阶位递增表（一阶1万→九阶1000亿，见两预设「进阶点数系统/等阶宝典」）。字段：`PlayerProfile.advancePoints` + `NpcRecord.advancePoints`；UI：PlayerSidebar「进阶点数」行、NpcDetail「进阶点数」字段（取代旧「等阶进度%」）。主角等级走 `character.B1.level`，NPC 走 `cr.<id>`。
- **主角演化注入快照**（重要）：`buildPlayerSystemPrompt` 只拼接条目、**从不填 `${...}` 变量**——曾导致主角演化看不到自身等级/进阶点数/已有技能天赋。现在 `runPlayerEvolutionPhaseCore` 在拼接后 `replaceAll` 填入 `${character_snapshot}`（姓名/阶位Lv/进阶点数/六维/已有技能/已有天赋）+`${player_skills}`/`${player_traits}`，主角侧也获得反累积可见性。
- **NPC 技能层阶**：addSkill 第2列由修仙"一品·练气"改为技能层阶 `入门/精通/大师/宗师/极道·Lv.X`（对齐主角技能）。
- **右侧「✨ 技能」面板限主角**：`CharacterPanel` 的 `charIds` 现只取 B 系（`/^B\d+$/`），不再列 C/G NPC；NPC 技能/天赋走「📇 NPC」→ NpcDetail。
- **技能/天赋纯正文驱动**：进阶点数只用于角色阶位/Lv 升级；**技能层阶提升、天赋觉醒/升级不消耗进阶点数**，只凭正文明确证据走 `addSkill`/`addTalent`（两预设已写明）。
- **删除修仙修为卡系统**：两预设移除「技能进展卡/技能主进度」（`<skill_card>`/`<cultivation_card>` 同步自检、`cr.B1.p`、第9列 技能主进度键）——这套修仙修为进度结算已由进阶点数取代。主角 COT 的 4.1C 改为「等级/进阶点数同步自检」，4.1D「技能事件同步自检(addSkill)」保留。
- **主角外观/位置更新修复**（根因+修法）：侧栏「外观描写/所处位置」读 `profile.appearance/location`，但旧预设用 `add("B1",{"16":动作\|穿着\|位置\|身段\|样貌,"10":背景})` 列写法输出 → 写不进 profile。修法：① `applyPlayerProfileCommands` 新增解析 `add("B1",{...})`，把列16(取穿着/身段/样貌→appearance、位置→location)、列10→background 同步进 profile；② 主角演化注入的 `${character_snapshot}` 加「当前外观/当前位置」让 AI 能对比更新。`character.B1.appearance/location` 直写路径仍有效。
- **并发/调度设置**（`npcEvoStore.settings.scheduling`，对齐原版 `batchSize/modelPerTurnLimit/requestTimeout`）：`concurrency`(默认2，端点常 524 时调低)、`modelPerTurnLimit`(每回合最多演化数,0=不限)、`requestTimeout`、`retryCount`、`targetMode`(auto/manual)、`skipDead`、`manualFocusIds`。`npcChatCompletion` 带客户端超时。注意 **524 超时会表现为 CORS 报错**（超时响应无 CORS 头）；缓解=降并发/切策略A/换端点。

## 右侧导航按钮映射（`App.tsx` rightMenuItems onClick）

已接线：装备/背包/技能(CharacterPanel)/NPC(NpcPanel)/**势力(FactionPanel)**/**领地(TerritoryPanel)**/**冒险团(AdventureTeamPanel)**/**回合洞察(TurnInsightPanel)**/**任务(MiscPanel)**/**记忆(SummaryPanel)**/**存档(SaveLoadPanel)**/设置。其余 label 暂未接。
