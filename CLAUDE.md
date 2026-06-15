# CLAUDE.md

本仓库的总览与铁则。**精简版**——只放每轮都需要的：构建命令 + 架构地图 + 跨切面铁则。
功能细节查 `docs/FEATURES.md`，代码定位查 `docs/CODE_MAP.md`。

> ## ⚙️ 工作流（省 token，务必遵守）
> 1. **改动前先读 `docs/CODE_MAP.md`** 定位到 文件 + 函数/组件名。
> 2. `Grep` 那个名字拿当前行号 → `Read` 只读那一段（offset/limit）。**不要整文件读**（App.tsx 32万字符、SettingsPanel 11万、NpcDetail 6万）。
> 3. 要功能的"为什么/规则/历史坑"才去读 `docs/FEATURES.md` 对应小节（按 TOC 用 offset/limit）。
> 4. 改 AI 提示词规则：优先改 App.tsx 顶部"代码注入铁则"常量（改即生效，无需重导预设）。

---

## 项目概览

- **`zhushen-space/zhushen-space/`** — 主神空间·无限流，React18+TS+Vite+Zustand+Tailwind 的 AI RPG（轮回乐园主题）。**主要工作目录**。注意是**两层同名**目录，内层才是真项目（含 index.html/package.json/node_modules）。
- **`______.json`** — 轮回乐园世界书（127条），AI 世界观设定。
- **`完整版-主角演化（轮回乐园适配）.json`** — 原版完整预设蓝本（全阶段 prompts）。"看原版怎么写"多指它。
- **`预设/*.json`** — 供前端各演化管理子页导入（主角/物品/NPC/势力/领地/冒险团/杂项演化）。
- **`docs/FEATURES.md` / `docs/CODE_MAP.md`** — 功能细节 / 代码地图（本文件的两个下游）。
- 集成指导 md（仓库根）+ `fanren-remake-public-assets/`（移植参考源,多数新功能从它移植）。

## 构建 / 开发命令（在 `zhushen-space/zhushen-space/` 下）

```
npm install
npm run dev                      # localhost:5173
.\node_modules\.bin\vite build   # 构建 dist/（推荐：本地二进制，跳过 tsc）
npm run build-vectors            # 建小说向量库（需 $env:EMBED_KEY）
npm run build-vectors-wb         # 建世界书向量库
```

> **构建铁则**：
> - **始终用 vite build 跳过 tsc**。`npm run build`（tsc && vite build）因 `WorldSelector.tsx` 等**预存 TS 错误**会失败——这些不是真 bug，esbuild/vite 忽略。tsc 仅用来抓"我这次改动新引入的"类型错。
> - 用**本地二进制** `.\node_modules\.bin\vite build`（裸 `npx vite build` 可能命中远程 rolldown-vite 报 `Cannot resolve entry module index.html`）。必须在内层 `zhushen-space/zhushen-space/` 目录。
> - PowerShell 校验：**勿对原生命令用 `2>$null`**（会把 chunk 警告当错误、误报 `$?=false`）；看到 `✓ built in …` 即成功。
> - 改 `src/` 后必须重新 `vite build` 才更新 `dist/`（前端加载 dist/）。dist/ 已 gitignore。
> - 无测试框架。用户负责 commit+push → Cloudflare Pages 自动部署（zhushen-space.pages.dev）。

---

## 架构地图

### Store（Zustand+persist→localStorage，key `drpg-*`）
gameStore`drpg-save`(玩家hp/mp/atk/def,手写持久化无rehydrate) · settingsStore`drpg-settings`(API/世界书/预设/正则/apiLibrary/apiRoutes/narrativeMemory) · itemStore`drpg-items`(背包/4货币) · playerStore`drpg-player-evo`(主角演化+profile身份档案+成就) · npcStore`drpg-npc`(NPC档案/持有物/场景/好友/临时队) · npcEvoStore`drpg-npc-evo`(策略A·B/调度) · factionStore/factionEvoStore · adventureTeamStore`drpg-team` · territoryStore`drpg-territory` · cosmosStore`drpg-cosmos` · characterStore`drpg-characters`(技能/天赋/称号/副职业/记忆,B1+Cx共用) · memoryStore · miscStore`drpg-misc`(任务/总结/narrativeFacts/双时间) · imageGenStore · channelStore · dmStore · turnInsightStore · creationTemplateStore · novelVecStore`drpg-novelvec` · variableStore。
> 详细职责/action 见 `CODE_MAP.md §5`。

