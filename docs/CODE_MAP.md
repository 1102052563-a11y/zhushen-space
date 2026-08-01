# CODE_MAP — 代码定位地图

> **改动前先读这个文件**，定位到具体文件 + 函数/组件名，再 `Grep` 那个名字拿到当前行号，最后 `Read` 那一段（用 offset/limit）。**不要整文件读**——App.tsx 32万字符、SettingsPanel 11万、NpcDetail 6万，整读极费 token。
> 行号是"写这份文档时"的近似值，会随编辑漂移；**以函数名为准去 grep**。

---

## 1. 功能 → 文件 反查表

| 想改… | 主要文件（函数/区域） |
|---|---|
| 主叙事调用 / 流式 / 召回注入 | `App.tsx` → `callApi` |
| 正文完成后并发触发哪些演化阶段 | `App.tsx` → `runPostNarrativePhases` |
| `<state>` / `<upstore>` 指令解析与应用 | `systems/stateParser.ts` |
| 物品/装备/货币指令 | `systems/stateParser.ts` → `applyItemCommands`；`store/itemStore.ts` |
| 物品阶段 / 综合对账纠错 | `App.tsx` → `runItemManagementPhaseCore` / `runMergedAuditPhase` |
| 物品重复（同物两条·一条有详情一条空壳） | `App.tsx` → `reconcileDeferredCreates`；`systems/stateParser.ts` → `deferredCreateSkipReason`(补建前三道判定) / `findIdenticalItem`(创建闸门判重)；`systems/itemWatchdog.ts` → `pruneBlankDupItems`(回合末空壳清理) |
| 主角演化 | `App.tsx` → `runPlayerEvolutionPhaseCore` / `applyPlayerProfileCommands`；`store/playerStore.ts` |
| NPC 演化（策略A/B、登场判断、调度） | `App.tsx` → `runNpcPipelineB` / `runEntryJudgment` / `computeFocusList`；`store/npcStore.ts` / `npcEvoStore.ts` |
| 🕸 NPC 关系图谱 | `systems/relationGraph.ts`(建图+ego子图+力导向布局·纯函数) → `components/RelationGraph.tsx`(SVG渲染)；入口：`NpcPanel` 头部「🕸 图谱」全局图 / `NpcDetail` 关系页 ego 局部图 |
| 📖 NPC 成长小传 | `npcStore.NpcRecord.lifeStory`；规则 `promptRules.NPC_LIFE_STORY_RULE`；自动生成 `App.tsx` → `runNpcEvolutionForTarget` 解析 `<小传>` 块；手动补写 `systems/npcLifeStory.ts` → `NpcDetail` 的 `LifeStoryBox` |
| 势力演化 | `App.tsx` → `runFactionEvolutionPhase` 等；`store/factionStore.ts` / `factionEvoStore.ts` |
| 领地 / 冒险团 / 万族 演化 | `App.tsx` → `runTerritory…` / `runTeam…` / `runCosmos…`；对应 store |
| 杂项演化（总结/双时间/天气/大事） | `App.tsx` → `runMiscEvolutionPhase`；`systems/miscParser.ts`（`applyMiscCommands` 支持 `domain:'tasks'/'world'` 域过滤）；`store/miscStore.ts` |
| 任务演化（独立阶段·主线路线图/环推进/结算·独立API featureKey='quest'） | `App.tsx` → `runQuestEvolutionPhase` / `manualGenTask`；开关+API 在 `miscStore.settings.questEnabled`/`questApi`；UI `components/QuestManager.tsx` |
| 生平压缩 | `App.tsx` → `runMemoryCompressionPhase`；`store/memoryStore.ts` + `characterStore.memory` |
| 叙事记忆（召回/改写/抽取/结构化档案） | `App.tsx` → `buildStructuredRecall` / `narrativeCompile` / `runNarrativeIngestPhase`；`systems/narrativeMemory.ts` / `structuredRecall.ts` |
| 向量资料库（原著+世界书语义检索） | `systems/novelVec.ts`；`store/novelVecStore.ts`；`components/NovelVecManager.tsx`；建库 `tools/build-novel-vectors.mjs` |
| 技能/天赋/称号/副职业/成就/记忆 数据 | `store/characterStore.ts`（B1+Cx 共用）；成就在 `store/playerStore.ts` |
| 技能/天赋指令 | `systems/stateParser.ts` → `parseAllCharCommands` / `applyCharacterCommands` |
| 职业技能树（潜能点·节点解锁·可视化编辑） | `systems/skillTree.ts`（确定性结算/校验）；`store/skillTreeStore.ts`；`components/SkillTreePanel.tsx`(玩家🌳)/`TreeCanvas.tsx`(共享SVG)/`SkillTreeManager.tsx`(编辑器)；提示词 `SKILLTREE_GEN_PROMPT` |
| 自定义能量条（HP/EP外·剧情/技能消耗/战斗累积·仅主角） | `store/resourceStore.ts`；上限/累积 `systems/playerVitals.ts`(`playerResourceMax`/`applyCombatResourceGains`/`resetCombatResources`)+`derivedStats.ts`(`computeAttrPool` 六维公式)；指令 `res.B1.<id>` 在 `systems/stateApply.ts`；注入 `systems/structuredRecall.ts`；UI `components/PlayerSidebar.tsx`(⚡管理+🎯技能绑定)；技能消耗/门槛 `skill.numeric.resCost/resGate`+`components/CombatPanel.tsx`；战斗累积钩子 `App.tsx`→`resolveAndNarrate`(出手+DoT) |
| 衍生属性 / HP·EP 上限 / 阶位↔等级 | `systems/derivedStats.ts` |
| 装备槽位 | `systems/equipSlots.ts`；`components/EquipmentPanel.tsx` / `NpcEquip.tsx` |
| 骰子判定 | `systems/diceEngine.ts`（确定性）/ `diceJudge.ts`（AI裁判）；`components/DicePanel.tsx` / `DiceManager.tsx` |
| 装备强化（仅乐园·看板娘·爆装保底） | `systems/enhanceEngine.ts`（确定性摇率/费用/爆装/保底）+ `enhanceBosses.ts`（分阶段立绘 manifest）；`store/enhanceStore.ts`；`components/EnhancePanel.tsx` / `EnhanceManager.tsx`；`App.tsx`→`runEnhanceFinalizePhase`/`enhanceBanter`；立绘 vite 插件 `syncEnhanceBosses`(vite.config) |
| 装备工艺（🔨锻造潜力/精髓/腐化/自创） | `systems/equipCraft.ts`（潜力·结果摇号·参数夹取·风险定价）；`store/equipCraftStore.ts`；UI = `EnhancePanel.tsx`→`CraftView`；`App.tsx`→`runEquipCraftPhase`/`confirmEquipCraft`/`extractEssence`/`runCraftProcessGenPhase`；提示词 `EQUIP_CRAFT_RULE`/`CRAFT_PROCESS_GEN_RULE`；分享 `workshop.ts` KIND `craftProcess` |
| 编年史 / 传奇模式（📜本纪+前尘） | `systems/chronicle.ts`（史料投影·重要性分级·分卷·互链·摘要）；`store/chronicleStore.ts`（rowMeta 分卷索引 + 编纂正史）；`components/ChroniclePanel.tsx`；分卷索引钩子在 `systems/tableEditParser.ts`→`applyTableEdits`（纪要行 insertRow 处）；`App.tsx`→`runChronicleCompilePhase`/`collectDeedSources`/`knownEntities`；提示词 `CHRONICLE_COMPILE_RULE` |
| 楼层分支树（🌿弃稿=可回收平行线） | `systems/branchTree.ts`（切回合·挂载·泳道布局·纯函数）；`components/BranchTreePanel.tsx`（SVG 时间线 + `usePinchPanZoom`）；存取全在 `systems/saveManager.ts`→`BRANCH_PREFIX`/`saveBranchPoint`/`listBranchPoints`/`pruneBranchPoints`/`setBranchPinned`/`deleteBranchPoint`/`clearBranchPoints`；抓取点 `App.tsx`→`stashDiscardedBranch`(在 `rollbackTurn`/`regenerateTurn` 的 loadSlot **之前**)/`bookmarkBranchPoint`/`jumpToBranch`；开关 `settings.branchCapture` |
| 冒险团派遣（⚔离线委托·倒数封条） | `systems/dispatchEngine.ts`（委托板生成/胜算评估/**确定性结算**/心跳 `runDispatchTick`/`ensureBoard`/`launchDispatch`/`grantReward`）；AI 委托板 `systems/dispatchGen.ts`（手动）；提示词常量 `systems/dispatchPrompts.ts`；战报 `systems/dispatchReport.ts`（**独立 API featureKey='dispatch'**·只叙述不改数值·失败回落 `fallbackReport`）；数据+哑 reducer 在 `store/adventureTeamStore.ts`（`dispatchActive`/`dispatchHistory`/`fatigue`/`injury`/`dispatchApi`）；UI `components/DispatchPanel.tsx`（挂在 `AdventureTeamPanel` 的 ⚔派遣 tab）；心跳挂 `App.tsx`→`runPostNarrativePhases`（**排在 `runNpcAutonomy` 之后**）；⚠ 轨道A 靠 `npcAutonomy.runNpcAutonomy` 里的 `dispatched` 集合让开、防双写 |
| 内置原著WIKI（📚两本·MkDocs 静态站） | `components/WikiPanel.tsx`（`SITES` 表=选书卡+iframe；先选书后加载）；右栏入口 `App.tsx`→`rightMenuItems` 的 `原著WIKI` + `runNavAction`/`wikiOpen`；构建 `vite.config.ts`→**`WIKIS` 表** + `buildWiki()`（每次 build 跑 mkdocs，单站失败不阻断另一站与游戏）。源 = 仓库根 `lunhui-wiki/`→`public/wiki/`、`神秘复苏百科/`→`public/wiki-shenmi/`（产物均 gitignore）。⚠ 加书 = **两处表都要加**且产物目录对得上；各 `mkdocs.yml` 必须 `use_directory_urls: false`（否则目录式 URL 被 SPA 兜底吃回游戏）+ `navigation.prune`（否则整棵 nav 嵌进每页）。神秘复苏的 nav 由 `神秘复苏百科/scripts/gen-nav.py` 生成（新增条目后重跑） |
| 正文关键词悬浮图鉴（名词 tooltip） | `systems/codexIndex.ts`（名字→词条索引·惰性重建·扫描器）；标注在 `systems/narrativeHtml.ts`→`markEntities`（挂在 `styleProse` 末尾·`ProseCtx` 贯穿整条消息）；悬浮卡 `components/CodexHover.tsx`（document 委托·portal）；wiki 层 `systems/lunhuiChars.ts`；开关 `settings.reading.codexHl`/`codexWiki`；样式 `index.css` `.zs-ent` |
| 生图（NAI/OpenAI/Gemini/Comfy/多模态Chat） | `systems/imageGen.ts` / `imageTags.ts`；`store/imageGenStore.ts`；`App.tsx` → `runPortraitPhase`/`runEquipImagePhase`/`runStoryImagePhase` |
| 📖 漫画工坊（楼层→分镜→并发绘画） | `systems/comic.ts`（编排：`listFloors`/`generateComic`/`retryMissingPages`/`redrawPage`/`cancelComic`）；`systems/comicDb.ts`（IndexedDB `drpg-comics`·批次+页·**不进 saveManager**）；`store/comicStore.ts`（`drpg-comic` 设置 + `useComicJob` 运行时进度）；提示词 `promptRules.ts`→`COMIC_STORYBOARD_RULE`/`COMIC_SOFTEN_RULE`/`COMIC_DRAW_GUARD`；UI `components/ImageGenManager.tsx`→`ComicTabPage`（生图设置「漫画」Tab）；分镜 LLM 走 `resolveApiChain('comic_storyboard_llm')` |
| 🖼 生成图片库（按名字分组浏览·漫画自成一类） | `systems/gallery.ts`（`collectGallery` 只读聚合：角色 avatar/装备 item.image(同名合并)/正文配图(chatDb 行内 images·带提示词·限150张)/漫画(comicDb 一批一组)）；UI `components/ImageGenManager.tsx`→`GalleryTabPage`（生图设置「图片库」Tab·分类筛选+名字瓷砖+灯箱翻看/提示词/下载/📤分享到交流室）|
| 🖼 交流室图片分享（公共图片区·频道） | worker：`multiplayer-worker/src/chatImage.js`（POST/GET `/api/chat/image[s]`·R2 `img/` 内容寻址+D1 `chat_images`·公共池 `?scope=public`·**需 redeploy relay**）+ `ChatDO.js` `case "image"`（只透传 {hash,w,h,caption} 引用·不广播大图）；前端：`systems/chatImages.ts`（`uploadChatImage`/`chatImageUrl`/`listPublicChatImages`/`shareImageToChannel`·频道名 `IMAGE_CHANNEL='images'`）、`chatProtocol.ts` `ChatImageRef`、`chatClient.image()/channel()`、`ChatRoomPanel` 频道页签(💬闲聊/🖼图片分享)+📷上传+🗂公共图池+灯箱 |
| 图片持久化（IndexedDB） | `systems/imageDb.ts` / `imageSync.ts` |
| 公共频道 / 系统商店 / 临时队伍 | `App.tsx` → `refreshChannel`/`replyToChannelPost`/`joinPartyFromPost`/`inviteToParty`；`store/channelStore.ts`；`systems/channelTrade.ts` |
| 私信（聊天/交易/讨价还价） | `App.tsx` → `dmReply`/`dmPropose`/`dmHaggle`/`dmAccept`；`store/dmStore.ts`；`systems/dmTrade.ts` |
| 好友栏 / 故友建档 | `App.tsx` → `addFriendByInfo`/`fleshOutContractor`；`store/npcStore.ts`（`setFriend`/`createArchivedContractor`）|
| 存档（多存档/新游戏/读档） | `systems/saveManager.ts` / `saveDb.ts`；`components/SaveLoadPanel.tsx` |
| 对话持久化（跨刷新） | `systems/chatDb.ts` |
| 中心 API 库 / 多接口路由 / fallback | `store/settingsStore.ts`（`apiLibrary`/`apiRoutes`/`resolveApiChain`）；`systems/apiChat.ts`（`apiChatFallback`）；`components/ApiRoutePicker.tsx` |
| 🤖 Agent 正文模式（工具循环产稿·仿 TauriTavern·独立旁路+独立API） | `systems/agent/`（`agentRuntime.ts` 循环+persist晋升+指引drain+评稿拦截`runReviewerOnce` / `agentTools.ts` 18工具 / `agentProtocol.ts` 双协议编解码+流式草稿抽取`extractNarrativePreview` / `agentWorkspace.ts` 虚拟FS+read-before-edit / `agentPrompt.ts` 拼系统提示词+指引/纠偏模板）；切口 `App.tsx`→`callApi` 内 `_agentCfg` 分支（onPreview 草稿楼层+0commit撤楼+reviewChain）；中途指引拦截 `App.tsx`→`sendMessage` 顶部（忙碌门之前）；开关钮 `ChatComposer.tsx`→`AgentModeToggle`（运行中发送钮=🎯提交指引）；时间线 `components/AgentTimeline.tsx`；journal+persist记忆+指引队列 `store/agentRunStore.ts`(`drpg-agentrun`·`persistFiles`/`submitGuidance`/`drainGuidance`)；配置档案 `settingsStore.agentProfiles`+`save/apply/deleteAgentProfile`；`db_query` 底层 `systems/tableSqlite.ts`→`agentSqlQuery`/`listSqliteTables`；洞察归档 `turnInsightStore.TurnSnapshot.agentRun`；设置 `SettingsPanel`→`AgentNarrativeSection`（`agentNarrative`/`agentApi`·featureKey='agent'/'agentReview'）；提示词 `AGENT_NARRATIVE_CONTRACT_RULE`/`AGENT_FLOW_RULE`/`AGENT_REVIEWER_RULE`；设计 `docs/AGENT_MODE_PLAN.md` |
| 角色创建 / 开场白 / 进入世界 | `App.tsx` → `confirmCreation`/`buildOpening`/`enterWorld`；`components/CharacterCreation.tsx` |
| 世界选择（AI 生成乐园） | `components/WorldSelector.tsx`（`generate(mode,override?)`：批量出全部 Roll / 每张卡 ✨ 单独生成累加）；`worldGenPrompt.ts` |
| 世界详情库（工坊档案→卡片生成/正文注入） | `systems/worldDetail.ts`（`fetchWorldDetailsFor`/`ensureWorldDetailFor`/`buildWorldDetailInjection`·三层覆盖 本地修订>全局修订>内置分片）；**分层注入引擎** `systems/worldDetailInject.ts`（分节/词条打分/阶段门控/预算常量）；切片插件 `vite.config.ts` `buildWorldDetailShards`；注入点 `WorldSelector.generate` + `App.tsx` callApi 世界志旁（正文=layered 传 ctxText·细纲=full）|
| 世界资料库面板（浏览/编辑/提交审核/全局生效） | `components/WorldDetailLibPanel.tsx`；本地修订 `store/worldEditStore.ts`(`drpg-worldedit`)；提交/审核 API `systems/worldDetailShare.ts`；服务端 `multiplayer-worker/src/worldDetail.js`（D1·管理员=工坊 adminKey）|
| 设置页路由（哪个子面板） | `components/SettingsPanel.tsx`（大路由）|
| 变量管理页（演化功能中心启动台） | `components/VariableManager.tsx` |
| 全局配置导出/导入（全部功能预设·世界书·API 一键备份迁移） | `systems/configExport.ts`；UI 在 `components/VariableManager.tsx` 底部 `ConfigBackupBar`（变量管理页最下方「配置备份·迁移」）|
| 顶部状态栏 / 双时间显示 | `components/StatusBar.tsx` |
| 代码注入的"铁则"提示词常量 | 大部分 `src/promptRules.ts`，少数 `App.tsx` 顶部（见 §4）|

