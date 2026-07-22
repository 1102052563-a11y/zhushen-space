# CLAUDE.md

总览与铁则（精简版）。功能细节 → `docs/FEATURES.md`；代码定位 → `docs/CODE_MAP.md`；**改动流程/规约（每次加改功能照这走）→ `docs/DEV_WORKFLOW.md`**。

> ## ⚙️ 工作流（省 token）
> 1. 改动前先读 `CODE_MAP.md` 定位 文件+函数名 → `Grep` 拿行号 → `Read` 只读那段。**勿整文件读**（App.tsx 32万字 / SettingsPanel 11万 / NpcDetail 6万）。
> 2. 要"为什么/规则/坑"才查 `FEATURES.md` 对应小节。
> 3. 改 AI 提示词：优先改 `src/promptRules.ts` 的提示词常量（即时生效，无需重导预设；少数常量仍在 App.tsx）。

## 项目概览
- **`zhushen-space/zhushen-space/`**（**两层同名，内层才是真项目**，含 package.json/node_modules）：React18+TS+Vite+Zustand+Tailwind 的 AI RPG（轮回乐园·无限流）。**主要工作目录**。
- 仓库根的 `______.json`(世界书)、`完整版-主角演化…json`(原版预设蓝本)、`预设/*.json`(各演化导入源)、`fanren-remake-public-assets/`(移植参考)：AI 内容/参考资料，非前端代码。

## 构建（在内层 `zhushen-space/zhushen-space/`）
```
npm run dev                      # localhost:5173
.\node_modules\.bin\vite build   # 构建 dist/（本地二进制，跳过 tsc）
npm run build-vectors[-wb]       # 建小说/世界书向量库（需 $env:EMBED_KEY）
```
> **铁则**：① tsc 已清零＋基线门禁（`npm run typecheck`=check-types.mjs，只拦新增错误）；`npm run build`=类型门禁+网络门禁(check-network.mjs)+vite build。快速迭代可仍用裸 `vite build`，但**收尾前门禁必须绿**（CI 也会跑）。② 用本地二进制、必须在内层目录（裸 `npx vite build` 可能报 entry module 错）。③ 勿对原生命令用 `2>$null`（会把 chunk 警告当错、误报 `$?=false`）；见 `✓ built in…` 即成功。④ 改 `src/` 后必须重 build 才更新 `dist/`（前端加载 dist/，已 gitignore）。⑤ 测试=vitest（`npm test`，引擎层102文件；组件无测试）；lint=`npm run lint`（hooks correctness）。用户负责 commit+push → Cloudflare 自动部署（zhushen-space.pages.dev）+ GitHub Actions CI（.github/workflows/ci.yml，五道门禁）。⑥ 线上崩溃自动上报：GET `https://zhushen-space.pages.dev/crash-report` 看最近记录（functions/crash-report.js→R2）。

## 架构地图
- **Store**（Zustand+persist→localStorage，key `drpg-*`）：game / settings / item / player / npc / npcEvo / faction(+Evo) / adventureTeam / territory / cosmos / character(技能·天赋·称号·副职业·记忆，B1+Cx 共用) / memory / misc / imageGen / channel / dm / turnInsight / creationTemplate / novelVec / variable / resource(自定义能量条·HP/EP外·仅主角)。职责/action 见 `CODE_MAP.md §5`。
- **非 store 持久化（IndexedDB）**：chatDb(对话增量) · saveDb+saveManager(多存档·读档靠 reload) · imageDb+imageSync(图片·partialize 排除出 localStorage) · novelVec · wbDb。
- **AI 多阶段（App.tsx）**：`callApi`→解析 `<state>`/`<upstore>`→`runPostNarrativePhases` **并发**触发各演化阶段（物品/主角/NPC/势力/领地/冒险团/万族/杂项/生平/记忆/生图），互不阻塞；物品+主角对账合并为 `runMergedAuditPhase`。位置见 `CODE_MAP.md §2`。
- **指令解析（systems/stateParser.ts）**：`<state>`=逐行 `key =/+= value`（含 `hp.C1`/`eq.B1`/`character.<id>.*` 等短指令）；`<upstore>`=helper（`createItem`/`addSkill`/`addFaction` 等）。所有解析走 **`lenientJsonParse`**（容忍裸键/单引号/尾逗号）。全量清单 `FEATURES.md §3`。

## 跨切面铁则（任何改动都记得）
- **代码注入铁则常量**：提示词规则（`*_RULE` / `MERGED_AUDIT_*`）大部分已抽到 **`src/promptRules.ts`**（少数仍在 App.tsx），各 `run*Phase` 拼接后追加在预设后。**改提示词优先改这里**（即时生效）。清单 `CODE_MAP.md §4`。
- **多接口路由**：调 AI 一律 `resolveApiChain(featureKey, legacy)` + `apiChatFallback`，别裸 fetch。
- **持久化即存档**：`drpg-*` 刷新不清；彻底重置=清 `drpg-` localStorage。图片在 IndexedDB（partialize 已排除 avatar/image，别加回）。新 store 要纳入 saveManager 快照 + clearProgress。
- **名称匹配**：同名更新/删除用 `nameEq`；物品用 `fuzzyFindItem`。引用已有条目让 AI 照抄全名（`*_EXACT_REF_RULE`）。
- **轮回乐园术语**：阶位/天赋(D-SSS 无上限)/技能品级(7档)/进阶点数/乐园币·魂币。改预设沿用统一映射（境界→阶位、灵根→天赋…见 `FEATURES.md §18`），勿让修仙词回流。
- **六维纯 AI 生成**，前端只算衍生 ATK/DEF（`derivedStats.ts`）；HP/EP 上限=六维按**自定义系数表**加权和（`hpRatio`/`epRatio`={属性:每点系数}，默认 体×20→HP / 智×15→EP，可混任意属性如 HP=体×10+智×5；主角存 `profile.hpRatio/epRatio`、NPC 存 `npc.hpRatio/epRatio`，缺省回退默认；各 `fullMaxHp/EP` 调用方用 `ratioOf(profile|npc)` 传入，玩家在主角血条面板/NPC 详情编辑的 6×2 矩阵里改）。
- **存档/读档用 reload**（gameStore 无 rehydrate）；新开档防历史泄漏靠 `messagesRef.current`。

## 右侧导航（App.tsx `rightMenuItems`）
装备 / 背包 / 技能(CharacterPanel) / 称号 / 成就 / 副职业 / NPC / 势力 / 领地 / 冒险团 / 万族 / 回合洞察 / 任务(MiscPanel) / 记忆(SummaryPanel) / 频道 / 私信 / 好友 / 存档 / 设置；设置→变量管理(`VariableManager`)=演化功能启动台。