### 非 store 持久化（IndexedDB）
chatDb`drpg-chat`(对话增量,跨刷新保留) · saveDb+saveManager`drpg-archive`(多存档,读档靠 reload) · imageDb+imageSync`drpg-images`(图片,太大不进 localStorage,各 store partialize 排除) · novelVec`drpg-novelvec` · wbDb(世界书)。

### AI 多阶段（`App.tsx`）
主叙事 `callApi` → 解析 `<state>`/`<upstore>` → `runPostNarrativePhases` **并发**触发：物品管理 / 主角演化 / NPC演化(策略B三段管线) / 势力 / 领地 / 冒险团 / 万族 / 杂项 / 生平压缩 / 叙事记忆回写 / 生图。**互不阻塞**，物品管理绝不 await NPC。物品+主角对账**合并一次**(`runMergedAuditPhase`)。
> 各阶段函数位置见 `CODE_MAP.md §2`；行为细节见 `FEATURES.md §2/§5-§9`。

### 指令解析（`systems/stateParser.ts`）
`<state>`=逐行 `key = / += value`（内置玩家key + `hp.C1`/`eq.B1`/`character.<id>.*`/货币 等短指令）。`<upstore>`=helper 调用（`createItem`/`addSkill("B1",{})`/`add("C1",{列})`/`addFaction` 等）。**`lenientJsonParse`** 容忍 AI 裸键/单引号/尾逗号——所有解析器都用它。
> 全量指令清单见 `FEATURES.md §3`。

---

## 跨切面铁则（任何改动都要记得）

- **代码注入"铁则"常量**：App.tsx 顶部模块作用域有一批硬编码提示词规则（`NARRATIVE_FIRST_RULE`/`SKILL_TIER_RULE`/`TALENT_NO_CAP_RULE`/`ITEM_FIXED_FORMAT_RULE`/`FACTION_FULL_FORMAT_RULE`/`IMAGE_TAGS_RULE`/`MERGED_AUDIT_*` 等），各 `run*Phase` 拼完导入预设后追加。**改提示词规则优先改这里**（对当前存档即时生效，无需重导预设）。清单见 `CODE_MAP.md §4`。
- **多接口路由**：调用 AI 一律 `resolveApiChain(featureKey, legacy)` + `apiChatFallback`（轮流+失败切换）。新功能接 AI 别裸 fetch。
- **持久化即存档**：`drpg-*` 刷新不清是机制。彻底重置=清 `drpg-` 开头 localStorage。图片在 IndexedDB（partialize 已把 avatar/image 排除出 localStorage，别加回去）。新 store 要纳入 saveManager 快照 + clearProgress。
- **名称匹配**：同名更新/按名删除用 `nameEq`(characterStore/territory/team)；物品用 `fuzzyFindItem`。引用已有条目让 AI 照抄完整名（`*_EXACT_REF_RULE`）。
- **轮回乐园术语**：阶位(一阶~无上之境)/天赋(D-SSS,无上限)/技能品级(普通~极境7档)/进阶点数/乐园币·魂币。改预设/提示词须沿用统一映射（境界→阶位、灵根→天赋、功法→技能书…见 `FEATURES.md §18`），勿让修仙词回流。
- **六维纯 AI 生成**，前端只算衍生 ATK/DEF（`derivedStats.ts`）。HP/EP 上限按六维换算(体×20/智×15)。
- **存档/读档用 reload**（gameStore 无 rehydrate）。新开档防历史泄漏靠 `messagesRef.current`。

---

## 右侧导航按钮（`App.tsx` rightMenuItems）
已接线：装备 / 背包 / 技能(CharacterPanel) / 称号 / 成就 / 副职业 / NPC / 势力 / 领地 / 冒险团 / 万族 / 回合洞察 / 任务(MiscPanel) / 记忆(SummaryPanel) / 频道 / 私信 / 好友 / 存档 / 设置。设置→变量管理=演化功能中心启动台(`VariableManager`)。