---

## 2. App.tsx（约 4900 行，主控）— 内部函数地图

> 全在 `App()` 组件内闭包。按关注点分组，名字后是当前近似行号。

**发送 / 正文 / 编排**
- `callApi` (~4521) — 主叙事：拼 system+历史+召回+结构化档案 → 流式 fetch（内置多接口 fallback 循环）→ 解析 `<state>`/`<upstore>` → 触发 `runPostNarrativePhases`
- `runPostNarrativePhases` (~4478) — 正文后**并发**触发全部演化阶段（互不阻塞）
- `sendMessage` (~4802) / `stopGeneration` (~4787) / `rollbackTurn` (~4789) / `regenerateTurn` (~4794) / `captureUndoPoint` (~4783)
- `buildPresetMessages` (~1338) / `applyRegex` (~1285) / `onChatScroll` (~1172)

**物品阶段**
- `runItemManagementPhaseCore` (~1390) / `runItemManagementPhase` (~1598) / `triggerItemPhaseManually` (~1377)
- `runMergedAuditPhase` (~1501) — 物品+主角**合并一次**对账纠错
- `runEnhanceFinalizePhase` / `enhanceBanter` — 装备强化：停止强化收尾刷装备(每+4级+1词缀,纯AI,按 growthCoef 品级×评分缩放) / 点立绘吐槽(分阶段×性别语气)；grep 函数名定位

**主角阶段**
- `runPlayerEvolutionPhaseCore` (~1614) / `runPlayerEvolutionPhase` (~1725)
- `applyPlayerProfileCommands` (~2076) — 解析 `add("B1",{列})` + `character.B1.*` 短指令 → profile

**NPC 阶段**（策略 B 为主）
- `runNpcPipelineB` (~2508) — 三段管线总入口；`runEntryJudgment` (~2348) 登场判断；`applyEntryResult` (~2278) 建档/归档/去重防撞；`computeFocusList` (~2387) 调度选焦点（含好友轮换）；`runNpcFocusEvolution` (~2476) + `runNpcEvolutionForTarget` (~2428) 逐NPC并发
- `runNpcEvolutionPhaseCoreA` (~2578) 策略A；`runNpcEvolutionPhase` (~2616) 分支入口
- `triggerNpcUpdateManually` (~2377) — NPC 面板「⟳ 手动更新」按钮：绕过启用/频率/调度，对单个 NPC 按最近正文跑一次 `runNpcEvolutionForTarget`（状态 `npcManualUpdatingId`，props 经 NpcPanel→NpcCard/NpcDetail）
- `applyNpcShortCommands` (~1924) — `character.<id>.*` / `cr.` / `hp.` / `ap.` 等短指令
- `serializeNpcSnapshot` (~1831) / `buildNpcPhaseSystemPrompt` (~1884) / `buildEntryPhaseSystemPrompt` (~1911)
- `npcChatCompletion` (~1760) / `buildNpcVars` (~1778) / `trimNarrative` (~1753) / `passFrequency` (~2380) / `maybeAskCleanup` (~2460) / `backfillNpcStarterKits` (~2528)

**限时状态**：`applyTimedStatusCommands` (~2178) / `expireStatuses` (~2229，每回合开头按回合/游戏时过期)

**势力**：`runFactionEvolutionPhase` (~4270) / `runFactionWorldJudgment` (~4199) / `runFactionFocusEvolution` (~4230) / `runFactionStrategyA` (~4256) / `computeFactionFocus` (~4185) / `applyFactionShortCommands` (~4159) / `serializeFactionSnapshot` (~4174)

**领地 / 冒险团 / 万族**：`runTerritoryEvolutionPhase` (~2820) + `serializeTerritorySnapshot` (~2803)；`runTeamEvolutionPhase` (~3081) + `serializeTeamSnapshot` (~3064)；`runCosmosEvolutionPhase` (~2955) + `serializeCosmosSnapshot` (~2870) + `buildCosmosInjection` (~2894)

**杂项 / 任务 / 记忆压缩**：`runMiscEvolutionPhase`（总结/双时间/天气/大事，任务已拆出）；`runQuestEvolutionPhase`（任务演化独立阶段·紧邻其前）；`runMemoryCompressionPhase` (~2650)

**叙事记忆**：`buildStructuredRecall` (~3402) / `narrativeCompile` (~3373) / `narrativeSelectChars` (~3385) / `runNarrativeIngestPhase` (~3492) / `nmChatCompletion` (~3362) / `getNmApi` (~3358)

**生图**：`runPortraitPhase` (~3123) / `runEquipImagePhase` (~3212) / `runStoryImagePhase` (~3276)

**频道 / 临时队伍**：`refreshChannel` (~3526) / `replyToChannelPost` (~3593) / `joinPartyFromPost` (~3673) / `inviteToParty` (~3686) / `reconcilePartyLifecycle` (~3720) / `getChannelApi` (~3521)

**系统商店**：`genShopItems` (~4050) / `genSellQuotes` (~4066) / `solicitQuotes` (~4087)

**私信**：`dmReply` (~3801) / `dmPropose` (~3840) / `dmHaggle` (~3898) / `dmAccept` (~3929) / `dmGenArchive` (~4007) / `dmPersonaPrompt` (~3752) / `dmPlayerCard` (~3740) / `openDmFor` (~3733)

**好友 / 故友建档**：`addFriendByInfo` (~4024) / `addFriendFromChannel` (~4033) / `fleshOutContractor` (~3952) / `stripDeadWords` (~3944) / `findNpcByName` (~4019)

**六维代码层生成 / 正文兜底**：`applyNarrativeAttrs` (~4287，扫正文人物卡照抄六维) / `applyNarrativeVitals` (~4318，扫"当前HP/EP") / `genVariedAttrs` (~4379) / `autoGenMissingAttrs` (~4401) / `reconcileScenePresence` (~4457)
> 另有 `reconcilePlayerVitals` / `isHomeWorld` / `reconcileHomeWorld`（回归乐园一致性兜底）—— grep 函数名定位（可能为 const 箭头或在别处）。

**回合洞察**：`captureTurnSnapshot` (~4413) / `buildRecentNarrative` (~4441)

**创建 / 世界**：`confirmCreation` (~4854) / `buildOpening` (~4813) / `enterWorld` (~4887)

---

## 3. systems/（纯逻辑，无 React）

| 文件 | 关键导出 / 职责 |
|---|---|
| `stateParser.ts` | **指令解析中枢**。`lenientJsonParse`(裸键容错)、`parseAllStateUpdates`、`applyItemCommands`(物品/货币/装备，含 destroyItem 自动卸下、equip fallback、`setNpcOwnerResolver`)、`parseAllCharCommands`/`applyCharacterCommands`(技能/天赋/称号/副职业/成就/记忆)、`parseAllNpcCommands`/`applyNpcCommands`(add/de)、`parseAllFactionCommands`/`applyFactionCommands`、`applyTerritoryCommands`、`applyTeamCommands`、`isEquippable`、`CATEGORY_MAP` |
| `derivedStats.ts` | `computeDerived`(物/法 ATK/DEF)、`computeMaxHp`/`computeMaxEp`(=Σ六维×系数表,默认 体×20/智×15)、`VitalRatio`{hp,ep 系数表}/`ratioOf`/`hpCoefOf`/`epCoefOf`/`vitalFormula`(主角·NPC 自定义多属性系数表,缺省回退默认·兼容旧扁平字段)、`effectiveResource`、`lvFromRealm`/`realmFromLevel`、`TIERS`/`normalizeTier`、`gear/abilityMaxHp/EpBonus` |
| `attrBonus.ts` | `ATTR_KEYS`/`ATTR_LABEL`、`parseAttrBonus`(从 effect 文本抽属性加成)、`effectiveAttrs`、`computeAttrBreakdown` |
| `diceEngine.ts` | 确定性判定：`resolve`、各 `*Mod`(属性/技能/天赋/好感/装备/强度差)、`rollExpr`、`buildCheckResultBlock`、难度/强度表 |
| `enhanceEngine.ts` | 装备强化确定性逻辑：`resolveEnhance`(摇率/爆装/降级/保底)、`enhanceCost`(品级×评分×老板)、`scoreCostMul`/`growthCoef`、`stageFromLevel`、`DEFAULT_BOSSES`/`DEFAULT_TABLES`、`enhanceFxClass`/`isEnhanceable` |
| `enhanceBosses.ts` | 老板分阶段立绘清单：`loadBossManifest`/`pickStagePortrait`(读 public/enhance-bosses/manifest.json，中文路径 encode，空阶段就近回退) |
| `chronicle.ts` | 编年史史料聚合（📜传奇模式）。`buildVolumes`(把纪要表/世界记录/deedLog/归档任务投影成**卷→页→注**三层)、`classifyText`(金银灰三级重要性·确定性关键词表·不花API)、`volumeIdForRow`(分卷:turn 落区间→世界名→散佚卷三级降级)、`extractEntities`(实体互链)、`digestVolume`/`overallDigest`(切入点·本卷之最)、`buildCompileInput`+`sanitizeCompiled`(修史输入/产出夹取)。**只读投影不写 store**，全部数据源以参数传入便于单测 |
| `equipCraft.ts` | 装备工艺确定性引擎（与强化的赌等级**正交**：强化赌等级、工艺改词条）。`potentialMax`/`potentialLeft`(锻造潜力·随品级递增·耗尽封盘·品级进阶会抬高上限)、`canCraft`(门禁)、`resolveCraft`(摇结果+拍板全部数值·rand 可注入便于单测)、`craftPatch`(落库补丁)、`craftCost`/`planCraftPayment`(锚 gradeMidPark)、`sanitizeProcess`+`riskPricing`(**自创工艺平衡阀**：参数夹取＋净得利越高自动越贵)、`BUILTIN_PROCESSES`(潜能锻打/精髓灌注/虚空腐蚀)、`isPreviewMode`(单结果=确定性走预览确认·多结果=赌博即时结算)、精髓 `affixName`/`canInfuse` |
| `diceJudge.ts` | AI 裁判：`aiJudge`、`aiSuggest`(✨建议属性难度)、`buildJudgeBlock` |
| `imageGen.ts` | `generateImage(service,opts)`(NAI ZIP解码/OpenAI/Comfy轮询/`genChatImg` 多模态Chat出图·`opts.refImages` 参考图仅 chatimg 线用)、`buildPortraitPrompt`/`buildEquipPrompt`、`shrinkDataUrl` |
| `comic.ts` / `comicDb.ts` | 漫画工坊：`generateComic`(楼层→`toProse`清洗+角色roster→分镜JSON `zs_comic_v1`→并发错峰绘画·单页失败不拖累·成功页即落库)、`retryMissingPages`/`redrawPage`(复用存储的 finalPrompt)、`parseComicPlan`(lenientJsonParse+夹取)；comicDb=IndexedDB `drpg-comics`(batches+pages·库房性质·不进存档快照) |
| `imageTags.ts` | 列19 danbooru tags：`genPortraitTags`/`genEquipTags`、`tagsLlmReady`/`isTagService` |
| `imageDb.ts` / `imageSync.ts` | 图片存 IndexedDB `drpg-images`：`putImg`/`getAllImg`/`bulkPutImg`/`clearAllImg`；`imageSync` 订阅 store 镜像 + `hydrateImages`/`snapshotImages` |
| `novelVec.ts` | 向量资料库运行时：`loadNovelIndex`/`retrieveNovel`/`searchAll`/`embedQuery`/`novelVecStatus`（多源 novel+worldbook，IndexedDB `drpg-novelvec` v2） |
| `narrativeMemory.ts` | 关键词召回：`tokenize`/`recallFacts`/`buildNarrativeHistory`；提示词 `NM_COMPILE_PROMPT`/`NM_INGEST_PROMPT` |
| `structuredRecall.ts` | 结构化档案召回：序列化主角/NPC/势力卡（`serializePlayerCard` 等），供 `buildStructuredRecall` |
| `setBonus.ts` | **套装加成单一口径**（宝石套装 `gemSets` + 锻造套装 `equipSets` 的"取两边+合并"）：`setAttrEntries`(六维→合成装备条目)/`setPassive`(战斗被动)/`setDetailLines`(逐套详情行)。**消费方一律走这里**——PlayerSidebar / combatEngine.buildCombatant / structuredRecall / NpcDetail；各写各的时代漏抄过两次（正文注入漏六维+详情、NpcDetail 漏六维） |
| `relationGraph.ts` | 🕸 关系图谱数据层（纯函数·`relationGraph.test.ts` 17 例）：`buildRelationGraph`(解析列13扁平串·C编号与姓名两种写法都认·认不出留 ghost 节点·`|好感|≥60` 连虚拟边)/`egoSubgraph`(N跳邻域·保留入选点彼此的边)/`layoutRelationGraph`(确定性 Fruchterman-Reingold·种子来自节点id集合→两次打开不跳位·`centerId` 钉中心)/`classifyRelation`(关键词归六类·顺序即优先级)/`tierColor` |
| `npcLifeStory.ts` | 📖 成长小传手动补写/重写：`generateLifeStory`(走 `resolveApiChain('npc')`)/`extractLifeStory`(取 `<小传>` 块·AI 没包块时退回裸文本) |
| `miscParser.ts` | 杂项指令：`applyMiscCommands`(总结/双时间/天气/世界大事/`T_`任务)、`extractTurnSummaries` |
| `gameClock.ts` | 游戏时间：`parseGameMinutes`/`parseDurationMinutes`/`parseDurationTurns`/`fmtMinutes` |
| `equipSlots.ts` | `SLOT_DEFS`、`normalizeEquipSlot`/`pickEquipSlot`/`resolveEquipSlot`/`slotAcceptsCategory` |
| `dispatchEngine.ts` | 派遣引擎（零 token）：`rollOfferBoard`(语料库播种造委托·阶梯难度)/`estimateDispatch`(战力·原型匹配·疲劳·**队内宿敌盟友**·团阶 → 0~100 分+逐项拆解)/`settleDispatch`(**纯函数**·评级 E~SSS·伤亡/疲劳/战利品/货币)/`runDispatchTick`(每回合心跳·**到点才封存账本**)/`ensureBoard`/`launchDispatch`/`memberBlockReason`。⚠ 货币按阶位门槛（≤三阶乐园币 / ≥四阶魂币）；战利品与陨落复用轨道A 的 `autoGearFull` 上限与 `npcAutonomyDeath` 开关，不另开后门 |
| `dispatchReport.ts` | 派遣战报：`generateDispatchReport`(仅对**已封存**记录有效)/`buildLedgerBrief`/`fallbackReport`。走 `resolveApiChain('dispatch')`，一次派遣一次调用（不是每回合阶段） |
| `dispatchGen.ts` | 委托板 AI 生成（**手动·唯一触发点是面板按钮**）：`generateDispatchBoard(turn)` 读主角+团+每个成员档案出委托，每条带一件**字段填满的奖励物品**；`gradeForTier` 按委托阶位定奖励品级（吃世界阶上限表，前端锁死后喂 AI）。联网＝`dispatchWebSearch` 开时给 `extra:{tools:[{google_search:{}}]}`。⚠ 生成的板 `boardSource='ai'`，`ensureBoard` 见到就让开，**永不自动换批** |
| `dispatchPrompts.ts` | `DISPATCH_GEN_RULE` / `DISPATCH_REPORT_RULE` 两条常量单独成文件——**断环**用（promptRegistry 要 import 它们，dispatchGen/Report 又要 import getPrompt）。照 `abyssPrompts.ts` 的做法 |
| `branchTree.ts` | 分支树纯模型：`splitTurns`(线性对话→回合·按 id 归位)/`attachIndex`(分叉点→挂哪一回合后)/`buildBranchTree`(节点+边+泳道+坐标·长档只画最近 N 回合)/`digest`(剥结算块/HTML/think 的正文摘要)。不碰 store/IDB/React |
| `codexIndex.ts` | 悬浮图鉴词典：`getCodexIndex`(**惰性重建·store 切片引用比对·version 单调自增**)/`scanEntities`(首字快筛+最长匹配+seen 只标首次)/`usableName`(停用词·≥2字·拒 id 形态)/`lookupCodex`(只查不重建)。⚠ 零订阅、位置保持匹配（不做 normName 归一） |
| `lunhuiChars.ts` | 轮回 wiki 人物库加载器（`loadLunhuiCharacters` 模块级缓存·2.2MB 只拉一次）+ `parseLunhuiChar`(前言区/首段/别名)/`stripMd`。小剧场取材与悬浮图鉴 wiki 层共用 |
| `channelTrade.ts` | 频道交易：`buyFromListing`/`postWantToBuy`/`postSellItem`/`acceptQuote`/`isBuyable` |
| `dmTrade.ts` | 私信结算：`settleDmDeal`(确定性转账，对方收物入其NPC储存)/`dealSummary` |
| `apiChat.ts` | `apiChatFallback(chain,messages,opts)` 多接口轮流+失败切换 |
| `apiThrottle.ts` | `acquireApiSlot`(并发+最小间隔限流) |
| `chatDb.ts` | 对话 IndexedDB `drpg-chat`：`loadAll`/`putChanged`(增量)/`replaceAll`/`clearAll` |
| `saveDb.ts` / `saveManager.ts` | 多存档 IndexedDB `drpg-archive`：`saveSlot`/`loadSlot`/`newGame`/`autoSaveSlot`/`clearProgress` |
| `wbDb.ts` | 世界书条目 IndexedDB 存储 |
| `configExport.ts` | 全局配置导出/导入：`buildGlobalConfig`/`downloadGlobalConfig`/`importGlobalConfig`。白名单提取 15 个配置 store 的 `settings`+`*Api`+`*UseSharedApi`（剔运行时数据，世界书只导非 builtin），导入用 zustand `setState` 浅合并不污染游戏进度、无需 reload。**仅配置不含存档** |
| `combat.ts` | 旧战斗 `rollDamage`/`power`（大多未用） |

---

## 4. "代码注入铁则"提示词常量（**改即生效、无需重导预设**）

各 `run*Phase` 拼完导入预设后**追加**这些硬编码规则。改提示词规则**优先改这里**（对当前存档即时生效）：

`NPC_SELF_NARRATION_RULE`/`NPC_LIFE_STORY_RULE`(门控生成一次·前者第一人称自述、后者成长小传；均已进预设中心可玩家改) · `NARRATIVE_FIRST_RULE`(逐条参照正文) · `BUFF_AS_STATUS_RULE` · `SUBPROF_RULE` · `NPC_AGE_RULE` · `FACTION_WORLD_RULE` / `FACTION_FULL_FORMAT_RULE` / `FACTION_HOME_EXIT_RULE` · `ITEM_FIXED_FORMAT_RULE` / `ITEM_EXACT_REF_RULE` · `EVO_EXACT_REF_RULE` · `TALENT_NO_CAP_RULE` · `SKILL_TIER_RULE` · `IMAGE_TAGS_RULE` · `MISC_HOME_TIME_RULE` · `CHANNEL_AUTHOR_INFO_RULE` · `MERGED_AUDIT_SYSTEM`/`MERGED_AUDIT_PROMPT`
> **大部分常量已抽到 `src/promptRules.ts`（集中维护，改提示词来这里），少数仍在 App.tsx 顶部。grep 常量名即可跨文件定位。**

---

## 5. store/（Zustand + persist，localStorage 持久化）

| store | persist key | 职责 / 关键 action |
|---|---|---|
| `gameStore.ts` | `drpg-save` | 玩家 hp/mp/atk/def、副本/战斗。**手写持久化、无 rehydrate**（读档靠 reload）|
| `settingsStore.ts` | `drpg-settings` | API/世界书/文本预设/正则/`apiLibrary`/`apiRoutes`/`resolveApiChain`/`narrativeMemory`/`nmApi`/`customOpening` |
| `itemStore.ts` | `drpg-items` | 背包/4种货币/物品预设。`addItem`(可堆叠类累加)、`dedupeByName`、`isStackableCat`。图片经 partialize 排除 |
| `playerStore.ts` | `drpg-player-evo` | 主角演化预设/独立API/`profile`(身份档案)/`achievements` |
| `npcStore.ts` | `drpg-npc` | NPC 档案/持有物/场景/调度。`setFriend`/`createArchivedContractor`/`createPartyMember`/`dedupeNpcItems`/`absorbOrphans`/`hardRemoveNpc` |
| `npcEvoStore.ts` | `drpg-npc-evo` | NPC 演化预设/API/策略A·B/`scheduling`(并发/配额/好友数)；`buildNpcSystemPrompt`/`buildEntrySystemPrompt`/`smartFilterEntries` |
| `factionStore.ts` | `drpg-faction` | 势力档案 `FactionRecord`（`inCurrentWorld`）|
| `factionEvoStore.ts` | `drpg-faction-evo` | 势力演化设置/API |
| `adventureTeamStore.ts` | `drpg-team` | 冒险团（数据+设置+API 合一）。注意成员是 `upsertMember` 不是 addTeamMember。**派遣**也住这里：`dispatchBoard`/`dispatchActive`/`dispatchHistory`/`fatigue`/`injury` + `dispatchApi`/`dispatchReportAuto`；⚠ 全是哑 reducer，算账在 `systems/dispatchEngine.ts`（这样 `npcAutonomy` 能 import 本 store 做分流过滤而不成环） |
| `territoryStore.ts` | `drpg-territory` | 领地（数据+设置+API 合一）|
| `cosmosStore.ts` | `drpg-cosmos` | 万族演化 |
| `characterStore.ts` | `drpg-characters` | 技能/天赋/称号/副职业/记忆（B1+Cx 共用）。`mergeKeepRich`(空字段保旧)、`nameEq`(归一化匹配)、`SKILL_TIER_*`/`normSkillTier`、`removeCharacter`/`purgeNpcCharacters` |
| `memoryStore.ts` | `drpg-memory` | 生平压缩设置+提示词+API |
| `miscStore.ts` | `drpg-misc` | 杂项(任务数据/总结/`narrativeFacts`/双时间/天气)+预设+API；另挂任务演化的 `settings.questEnabled`+`questApi`/`questUseSharedApi`（独立阶段，merge 迁移旧档继承 enabled）。`addNarrativeFacts` |
| `imageGenStore.ts` | `drpg-image-gen` | 生图服务/用途/模板/自动开关；服务含 `chatimg`(多模态Chat出图·nano-banana系) |
| `comicStore.ts` | `drpg-comic` | 漫画工坊设置（服务/页数/尺寸/语言/参考图/送审软化/错峰间隔）；`useComicJob`=运行时任务进度（不持久化）|
| `channelStore.ts` | `drpg-channel` | 公共频道（数据+设置+API+预设）|
| `dmStore.ts` | `drpg-dm` | 私信线程/消息/交易卡 |
| `turnInsightStore.ts` | `drpg-turn-insight` | 回合洞察快照（滚动14份）|
| `creationTemplateStore.ts` | `drpg-creation-templates` | 角色创建模板 |
| `novelVecStore.ts` | `drpg-novelvec` | 向量资料库设置（embedding 接口/topK/阈值/maxChars）|
| `enhanceStore.ts` | `drpg-enhance` | 装备强化：老板名册/率表(配置)、`pity`垫子计数(账号级全局,不进存档/不导出)、`session`本轮日志。立绘 partialize→IndexedDB；`hydrateEnhancePortraits` |
| `chronicleStore.ts` | `drpg-chronicle` | 编年史：`rowMeta`(纪要行 row_id→{turn,world}·**分卷地基**·由 applyTableEdits 旁路记·上限4000) + `compiled`(AI 修的正史·按 WorldRecord.id)。都是本存档进度，随快照/新游戏清空。⚠ 丰碑(drpg-monument)是账号级、不在此列 |
| `equipCraftStore.ts` | `drpg-equipcraft` | 装备工艺：`settings.processes` 工艺库(内置3+自创)=**配置**(进 configExport/可传工坊/跨新游戏保留)；`essences` 精髓图鉴=**进度**(进 saveManager 快照,新游戏清空,遵守"库房只存不删")。`upsertProcess` 入库必过 `sanitizeProcess`(AI/工坊/手改 localStorage 都夹取)；内置工艺不可被覆盖。API 复用 enhanceApi |
| `skillTreeStore.ts` | `drpg-skilltree` | 职业技能树：`trees`模板库(配置/可分享) + 每角色`progress`(解锁进度/潜能点,随存档)。`unlockNode`(扣潜能点+灌 addSkill/addTrait)、`respec`、编辑器ops(addNode/addEdge拒环/...)。仅 B1 |
| `variableStore.ts` | — | 自定义变量（`<state>` 兜底查找）|
| `imageViewerStore` / `imageBusyStore` | — | UI 瞬时（看图/生图忙提示）|
| `composerStore` | — | UI 瞬时：`draft`/`fill(text)`，背包「使用」物品把「使用XX」填进主聊天输入框（App 订阅 draft→setInputValue+关背包+聚焦）|

> **所有 `drpg-*` 持久化，刷新不清是存档机制**。彻底重置=清 `drpg-` 开头 localStorage。图片大、存 IndexedDB `drpg-images`（不进 localStorage）。

---

## 6. components/（按用途）

**外壳/正文**：`StartScreen`(封面热区) · `CharacterCreation`(开局) · `SettingsPanel`(设置大路由) · `VariableManager`(演化功能中心启动台) · `StatusBar`(顶部双时间/天气) · `ErrorBoundary` · `Bar` · `VersionToast` · `ImageBusyToast` · `ImageViewer` · `CodexHover`(正文名词悬浮卡·document 委托·零 store 订阅；⚠**主返回与设置页早退各挂一份**，二者互斥不会同时出现)

**主角侧**：`PlayerSidebar`(身份档案/六维/状态，点击即编辑) · `PlayerEquipPanel`(左浮窗装备) · `CharacterPanel`(✨技能/天赋，仅B*) · `TitlePanel`(🎖称号) · `AchievementPanel`(🏆成就) · `SubProfessionPanel`(🛠副职业) · `ItemListPanel`(右下物品栏浮窗) · `StatusEffectChips`/`StatusChips`(状态胶囊) · `CharEditForms`(`SkillEditForm`/`TraitEditForm` 技能·天赋手动编辑表单，主角 CharacterPanel + NPC NpcDetail 共用，写 `characterStore.updateSkill/updateTrait`)

**装备/背包**：`EquipmentPanel`(⚔玩家装备槽) · `BackpackModal`(🎒储存空间，含 `CurrencyConverter` 乐园币↔灵魂钱币 1:15万) · `NpcEquip`(NPC装备)；三者装备卡均显 `+N` 强化角标

**NPC**：`NpcPanel`(📇档案列表·头部「🕸 图谱」入口) · `NpcDetail`(单角色11栏，导出 `SegmentedText`/`StatusChips`；关系页顶部嵌 ego 图，经历页含 `LifeStoryBox` 成长小传) · `OnScenePanel`(右上在场浮窗) · `RelationGraph`(🕸 纯SVG关系图·懒加载独立chunk：默认导出=全局弹窗，具名导出 `RelationGraphView`/`RelationEgoGraph`/`RelationLegend`)

**右侧导航面板**：`FactionPanel`(🏛) · `TerritoryPanel`(🏯) · `AdventureTeamPanel`(🛡) · `TurnInsightPanel`(🔍回合洞察) · `MiscPanel`(📋任务) · `SummaryPanel`(🧠记忆) · `CosmosPanel`(🌌) · `ChannelPanel`(📡频道) + `SystemShop`(🏪) · `DmPanel`(✉私信) · `FriendsPanel`(👥好友) · `SaveLoadPanel`(💾存档) · `DicePanel`(🎲in-chat骰子) · `EnhancePanel`(⚒强化所：左看板娘立绘+切换+吐槽气泡/中被强化装备+特效/右选装备+率+花费+日志)

**设置子页（演化管理）**：`ItemManager` · `PlayerManager` · `NpcManager` · `FactionManager` · `TerritoryManager` · `AdventureTeamManager` · `CosmosManager` · `MemoryManager` · `MiscManager` · `QuestManager`(任务演化:启用/任务闸门/正文注入/独立API) · `ChannelManager` · `ImageGenManager` · `NovelVecManager` · `DiceManager` · `EnhanceManager`(装备强化:老板名册/立绘文件夹/率表/API)

**API/其他**：`ApiRoutePicker`(多接口路由配置) · `ApiQuickPick`(旧,未引用) · `WorldSelector`(AI生成乐园) · `Hub`/`InstanceView`(旧副本，大多未用)

---

## 7. 其它

- **数据/工具**：`src/data/{monsters,events,instances,enhancements}.ts`(旧副本数据，多未用)、`src/worldGenPrompt.ts`、`src/types.ts`、`src/version.ts`
- **建库脚本**：`tools/build-novel-vectors.mjs`（`npm run build-vectors` 小说 / `build-vectors-wb` 世界书）
- **强化老板立绘**：源放仓库根 `图片/<老板>/阶段1~4/`(入库)；`vite.config` 插件 `syncEnhanceBosses` build/dev 同步进 `public/enhance-bosses/` + 生成 `manifest.json`(副本 gitignore)
- **Cloudflare 代理**：`functions/proxy/[[path]].js`（同源 CORS 透传，不存 key）
- **预设文件**（仓库根 `预设/*.json` + `src/data/*DefaultPreset.json`）：导入到各演化管理子页
